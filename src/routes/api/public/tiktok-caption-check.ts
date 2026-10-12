import { createFileRoute } from "@tanstack/react-router";
import { fetchCaption, parseSocial } from "@/lib/social.server";

// Temporary, fixed-post network diagnostic. Remove after checking the hosted worker.
export const Route = createFileRoute("/api/public/tiktok-caption-check")({
  server: { handlers: { GET: async () => {
    const headers = { "User-Agent": "Mozilla/5.0 (compatible; AppCinemaImport/1.0)", Accept: "text/html,application/json" };
    const url = "https://www.tiktok.com/@miromalacrida/video/7478703127655484727";
    try {
      const variants = await Promise.all([
        { name: "language", url, headers: { ...headers, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" } },
        { name: "mobile", url: url.replace("www.tiktok.com", "m.tiktok.com"), headers: { ...headers, "User-Agent": "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" } },
        { name: "query", url: `${url}?lang=pt-BR`, headers },
        { name: "api", url: "https://www.tiktok.com/api/item/detail/?itemId=7478703127655484727", headers },
      ].map(async (v) => {
        try {
          const res = await fetch(v.url, { redirect: "manual", headers: v.headers, signal: AbortSignal.timeout(6000) });
          const body = await res.text();
          if (v.name === "api") return { name: v.name, status: res.status, length: body.length, tracks: body.includes("subtitleInfos"), item: body.includes("7478703127655484727") };
          const raw = body.match(/<script[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
          const item = raw ? JSON.parse(raw)?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct : null;
          const found = item?.video?.subtitleInfos ?? [];
          const checked = v.name === "language" ? await Promise.all(found.slice(0, 3).map(async (track: { Url?: string; Format?: string; LanguageCodeName?: string }) => {
            const host = track.Url ? new URL(track.Url).hostname : null;
            if (!host || !/^v\d+-webapp(?:-[a-z0-9-]+)?\.(?:tiktok\.com|tiktokcdn-eu\.com)$/.test(host)) return { format: track.Format, lang: track.LanguageCodeName, host, safe: false };
            try {
              const r = await fetch(track.Url!, { redirect: "manual", headers: v.headers, signal: AbortSignal.timeout(6000) });
              const text = await r.text();
              return { format: track.Format, lang: track.LanguageCodeName, host, status: r.status, length: text.length, vtt: text.startsWith("WEBVTT"), redRooms: text.includes("Red Rooms") };
            } catch (e) { return { format: track.Format, lang: track.LanguageCodeName, host, error: e instanceof Error ? e.name : "error" }; }
          })) : undefined;
          return { name: v.name, status: res.status, length: body.length, tracks: found.length, description: item?.desc?.length ?? null, checked };
        } catch (e) { return { name: v.name, error: e instanceof Error ? e.name : "error" }; }
      }));
      const page = await fetch(url, { redirect: "manual", headers, signal: AbortSignal.timeout(6000) });
      const html = await page.text();
      const raw = html.match(/<script[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
      const data = raw ? JSON.parse(raw) : null;
      const video = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct?.video;
      const tracks = [];
      for (const track of (video?.subtitleInfos ?? []).slice(0, 3)) {
        const trackUrl = typeof track.Url === "string" ? new URL(track.Url) : null;
        if (!trackUrl || !/^v\d+-webapp(?:-[a-z0-9-]+)?\.tiktok\.com$/.test(trackUrl.hostname)) continue;
        try {
          const res = await fetch(track.Url, { redirect: "manual", headers, signal: AbortSignal.timeout(6000) });
          const body = await res.text();
          tracks.push({ format: track.Format, lang: track.LanguageCodeName, status: res.status, length: body.length, vtt: body.startsWith("WEBVTT"), redRooms: body.includes("Red Rooms") });
        } catch (e) { tracks.push({ format: track.Format, lang: track.LanguageCodeName, error: e instanceof Error ? e.name : "error" }); }
      }
      const result = await fetchCaption(parseSocial(url)!);
      return Response.json({ page: page.status, htmlLength: html.length, description: data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct?.desc?.length ?? null, tracks, variants,
        captionResult: { status: result.status, videoProbed: result.videoProbed, length: result.caption?.length ?? 0, redRooms: result.caption?.includes("Red Rooms") ?? false } });
    } catch (e) { return Response.json({ error: e instanceof Error ? e.name : "error" }); }
  } } },
});
