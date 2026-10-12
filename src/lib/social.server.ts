// Bounded public-caption lookup for Instagram/TikTok posts. Never fetches the user's URL as given:
// only URLs rebuilt from parsed identifiers on allowlisted HTTPS hosts, manual redirects with
// per-hop validation, timeout and byte cap. Returns plain text only (no platform HTML rendered).
const HOSTS = new Set(["www.instagram.com", "instagram.com", "www.tiktok.com", "m.tiktok.com", "vt.tiktok.com", "vm.tiktok.com"]);
const MAX_BYTES = 600_000;
const TIMEOUT = 6000;
const UA = "Mozilla/5.0 (compatible; AppCinemaImport/1.0)";

import { parseSocial, type SocialRef } from "./social-url";
import { explicitTitle } from "./explicit-title";
export { parseSocial, type SocialRef };

function allowed(url: string, subtitle = false) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && !u.username && !u.password && !u.port &&
      (subtitle ? /^v\d+-webapp(?:-[a-z0-9-]+)?\.(?:tiktok\.com|tiktokcdn-eu\.com)$/.test(host) : HOSTS.has(host));
  } catch { return false; }
}

async function boundedFetch(url: string, readBody = true, subtitle = false) {
  if (!allowed(url, subtitle)) throw new Error("blocked_host");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    // The hosted edge runtime rejects redirect: "error". Manual prevents an unchecked hop;
    // only expandShort explicitly follows a Location after validating the next host.
    // TikTok omits native subtitleInfos from its default hosted-worker page variant.
    // A language preference yields the caption tracks for the same public post.
    const res = await fetch(url, { redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "text/html,application/json", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" } });
    if (!readBody || !res.ok) return { res, body: "" };
    const reader = res.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > (subtitle ? 60_000 : MAX_BYTES)) { await reader.cancel(); throw new Error("body_too_large"); }
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

export type CaptionResult = { platform: "instagram" | "tiktok"; canonical: string; author: string | null; caption: string | null; status: "ok" | "blocked" | "unavailable" | "photo_unavailable"; message: string | null; imgIndex?: number | null; videoProbed?: boolean };

export const VIDEO_PROBE_STATUS = "ok_video_probe_v1";

export function needsCaptionFetch(p: { source_url: string; caption: string | null; caption_status: string | null; caption_fetched_at: string | null }, now = Date.now()) {
  if (p.caption) {
    const ref = parseSocial(p.source_url);
    if (!ref || ref.platform === "instagram" || explicitTitle(p.caption)) return false;
    if (p.caption_status === VIDEO_PROBE_STATUS && p.caption.includes("Legendas automáticas do vídeo:\n")) return false;
    return !p.caption_fetched_at || now - new Date(p.caption_fetched_at).getTime() >= 2 * 60_000;
  }
  return !p.caption_fetched_at || now - new Date(p.caption_fetched_at).getTime() >= 2 * 60_000;
}

function vttSpeech(vtt: string) {
  if (!/^\uFEFF?WEBVTT(?:[ \t]|\r?\n|$)/.test(vtt)) return null;
  const cues = vtt.replace(/^\uFEFF/, "").split(/\r?\n\s*\r?\n/).slice(1);
  const lines: string[] = [];
  for (const cue of cues) {
    const rows = cue.split(/\r?\n/);
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(rows[0]?.trim() ?? "")) continue;
    const timing = rows.findIndex((row) => /^\s*(?:\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->/.test(row));
    if (timing < 0) continue;
    const words = rows.slice(timing + 1).map((row) => decode(row.replace(/<[^>]*>/g, "")).trim()).filter(Boolean).join(" ");
    if (words && words !== lines.at(-1)) lines.push(words);
  }
  const speech = lines.join(" ").slice(0, 2500);
  return speech || null;
}

async function tiktokSpeech(video: { subtitleInfos?: unknown }) {
  type Track = { Format?: unknown; Url?: unknown; Size?: unknown; LanguageCodeName?: unknown };
  const tracks = Array.isArray(video.subtitleInfos) ? video.subtitleInfos as Track[] : [];
  const ranked = tracks.filter((t) => t.Format === "webvtt" && typeof t.Url === "string" &&
    allowed(t.Url, true) && (t.Size == null || (Number(t.Size) > 0 && Number(t.Size) <= 60_000)))
    .sort((a, b) => {
      const rank = (t: Track) => /^por-BR$/i.test(String(t.LanguageCodeName)) ? 0 : /^por-/i.test(String(t.LanguageCodeName)) ? 1 : /^eng-/i.test(String(t.LanguageCodeName)) ? 2 : 3;
      return rank(a) - rank(b);
    });
  for (const track of ranked.slice(0, 2)) {
    const { res, body } = await boundedFetch(String(track.Url), true, true).catch(() => ({ res: null, body: "" }));
    const speech = res?.ok ? vttSpeech(body) : null;
    if (speech) return speech;
  }
  return null;
}

async function tiktokPageCaption(ref: Extract<SocialRef, { platform: "tiktok" }>) {
  const { res, body } = await boundedFetch(ref.canonical).catch(() => ({ res: null, body: "" }));
  if (!res?.ok) return null;
  // TikTok's public video page can expose the post description even when oEmbed is rate-limited.
  const raw = body.match(/<script[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const item = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
    if (String(item?.id) !== ref.id) return null;
    const caption = typeof item.desc === "string" ? item.desc.trim().slice(0, 2000) : "";
    const speech = ref.kind === "video" && !explicitTitle(caption) ? await tiktokSpeech(item.video ?? {}) : null;
    if (!caption && !speech) return null;
    return { caption, speech, author: typeof item.author?.uniqueId === "string" ? item.author.uniqueId : null };
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
    let embedCaption = "";
    let embedAuthor: string | null = null;
    if (res?.ok) {
      try {
        const j = JSON.parse(body) as { title?: string; author_name?: string };
        embedCaption = typeof j.title === "string" ? j.title.trim().slice(0, 2000) : "";
        embedAuthor = j.author_name ?? null;
        // A clear title needs no video analysis; ambiguous/missing descriptions get native speech.
        if (embedCaption && explicitTitle(embedCaption)) return { platform: "tiktok", canonical: ref.canonical, author: embedAuthor, caption: embedCaption, status: "ok", message: null };
      } catch { /* Try the public post page below. */ }
    }
    const page = await tiktokPageCaption(ref);
    const caption = embedCaption || page?.caption || "";
    const evidence = [caption, ...(page?.speech ? [`Legendas automáticas do vídeo:\n${page.speech}`] : [])].filter(Boolean).join("\n\n").slice(0, 4000);
    if (evidence) return { platform: "tiktok", canonical: ref.canonical, author: embedAuthor ?? page?.author ?? null, caption: evidence, status: "ok", message: null, videoProbed: !!page?.speech };
    return { platform: "tiktok", canonical: ref.canonical, author: null, caption: null, status: ref.kind === "photo" ? "photo_unavailable" : res?.status === 429 ? "blocked" : "unavailable", message: ref.kind === "photo" ? "O TikTok não forneceu as imagens deste carrossel. Selecione as páginas com filmes de uma vez." : "O TikTok não forneceu a legenda deste post. Envie uma captura ou cole a legenda." };
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
