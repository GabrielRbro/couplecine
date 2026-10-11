// Bounded public-caption lookup for Instagram/TikTok posts. Never fetches the user's URL as given:
// only URLs rebuilt from parsed identifiers on allowlisted HTTPS hosts, manual redirects with
// per-hop validation, timeout and byte cap. Returns plain text only (no platform HTML rendered).
const HOSTS = new Set(["www.instagram.com", "instagram.com", "www.tiktok.com", "m.tiktok.com", "vt.tiktok.com", "vm.tiktok.com"]);
const MAX_BYTES = 600_000;
const TIMEOUT = 6000;
const UA = "Mozilla/5.0 (compatible; AppCinemaImport/1.0)";

import { parseSocial, type SocialRef } from "./social-url";
export { parseSocial, type SocialRef };

function allowed(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && HOSTS.has(u.hostname.toLowerCase());
  } catch { return false; }
}

async function boundedFetch(url: string, readBody = true) {
  if (!allowed(url)) throw new Error("blocked_host");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    // The hosted edge runtime rejects redirect: "error". Manual prevents an unchecked hop;
    // only expandShort explicitly follows a Location after validating the next host.
    const res = await fetch(url, { redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "text/html,application/json" } });
    if (!readBody || !res.ok) return { res, body: "" };
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
    const { res } = await boundedFetch(url, false);
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

async function tiktokPageCaption(ref: Extract<SocialRef, { platform: "tiktok" }>) {
  const { res, body } = await boundedFetch(ref.canonical).catch(() => ({ res: null, body: "" }));
  if (!res?.ok) return null;
  // TikTok's public video page can expose the post description even when oEmbed is rate-limited.
  const raw = body.match(/<script[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const item = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
    if (String(item?.id) !== ref.id || typeof item?.desc !== "string") return null;
    const caption = item.desc.trim().slice(0, 2000);
    if (!caption) return null;
    return { caption, author: typeof item.author?.uniqueId === "string" ? item.author.uniqueId : null };
  } catch { return null; }
}

export async function fetchCaption(ref: SocialRef): Promise<CaptionResult> {
  if (ref.platform === "tiktok-short") {
    const full = await expandShort(ref.canonical).catch(() => null);
    if (!full) return { platform: "tiktok", canonical: ref.canonical, author: null, caption: null, status: "unavailable", message: "Não foi possível abrir o link curto do TikTok. Envie uma captura ou cole a legenda." };
    return fetchCaption(full);
  }
  if (ref.platform === "tiktok") {
    // Official oEmbed (developers.tiktok.com/docs/en/embed-videos): `title` carries the post caption.
    const { res, body } = await boundedFetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(ref.canonical)}`).catch(() => ({ res: null, body: "" }));
    if (res?.ok) {
      try {
        const j = JSON.parse(body) as { title?: string; author_name?: string };
        const caption = typeof j.title === "string" ? j.title.trim().slice(0, 2000) : "";
        if (caption) return { platform: "tiktok", canonical: ref.canonical, author: j.author_name ?? null, caption, status: "ok", message: null };
      } catch { /* Try the public post page below. */ }
    }
    const page = await tiktokPageCaption(ref);
    if (page) return { platform: "tiktok", canonical: ref.canonical, ...page, status: "ok", message: null };
    return { platform: "tiktok", canonical: ref.canonical, author: null, caption: null, status: res?.status === 429 ? "blocked" : "unavailable", message: ref.kind === "photo" ? "O TikTok não forneceu dados deste post de fotos. Envie capturas das imagens." : "O TikTok não forneceu a legenda deste post. Envie uma captura ou cole a legenda." };
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
