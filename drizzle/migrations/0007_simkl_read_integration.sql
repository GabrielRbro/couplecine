CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.simkl_tokens (
  user_id uuid PRIMARY KEY,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  scope text NOT NULL,
  snapshot jsonb,
  last_sync_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS private.oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  provider text NOT NULL,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.simkl_tokens, private.oauth_states FROM PUBLIC, anon, authenticated;

-- integration_accounts: members only read their own row; writes happen server-side.
DROP POLICY IF EXISTS integrations_own ON public.integration_accounts;
REVOKE INSERT, UPDATE, DELETE ON public.integration_accounts FROM authenticated;
CREATE POLICY integrations_read_own ON public.integration_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());
ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS external_username text,
  ADD COLUMN IF NOT EXISTS sync_status text,
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;

CREATE TABLE public.external_watch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  external_type text NOT NULL,
  external_id text NOT NULL,
  media_type text,
  tmdb_id integer,
  imdb_id text,
  title text NOT NULL,
  year integer,
  status text,
  last_watched_at timestamptz,
  watched_episodes_count integer,
  total_episodes_count integer,
  dated_episodes_count integer NOT NULL DEFAULT 0,
  user_rating numeric,
  episodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, external_type, external_id)
);
GRANT SELECT ON public.external_watch_items TO authenticated;
GRANT ALL ON public.external_watch_items TO service_role;
ALTER TABLE public.external_watch_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY external_watch_read_own ON public.external_watch_items FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.simkl_state_put(_state text, _user uuid, _verifier text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'private' AS $$
  DELETE FROM private.oauth_states WHERE expires_at < now() OR (user_id = _user AND provider = 'simkl');
  INSERT INTO private.oauth_states(state, user_id, provider, verifier, expires_at) VALUES (_state, _user, 'simkl', _verifier, now() + interval '10 minutes');
$$;
CREATE OR REPLACE FUNCTION public.simkl_state_take(_state text)
RETURNS TABLE(user_id uuid, verifier text) LANGUAGE sql SECURITY DEFINER SET search_path TO 'private' AS $$
  DELETE FROM private.oauth_states s WHERE s.state = _state AND s.provider = 'simkl' RETURNING
    CASE WHEN s.expires_at > now() THEN s.user_id END, CASE WHEN s.expires_at > now() THEN s.verifier END;
$$;
CREATE OR REPLACE FUNCTION public.simkl_token_get(_user uuid)
RETURNS TABLE(access_token text, refresh_token text, expires_at timestamptz, scope text, snapshot jsonb, last_sync_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'private' AS $$
  SELECT access_token, refresh_token, expires_at, scope, snapshot, last_sync_at FROM private.simkl_tokens WHERE user_id = _user;
$$;
CREATE OR REPLACE FUNCTION public.simkl_token_set(_user uuid, _access text, _refresh text, _expires timestamptz, _scope text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'private' AS $$
  INSERT INTO private.simkl_tokens(user_id, access_token, refresh_token, expires_at, scope) VALUES (_user, _access, _refresh, _expires, _scope)
  ON CONFLICT (user_id) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at, scope = EXCLUDED.scope, updated_at = now();
$$;
CREATE OR REPLACE FUNCTION public.simkl_sync_mark(_user uuid, _snapshot jsonb, _attempt boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'private' AS $$
  UPDATE private.simkl_tokens SET last_sync_at = now(), snapshot = CASE WHEN _attempt THEN snapshot ELSE coalesce(_snapshot, snapshot) END WHERE user_id = _user;
$$;
CREATE OR REPLACE FUNCTION public.simkl_token_delete(_user uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'private' AS $$
  DELETE FROM private.simkl_tokens WHERE user_id = _user;
$$;
REVOKE EXECUTE ON FUNCTION public.simkl_state_put(text, uuid, text), public.simkl_state_take(text), public.simkl_token_get(uuid),
  public.simkl_token_set(uuid, text, text, timestamptz, text), public.simkl_sync_mark(uuid, jsonb, boolean), public.simkl_token_delete(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simkl_state_put(text, uuid, text), public.simkl_state_take(text), public.simkl_token_get(uuid),
  public.simkl_token_set(uuid, text, text, timestamptz, text), public.simkl_sync_mark(uuid, jsonb, boolean), public.simkl_token_delete(uuid)
  TO service_role;