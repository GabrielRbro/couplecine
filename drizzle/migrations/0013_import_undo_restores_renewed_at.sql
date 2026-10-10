-- Undo of a non-final decision restores renewed_at to the previous active decision's own timestamp.
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
    effects=jsonb_build_object('indication', CASE WHEN outcome = 'kept' THEN 'renewed' ELSE outcome END, 'link_created', link, 'renewed_at', CASE WHEN outcome = 'created' THEN NULL ELSE to_jsonb(ts) END), note=NULL, updated_at=now() WHERE id = c.id;
  UPDATE import_sessions SET updated_at = now(), status = CASE WHEN status IN ('analyzing','interrupted','needs_help') THEN 'review' ELSE status END WHERE id = c.session_id;
  RETURN jsonb_build_object('status','saved','work_id',w.id,'indication',CASE WHEN outcome = 'kept' THEN 'renewed' ELSE outcome END,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.import_undo(_candidate uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c import_candidates; s import_sessions; uid uuid := auth.uid(); h import_work_holds; wid uuid; ind indications; nextr interest_reaction; prev_ts timestamptz;
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
      -- Renewal: fall back to the latest timestamp written by a still-saved decision (NULL if only creations
      -- remain), only while the current value is still the one the import wrote.
      SELECT max((o.effects->>'renewed_at')::timestamptz) INTO prev_ts FROM import_candidates o WHERE o.id = ANY(h.candidates) AND o.status = 'saved';
      UPDATE indications SET renewed_at = prev_ts WHERE work_id = wid AND indicated_by = uid AND renewed_at IS NOT DISTINCT FROM h.import_renewed_at;
      IF FOUND THEN UPDATE import_work_holds SET import_renewed_at = prev_ts WHERE work_id = wid AND user_id = uid; END IF;
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