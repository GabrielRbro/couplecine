-- Per-user cache for small Gemini calls; also used to dedupe requests and enforce a rate guard.
CREATE TABLE public.ai_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  feature text NOT NULL CHECK (feature IN ('import','smart_search','discover')),
  cache_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, feature, cache_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_cache TO authenticated;
GRANT ALL ON public.ai_cache TO service_role;
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_cache_own ON public.ai_cache FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX ai_cache_user_feature_time ON public.ai_cache (user_id, feature, created_at DESC);