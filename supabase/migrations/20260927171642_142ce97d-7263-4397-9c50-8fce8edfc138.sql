CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.media_type AS ENUM ('movie','tv');
CREATE TYPE public.interest_reaction AS ENUM ('fire','like','neutral','dislike');
CREATE TYPE public.series_status AS ENUM ('watching','waiting','paused','abandoned','completed');

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, display_name text NOT NULL, avatar_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles TO authenticated; GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_own ON public.profiles FOR ALL TO authenticated USING (id=auth.uid()) WITH CHECK (id=auth.uid());
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.couple_spaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT 'Nosso cinema', created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.couple_spaces TO authenticated; GRANT ALL ON public.couple_spaces TO service_role;
ALTER TABLE public.couple_spaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.space_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE, user_id uuid NOT NULL, joined_at timestamptz NOT NULL DEFAULT now(), UNIQUE(space_id,user_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.space_members TO authenticated; GRANT ALL ON public.space_members TO service_role;
ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_space_member(_space_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.space_members WHERE space_id=_space_id AND user_id=auth.uid()) $$;
GRANT EXECUTE ON FUNCTION public.is_space_member(uuid) TO authenticated;

CREATE POLICY spaces_create ON public.couple_spaces FOR INSERT TO authenticated WITH CHECK (created_by=auth.uid());
CREATE POLICY spaces_read ON public.couple_spaces FOR SELECT TO authenticated USING (public.is_space_member(id) OR created_by=auth.uid());
CREATE POLICY spaces_update ON public.couple_spaces FOR UPDATE TO authenticated USING (public.is_space_member(id)) WITH CHECK (public.is_space_member(id));
CREATE POLICY members_read ON public.space_members FOR SELECT TO authenticated USING (public.is_space_member(space_id) OR user_id=auth.uid());
CREATE POLICY members_join_creator ON public.space_members FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.couple_spaces s WHERE s.id=space_id AND s.created_by=auth.uid()));
CREATE POLICY members_leave ON public.space_members FOR DELETE TO authenticated USING (user_id=auth.uid());
CREATE TRIGGER spaces_updated BEFORE UPDATE ON public.couple_spaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.authorized_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE, email text NOT NULL, invited_by uuid NOT NULL, accepted_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(space_id,email));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.authorized_users TO authenticated; GRANT ALL ON public.authorized_users TO service_role;
ALTER TABLE public.authorized_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY authorized_read ON public.authorized_users FOR SELECT TO authenticated USING (public.is_space_member(space_id) OR lower(email)=lower(auth.jwt()->>'email'));
CREATE POLICY authorized_invite ON public.authorized_users FOR INSERT TO authenticated WITH CHECK (public.is_space_member(space_id) AND invited_by=auth.uid());
CREATE POLICY authorized_accept ON public.authorized_users FOR UPDATE TO authenticated USING (lower(email)=lower(auth.jwt()->>'email')) WITH CHECK (accepted_by=auth.uid());

CREATE TABLE public.works (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE, media_type public.media_type NOT NULL, tmdb_id integer NOT NULL, title text NOT NULL, original_title text, poster_path text, backdrop_path text, release_year integer, overview text, genres text[] NOT NULL DEFAULT '{}', runtime_minutes integer, created_by uuid NOT NULL, activity_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(space_id,media_type,tmdb_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.works TO authenticated; GRANT ALL ON public.works TO service_role;
ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;
CREATE POLICY works_access ON public.works FOR ALL TO authenticated USING (public.is_space_member(space_id)) WITH CHECK (public.is_space_member(space_id) AND created_by=auth.uid());
CREATE TRIGGER works_updated BEFORE UPDATE ON public.works FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.work_metadata_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_id uuid NOT NULL UNIQUE REFERENCES public.works(id) ON DELETE CASCADE, payload jsonb NOT NULL DEFAULT '{}', expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.work_metadata_cache TO authenticated; GRANT ALL ON public.work_metadata_cache TO service_role;
ALTER TABLE public.work_metadata_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY metadata_access ON public.work_metadata_cache FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id))) WITH CHECK (EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id)));

CREATE TABLE public.indications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE, work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE, indicated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(work_id,indicated_by));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.indications TO authenticated; GRANT ALL ON public.indications TO service_role;
ALTER TABLE public.indications ENABLE ROW LEVEL SECURITY;
CREATE POLICY indications_access ON public.indications FOR ALL TO authenticated USING (public.is_space_member(space_id)) WITH CHECK (public.is_space_member(space_id) AND indicated_by=auth.uid());

CREATE TABLE public.interests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE, user_id uuid NOT NULL, reaction public.interest_reaction NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,work_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.interests TO authenticated; GRANT ALL ON public.interests TO service_role;
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;
CREATE POLICY interests_read ON public.interests FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id)));
CREATE POLICY interests_own ON public.interests FOR ALL TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id)));
CREATE TRIGGER interests_updated BEFORE UPDATE ON public.interests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ratings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE, user_id uuid NOT NULL, score numeric(3,1) NOT NULL CHECK(score>=0 AND score<=10 AND score*2=trunc(score*2)), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,work_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ratings TO authenticated; GRANT ALL ON public.ratings TO service_role;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ratings_read ON public.ratings FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id)));
CREATE POLICY ratings_own ON public.ratings FOR ALL TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id)));
CREATE TRIGGER ratings_updated BEFORE UPDATE ON public.ratings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.prior_watch_status (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE, user_id uuid NOT NULL, watched boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,work_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.prior_watch_status TO authenticated; GRANT ALL ON public.prior_watch_status TO service_role;
ALTER TABLE public.prior_watch_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY prior_read ON public.prior_watch_status FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id)));
CREATE POLICY prior_own ON public.prior_watch_status FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());

CREATE TABLE public.source_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE, work_id uuid REFERENCES public.works(id) ON DELETE CASCADE, platform text NOT NULL, source_url text NOT NULL, caption text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(space_id,source_url));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.source_posts TO authenticated; GRANT ALL ON public.source_posts TO service_role;
ALTER TABLE public.source_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY posts_access ON public.source_posts FOR ALL TO authenticated USING(public.is_space_member(space_id)) WITH CHECK(public.is_space_member(space_id) AND created_by=auth.uid());

CREATE TABLE public.joint_watch_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE, work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE, watched_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, notes text, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.joint_watch_sessions TO authenticated; GRANT ALL ON public.joint_watch_sessions TO service_role;
ALTER TABLE public.joint_watch_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_access ON public.joint_watch_sessions FOR ALL TO authenticated USING(public.is_space_member(space_id)) WITH CHECK(public.is_space_member(space_id) AND created_by=auth.uid());

CREATE TABLE public.watch_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE, work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE, session_id uuid REFERENCES public.joint_watch_sessions(id) ON DELETE SET NULL, season_number integer, episode_number integer, watched_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, UNIQUE(space_id,work_id,season_number,episode_number));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.watch_events TO authenticated; GRANT ALL ON public.watch_events TO service_role;
ALTER TABLE public.watch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_access ON public.watch_events FOR ALL TO authenticated USING(public.is_space_member(space_id)) WITH CHECK(public.is_space_member(space_id) AND created_by=auth.uid());

CREATE TABLE public.series_states (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.couple_spaces(id) ON DELETE CASCADE, work_id uuid NOT NULL UNIQUE REFERENCES public.works(id) ON DELETE CASCADE, status public.series_status NOT NULL DEFAULT 'watching', next_season integer, next_episode integer, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.series_states TO authenticated; GRANT ALL ON public.series_states TO service_role;
ALTER TABLE public.series_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY states_access ON public.series_states FOR ALL TO authenticated USING(public.is_space_member(space_id)) WITH CHECK(public.is_space_member(space_id));

CREATE TABLE public.season_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE, season_number integer NOT NULL, name text NOT NULL, poster_path text, episode_count integer, payload jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(work_id,season_number));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.season_cache TO authenticated; GRANT ALL ON public.season_cache TO service_role;
ALTER TABLE public.season_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY seasons_access ON public.season_cache FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id))) WITH CHECK(EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id)));

CREATE TABLE public.episode_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE, season_number integer NOT NULL, episode_number integer NOT NULL, name text NOT NULL, overview text, still_path text, runtime_minutes integer, air_date date, payload jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(work_id,season_number,episode_number));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.episode_cache TO authenticated; GRANT ALL ON public.episode_cache TO service_role;
ALTER TABLE public.episode_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY episodes_access ON public.episode_cache FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id))) WITH CHECK(EXISTS(SELECT 1 FROM public.works w WHERE w.id=work_id AND public.is_space_member(w.space_id)));

CREATE TABLE public.notification_preferences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE, new_indication boolean NOT NULL DEFAULT true, watch_reminders boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.notification_preferences TO authenticated; GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefs_own ON public.notification_preferences FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());

CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL, body text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.notifications TO authenticated; GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON public.notifications FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());

CREATE TABLE public.integration_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, provider text NOT NULL, status text NOT NULL DEFAULT 'not_configured', external_account_id text, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,provider));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.integration_accounts TO authenticated; GRANT ALL ON public.integration_accounts TO service_role;
ALTER TABLE public.integration_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY integrations_own ON public.integration_accounts FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());

CREATE INDEX works_space_activity_idx ON public.works(space_id,activity_at DESC);
CREATE INDEX watch_events_progress_idx ON public.watch_events(work_id,season_number,episode_number);
ALTER PUBLICATION supabase_realtime ADD TABLE public.interests, public.ratings, public.watch_events, public.series_states;