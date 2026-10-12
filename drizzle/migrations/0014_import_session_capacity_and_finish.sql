CREATE OR REPLACE FUNCTION private.import_session_capacity_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'completed' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.space_id::text || ':' || NEW.created_by::text, 0));
  IF (SELECT count(*) FROM import_sessions WHERE space_id=NEW.space_id AND created_by=NEW.created_by AND status <> 'completed' AND id <> NEW.id) >= 3 THEN
    RAISE EXCEPTION 'import_session_limit';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_session_capacity BEFORE INSERT OR UPDATE OF status ON public.import_sessions FOR EACH ROW EXECUTE FUNCTION private.import_session_capacity_guard();

CREATE OR REPLACE FUNCTION public.import_session_start(_space uuid, _origin text, _title text DEFAULT NULL, _text text DEFAULT NULL, _url text DEFAULT NULL, _source uuid DEFAULT NULL, _token text DEFAULT NULL, _replace uuid DEFAULT NULL, _refs jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); oldest import_sessions; sid uuid; ids uuid[] := '{}'; ref jsonb; source_id uuid;
BEGIN
  IF uid IS NULL OR NOT private.is_space_member(_space) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _origin NOT IN ('share','manual','capture') OR length(coalesce(_title,''))>300 OR length(coalesce(_text,''))>4000 OR length(coalesce(_url,''))>2000 OR jsonb_typeof(_refs)<>'array' OR jsonb_array_length(_refs)>12 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_space::text || ':' || uid::text, 0));
  IF _token IS NOT NULL THEN
    SELECT id INTO sid FROM import_sessions WHERE created_by=uid AND client_token=_token AND space_id=_space;
    IF FOUND THEN RETURN jsonb_build_object('sessionId',sid,'reused',true); END IF;
  END IF;
  IF (SELECT count(*) FROM import_sessions WHERE space_id=_space AND created_by=uid AND status<>'completed') >= 3 THEN
    SELECT * INTO oldest FROM import_sessions WHERE space_id=_space AND created_by=uid AND status<>'completed' ORDER BY created_at,id LIMIT 1 FOR UPDATE;
    IF _replace IS DISTINCT FROM oldest.id THEN RETURN jsonb_build_object('limit',true,'oldestId',oldest.id,'oldestTitle',coalesce(nullif(oldest.shared_title,''),CASE WHEN oldest.origin='capture' THEN 'Captura' WHEN oldest.origin='share' THEN 'Compartilhamento' ELSE 'Texto ou link' END)); END IF;
    -- Saved decisions must retain their candidates: provenance/undo in another session can still reference them.
    IF EXISTS (SELECT 1 FROM import_candidates WHERE session_id=oldest.id AND status='saved') THEN
      UPDATE import_candidates SET status='skipped',note=NULL,updated_at=now() WHERE session_id=oldest.id AND status IN ('pending','error');
      UPDATE import_sessions SET status='completed', skipped_source_ids=source_post_ids,updated_at=now() WHERE id=oldest.id;
    ELSE
      DELETE FROM import_sessions WHERE id=oldest.id;
    END IF;
  END IF;
  IF _source IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM source_posts WHERE id=_source AND space_id=_space) THEN RAISE EXCEPTION 'invalid_source'; END IF;
    ids := array_append(ids,_source);
  END IF;
  FOR ref IN SELECT value FROM jsonb_array_elements(_refs) LOOP
    source_id := public.import_source_for(_space,ref->>'platform',ref->>'url',ref->>'shortcode',coalesce((ref->>'reel')::boolean,false));
    IF NOT source_id = ANY(ids) THEN ids:=array_append(ids,source_id); END IF;
  END LOOP;
  INSERT INTO import_sessions(space_id,created_by,origin,shared_title,shared_text,shared_url,source_post_ids,client_token) VALUES (_space,uid,_origin,_title,_text,_url,ids,_token) RETURNING id INTO sid;
  RETURN jsonb_build_object('sessionId',sid,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.import_session_start(uuid,text,text,text,text,uuid,text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_session_start(uuid,text,text,text,text,uuid,text,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_finish_remaining(_session uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s import_sessions; uid uuid:=auth.uid();
BEGIN
  SELECT * INTO s FROM import_sessions WHERE id=_session FOR UPDATE;
  IF uid IS NULL OR NOT FOUND OR s.created_by<>uid OR NOT private.is_space_member(s.space_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF s.status='completed' THEN RETURN 'completed'; END IF;
  UPDATE import_candidates SET status='skipped',note=NULL,updated_at=now() WHERE session_id=_session AND status IN ('pending','error');
  UPDATE import_sessions SET skipped_source_ids=source_post_ids WHERE id=_session;
  RETURN public.import_complete(_session);
END $$;
REVOKE ALL ON FUNCTION public.import_finish_remaining(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_finish_remaining(uuid) TO authenticated;