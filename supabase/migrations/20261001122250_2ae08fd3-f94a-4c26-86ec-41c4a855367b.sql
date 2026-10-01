ALTER FUNCTION public.match_status(uuid) SET SCHEMA private;
REVOKE EXECUTE ON FUNCTION private.match_status(uuid) FROM public, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.match_status(uuid) TO authenticated;
CREATE FUNCTION public.match_status(_session uuid)
RETURNS TABLE (user_id uuid, voted integer, matches uuid[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM private.match_status(_session);
$$;
REVOKE EXECUTE ON FUNCTION public.match_status(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.match_status(uuid) TO authenticated;