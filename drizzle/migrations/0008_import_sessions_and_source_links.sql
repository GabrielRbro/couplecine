-- 1) source_posts = source identity per space/canonical URL. Author-only update/delete.
ALTER TABLE public.source_posts
  ADD COLUMN IF NOT EXISTS caption_status text,
  ADD COLUMN IF NOT EXISTS caption_fetched_at timestamptz;
COMMENT ON COLUMN public.source_posts.work_id IS 'DEPRECATED: replaced by public.source_post_works (N:N); kept for history';
ALTER TABLE public.source_posts ADD CONSTRAINT source_posts_id_space_key UNIQUE (id, space_id);
ALTER TABLE public.works ADD CONSTRAINT works_id_space_key UNIQUE (id, space_id);
DROP POLICY IF EXISTS posts_access ON public.source_posts;
CREATE POLICY posts_read ON public.source_posts FOR SELECT TO authenticated USING (private.is_space_member(space_id));
CREATE POLICY posts_insert ON public.source_posts FOR INSERT TO authenticated WITH CHECK (private.is_space_member(space_id) AND created_by = auth.uid());
CREATE POLICY posts_update_own ON public.source_posts FOR UPDATE TO authenticated USING (created_by = auth.uid() AND private.is_space_member(space_id)) WITH CHECK (created_by = auth.uid() AND private.is_space_member(space_id));
CREATE POLICY posts_delete_own ON public.source_posts FOR DELETE TO authenticated USING (created_by = auth.uid() AND private.is_space_member(space_id));

-- 2) N:N source <-> work, same-space enforced by composite FKs.
CREATE TABLE public.source_post_works (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  source_post_id uuid NOT NULL,
  work_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_post_id, work_id),
  FOREIGN KEY (source_post_id, space_id) REFERENCES public.source_posts(id, space_id) ON DELETE CASCADE,
  FOREIGN KEY (work_id, space_id) REFERENCES public.works(id, space_id) ON DELETE CASCADE
);
CREATE INDEX source_post_works_work_idx ON public.source_post_works(work_id);
GRANT SELECT ON public.source_post_works TO authenticated;
GRANT ALL ON public.source_post_works TO service_role;
ALTER TABLE public.source_post_works ENABLE ROW LEVEL SECURITY;
CREATE POLICY spw_read ON public.source_post_works FOR SELECT TO authenticated USING (private.is_space_member(space_id));
INSERT INTO public.source_post_works (space_id, source_post_id, work_id, created_by, created_at)
  SELECT space_id, id, work_id, created_by, created_at FROM public.source_posts WHERE work_id IS NOT NULL
  ON CONFLICT DO NOTHING;

-- 3) Personal import sessions and candidates.
CREATE TABLE public.import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'analyzing' CHECK (status IN ('analyzing','review','needs_help','interrupted','completed')),
  origin text NOT NULL CHECK (origin IN ('share','manual','capture')),
  shared_title text,
  shared_text text,
  shared_url text,
  source_post_ids uuid[] NOT NULL DEFAULT '{}',
  note text,
  ai_done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_sessions_owner_idx ON public.import_sessions(created_by, updated_at DESC);
GRANT SELECT ON public.import_sessions TO authenticated;
GRANT ALL ON public.import_sessions TO service_role;
ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_sessions_own ON public.import_sessions FOR SELECT TO authenticated USING (created_by = auth.uid() AND private.is_space_member(space_id));

CREATE TABLE public.import_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.import_sessions(id) ON DELETE CASCADE,
  space_id uuid NOT NULL,
  created_by uuid NOT NULL,
  source_post_id uuid REFERENCES public.source_posts(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  media_type media_type NOT NULL,
  tmdb_id integer NOT NULL,
  title text NOT NULL,
  original_title text,
  year integer,
  poster_path text,
  backdrop_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','skipped','saved','error')),
  reaction interest_reaction CHECK (reaction IS NULL OR reaction IN ('fire','like','neutral')),
  seen boolean NOT NULL DEFAULT false,
  corrected boolean NOT NULL DEFAULT false,
  work_id uuid REFERENCES public.works(id) ON DELETE SET NULL,
  effects jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX import_candidates_identity ON public.import_candidates(session_id, coalesce(source_post_id, '00000000-0000-0000-0000-000000000000'::uuid), media_type, tmdb_id);
CREATE INDEX import_candidates_session_idx ON public.import_candidates(session_id, position);
GRANT SELECT ON public.import_candidates TO authenticated;
GRANT UPDATE (status) ON public.import_candidates TO authenticated;
GRANT ALL ON public.import_candidates TO service_role;
ALTER TABLE public.import_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_candidates_read_own ON public.import_candidates FOR SELECT TO authenticated USING (created_by = auth.uid());
-- Direct client update only toggles pending <-> skipped (recoverable skip). Everything else goes through RPCs.
CREATE POLICY import_candidates_skip_own ON public.import_candidates FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND status IN ('pending','skipped'))
  WITH CHECK (created_by = auth.uid() AND status IN ('pending','skipped'));

-- 4) Transactional RPCs (auth.uid + membership, idempotent per candidate).
CREATE OR REPLACE FUNCTION public.import_confirm(_candidate uuid, _work uuid, _reaction interest_reaction, _seen boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; w works; uid uuid := auth.uid(); ind indications; prior_int interest_reaction; prior_seen boolean; eff jsonb := '{}'; outcome text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _reaction NOT IN ('fire','like','neutral') THEN RAISE EXCEPTION 'invalid_reaction'; END IF;
  SELECT * INTO c FROM import_candidates WHERE id = _candidate FOR UPDATE;
  IF NOT FOUND OR c.created_by <> uid OR NOT private.is_space_member(c.space_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF c.status = 'saved' THEN RETURN jsonb_build_object('status','saved','work_id',c.work_id,'effects',c.effects,'idempotent',true); END IF;
  SELECT * INTO w FROM works WHERE id = _work;
  IF NOT FOUND OR w.space_id <> c.space_id OR w.media_type <> c.media_type OR w.tmdb_id <> c.tmdb_id THEN RAISE EXCEPTION 'work_mismatch'; END IF;

  SELECT * INTO ind FROM indications WHERE work_id = w.id AND indicated_by = uid FOR UPDATE;
  IF FOUND THEN
    eff := eff || jsonb_build_object('indication','renewed','prev_renewed_at',ind.renewed_at);
    UPDATE indications SET renewed_at = now() WHERE id = ind.id;
    outcome := 'renewed';
  ELSE
    INSERT INTO indications(space_id, work_id, indicated_by) VALUES (c.space_id, w.id, uid);
    eff := eff || jsonb_build_object('indication','created');
    outcome := 'created';
  END IF;

  SELECT reaction INTO prior_int FROM interests WHERE work_id = w.id AND user_id = uid;
  eff := eff || jsonb_build_object('prev_reaction', prior_int);
  INSERT INTO interests(work_id, user_id, reaction) VALUES (w.id, uid, _reaction)
    ON CONFLICT (user_id, work_id) DO UPDATE SET reaction = EXCLUDED.reaction;

  IF _seen THEN
    SELECT watched INTO prior_seen FROM prior_watch_status WHERE work_id = w.id AND user_id = uid;
    eff := eff || jsonb_build_object('seen_set', true, 'prev_seen', prior_seen);
    INSERT INTO prior_watch_status(work_id, user_id, watched) VALUES (w.id, uid, true)
      ON CONFLICT (user_id, work_id) DO UPDATE SET watched = true, updated_at = now();
  END IF;

  IF c.source_post_id IS NOT NULL THEN
    INSERT INTO source_post_works(space_id, source_post_id, work_id, created_by) VALUES (c.space_id, c.source_post_id, w.id, uid)
      ON CONFLICT (source_post_id, work_id) DO NOTHING;
    IF FOUND THEN eff := eff || jsonb_build_object('link_created', true); END IF;
  END IF;

  UPDATE import_candidates SET status='saved', work_id=w.id, reaction=_reaction, seen=_seen, effects=eff, note=NULL, updated_at=now() WHERE id = c.id;
  UPDATE import_sessions SET updated_at = now(), status = CASE WHEN status IN ('analyzing','interrupted','needs_help') THEN 'review' ELSE status END WHERE id = c.session_id;
  RETURN jsonb_build_object('status','saved','work_id',w.id,'indication',outcome,'effects',eff,'idempotent',false);
END $$;

-- Undo reverts only this candidate's own effects; partner data and other sessions' links stay.
CREATE OR REPLACE FUNCTION public.import_undo(_candidate uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; uid uuid := auth.uid(); e jsonb; other_saved boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO c FROM import_candidates WHERE id = _candidate FOR UPDATE;
  IF NOT FOUND OR c.created_by <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF c.status <> 'saved' THEN RETURN jsonb_build_object('status', c.status, 'idempotent', true); END IF;
  e := c.effects;
  IF c.work_id IS NOT NULL THEN
    -- Another saved candidate of mine for the same work keeps the indication/reaction alive.
    SELECT EXISTS(SELECT 1 FROM import_candidates o WHERE o.id <> c.id AND o.created_by = uid AND o.work_id = c.work_id AND o.status = 'saved') INTO other_saved;
    IF NOT other_saved THEN
      IF e->>'indication' = 'created' THEN DELETE FROM indications WHERE work_id = c.work_id AND indicated_by = uid;
      ELSIF e->>'indication' = 'renewed' THEN UPDATE indications SET renewed_at = NULLIF(e->>'prev_renewed_at','')::timestamptz WHERE work_id = c.work_id AND indicated_by = uid; END IF;
      IF e ? 'prev_reaction' AND e->>'prev_reaction' IS NOT NULL THEN UPDATE interests SET reaction = (e->>'prev_reaction')::interest_reaction WHERE work_id = c.work_id AND user_id = uid;
      ELSE DELETE FROM interests WHERE work_id = c.work_id AND user_id = uid; END IF;
      IF (e->>'seen_set')::boolean IS TRUE THEN
        IF e->>'prev_seen' IS NULL THEN DELETE FROM prior_watch_status WHERE work_id = c.work_id AND user_id = uid;
        ELSE UPDATE prior_watch_status SET watched = (e->>'prev_seen')::boolean WHERE work_id = c.work_id AND user_id = uid; END IF;
      END IF;
    END IF;
    IF (e->>'link_created')::boolean IS TRUE AND NOT EXISTS (SELECT 1 FROM import_candidates o WHERE o.id <> c.id AND o.status='saved' AND o.source_post_id = c.source_post_id AND o.work_id = c.work_id) THEN
      DELETE FROM source_post_works WHERE source_post_id = c.source_post_id AND work_id = c.work_id;
    END IF;
    -- Work row removed only if I created it and nothing else references it.
    DELETE FROM works w WHERE w.id = c.work_id AND w.created_by = uid
      AND NOT EXISTS (SELECT 1 FROM indications WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM interests WHERE work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM ratings WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM prior_watch_status WHERE work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM watch_events WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM joint_watch_sessions WHERE work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM source_post_works WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM match_votes WHERE work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM match_sessions WHERE w.id = ANY(work_ids))
      AND NOT EXISTS (SELECT 1 FROM import_candidates o WHERE o.work_id = w.id AND o.id <> c.id AND o.status = 'saved');
  END IF;
  UPDATE import_candidates SET status='pending', work_id=NULL, effects='{}', note=NULL, updated_at=now() WHERE id = c.id;
  UPDATE import_sessions SET status = CASE WHEN status='completed' THEN 'review' ELSE status END, updated_at = now() WHERE id = c.session_id;
  RETURN jsonb_build_object('status','pending');
END $$;

CREATE OR REPLACE FUNCTION public.import_set_reaction(_candidate uuid, _reaction interest_reaction)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; uid uuid := auth.uid();
BEGIN
  IF _reaction NOT IN ('fire','like','neutral') THEN RAISE EXCEPTION 'invalid_reaction'; END IF;
  SELECT * INTO c FROM import_candidates WHERE id = _candidate FOR UPDATE;
  IF NOT FOUND OR c.created_by <> uid OR c.status <> 'saved' OR c.work_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE interests SET reaction = _reaction WHERE work_id = c.work_id AND user_id = uid;
  IF NOT FOUND THEN INSERT INTO interests(work_id, user_id, reaction) VALUES (c.work_id, uid, _reaction); END IF;
  UPDATE import_candidates SET reaction = _reaction, updated_at = now() WHERE id = c.id;
END $$;

CREATE OR REPLACE FUNCTION public.import_set_seen(_candidate uuid, _seen boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; uid uuid := auth.uid(); prior boolean;
BEGIN
  SELECT * INTO c FROM import_candidates WHERE id = _candidate FOR UPDATE;
  IF NOT FOUND OR c.created_by <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF c.status <> 'saved' THEN UPDATE import_candidates SET seen = _seen, updated_at = now() WHERE id = c.id; RETURN; END IF;
  IF _seen = c.seen THEN RETURN; END IF;
  IF _seen THEN
    SELECT watched INTO prior FROM prior_watch_status WHERE work_id = c.work_id AND user_id = uid;
    INSERT INTO prior_watch_status(work_id, user_id, watched) VALUES (c.work_id, uid, true) ON CONFLICT (user_id, work_id) DO UPDATE SET watched = true, updated_at = now();
    UPDATE import_candidates SET seen = true, effects = effects || jsonb_build_object('seen_set', true, 'prev_seen', prior), updated_at = now() WHERE id = c.id;
  ELSE
    IF (c.effects->>'seen_set')::boolean IS TRUE THEN
      IF c.effects->>'prev_seen' IS NULL THEN DELETE FROM prior_watch_status WHERE work_id = c.work_id AND user_id = uid;
      ELSE UPDATE prior_watch_status SET watched = (c.effects->>'prev_seen')::boolean WHERE work_id = c.work_id AND user_id = uid; END IF;
    END IF;
    UPDATE import_candidates SET seen = false, effects = (effects - 'seen_set') - 'prev_seen', updated_at = now() WHERE id = c.id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.import_complete(_session uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s import_sessions; uid uuid := auth.uid();
BEGIN
  SELECT * INTO s FROM import_sessions WHERE id = _session FOR UPDATE;
  IF NOT FOUND OR s.created_by <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM import_candidates WHERE session_id = _session AND status IN ('pending','error')) THEN RETURN s.status; END IF;
  UPDATE import_sessions SET status = 'completed', updated_at = now() WHERE id = _session;
  RETURN 'completed';
END $$;

-- Dismiss: only sessions without saved works; sources stay.
CREATE OR REPLACE FUNCTION public.import_dismiss(_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s import_sessions; uid uuid := auth.uid();
BEGIN
  SELECT * INTO s FROM import_sessions WHERE id = _session FOR UPDATE;
  IF NOT FOUND OR s.created_by <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM import_candidates WHERE session_id = _session AND status = 'saved') THEN RAISE EXCEPTION 'has_saved'; END IF;
  DELETE FROM import_sessions WHERE id = _session;
END $$;

REVOKE EXECUTE ON FUNCTION public.import_confirm(uuid, uuid, interest_reaction, boolean), public.import_undo(uuid), public.import_set_reaction(uuid, interest_reaction), public.import_set_seen(uuid, boolean), public.import_complete(uuid), public.import_dismiss(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_confirm(uuid, uuid, interest_reaction, boolean), public.import_undo(uuid), public.import_set_reaction(uuid, interest_reaction), public.import_set_seen(uuid, boolean), public.import_complete(uuid), public.import_dismiss(uuid) TO authenticated;