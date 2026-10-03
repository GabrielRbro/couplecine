CREATE OR REPLACE FUNCTION private.match_join(_session uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s match_sessions; lim int;
BEGIN
  SELECT * INTO s FROM match_sessions WHERE id = _session;
  IF s IS NULL OR NOT private.is_space_member(s.space_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF s.status <> 'open' THEN RAISE EXCEPTION 'session_not_open'; END IF;
  INSERT INTO match_participants(session_id, user_id, card_limit)
  VALUES (_session, auth.uid(), LEAST(15, coalesce(array_length(s.work_ids,1),0)))
  ON CONFLICT DO NOTHING;
  SELECT card_limit INTO lim FROM match_participants WHERE session_id = _session AND user_id = auth.uid();
  RETURN lim;
END $function$;
DELETE FROM public.match_participants p USING public.match_sessions s
 WHERE p.session_id = s.id AND s.status = 'abandoned';