import { createFileRoute } from "@tanstack/react-router";

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
          return { name: v.name, status: res.status, length: body.length, tracks: item?.video?.subtitleInfos?.length ?? null, description: item?.desc?.length ?? null };
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
      return Response.json({ page: page.status, htmlLength: html.length, description: data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct?.desc?.length ?? null, tracks, variants });
    } catch (e) { return Response.json({ error: e instanceof Error ? e.name : "error" }); }
  } } },
});
