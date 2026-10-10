// Pure, client-safe social URL parsing/canonicalisation (no network).
export type SocialRef =
  | { platform: "instagram"; id: string; kind: "reel" | "post"; canonical: string; imgIndex: number | null }
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
    // Reels stay /reel/, posts stay /p/; tracking (?igsh, ?dlrf, utm…) dropped; carousel index kept for /p/.
    const reel = /^\/(?:[\w.]{1,30}\/)?reels?\//.test(u.pathname);
    const imgIndex = !reel && Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
    return { platform: "instagram", id: m[1]!, kind: reel ? "reel" : "post", canonical: `https://www.instagram.com/${reel ? "reel" : "p"}/${m[1]}/`, imgIndex };
  }
  if ((host === "tiktok.com" || host === "www.tiktok.com" || host === "m.tiktok.com") && (m = u.pathname.match(/^\/@([\w.-]{1,40})\/(video|photo)\/(\d{8,25})\/?$/)))
    return { platform: "tiktok", id: m[3]!, kind: m[2] as "video" | "photo", canonical: `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}` };
  if ((host === "vt.tiktok.com" || host === "vm.tiktok.com") && (m = u.pathname.match(/^\/([A-Za-z0-9]{5,15})\/?$/)))
    return { platform: "tiktok-short", code: m[1]!, canonical: `https://${host}/${m[1]}/` };
  return null;
}

/** Stored identity of a source: canonical URL plus ?img_index for carousels (capture reference only). */
export function sourceUrl(ref: SocialRef) {
  return ref.platform === "instagram" && ref.imgIndex ? `${ref.canonical}?img_index=${ref.imgIndex}` : ref.canonical;
}

export function extractSocial(text: string, max = 12) {
  const refs = [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => parseSocial(m[0])).filter((r): r is SocialRef => !!r);
  return [...new Map(refs.map((r) => [sourceUrl(r), r])).values()].slice(0, max);
}
