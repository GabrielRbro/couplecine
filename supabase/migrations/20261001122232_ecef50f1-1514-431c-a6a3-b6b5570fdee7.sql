CREATE TABLE public.match_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  work_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.match_sessions TO authenticated;
GRANT ALL ON public.match_sessions TO service_role;
ALTER TABLE public.match_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_sessions_read ON public.match_sessions FOR SELECT TO authenticated USING (private.is_space_member(space_id));
CREATE POLICY match_sessions_create ON public.match_sessions FOR INSERT TO authenticated WITH CHECK (private.is_space_member(space_id) AND created_by = auth.uid());
CREATE POLICY match_sessions_update ON public.match_sessions FOR UPDATE TO authenticated USING (private.is_space_member(space_id)) WITH CHECK (private.is_space_member(space_id));

CREATE TABLE public.match_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.match_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  liked boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id, work_id)
);
GRANT SELECT, INSERT, UPDATE ON public.match_votes TO authenticated;
GRANT ALL ON public.match_votes TO service_role;
ALTER TABLE public.match_votes ENABLE ROW LEVEL SECURITY;
-- Votes are secret: each person sees only their own.
CREATE POLICY match_votes_own ON public.match_votes FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.match_sessions s WHERE s.id = session_id AND s.status = 'open' AND private.is_space_member(s.space_id)));

-- Reveals only progress counts and mutual likes, never individual votes.
CREATE OR REPLACE FUNCTION public.match_status(_session uuid)
RETURNS TABLE (user_id uuid, voted integer, matches uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT * FROM match_sessions WHERE id = _session AND private.is_space_member(space_id)),
  m AS (
    SELECT array_agg(work_id) AS ids FROM (
      SELECT v.work_id FROM match_votes v JOIN s ON s.id = v.session_id
      WHERE v.liked GROUP BY v.work_id
      HAVING count(DISTINCT v.user_id) >= (SELECT count(*) FROM space_members sm JOIN s ON sm.space_id = s.space_id)
    ) x
  )
  SELECT sm.user_id,
    (SELECT count(*)::int FROM match_votes v WHERE v.session_id = _session AND v.user_id = sm.user_id),
    COALESCE((SELECT ids FROM m), '{}')
  FROM space_members sm JOIN s ON sm.space_id = s.space_id;
$$;
REVOKE EXECUTE ON FUNCTION public.match_status(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.match_status(uuid) TO authenticated;