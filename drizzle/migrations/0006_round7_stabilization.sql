-- 1) Couple invariants: one space per user, at most two members per space.
ALTER TABLE public.space_members ADD CONSTRAINT space_members_one_space_per_user UNIQUE (user_id);

CREATE OR REPLACE FUNCTION private.enforce_space_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('space_members:' || NEW.space_id::text));
  IF (SELECT count(*) FROM space_members WHERE space_id = NEW.space_id) >= 2 THEN
    RAISE EXCEPTION 'Este espaço já tem dois membros.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER space_members_capacity BEFORE INSERT ON public.space_members
FOR EACH ROW EXECUTE FUNCTION private.enforce_space_capacity();

-- 2) Works: any member may refresh base metadata; identity/ownership columns are immutable.
DROP POLICY IF EXISTS works_access ON public.works;
CREATE POLICY works_select ON public.works FOR SELECT TO authenticated USING (private.is_space_member(space_id));
CREATE POLICY works_insert ON public.works FOR INSERT TO authenticated
  WITH CHECK (private.is_space_member(space_id) AND created_by = auth.uid());
CREATE POLICY works_update ON public.works FOR UPDATE TO authenticated
  USING (private.is_space_member(space_id)) WITH CHECK (private.is_space_member(space_id));
CREATE POLICY works_delete ON public.works FOR DELETE TO authenticated USING (private.is_space_member(space_id));

CREATE OR REPLACE FUNCTION private.works_immutable_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.space_id <> OLD.space_id OR NEW.created_by <> OLD.created_by
     OR NEW.media_type <> OLD.media_type OR NEW.tmdb_id <> OLD.tmdb_id THEN
    RAISE EXCEPTION 'Campos de identidade da obra não podem mudar.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER works_identity_guard BEFORE UPDATE ON public.works
FOR EACH ROW EXECUTE FUNCTION private.works_immutable_identity();

-- 3) Episode toggle + series state in one transaction (runs as the caller; RLS applies).
CREATE OR REPLACE FUNCTION public.set_episode_watched(
  _work uuid, _season int, _episode int, _watched boolean,
  _next_season int, _next_episode int)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE sp uuid;
BEGIN
  SELECT space_id INTO sp FROM works WHERE id = _work;
  IF sp IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  IF _watched THEN
    INSERT INTO watch_events(space_id, work_id, season_number, episode_number, created_by)
    VALUES (sp, _work, _season, _episode, auth.uid())
    ON CONFLICT (space_id, work_id, season_number, episode_number) DO NOTHING;
  ELSE
    DELETE FROM watch_events WHERE work_id = _work AND season_number = _season AND episode_number = _episode;
  END IF;
  INSERT INTO series_states(space_id, work_id, status, next_season, next_episode, updated_by)
  VALUES (sp, _work, 'watching', _next_season, _next_episode, auth.uid())
  ON CONFLICT (work_id) DO UPDATE SET next_season = EXCLUDED.next_season,
    next_episode = EXCLUDED.next_episode, updated_by = EXCLUDED.updated_by, updated_at = now();
END $$;
GRANT EXECUTE ON FUNCTION public.set_episode_watched(uuid,int,int,boolean,int,int) TO authenticated;

-- 4) Demo cleanup never leaves open Match sessions pointing at deleted works.
CREATE OR REPLACE FUNCTION public.demo_cleanup(_batch text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int; ids uuid[];
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT coalesce(array_agg(work_id), '{}') INTO ids FROM demo_batch_items WHERE batch = _batch AND work_id IS NOT NULL;
  DELETE FROM match_votes WHERE session_id IN (SELECT id FROM match_sessions WHERE status = 'open' AND work_ids && ids);
  DELETE FROM match_participants WHERE session_id IN (SELECT id FROM match_sessions WHERE status = 'open' AND work_ids && ids);
  UPDATE match_sessions SET status = 'abandoned', closed_at = now(), result_work_ids = NULL
    WHERE status = 'open' AND work_ids && ids;
  DELETE FROM match_sessions WHERE id IN (SELECT match_session_id FROM demo_batch_items WHERE batch = _batch AND match_session_id IS NOT NULL);
  WITH d AS (DELETE FROM works WHERE id = ANY(ids) RETURNING 1) SELECT count(*) INTO n FROM d;
  DELETE FROM demo_batch_items WHERE batch = _batch;
  RETURN n;
END $$;

-- 5) App-level secrets (Gemini key): private schema, service-role only via definer functions.
CREATE TABLE private.app_secrets (name text PRIMARY KEY, value text NOT NULL, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON private.app_secrets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_secret_get(_name text) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path TO 'private' AS $$ SELECT value FROM private.app_secrets WHERE name = _name $$;
CREATE OR REPLACE FUNCTION public.app_secret_set(_name text, _value text, _by uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'private' AS $$
  INSERT INTO private.app_secrets(name, value, updated_by) VALUES (_name, _value, _by)
  ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now() $$;
CREATE OR REPLACE FUNCTION public.app_secret_delete(_name text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'private' AS $$ DELETE FROM private.app_secrets WHERE name = _name $$;
REVOKE ALL ON FUNCTION public.app_secret_get(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_secret_set(text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_secret_delete(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_secret_get(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_secret_set(text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_secret_delete(text) TO service_role;

-- 6) AI usage: every real attempt reserved atomically, independent of the cache.
CREATE TABLE private.ai_usage (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL, feature text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ai_usage_lookup ON private.ai_usage (user_id, feature, created_at);
REVOKE ALL ON private.ai_usage FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_reserve(_feature text, _limit int) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private' AS $$
DECLARE uid uuid := auth.uid(); used int;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ai:' || uid::text || ':' || _feature));
  SELECT count(*) INTO used FROM private.ai_usage
    WHERE user_id = uid AND feature = _feature AND created_at > now() - interval '1 hour';
  IF used >= _limit THEN RETURN false; END IF;
  INSERT INTO private.ai_usage(user_id, feature) VALUES (uid, _feature);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ai_reserve(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_reserve(text,int) TO authenticated;