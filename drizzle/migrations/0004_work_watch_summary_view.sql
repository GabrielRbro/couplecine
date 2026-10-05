CREATE VIEW public.work_watch_summary WITH (security_invoker = true) AS
SELECT work_id,
       count(*)::int AS seen_count,
       max(watched_at) AS last_watched_at,
       array_agg(DISTINCT (season_number::text || ':' || episode_number::text))
         FILTER (WHERE season_number IS NOT NULL AND episode_number IS NOT NULL) AS seen_keys
FROM public.watch_events
GROUP BY work_id;
GRANT SELECT ON public.work_watch_summary TO authenticated;
GRANT SELECT ON public.work_watch_summary TO service_role;