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
