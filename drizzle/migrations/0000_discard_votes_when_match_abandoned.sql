CREATE OR REPLACE FUNCTION private.match_abandon(_session uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  changed boolean;
BEGIN
  UPDATE match_sessions
  SET status = 'abandoned', closed_at = now(), result_work_ids = NULL
  WHERE id = _session
    AND status = 'open'
    AND private.is_space_member(space_id)
  RETURNING true INTO changed;

  IF coalesce(changed, false) THEN
    DELETE FROM match_votes WHERE session_id = _session;
    DELETE FROM match_participants WHERE session_id = _session;
  END IF;
END $$;

REVOKE ALL ON FUNCTION private.match_abandon(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.match_abandon(uuid) TO authenticated;