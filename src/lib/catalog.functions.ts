import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AuthedClient = SupabaseClient<Database>;
import {
  discoverFeed,
  fetchDetails,
  fetchSeason,
  searchMulti,
  type TmdbDetails,
} from "./tmdb.server";

function friendly(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "TMDB_NOT_CONFIGURED")
    throw new Error("O catálogo de filmes ainda não está configurado.");
  if (message === "TMDB_REQUEST_FAILED")
    throw new Error("O catálogo de filmes não respondeu. Tente de novo.");
  throw error instanceof Error ? error : new Error(message);
}

export const searchCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ query: z.string().min(1).max(120), spaceId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const results = await searchMulti(data.query);
      const { data: existing } = await context.supabase
        .from("works")
        .select("id, media_type, tmdb_id")
        .eq("space_id", data.spaceId);
      const map = new Map((existing ?? []).map((w) => [`${w.media_type}:${w.tmdb_id}`, w.id]));
      return results.map((r) => ({
        ...r,
        existingWorkId: map.get(`${r.mediaType}:${r.tmdbId}`) ?? null,
      }));
    } catch (e) {
      friendly(e);
    }
  });

// Finds the space's single work for (media_type, tmdb_id) or creates it from TMDB.
async function ensureWork(
  supabase: AuthedClient,
  userId: string,
  data: { spaceId: string; mediaType: "movie" | "tv"; tmdbId: number },
): Promise<string> {
    const { data: found } = await supabase
      .from("works")
      .select("id")
      .eq("space_id", data.spaceId)
      .eq("media_type", data.mediaType)
      .eq("tmdb_id", data.tmdbId)
      .maybeSingle();
    let workId = found?.id ?? null;
    if (!workId) {
      let d: TmdbDetails;
      try {
        d = await fetchDetails(data.mediaType, data.tmdbId);
      } catch (e) {
        friendly(e);
      }
      const { data: inserted, error } = await supabase
        .from("works")
        .insert({
          space_id: data.spaceId,
          media_type: data.mediaType,
          tmdb_id: data.tmdbId,
          title: d.title,
          original_title: d.originalTitle,
          overview: d.overview,
          poster_path: d.posterPath,
          backdrop_path: d.backdropPath,
          release_year: d.year,
          runtime_minutes: d.runtimeMinutes,
          genres: d.genres,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) throw new Error("Não foi possível salvar a obra.");
      workId = inserted.id;
      await supabase.from("work_metadata_cache").upsert(
        {
          work_id: workId,
          payload: d as never,
          expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        },
        { onConflict: "work_id" },
      );
    }
  return workId;
}

export const addWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        spaceId: z.string().uuid(),
        mediaType: z.enum(["movie", "tv"]),
        tmdbId: z.number().int().positive(),
        reaction: z.enum(["fire", "like", "neutral"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const workId = await ensureWork(supabase, userId, data);
    const { data: mine } = await supabase
      .from("indications")
      .select("id")
      .eq("work_id", workId)
      .eq("indicated_by", userId)
      .maybeSingle();
    // One active indication per person: re-indicating renews it (keeps original author/date) and bumps activity via trigger.
    if (mine)
      await supabase
        .from("indications")
        .update({ renewed_at: new Date().toISOString() })
        .eq("id", mine.id);
    else
      await supabase
        .from("indications")
        .insert({ space_id: data.spaceId, work_id: workId, indicated_by: userId });
    const { error: ie } = await supabase
      .from("interests")
      .upsert(
        { work_id: workId, user_id: userId, reaction: data.reaction },
        { onConflict: "user_id,work_id" },
      );
    if (ie) throw new Error("Não foi possível salvar sua reação.");
    return { workId };
  });

export const getWorkDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: work } = await supabase
      .from("works")
      .select("media_type, tmdb_id")
      .eq("id", data.workId)
      .maybeSingle();
    if (!work) throw new Error("Obra não encontrada.");
    const { data: cache } = await supabase
      .from("work_metadata_cache")
      .select("payload, expires_at")
      .eq("work_id", data.workId)
      .maybeSingle();
    const cached = cache?.payload as TmdbDetails | undefined;
    if (cached && cached.cast && new Date(cache!.expires_at) > new Date()) return cached;
    try {
      const d = await fetchDetails(work.media_type, work.tmdb_id);
      await supabase.from("work_metadata_cache").upsert(
        {
          work_id: data.workId,
          payload: d as never,
          expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        },
        { onConflict: "work_id" },
      );
      return d;
    } catch (e) {
      if (cached) return cached;
      friendly(e);
    }
  });

export const getSeasonEpisodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ workId: z.string().uuid(), season: z.number().int().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: work } = await context.supabase
      .from("works")
      .select("tmdb_id, media_type")
      .eq("id", data.workId)
      .maybeSingle();
    if (!work || work.media_type !== "tv") throw new Error("Série não encontrada.");
    try {
      return await fetchSeason(work.tmdb_id, data.season);
    } catch (e) {
      friendly(e);
    }
  });

export const getDiscover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ spaceId: z.string().uuid(), page: z.number().int().min(1).max(20) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [{ data: works }, { data: dismissed }, { data: prior }] = await Promise.all([
      supabase
        .from("works")
        .select("id, media_type, tmdb_id, activity_at, indications(indicated_by), interests(user_id, reaction)")
        .eq("space_id", data.spaceId)
        .order("activity_at", { ascending: false }),
      supabase.from("discover_dismissals").select("media_type, tmdb_id").eq("user_id", userId),
      supabase.from("prior_watch_status").select("work_id").eq("user_id", userId).eq("watched", true),
    ]);
    const all = works ?? [];
    const key = (t: string, id: number) => `${t}:${id}`;
    const seenIds = new Set((prior ?? []).map((p) => p.work_id));
    const hidden = new Set((dismissed ?? []).map((d) => key(d.media_type, d.tmdb_id)));
    for (const w of all)
      if (w.indications.some((i) => i.indicated_by === userId) || seenIds.has(w.id))
        hidden.add(key(w.media_type, w.tmdb_id));
    // Seeds: a few recent works the couple cares about (strong reactions or indicated).
    const strong = (w: (typeof all)[number]) =>
      w.interests.some((i) => i.reaction === "fire" || i.reaction === "like");
    const seeds = [...all.filter(strong), ...all.filter((w) => !strong(w) && w.indications.length)]
      .slice(0, 4)
      .map((w) => ({ mediaType: w.media_type, tmdbId: w.tmdb_id }));
    try {
      const items = await discoverFeed(seeds, data.page);
      const existing = new Map(all.map((w) => [key(w.media_type, w.tmdb_id), w.id]));
      return {
        items: items
          .filter((i) => !hidden.has(key(i.mediaType, i.tmdbId)))
          .map((i) => ({ ...i, existingWorkId: existing.get(key(i.mediaType, i.tmdbId)) ?? null })),
        hasMore: items.length > 0 && data.page < 20,
      };
    } catch (e) {
      friendly(e);
    }
  });

export const markSeenBefore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        spaceId: z.string().uuid(),
        mediaType: z.enum(["movie", "tv"]),
        tmdbId: z.number().int().positive(),
        score: z.number().min(0).max(10).multipleOf(0.5).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Ensures the shared work exists without creating an indication.
    const workId = await ensureWork(supabase, userId, data);
    const { error } = await supabase
      .from("prior_watch_status")
      .upsert({ work_id: workId, user_id: userId, watched: true }, { onConflict: "user_id,work_id" });
    if (error) throw new Error("Não foi possível salvar.");
    if (data.score !== null) {
      const { error: re } = await supabase
        .from("ratings")
        .upsert({ work_id: workId, user_id: userId, score: data.score }, { onConflict: "user_id,work_id" });
      if (re) throw new Error("Não foi possível salvar a nota.");
    }
    return { workId };
  });
