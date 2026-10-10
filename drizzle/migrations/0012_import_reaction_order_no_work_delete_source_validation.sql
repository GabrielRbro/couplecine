COMMENT ON COLUMN public.import_work_holds.work_created IS 'DEPRECATED: heuristic, no longer used; undo never deletes works';
COMMENT ON COLUMN public.import_work_holds.candidates IS 'Saved candidates holding this (work,user), ordered by most recent reaction decision last';

-- Source identity: every parameter must derive from the canonical URL (no forged shortcode/platform/kind).
CREATE OR REPLACE FUNCTION public.import_source_for(_space uuid, _platform text, _url text, _shortcode text, _reel boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); hit source_posts; n int; m text[]; code text; reel boolean;
BEGIN
  IF uid IS NULL OR NOT private.is_space_member(_space) THEN RAISE EXCEPTION 'forbidden'; END IF;
  m := regexp_match(_url, '^https://www\.instagram\.com/(p|reel)/([A-Za-z0-9_-]{5,40})/$');
  IF m IS NOT NULL THEN
    code := m[2]; reel := m[1] = 'reel';
    IF _platform IS DISTINCT FROM 'instagram' OR _shortcode IS DISTINCT FROM code OR _reel IS DISTINCT FROM reel THEN RAISE EXCEPTION 'source_params_mismatch'; END IF;
  ELSIF _url ~ '^https://www\.tiktok\.com/@[A-Za-z0-9_.-]{1,40}/(video|photo)/[0-9]{8,25}$' OR _url ~ '^https://(vt|vm)\.tiktok\.com/[A-Za-z0-9]{5,15}/$' THEN
    IF _platform IS DISTINCT FROM 'tiktok' OR _shortcode IS NOT NULL OR coalesce(_reel, false) THEN RAISE EXCEPTION 'source_params_mismatch'; END IF;
  ELSE
    RAISE EXCEPTION 'invalid_source';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('src:' || _space::text || ':' || coalesce(code, _url)));
  SELECT * INTO hit FROM source_posts WHERE space_id = _space AND source_url = _url;
  IF FOUND THEN RETURN hit.id; END IF;
  IF code IS NOT NULL THEN
    SELECT count(*) INTO n FROM source_posts WHERE space_id = _space
      AND source_url ~ ('^https://www\.instagram\.com/(p|reel)/' || code || '/(\?img_index=[0-9]{1,2})?$');
    IF n >= 1 THEN
      SELECT * INTO hit FROM source_posts WHERE space_id = _space
        AND source_url ~ ('^https://www\.instagram\.com/(p|reel)/' || code || '/(\?img_index=[0-9]{1,2})?$')
        ORDER BY created_at, id LIMIT 1;
      IF reel AND n = 1 AND hit.source_url ~ '^https://www\.instagram\.com/p/' THEN
        UPDATE source_posts SET source_url = _url WHERE id = hit.id;
      END IF;
      RETURN hit.id;
    END IF;
  END IF;
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (_space, _platform, _url, uid) RETURNING id INTO hit.id;
  RETURN hit.id;
END $$;

-- Confirm: no work-ownership heuristic (work_created always false).
CREATE OR REPLACE FUNCTION public.import_confirm(_candidate uuid, _work uuid, _reaction interest_reaction, _seen boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; s import_sessions; w works; uid uuid := auth.uid(); ind indications; h import_work_holds;
  prior_int interest_reaction; outcome text; ts timestamptz := clock_timestamp(); link boolean := false;
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
    INSERT INTO import_work_holds(work_id, user_id, space_id, ind_existed, prev_renewed_at, prev_reaction, work_created)
      VALUES (w.id, uid, c.space_id, ind.id IS NOT NULL, ind.renewed_at, prior_int, false) RETURNING * INTO h;
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

-- Undo: never deletes works. While other candidates remain, the global reaction falls back to the most
-- recent remaining decision, only if it is still the value the import wrote.
CREATE OR REPLACE FUNCTION public.import_undo(_candidate uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; s import_sessions; uid uuid := auth.uid(); h import_work_holds; wid uuid; ind indications; nextr interest_reaction;
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
    ELSIF FOUND THEN
      SELECT reaction INTO nextr FROM import_candidates WHERE id = h.candidates[cardinality(h.candidates)];
      IF nextr IS NOT NULL AND EXISTS (SELECT 1 FROM interests WHERE work_id = wid AND user_id = uid AND reaction IS NOT DISTINCT FROM h.import_reaction) THEN
        UPDATE interests SET reaction = nextr WHERE work_id = wid AND user_id = uid;
        UPDATE import_work_holds SET import_reaction = nextr WHERE work_id = wid AND user_id = uid;
      END IF;
    END IF;
    IF c.source_post_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM import_candidates o WHERE o.id <> c.id AND o.status = 'saved' AND o.source_post_id = c.source_post_id AND o.work_id = wid) THEN
      DELETE FROM source_post_works WHERE source_post_id = c.source_post_id AND work_id = wid AND via_import;
    END IF;
  END IF;
  UPDATE import_candidates SET status='pending', work_id=NULL, effects='{}', note=NULL, updated_at=now() WHERE id = c.id;
  UPDATE import_sessions SET status = CASE WHEN status='completed' THEN 'review' ELSE status END, updated_at = now() WHERE id = c.session_id;
  RETURN jsonb_build_object('status','pending','idempotent',false);
END $$;

-- Changing a saved candidate's reaction makes it the most recent decision.
CREATE OR REPLACE FUNCTION public.import_set_reaction(_candidate uuid, _reaction interest_reaction)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _reaction IS NULL OR _reaction NOT IN ('fire','like','neutral') THEN RAISE EXCEPTION 'invalid_reaction'; END IF;
  SELECT * INTO c FROM import_candidates WHERE id = _candidate FOR UPDATE;
  IF NOT FOUND OR c.created_by <> uid OR NOT private.is_space_member(c.space_id) OR c.status <> 'saved' OR c.work_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM 1 FROM import_work_holds WHERE work_id = c.work_id AND user_id = uid FOR UPDATE;
  INSERT INTO interests(work_id, user_id, reaction) VALUES (c.work_id, uid, _reaction) ON CONFLICT (user_id, work_id) DO UPDATE SET reaction = EXCLUDED.reaction;
  UPDATE import_work_holds SET import_reaction = _reaction, candidates = array_append(array_remove(candidates, c.id), c.id) WHERE work_id = c.work_id AND user_id = uid;
  UPDATE import_candidates SET reaction = _reaction, updated_at = now() WHERE id = c.id;
END $$;