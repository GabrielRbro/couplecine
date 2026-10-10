// Bounded public-caption lookup for Instagram/TikTok posts. Never fetches the user's URL as given:
// only URLs rebuilt from parsed identifiers on allowlisted HTTPS hosts, manual redirects with
// per-hop validation, timeout and byte cap. Returns plain text only (no platform HTML rendered).
const HOSTS = new Set(["www.instagram.com", "instagram.com", "www.tiktok.com", "m.tiktok.com", "vt.tiktok.com", "vm.tiktok.com"]);
const MAX_BYTES = 600_000;
const TIMEOUT = 6000;
const UA = "Mozilla/5.0 (compatible; AppCinemaImport/1.0)";

export type SocialRef =
  | { platform: "instagram"; id: string; canonical: string; imgIndex: number | null }
  | { platform: "tiktok"; id: string; canonical: string; kind: "video" | "photo" }
  | { platform: "tiktok-short"; code: string; canonical: string };

export function parseSocial(raw: string): SocialRef | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((host === "instagram.com" || host === "www.instagram.com") && (m = u.pathname.match(/^\/(?:[\w.]{1,30}\/)?(?:reel|reels|p)\/([A-Za-z0-9_-]{5,40})\/?$/)))
  {
    // Carousel position the user shared (?img_index=N): kept only as a capture reference, never fetched.
    const n = Number(u.searchParams.get("img_index"));
    return { platform: "instagram", id: m[1]!, canonical: `https://www.instagram.com/p/${m[1]}/`, imgIndex: Number.isInteger(n) && n >= 1 && n <= 20 ? n : null };
  }
  if ((host === "tiktok.com" || host === "www.tiktok.com" || host === "m.tiktok.com") && (m = u.pathname.match(/^\/@([\w.-]{1,40})\/(video|photo)\/(\d{8,25})\/?$/)))
    return { platform: "tiktok", id: m[3]!, kind: m[2] as "video" | "photo", canonical: `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}` };
  if ((host === "vt.tiktok.com" || host === "vm.tiktok.com") && (m = u.pathname.match(/^\/([A-Za-z0-9]{5,15})\/?$/)))
    return { platform: "tiktok-short", code: m[1]!, canonical: `https://${host}/${m[1]}/` };
  return null;
}

function allowed(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && HOSTS.has(u.hostname.toLowerCase());
  } catch { return false; }
}

async function boundedFetch(url: string, redirect: "manual" | "error" = "error") {
  if (!allowed(url)) throw new Error("blocked_host");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect, signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "text/html,application/json" } });
    if (redirect === "manual") return { res, body: "" };
    const reader = res.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
    return { res, body: new TextDecoder().decode(buf) };
  } finally { clearTimeout(t); }
}

/** Expand vt/vm shortlinks hop by hop (max 3), validating each Location before following. */
async function expandShort(start: string): Promise<SocialRef | null> {
  let url = start;
  for (let hop = 0; hop < 3; hop++) {
    const { res } = await boundedFetch(url, "manual");
    const loc = res.headers.get("location");
    if (!loc || res.status < 300 || res.status >= 400) return null;
    const next = new URL(loc, url).toString();
    const parsed = parseSocial(next.split("?")[0]!);
    if (parsed?.platform === "tiktok") return parsed;
    if (!allowed(next)) return null;
    url = next;
  }
  return null;
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

export type CaptionResult = { platform: "instagram" | "tiktok"; canonical: string; author: string | null; caption: string | null; status: "ok" | "blocked" | "unavailable"; message: string | null; imgIndex?: number | null };

export async function fetchCaption(ref: SocialRef): Promise<CaptionResult> {
  if (ref.platform === "tiktok-short") {
    const full = await expandShort(ref.canonical).catch(() => null);
    if (!full) return { platform: "tiktok", canonical: ref.canonical, author: null, caption: null, status: "unavailable", message: "Não foi possível abrir o link curto do TikTok. Envie uma captura ou cole a legenda." };
    return fetchCaption(full);
  }
  if (ref.platform === "tiktok") {
    // Official oEmbed (developers.tiktok.com/docs/en/embed-videos): `title` carries the post caption.
    const { res, body } = await boundedFetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(ref.canonical)}`).catch(() => ({ res: null, body: "" }));
    if (!res?.ok) return { platform: "tiktok", canonical: ref.canonical, author: null, caption: null, status: res?.status === 429 ? "blocked" : "unavailable", message: ref.kind === "photo" ? "O TikTok não forneceu dados deste post de fotos. Envie capturas das imagens." : "O TikTok não forneceu a legenda deste post. Envie uma captura ou cole a legenda." };
    try {
      const j = JSON.parse(body) as { title?: string; author_name?: string };
      const caption = (j.title ?? "").trim().slice(0, 2000) || null;
      return { platform: "tiktok", canonical: ref.canonical, author: j.author_name ?? null, caption, status: "ok", message: caption ? null : "Post sem legenda. Envie uma captura." };
    } catch { return { platform: "tiktok", canonical: ref.canonical, author: null, caption: null, status: "unavailable", message: "Resposta inesperada do TikTok. Envie uma captura." }; }
  }
  return { ...(await instagram(ref)), imgIndex: ref.imgIndex };
}

async function instagram(ref: Extract<SocialRef, { platform: "instagram" }>): Promise<CaptionResult> {
  const { res, body } = await boundedFetch(ref.canonical).catch(() => ({ res: null, body: "" }));
  if (!res || res.status === 429 || !res.ok || /accounts\/login/.test(res.url))
    return { platform: "instagram", canonical: ref.canonical, author: null, caption: null, status: "blocked", message: "O Instagram bloqueou a leitura pública (limite ou login). Envie uma captura de tela ou cole a legenda." };
  const meta = body.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1] ?? body.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1];
  const title = body.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1];
  if (!meta) return { platform: "instagram", canonical: ref.canonical, author: null, caption: null, status: "unavailable", message: "O Instagram não expôs a legenda deste post. Envie uma captura de tela ou cole a legenda." };
  const text = decode(meta);
  // Typical: '12 likes, 3 comments - user on May 1, 2025: "caption"'. Keep the quoted caption when present.
  const quoted = text.match(/:\s*"([\s\S]*)"\.?\s*$/)?.[1];
  const author = text.match(/-\s*([\w.]{1,30})\s+(?:on|em)\s/)?.[1] ?? (title ? decode(title).split(/ on Instagram| no Instagram/)[0]?.trim() ?? null : null);
  const caption = (quoted ?? text).trim().slice(0, 2000) || null;
  return { platform: "instagram", canonical: ref.canonical, author, caption, status: "ok", message: null };
}
