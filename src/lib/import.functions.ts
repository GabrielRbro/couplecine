import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findImdb, lookupTmdb, type TmdbSearchItem } from "./tmdb.server";

const SOCIAL = /(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|fb\.watch|threads\.net|kwai\.com|pinterest\.com|reddit\.com)$/i;

/**
 * Deterministic import resolution, no AI and no fetch of user-supplied URLs (no SSRF surface):
 * TMDB links/ids and IMDb ids are resolved through TMDB only. Social links are reported as
 * unidentifiable so the user can send a screenshot or caption instead.
 */
export const resolveImportText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ spaceId: z.string().uuid(), text: z.string().max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const text = data.text;
    const tmdb = [...text.matchAll(/themoviedb\.org\/(movie|tv)\/(\d{1,9})/gi)].map((m) => ({ mediaType: m[1]!.toLowerCase() as "movie" | "tv", id: Number(m[2]) }));
    const imdb = [...new Set([...text.matchAll(/\b(tt\d{7,9})\b/gi)].map((m) => m[1]!.toLowerCase()))];
    const urls = [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => m[0]);
    const social = [...new Set(urls.flatMap((u) => { try { const h = new URL(u).hostname.replace(/^www\./, ""); return SOCIAL.test(h) ? [h] : []; } catch { return []; } }))];
    const found: TmdbSearchItem[] = [];
    for (const t of tmdb.slice(0, 12)) { const item = await lookupTmdb(t.mediaType, t.id); if (item) found.push(item); }
    for (const id of imdb.slice(0, 12)) found.push(...(await findImdb(id)).slice(0, 1));
    const { data: existing } = await context.supabase.from("works").select("id, media_type, tmdb_id").eq("space_id", data.spaceId);
    const map = new Map((existing ?? []).map((w) => [`${w.media_type}:${w.tmdb_id}`, w.id]));
    const seen = new Set<string>();
    const items = found.flatMap((f) => {
      const k = `${f.mediaType}:${f.tmdbId}`;
      if (seen.has(k)) return [];
      seen.add(k);
      return [{ ...f, existingWorkId: map.get(k) ?? null }];
    });
    // Free text left after removing URLs/ids decides whether an AI analysis could help.
    const rest = text.replace(/https?:\/\/[^\s]+/gi, " ").replace(/\btt\d{7,9}\b/gi, " ").replace(/\s+/g, " ").trim();
    return { items, social, hasText: rest.length >= 3 };
  });
