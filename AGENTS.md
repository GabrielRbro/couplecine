<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- The whole app lives under `src/routes/_authenticated/` (home at `/`); only `/auth` is public — the app is private to one couple.
- TMDB is called only from `src/lib/catalog.functions.ts` via `tmdb.server.ts` — keeps the API key on the server.
- Ordinary reads/writes go directly through the browser client with RLS scoped by space membership — fewer moving parts.
- Indication activity is bumped by a DB trigger, never by reaction/rating edits — product rule for Indicações ordering.
- Descobrir dismissals live in `discover_dismissals` (per user, RLS own) and never create a 👎 interest — dismissing only hides from that user's feed.
- Authenticated app chrome lives in the `_authenticated` layout so the BottomNav persists across route changes; route pages render only their content shell.
- Library grids read a lightweight summary (`libraryQueryOptions`) with episode history pre-aggregated by the `work_watch_summary` view; raw watch_events load only on the work page — keeps list routes fast.
- Page transitions use the router's View Transitions (`defaultViewTransition`) with `poster-<id>`/`backdrop-<id>` names for shared elements — degrades to instant swap where unsupported.
- Gemini is called only from `gemini.server.ts` via `ai.functions.ts`/catalog rerank, cached and rate-guarded in `ai_cache`; TMDB validates every AI suggestion and is the fallback.
- Demo seed rows are tracked in `demo_batch_items` and removed only through `demo_cleanup(batch)` — never by title/date.
- The `_authenticated` gate reads the local session (`getSession`); RLS/JWT on every query is the real security boundary.
- MCP server lives in `src/lib/mcp/` (read-only tools, Supabase OAuth, RLS as the caller) — agents get the same access as the signed-in user.
