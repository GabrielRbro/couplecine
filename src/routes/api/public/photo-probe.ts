import { createFileRoute } from "@tanstack/react-router";

// Temporary, fixed-public-post probe for diagnosing the hosted worker's outbound fetch.
const urls = [
  "https://vt.tiktok.com/ZSbwkJy77/",
  "https://www.tiktok.com/@vtindica_/photo/7686999788637736213",
];

async function inspectPost(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`, {
      redirect: "manual", signal: ctrl.signal, headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });
    const body = await res.text();
    const result: Record<string, unknown> = { status: res.status, length: body.length, type: res.headers.get("content-type") };
    if (!res.ok || body.length > 100_000) return result;
    const data = JSON.parse(body) as { code?: unknown; data?: { id?: unknown; images?: unknown[] } };
    result["code"] = data.code;
    result["id"] = data.data?.id;
    result["images"] = data.data?.images?.length;
    const first = data.data?.images?.[0];
    if (typeof first !== "string") return result;
    const media = new URL(first);
    if (!/^p\d+-common-sign\.tiktokcdn(?:-us|-eu)?\.com$/.test(media.hostname)) return result;
    const image = await fetch(first, { redirect: "manual", signal: ctrl.signal, headers: { Accept: "image/jpeg,image/png,image/webp", "User-Agent": "Mozilla/5.0" } });
    result["imageStatus"] = image.status;
    result["imageType"] = image.headers.get("content-type");
    result["imageBytes"] = image.ok ? (await image.arrayBuffer()).byteLength : null;
    return result;
  } catch (error) { return { error: error instanceof Error ? error.name : "unknown" }; }
  finally { clearTimeout(timer); }
}

export const Route = createFileRoute("/api/public/photo-probe")({
  server: { handlers: { GET: async () => Response.json(await Promise.all(urls.map(inspectPost))) } },
});
