import { createFileRoute } from "@tanstack/react-router";
import { fetchCaption, parseSocial } from "@/lib/social.server";

// Temporary read-only production probe for the two public example posts. Remove after verification.
export const Route = createFileRoute("/api/public/social-check")({
  server: {
    handlers: {
      GET: async () => {
        const urls = ["https://www.instagram.com/reel/DXXrooqjCI9/", "https://vt.tiktok.com/ZSb3uY7AE/"];
        const results = await Promise.all(urls.map(async (url) => {
          const ref = parseSocial(url)!;
          const result = await fetchCaption(ref);
          return { platform: result.platform, status: result.status, firstLine: result.caption?.split("\n", 1)[0]?.slice(0, 120) ?? null };
        }));
        const probeUrls = [
          "https://r.jina.ai/https://www.instagram.com/reel/DXXrooqjCI9/",
          "https://r.jina.ai/https://www.tiktok.com/oembed?url=https%3A%2F%2Fvt.tiktok.com%2FZSb3uY7AE%2F",
        ];
        const probes = await Promise.all(probeUrls.map(async (url) => {
          try {
            const response = await fetch(url, { redirect: "manual", headers: { Accept: "text/plain" }, signal: AbortSignal.timeout(20_000) });
            const body = await response.text();
            return { status: response.status, bytes: body.length, start: body.slice(0, 140), reader: url.includes("instagram") ? "instagram" : "tiktok" };
          } catch (error) { return { error: error instanceof Error ? error.message : String(error), reader: url.includes("instagram") ? "instagram" : "tiktok" }; }
        }));
        return Response.json({ results, probes }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
