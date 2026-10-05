CREATE OR REPLACE FUNCTION private.match_extend(_session uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s match_sessions; p match_participants; pool int; voted int; goal_reached boolean; add int;
BEGIN
  SELECT * INTO s FROM match_sessions WHERE id = _session;
  IF s IS NULL OR NOT private.is_space_member(s.space_id) OR s.status <> 'open' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO p FROM match_participants WHERE session_id = _session AND user_id = auth.uid();
  IF p IS NULL THEN RAISE EXCEPTION 'not joined'; END IF;
  pool := coalesce(array_length(s.work_ids,1),0);
  SELECT count(*) INTO voted FROM match_votes WHERE session_id = _session AND user_id = auth.uid();
  IF voted < p.card_limit OR p.card_limit >= pool THEN RETURN p.card_limit; END IF;
  goal_reached := coalesce(array_length(private.match_mutual(_session),1),0) >= 3;
  IF goal_reached THEN
    IF p.extended_after_goal THEN RETURN p.card_limit; END IF;
    add := 4 + floor(random()*5)::int; -- 4..8 extra cards, never 0
    UPDATE match_participants SET card_limit = LEAST(pool, card_limit + add), extended_after_goal = true
      WHERE session_id = _session AND user_id = auth.uid();
  ELSE
    add := 5 + floor(random()*6)::int;
    UPDATE match_participants SET card_limit = LEAST(pool, card_limit + add)
      WHERE session_id = _session AND user_id = auth.uid();
  END IF;
  RETURN (SELECT card_limit FROM match_participants WHERE session_id = _session AND user_id = auth.uid());
END $function$;

-- Tracks demo seed rows so they can be removed without touching real data.
CREATE TABLE public.demo_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch text NOT NULL,
  work_id uuid REFERENCES public.works(id) ON DELETE CASCADE,
  match_session_id uuid REFERENCES public.match_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.demo_batch_items TO authenticated;
GRANT ALL ON public.demo_batch_items TO service_role;
ALTER TABLE public.demo_batch_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_read_owner ON public.demo_batch_items FOR SELECT TO authenticated USING (private.is_owner());

CREATE OR REPLACE FUNCTION public.demo_cleanup(_batch text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM match_sessions WHERE id IN (SELECT match_session_id FROM demo_batch_items WHERE batch = _batch AND match_session_id IS NOT NULL);
  WITH d AS (DELETE FROM works WHERE id IN (SELECT work_id FROM demo_batch_items WHERE batch = _batch AND work_id IS NOT NULL) RETURNING 1)
  SELECT count(*) INTO n FROM d;
  DELETE FROM demo_batch_items WHERE batch = _batch;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.demo_cleanup(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.demo_cleanup(text) TO authenticated;