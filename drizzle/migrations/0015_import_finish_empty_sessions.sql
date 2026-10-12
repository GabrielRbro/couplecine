-- Closing an import is explicit: even a session that never produced a candidate
-- must release its capacity slot. import_complete deliberately rejects empty
-- sessions for the normal review flow, so this escape hatch completes them here.
CREATE OR REPLACE FUNCTION public.import_finish_remaining(_session uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s import_sessions; uid uuid := auth.uid();
BEGIN
  SELECT * INTO s FROM import_sessions WHERE id = _session FOR UPDATE;
  IF uid IS NULL OR NOT FOUND OR s.created_by <> uid OR NOT private.is_space_member(s.space_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF s.status = 'completed' THEN RETURN 'completed'; END IF;

  UPDATE import_candidates
  SET status = 'skipped', note = NULL, updated_at = now()
  WHERE session_id = _session AND status IN ('pending', 'error');

  -- Sources are retained for provenance, but no longer block a manual close.
  UPDATE import_sessions
  SET status = 'completed', skipped_source_ids = source_post_ids, updated_at = now()
  WHERE id = _session;
  RETURN 'completed';
END $$;
REVOKE ALL ON FUNCTION public.import_finish_remaining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_finish_remaining(uuid) TO authenticated;
