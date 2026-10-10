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
- Overlays (sheets, radial, piles) register a silent history entry via `src/lib/overlay.ts`; its capture-phase popstate hides those entries from the router — Back closes overlays first without ghost navigations.
- Shared view transitions are set only on the tapped element and destination hero (`src/lib/shared-transition.ts`) — naming every card painted lists above the BottomNav.
- Work deletion is scheduled in module scope (`src/lib/pending-delete.ts`) so the undo timer survives route changes; closing the app keeps the work.
- Episode toggles go through the `set_episode_watched` RPC so the watch event and series state commit together.
- The Gemini key is stored in `private.app_secrets`, readable only through service-role definer functions; resolution is app key > GEMINI_API_KEY env. AI attempts are reserved atomically via `ai_reserve` on cache miss only.
- PWA: `pwa.config.ts` (build-only Vite plugin via workbox-build) writes manifest + sw.js precaching only static build assets, no runtime/navigation caching; `src/lib/pwa.ts` is the sole registrar (refuses dev/preview/iframe, `?sw=off`) and prompts "Atualizar" instead of auto-reloading — keeps private data off the cache and never interrupts use.
- Catalog previews use the authenticated title route and existing catalog server functions; existing works link directly to their work page — avoids duplicate local records and keeps TMDB credentials server-only.
- Gallery title logos share complete work_metadata_cache payloads and are fetched in visible batches with two workers; expired payloads refresh fully — avoids N+1 bursts and extending stale metadata.
- MatchSimulator persists account-scoped temporary state in sessionStorage, offered only to a one-member space and isolated from real Match writes — enables temporary solo QA without fake participants or sessions.

- Match external candidates are TMDB-validated; solo candidates remain local and real candidates materialize only catalog identities without indication or interest, so stable voting IDs do not pollute library sections.

- Search relevance combines bounded title matching with TMDB recognition signals; AI batches exclude previous validated identities and use query/type/batch cache keys to avoid repeat sets.
- Import: one `source_posts` row per space+canonical URL (Reel stays /reel/), linked N:N to works via `source_post_works`; personal `import_sessions`/`import_candidates` written server-side, confirm/undo via `import_*` RPCs that record and revert only their own effects; captions fetched only on tap from rebuilt allowlisted URLs, AI only on explicit action — resumable, provenance-safe, no SSRF.
- Simkl is read-only per user (AUTH V2 + PKCE); tokens/OAuth states live in `private` behind service-role definer functions, `integration_accounts`/`external_watch_items` are user-read-only via RLS and written only server-side, and external history never writes watch_events/prior_watch_status — keeps credentials off the client and evidence separate from couple data.
- Nuvio TV is exposed only as a copyable canonical `nuvio://tmdb/<type>/<id>` link — remote send/playback needs a paired companion that is unproven.
