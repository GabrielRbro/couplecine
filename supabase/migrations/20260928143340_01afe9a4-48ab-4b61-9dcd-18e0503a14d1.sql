CREATE OR REPLACE FUNCTION private.bump_work_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.works SET activity_at = now() WHERE id = NEW.work_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.bump_work_activity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER indications_bump_activity AFTER INSERT ON public.indications FOR EACH ROW EXECUTE FUNCTION private.bump_work_activity();
CREATE TRIGGER source_posts_bump_activity AFTER INSERT ON public.source_posts FOR EACH ROW WHEN (NEW.work_id IS NOT NULL) EXECUTE FUNCTION private.bump_work_activity();