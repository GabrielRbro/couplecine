CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
ALTER FUNCTION public.is_space_member(uuid) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.is_space_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_space_member(uuid) TO authenticated, service_role;