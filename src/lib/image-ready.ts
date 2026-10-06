import { tmdbImage } from "./format";

/** Decode only the small animation batch; failures remain scenic cards. */
export async function readyPoster(path: string | null): Promise<boolean> {
  const src = tmdbImage(path);
  if (!src) return false;
  const img = new Image();
  img.src = src;
  try { await img.decode(); return true; } catch { return false; }
}