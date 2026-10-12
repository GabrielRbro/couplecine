import { createFileRoute } from "@tanstack/react-router";

// Temporary, fixed-post network diagnostic. Remove after checking the hosted worker.
export const Route = createFileRoute("/api/public/tiktok-caption-check")({
  server: { handlers: { GET: async () => {
    const headers = { "User-Agent": "Mozilla/5.0 (compatible; AppCinemaImport/1.0)", Accept: "text/html,application/json" };
    const url = "https://www.tiktok.com/@miromalacrida/video/7478703127655484727";
    try {
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
      return Response.json({ page: page.status, htmlLength: html.length, description: data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct?.desc?.length ?? null, tracks });
    } catch (e) { return Response.json({ error: e instanceof Error ? e.name : "error" }); }
  } } },
});
