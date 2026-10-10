DROP POLICY IF EXISTS import_candidates_skip_own ON public.import_candidates;
CREATE POLICY import_candidates_skip_own ON public.import_candidates FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND status IN ('pending','skipped','error'))
  WITH CHECK (created_by = auth.uid() AND status IN ('pending','skipped'));