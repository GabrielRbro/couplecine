import { tmdbImage } from "./format";

/** Decode only the small animation batch; failures remain scenic cards. */
export async function readyPoster(path: string | null): Promise<boolean> {
  const src = tmdbImage(path);
  if (!src) return false;
  const img = new Image();
  img.src = src;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      img.decode().then(() => true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 5000); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}