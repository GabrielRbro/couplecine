import { createFileRoute } from "@tanstack/react-router";
import { fetchCaption, parseSocial } from "@/lib/social.server";
import { explicitTitle } from "@/lib/explicit-title";
import { findTitle } from "@/lib/tmdb.server";

// Temporary read-only production probe for the two public example posts. Remove after verification.
export const Route = createFileRoute("/api/public/social-check")({
  server: {
    handlers: {
      GET: async () => {
        const urls = ["https://www.instagram.com/reel/DXXrooqjCI9/", "https://vt.tiktok.com/ZSb3uY7AE/"];
        const results = await Promise.all(urls.map(async (url) => {
          const ref = parseSocial(url)!;
          const result = await fetchCaption(ref);
          const guess = result.caption ? explicitTitle(result.caption) : null;
          const work = guess ? await findTitle(guess).catch(() => null) : null;
          return { platform: result.platform, status: result.status, firstLine: result.caption?.split("\n", 1)[0]?.slice(0, 120) ?? null,
            guess, work: work ? { title: work.title, tmdbId: work.tmdbId, year: work.year } : null };
        }));
        return Response.json(results, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
