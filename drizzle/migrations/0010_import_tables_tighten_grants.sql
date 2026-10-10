REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.import_sessions, public.import_candidates, public.source_post_works FROM authenticated, anon;
REVOKE SELECT ON public.import_sessions, public.import_candidates, public.source_post_works FROM anon;
GRANT SELECT ON public.import_sessions, public.import_candidates, public.source_post_works TO authenticated;
GRANT UPDATE (status) ON public.import_candidates TO authenticated;