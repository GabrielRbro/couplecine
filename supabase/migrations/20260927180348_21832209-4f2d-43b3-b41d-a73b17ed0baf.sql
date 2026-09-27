CREATE POLICY members_join_invited ON public.space_members FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.authorized_users a
  WHERE a.space_id = space_members.space_id
    AND lower(a.email) = lower(auth.jwt()->>'email')
));