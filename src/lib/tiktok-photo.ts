import type { SocialRef } from "./social-url";

type PhotoImage = { mimeType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

function photoUrl(raw: string) {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      /^p\d+-common-sign\.tiktokcdn(?:-us|-eu)?\.com$/.test(u.hostname) &&
      /^\/tos-[\w-]+\/[^/]+~tplv-photomode-image\.(?:jpe?g|png|webp)$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

async function bytesWithin(res: Response, limit: number) {
  if (!res.ok || Number(res.headers.get("content-length")) > limit || !res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function readPhoto(url: string): Promise<PhotoImage | null> {
  if (!photoUrl(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { credentials: "omit", redirect: "error", signal: ctrl.signal });
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim();
    if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp")
      return null;
    const bytes = await bytesWithin(res, 2_000_000);
    if (!bytes) return null;
    const valid =
      mimeType === "image/jpeg"
        ? bytes[0] === 0xff && bytes[1] === 0xd8
        : mimeType === "image/png"
          ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
          : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    if (!valid) return null;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { mimeType, base64: btoa(binary) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Browser-side capture: the hosted worker receives an empty response for this public photo
 * post, while TikWM and TikTok CDN both allow cross-origin reads from the user's browser. */
export async function captureTikTokPhotos(
  ref: SocialRef,
): Promise<{ caption: string | null; images: PhotoImage[] } | null> {
  if (ref.platform !== "tiktok-short" && (ref.platform !== "tiktok" || ref.kind !== "photo"))
    return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let data: { id?: unknown; title?: unknown; images?: unknown; author?: { unique_id?: unknown } };
  try {
    const res = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(ref.canonical)}`, {
      credentials: "omit",
      redirect: "error",
      signal: ctrl.signal,
    });
    const bytes = await bytesWithin(res, 100_000);
    if (!bytes) return null;
    const json = JSON.parse(new TextDecoder().decode(bytes)) as {
      code?: unknown;
      data?: typeof data;
    };
    if (json.code !== 0 || !Array.isArray(json.data?.images)) return null;
    if (ref.platform === "tiktok" && String(json.data.id) !== ref.id) return null;
    if (
      ref.platform === "tiktok-short" &&
      (!/^\d{8,25}$/.test(String(json.data.id)) ||
        !/^[\w.-]{1,40}$/.test(String(json.data.author?.unique_id)))
    )
      return null;
    data = json.data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const urls = data.images as unknown[];
  if (
    !urls.length ||
    urls.length > 10 ||
    urls.some((url) => typeof url !== "string" || !photoUrl(url))
  )
    return null;
  const images: PhotoImage[] = [];
  let total = 0;
  for (let i = 0; i < urls.length; i += 3) {
    const batch = await Promise.all((urls as string[]).slice(i, i + 3).map(readPhoto));
    if (batch.some((image) => !image)) return null;
    for (const image of batch as PhotoImage[]) {
      total += image.base64.length;
      if (total > 9_000_000) return null;
      images.push(image);
    }
  }
  return {
    caption: typeof data.title === "string" ? data.title.trim().slice(0, 2000) || null : null,
    images,
  };
}
