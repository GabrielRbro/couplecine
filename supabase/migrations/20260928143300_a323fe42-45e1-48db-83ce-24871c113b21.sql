CREATE OR REPLACE FUNCTION private.shares_space(_other uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.space_members a JOIN public.space_members b ON a.space_id=b.space_id WHERE a.user_id=auth.uid() AND b.user_id=_other)
$$;
REVOKE ALL ON FUNCTION private.shares_space(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.shares_space(uuid) TO authenticated, service_role;
CREATE POLICY profiles_partner_read ON public.profiles FOR SELECT TO authenticated USING (private.shares_space(id));

CREATE OR REPLACE FUNCTION private.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.profiles(id, display_name, avatar_url)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)), NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();
INSERT INTO public.profiles(id, display_name, avatar_url)
SELECT id, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email,'@',1)), raw_user_meta_data->>'avatar_url' FROM auth.users ON CONFLICT (id) DO NOTHING;