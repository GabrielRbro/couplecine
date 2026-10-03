-- B. Owner allowlist: only the project owner can create the first space
CREATE TABLE private.owner_allowlist (email text PRIMARY KEY);
INSERT INTO private.owner_allowlist(email) VALUES ('gabriel28ribeiro@gmail.com');
REVOKE ALL ON private.owner_allowlist FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.is_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM private.owner_allowlist o WHERE lower(o.email) = lower(auth.jwt() ->> 'email'))
$$;
REVOKE ALL ON FUNCTION private.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_owner() TO authenticated;
DROP POLICY IF EXISTS spaces_create ON public.couple_spaces;
CREATE POLICY spaces_create ON public.couple_spaces FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND private.is_owner());
CREATE FUNCTION public.can_create_space() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$ SELECT private.is_owner() $$;
REVOKE EXECUTE ON FUNCTION public.can_create_space() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_space() TO authenticated;

-- B. Indications: everyone in the space reads; each person writes/removes only their own
DROP POLICY IF EXISTS indications_access ON public.indications;
CREATE POLICY indications_read ON public.indications FOR SELECT TO authenticated USING (private.is_space_member(space_id));
CREATE POLICY indications_insert ON public.indications FOR INSERT TO authenticated WITH CHECK (private.is_space_member(space_id) AND indicated_by = auth.uid());
CREATE POLICY indications_update ON public.indications FOR UPDATE TO authenticated USING (indicated_by = auth.uid()) WITH CHECK (indicated_by = auth.uid() AND private.is_space_member(space_id));
CREATE POLICY indications_delete ON public.indications FOR DELETE TO authenticated USING (indicated_by = auth.uid());

-- Re-indication renews the single active indication without losing authorship/date
ALTER TABLE public.indications ADD COLUMN renewed_at timestamptz;
CREATE OR REPLACE FUNCTION private.bump_on_renew() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.renewed_at IS DISTINCT FROM OLD.renewed_at AND NEW.renewed_at IS NOT NULL THEN
    UPDATE works SET activity_at = now() WHERE id = NEW.work_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.bump_on_renew() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER indications_bump_on_renew AFTER UPDATE ON public.indications FOR EACH ROW EXECUTE FUNCTION private.bump_on_renew();

-- A. Match secrecy
DROP FUNCTION IF EXISTS public.match_status(uuid);
DROP FUNCTION IF EXISTS private.match_status(uuid);
ALTER TABLE public.match_sessions DROP CONSTRAINT IF EXISTS match_sessions_status_check;
ALTER TABLE public.match_sessions ADD CONSTRAINT match_sessions_status_check CHECK (status IN ('open','closed','abandoned'));
ALTER TABLE public.match_sessions ADD COLUMN result_work_ids uuid[];
ALTER TABLE public.match_sessions ADD COLUMN closed_at timestamptz;
-- Clients may no longer update sessions directly; state changes go through RPCs.
DROP POLICY IF EXISTS match_sessions_update ON public.match_sessions;
REVOKE UPDATE ON public.match_sessions FROM authenticated;

CREATE TABLE public.match_participants (
  session_id uuid NOT NULL REFERENCES public.match_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  card_limit integer NOT NULL,
  extended_after_goal boolean NOT NULL DEFAULT false,
  close_requested boolean NOT NULL DEFAULT false,
  PRIMARY KEY (session_id, user_id)
);
GRANT SELECT ON public.match_participants TO authenticated;
GRANT ALL ON public.match_participants TO service_role;
ALTER TABLE public.match_participants ENABLE ROW LEVEL SECURITY;
-- Only your own row (card limit could hint at partner progress otherwise).
CREATE POLICY participants_own ON public.match_participants FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Votes: own only; insert only within your current card limit on an open session; undo via RPC.
DROP POLICY IF EXISTS match_votes_own ON public.match_votes;
REVOKE UPDATE ON public.match_votes FROM authenticated;
CREATE POLICY match_votes_read ON public.match_votes FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY match_votes_insert ON public.match_votes FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.match_sessions s WHERE s.id = session_id AND s.status = 'open'
      AND private.is_space_member(s.space_id) AND work_id = ANY (s.work_ids)
  )
);

CREATE OR REPLACE FUNCTION private.match_join(_session uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s match_sessions; lim int;
BEGIN
  SELECT * INTO s FROM match_sessions WHERE id = _session;
  IF s IS NULL OR NOT private.is_space_member(s.space_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO match_participants(session_id, user_id, card_limit)
  VALUES (_session, auth.uid(), LEAST(15, coalesce(array_length(s.work_ids,1),0)))
  ON CONFLICT DO NOTHING;
  SELECT card_limit INTO lim FROM match_participants WHERE session_id = _session AND user_id = auth.uid();
  RETURN lim;
END $$;

CREATE OR REPLACE FUNCTION private.match_mutual(_session uuid) RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(work_id), '{}') FROM (
    SELECT v.work_id FROM match_votes v
    WHERE v.session_id = _session AND v.liked
    GROUP BY v.work_id
    HAVING count(DISTINCT v.user_id) >= (SELECT count(*) FROM space_members sm JOIN match_sessions s2 ON sm.space_id = s2.space_id WHERE s2.id = _session)
  ) x
$$;

-- Called when the user has voted on every card in their current limit. Returns the new limit.
-- Adaptive skeleton: goal ~3 matches. Before goal: extend 5–10. After goal: one variable extension 0–8, then stop.
-- Ranges overlap on purpose so the extension size does not reveal whether the goal was reached.
CREATE OR REPLACE FUNCTION private.match_extend(_session uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    add := floor(random()*9)::int;
    UPDATE match_participants SET card_limit = LEAST(pool, card_limit + add), extended_after_goal = true
      WHERE session_id = _session AND user_id = auth.uid();
  ELSE
    add := 5 + floor(random()*6)::int;
    UPDATE match_participants SET card_limit = LEAST(pool, card_limit + add)
      WHERE session_id = _session AND user_id = auth.uid();
  END IF;
  RETURN (SELECT card_limit FROM match_participants WHERE session_id = _session AND user_id = auth.uid());
END $$;

CREATE OR REPLACE FUNCTION private.match_undo(_session uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v match_votes;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM match_sessions WHERE id = _session AND status = 'open' AND private.is_space_member(space_id)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v FROM match_votes WHERE session_id = _session AND user_id = auth.uid() ORDER BY created_at DESC LIMIT 1;
  IF v IS NULL THEN RETURN NULL; END IF;
  DELETE FROM match_votes WHERE id = v.id;
  RETURN v.work_id;
END $$;

-- Returns only: my close request, whether the partner asked to close, and the status. Never counts or votes.
CREATE OR REPLACE FUNCTION private.match_request_close(_session uuid, _want boolean) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s match_sessions; members int; wanting int;
BEGIN
  SELECT * INTO s FROM match_sessions WHERE id = _session;
  IF s IS NULL OR NOT private.is_space_member(s.space_id) OR s.status <> 'open' THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM private.match_join(_session);
  UPDATE match_participants SET close_requested = _want WHERE session_id = _session AND user_id = auth.uid();
  SELECT count(*) INTO members FROM space_members WHERE space_id = s.space_id;
  SELECT count(*) INTO wanting FROM match_participants WHERE session_id = _session AND close_requested;
  IF wanting >= members THEN
    UPDATE match_sessions SET status = 'closed', closed_at = now(), result_work_ids = private.match_mutual(_session) WHERE id = _session;
    RETURN 'closed';
  END IF;
  RETURN 'open';
END $$;

CREATE OR REPLACE FUNCTION private.match_partner_wants_close(_session uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM match_participants p JOIN match_sessions s ON s.id = p.session_id
    WHERE p.session_id = _session AND p.user_id <> auth.uid() AND p.close_requested AND private.is_space_member(s.space_id))
$$;

CREATE OR REPLACE FUNCTION private.match_abandon(_session uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE match_sessions SET status = 'abandoned', closed_at = now()
  WHERE id = _session AND status = 'open' AND private.is_space_member(space_id);
END $$;

REVOKE ALL ON FUNCTION private.match_join(uuid), private.match_mutual(uuid), private.match_extend(uuid), private.match_undo(uuid),
  private.match_request_close(uuid, boolean), private.match_partner_wants_close(uuid), private.match_abandon(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.match_mutual(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.match_join(uuid), private.match_extend(uuid), private.match_undo(uuid),
  private.match_request_close(uuid, boolean), private.match_partner_wants_close(uuid), private.match_abandon(uuid) TO authenticated;

CREATE FUNCTION public.match_join(_session uuid) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.match_join(_session) $$;
CREATE FUNCTION public.match_extend(_session uuid) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.match_extend(_session) $$;
CREATE FUNCTION public.match_undo(_session uuid) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.match_undo(_session) $$;
CREATE FUNCTION public.match_request_close(_session uuid, _want boolean) RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.match_request_close(_session, _want) $$;
CREATE FUNCTION public.match_partner_wants_close(_session uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$ SELECT private.match_partner_wants_close(_session) $$;
CREATE FUNCTION public.match_abandon(_session uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.match_abandon(_session) $$;
REVOKE EXECUTE ON FUNCTION public.match_join(uuid), public.match_extend(uuid), public.match_undo(uuid),
  public.match_request_close(uuid, boolean), public.match_partner_wants_close(uuid), public.match_abandon(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_join(uuid), public.match_extend(uuid), public.match_undo(uuid),
  public.match_request_close(uuid, boolean), public.match_partner_wants_close(uuid), public.match_abandon(uuid) TO authenticated;

-- Only one open session per space
CREATE UNIQUE INDEX match_one_open_per_space ON public.match_sessions(space_id) WHERE status = 'open';