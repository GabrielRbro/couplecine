-- Import correctness: provenance holds, integrity, idempotent session creation, source identity.
ALTER TABLE public.import_sessions ADD CONSTRAINT import_sessions_id_space_key UNIQUE (id, space_id);
ALTER TABLE public.import_candidates ADD CONSTRAINT import_candidates_session_space_fk
  FOREIGN KEY (session_id, space_id) REFERENCES public.import_sessions(id, space_id) ON DELETE CASCADE;
ALTER TABLE public.import_candidates DROP CONSTRAINT IF EXISTS import_candidates_source_post_id_fkey;
ALTER TABLE public.import_candidates ADD CONSTRAINT import_candidates_source_space_fk
  FOREIGN KEY (source_post_id, space_id) REFERENCES public.source_posts(id, space_id) ON DELETE SET NULL (source_post_id);

ALTER TABLE public.import_sessions
  ADD COLUMN IF NOT EXISTS client_token text,
  ADD COLUMN IF NOT EXISTS skipped_source_ids uuid[] NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS import_sessions_client_token ON public.import_sessions(created_by, client_token) WHERE client_token IS NOT NULL;

CREATE OR REPLACE FUNCTION private.import_sessions_sources_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.source_post_ids || NEW.skipped_source_ids) x
             WHERE NOT EXISTS (SELECT 1 FROM source_posts p WHERE p.id = x AND p.space_id = NEW.space_id)) THEN
    RAISE EXCEPTION 'source_space_mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_sessions_sources_guard BEFORE INSERT OR UPDATE OF source_post_ids, skipped_source_ids, space_id ON public.import_sessions
  FOR EACH ROW EXECUTE FUNCTION private.import_sessions_sources_guard();

CREATE OR REPLACE FUNCTION private.source_posts_delete_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM import_sessions s WHERE OLD.id = ANY(s.source_post_ids) AND s.status <> 'completed') THEN
    RAISE EXCEPTION 'source_in_open_session';
  END IF;
  UPDATE import_sessions SET source_post_ids = array_remove(source_post_ids, OLD.id), skipped_source_ids = array_remove(skipped_source_ids, OLD.id)
    WHERE OLD.id = ANY(source_post_ids) OR OLD.id = ANY(skipped_source_ids);
  RETURN OLD;
END $$;
CREATE TRIGGER source_posts_delete_guard BEFORE DELETE ON public.source_posts FOR EACH ROW EXECUTE FUNCTION private.source_posts_delete_guard();

DROP POLICY IF EXISTS import_candidates_read_own ON public.import_candidates;
CREATE POLICY import_candidates_read_own ON public.import_candidates FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND private.is_space_member(space_id));
DROP POLICY IF EXISTS import_candidates_skip_own ON public.import_candidates;
CREATE POLICY import_candidates_skip_own ON public.import_candidates FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND private.is_space_member(space_id) AND status IN ('pending','skipped','error'))
  WITH CHECK (created_by = auth.uid() AND private.is_space_member(space_id) AND status IN ('pending','skipped'));

ALTER TABLE public.source_post_works ADD COLUMN IF NOT EXISTS via_import boolean NOT NULL DEFAULT false;

CREATE TABLE public.import_work_holds (
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  space_id uuid NOT NULL,
  candidates uuid[] NOT NULL DEFAULT '{}',
  ind_existed boolean NOT NULL,
  prev_renewed_at timestamptz,
  import_renewed_at timestamptz,
  prev_reaction interest_reaction,
  import_reaction interest_reaction,
  seen_candidates uuid[] NOT NULL DEFAULT '{}',
  seen_baseline_recorded boolean NOT NULL DEFAULT false,
  prev_seen boolean,
  work_created boolean NOT NULL DEFAULT false,
  PRIMARY KEY (work_id, user_id)
);
GRANT SELECT ON public.import_work_holds TO authenticated;
GRANT ALL ON public.import_work_holds TO service_role;
ALTER TABLE public.import_work_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_work_holds_read_own ON public.import_work_holds FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.import_source_for(_space uuid, _platform text, _url text, _shortcode text, _reel boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); hit source_posts; n int;
BEGIN
  IF uid IS NULL OR NOT private.is_space_member(_space) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _platform NOT IN ('instagram','tiktok') OR _url !~ '^https://(www\.instagram\.com/(p|reel)/[A-Za-z0-9_-]{5,40}/$|(www|vt|vm|m)\.tiktok\.com/)' THEN RAISE EXCEPTION 'invalid_source'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('src:' || _space::text || ':' || coalesce(_shortcode, _url)));
  SELECT * INTO hit FROM source_posts WHERE space_id = _space AND source_url = _url;
  IF FOUND THEN RETURN hit.id; END IF;
  IF _platform = 'instagram' AND _shortcode ~ '^[A-Za-z0-9_-]{5,40}$' THEN
    SELECT count(*) INTO n FROM source_posts WHERE space_id = _space
      AND source_url ~ ('^https://www\.instagram\.com/(p|reel)/' || _shortcode || '/(\?img_index=[0-9]{1,2})?$');
    IF n >= 1 THEN
      SELECT * INTO hit FROM source_posts WHERE space_id = _space
        AND source_url ~ ('^https://www\.instagram\.com/(p|reel)/' || _shortcode || '/(\?img_index=[0-9]{1,2})?$')
        ORDER BY created_at, id LIMIT 1;
      IF _reel AND n = 1 AND hit.source_url ~ '^https://www\.instagram\.com/p/' THEN
        UPDATE source_posts SET source_url = _url WHERE id = hit.id;
      END IF;
      RETURN hit.id;
    END IF;
  END IF;
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (_space, _platform, _url, uid) RETURNING id INTO hit.id;
  RETURN hit.id;
END $$;

CREATE OR REPLACE FUNCTION private.import_hold_seen_add(_work uuid, _uid uuid, _cand uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h import_work_holds; prior boolean;
BEGIN
  SELECT * INTO h FROM import_work_holds WHERE work_id = _work AND user_id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'hold_missing'; END IF;
  IF NOT h.seen_baseline_recorded THEN
    SELECT watched INTO prior FROM prior_watch_status WHERE work_id = _work AND user_id = _uid;
    UPDATE import_work_holds SET prev_seen = prior, seen_baseline_recorded = true WHERE work_id = _work AND user_id = _uid;
  END IF;
  INSERT INTO prior_watch_status(work_id, user_id, watched) VALUES (_work, _uid, true)
    ON CONFLICT (user_id, work_id) DO UPDATE SET watched = true, updated_at = now();
  UPDATE import_work_holds SET seen_candidates = array_append(array_remove(seen_candidates, _cand), _cand) WHERE work_id = _work AND user_id = _uid;
END $$;

CREATE OR REPLACE FUNCTION private.import_hold_seen_remove(_work uuid, _uid uuid, _cand uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h import_work_holds;
BEGIN
  UPDATE import_work_holds SET seen_candidates = array_remove(seen_candidates, _cand) WHERE work_id = _work AND user_id = _uid RETURNING * INTO h;
  IF NOT FOUND OR cardinality(h.seen_candidates) > 0 OR NOT h.seen_baseline_recorded THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM prior_watch_status WHERE work_id = _work AND user_id = _uid AND watched) THEN
    IF h.prev_seen IS NULL THEN DELETE FROM prior_watch_status WHERE work_id = _work AND user_id = _uid;
    ELSE UPDATE prior_watch_status SET watched = h.prev_seen, updated_at = now() WHERE work_id = _work AND user_id = _uid; END IF;
  END IF;
  UPDATE import_work_holds SET seen_baseline_recorded = false, prev_seen = NULL WHERE work_id = _work AND user_id = _uid;
END $$;

CREATE OR REPLACE FUNCTION public.import_confirm(_candidate uuid, _work uuid, _reaction interest_reaction, _seen boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; s import_sessions; w works; uid uuid := auth.uid(); ind indications; h import_work_holds;
  prior_int interest_reaction; fresh boolean; outcome text; ts timestamptz := clock_timestamp(); link boolean := false;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _reaction IS NULL OR _reaction NOT IN ('fire','like','neutral') THEN RAISE EXCEPTION 'invalid_reaction'; END IF;
  IF _seen IS NULL THEN RAISE EXCEPTION 'invalid_seen'; END IF;
  SELECT * INTO c FROM import_candidates WHERE id = _candidate FOR UPDATE;
  IF NOT FOUND OR c.created_by <> uid OR NOT private.is_space_member(c.space_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO s FROM import_sessions WHERE id = c.session_id FOR UPDATE;
  IF s.created_by <> uid OR s.space_id <> c.space_id THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF c.status = 'saved' THEN RETURN jsonb_build_object('status','saved','work_id',c.work_id,'indication',c.effects->>'indication','idempotent',true); END IF;
  IF c.status NOT IN ('pending','error') THEN RAISE EXCEPTION 'not_confirmable'; END IF;
  IF s.status = 'completed' THEN RAISE EXCEPTION 'session_completed'; END IF;
  SELECT * INTO w FROM works WHERE id = _work FOR UPDATE;
  IF NOT FOUND OR w.space_id <> c.space_id OR w.media_type <> c.media_type OR w.tmdb_id <> c.tmdb_id THEN RAISE EXCEPTION 'work_mismatch'; END IF;

  SELECT * INTO h FROM import_work_holds WHERE work_id = w.id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO ind FROM indications WHERE work_id = w.id AND indicated_by = uid;
    SELECT reaction INTO prior_int FROM interests WHERE work_id = w.id AND user_id = uid;
    fresh := w.created_by = uid AND w.created_at > now() - interval '30 minutes'
      AND NOT EXISTS (SELECT 1 FROM import_work_holds x WHERE x.work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM indications WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM interests WHERE work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM ratings WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM prior_watch_status WHERE work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM watch_events WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM joint_watch_sessions WHERE work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM source_post_works WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM match_votes WHERE work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM match_sessions WHERE w.id = ANY(work_ids));
    INSERT INTO import_work_holds(work_id, user_id, space_id, ind_existed, prev_renewed_at, prev_reaction, work_created)
      VALUES (w.id, uid, c.space_id, ind.id IS NOT NULL, ind.renewed_at, prior_int, fresh) RETURNING * INTO h;
  END IF;

  SELECT * INTO ind FROM indications WHERE work_id = w.id AND indicated_by = uid FOR UPDATE;
  IF FOUND THEN
    UPDATE indications SET renewed_at = ts WHERE id = ind.id;
    UPDATE import_work_holds SET import_renewed_at = ts WHERE work_id = w.id AND user_id = uid;
    outcome := CASE WHEN h.ind_existed THEN 'renewed' ELSE 'kept' END;
  ELSE
    INSERT INTO indications(space_id, work_id, indicated_by) VALUES (c.space_id, w.id, uid);
    UPDATE import_work_holds SET import_renewed_at = NULL WHERE work_id = w.id AND user_id = uid;
    outcome := 'created';
  END IF;

  INSERT INTO interests(work_id, user_id, reaction) VALUES (w.id, uid, _reaction)
    ON CONFLICT (user_id, work_id) DO UPDATE SET reaction = EXCLUDED.reaction;
  UPDATE import_work_holds SET import_reaction = _reaction, candidates = array_append(array_remove(candidates, c.id), c.id) WHERE work_id = w.id AND user_id = uid;

  IF _seen THEN PERFORM private.import_hold_seen_add(w.id, uid, c.id); END IF;

  IF c.source_post_id IS NOT NULL THEN
    INSERT INTO source_post_works(space_id, source_post_id, work_id, created_by, via_import) VALUES (c.space_id, c.source_post_id, w.id, uid, true)
      ON CONFLICT (source_post_id, work_id) DO NOTHING;
    link := FOUND;
  END IF;

  UPDATE import_candidates SET status='saved', work_id=w.id, reaction=_reaction, seen=_seen,
    effects=jsonb_build_object('indication', CASE WHEN outcome = 'kept' THEN 'renewed' ELSE outcome END, 'link_created', link), note=NULL, updated_at=now() WHERE id = c.id;
  UPDATE import_sessions SET updated_at = now(), status = CASE WHEN status IN ('analyzing','interrupted','needs_help') THEN 'review' ELSE status END WHERE id = c.session_id;
  RETURN jsonb_build_object('status','saved','work_id',w.id,'indication',CASE WHEN outcome = 'kept' THEN 'renewed' ELSE outcome END,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.import_undo(_candidate uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; s import_sessions; uid uuid := auth.uid(); h import_work_holds; wid uuid; ind indications; released boolean := false; created boolean := false;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO c FROM import_candidates WHERE id = _candidate FOR UPDATE;
  IF NOT FOUND OR c.created_by <> uid OR NOT private.is_space_member(c.space_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO s FROM import_sessions WHERE id = c.session_id FOR UPDATE;
  IF s.created_by <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF c.status <> 'saved' THEN RETURN jsonb_build_object('status', c.status, 'idempotent', true); END IF;
  wid := c.work_id;
  IF wid IS NOT NULL THEN
    PERFORM private.import_hold_seen_remove(wid, uid, c.id);
    UPDATE import_work_holds SET candidates = array_remove(candidates, c.id) WHERE work_id = wid AND user_id = uid RETURNING * INTO h;
    IF FOUND AND cardinality(h.candidates) = 0 THEN
      released := true; created := h.work_created;
      SELECT * INTO ind FROM indications WHERE work_id = wid AND indicated_by = uid FOR UPDATE;
      IF ind.id IS NOT NULL AND ind.renewed_at IS NOT DISTINCT FROM h.import_renewed_at THEN
        IF NOT h.ind_existed THEN DELETE FROM indications WHERE id = ind.id;
        ELSE UPDATE indications SET renewed_at = h.prev_renewed_at WHERE id = ind.id; END IF;
      END IF;
      IF EXISTS (SELECT 1 FROM interests WHERE work_id = wid AND user_id = uid AND reaction IS NOT DISTINCT FROM h.import_reaction) THEN
        IF h.prev_reaction IS NULL THEN DELETE FROM interests WHERE work_id = wid AND user_id = uid;
        ELSE UPDATE interests SET reaction = h.prev_reaction WHERE work_id = wid AND user_id = uid; END IF;
      END IF;
      DELETE FROM import_work_holds WHERE work_id = wid AND user_id = uid;
    END IF;
    IF c.source_post_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM import_candidates o WHERE o.id <> c.id AND o.status = 'saved' AND o.source_post_id = c.source_post_id AND o.work_id = wid) THEN
      DELETE FROM source_post_works WHERE source_post_id = c.source_post_id AND work_id = wid AND via_import;
    END IF;
    IF released AND created THEN
      DELETE FROM works w WHERE w.id = wid
        AND NOT EXISTS (SELECT 1 FROM import_work_holds x WHERE x.work_id = w.id)
        AND NOT EXISTS (SELECT 1 FROM indications WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM interests WHERE work_id = w.id)
        AND NOT EXISTS (SELECT 1 FROM ratings WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM prior_watch_status WHERE work_id = w.id)
        AND NOT EXISTS (SELECT 1 FROM watch_events WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM joint_watch_sessions WHERE work_id = w.id)
        AND NOT EXISTS (SELECT 1 FROM source_post_works WHERE work_id = w.id) AND NOT EXISTS (SELECT 1 FROM match_votes WHERE work_id = w.id)
        AND NOT EXISTS (SELECT 1 FROM match_sessions WHERE w.id = ANY(work_ids))
        AND NOT EXISTS (SELECT 1 FROM import_candidates o WHERE o.work_id = w.id AND o.id <> c.id AND o.status = 'saved');
    END IF;
  END IF;
  UPDATE import_candidates SET status='pending', work_id=NULL, effects='{}', note=NULL, updated_at=now() WHERE id = c.id;
  UPDATE import_sessions SET status = CASE WHEN status='completed' THEN 'review' ELSE status END, updated_at = now() WHERE id = c.session_id;
  RETURN jsonb_build_object('status','pending','idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.import_set_reaction(_candidate uuid, _reaction interest_reaction)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _reaction IS NULL OR _reaction NOT IN ('fire','like','neutral') THEN RAISE EXCEPTION 'invalid_reaction'; END IF;
  SELECT * INTO c FROM import_candidates WHERE id = _candidate FOR UPDATE;
  IF NOT FOUND OR c.created_by <> uid OR NOT private.is_space_member(c.space_id) OR c.status <> 'saved' OR c.work_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO interests(work_id, user_id, reaction) VALUES (c.work_id, uid, _reaction) ON CONFLICT (user_id, work_id) DO UPDATE SET reaction = EXCLUDED.reaction;
  UPDATE import_work_holds SET import_reaction = _reaction WHERE work_id = c.work_id AND user_id = uid;
  UPDATE import_candidates SET reaction = _reaction, updated_at = now() WHERE id = c.id;
END $$;

CREATE OR REPLACE FUNCTION public.import_set_seen(_candidate uuid, _seen boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _seen IS NULL THEN RAISE EXCEPTION 'invalid_seen'; END IF;
  SELECT * INTO c FROM import_candidates WHERE id = _candidate FOR UPDATE;
  IF NOT FOUND OR c.created_by <> uid OR NOT private.is_space_member(c.space_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF c.status <> 'saved' THEN UPDATE import_candidates SET seen = _seen, updated_at = now() WHERE id = c.id; RETURN; END IF;
  IF _seen = c.seen THEN RETURN; END IF;
  IF _seen THEN PERFORM private.import_hold_seen_add(c.work_id, uid, c.id);
  ELSE PERFORM private.import_hold_seen_remove(c.work_id, uid, c.id); END IF;
  UPDATE import_candidates SET seen = _seen, updated_at = now() WHERE id = c.id;
END $$;

CREATE OR REPLACE FUNCTION public.import_complete(_session uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s import_sessions; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO s FROM import_sessions WHERE id = _session FOR UPDATE;
  IF NOT FOUND OR s.created_by <> uid OR NOT private.is_space_member(s.space_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF s.status = 'completed' THEN RETURN 'completed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM import_candidates WHERE session_id = _session) THEN RETURN 'empty'; END IF;
  IF EXISTS (SELECT 1 FROM import_candidates WHERE session_id = _session AND status IN ('pending','error')) THEN RETURN 'open'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(s.source_post_ids) x WHERE NOT x = ANY(s.skipped_source_ids)
             AND NOT EXISTS (SELECT 1 FROM import_candidates c WHERE c.session_id = _session AND c.source_post_id = x)) THEN RETURN 'sources_open'; END IF;
  UPDATE import_sessions SET status = 'completed', updated_at = now() WHERE id = _session;
  RETURN 'completed';
END $$;

CREATE OR REPLACE FUNCTION public.import_skip_source(_session uuid, _source uuid, _skip boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s import_sessions; uid uuid := auth.uid();
BEGIN
  SELECT * INTO s FROM import_sessions WHERE id = _session FOR UPDATE;
  IF NOT FOUND OR uid IS NULL OR s.created_by <> uid OR NOT private.is_space_member(s.space_id) OR NOT _source = ANY(s.source_post_ids) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE import_sessions SET skipped_source_ids = CASE WHEN coalesce(_skip, false) THEN array_append(array_remove(skipped_source_ids, _source), _source) ELSE array_remove(skipped_source_ids, _source) END, updated_at = now() WHERE id = _session;
END $$;

REVOKE EXECUTE ON FUNCTION public.import_source_for(uuid, text, text, text, boolean), public.import_skip_source(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.import_hold_seen_add(uuid, uuid, uuid), private.import_hold_seen_remove(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_source_for(uuid, text, text, text, boolean), public.import_skip_source(uuid, uuid, boolean),
  public.import_confirm(uuid, uuid, interest_reaction, boolean), public.import_undo(uuid), public.import_set_reaction(uuid, interest_reaction),
  public.import_set_seen(uuid, boolean), public.import_complete(uuid), public.import_dismiss(uuid) TO authenticated;