CREATE TABLE public.discover_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  media_type public.media_type NOT NULL,
  tmdb_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, media_type, tmdb_id)
);
GRANT SELECT, INSERT, DELETE ON public.discover_dismissals TO authenticated;
GRANT ALL ON public.discover_dismissals TO service_role;
ALTER TABLE public.discover_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY dismissals_own ON public.discover_dismissals FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());