import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AuthedClient = SupabaseClient<Database>;
import {
  discoverFeed,
  fetchDetails,
  fetchLogo,
  fetchSeason,
  searchMulti,
  DETAILS_CACHE_VERSION,
  type TmdbDetails,
  type TmdbEpisode,
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
  const findExisting = async () => {
    const { data: found, error } = await supabase
      .from("works")
      .select("id")
      .eq("space_id", data.spaceId)
      .eq("media_type", data.mediaType)
      .eq("tmdb_id", data.tmdbId)
      .maybeSingle();
    if (error) throw new Error("Não foi possível consultar a biblioteca.");
    return found?.id ?? null;
  };
  const existing = await findExisting();
  if (existing) return existing;
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
  if (error) {
    // Both people adding the same work at once: the unique constraint wins, reuse that row.
    if (error.code === "23505") {
      const raced = await findExisting();
      if (raced) return raced;
    }
    console.error("ensureWork insert failed", error.code, error.message);
    throw new Error("Não foi possível salvar a obra.");
  }
  const { error: ce } = await supabase.from("work_metadata_cache").upsert(
    {
      work_id: inserted.id,
      payload: d as never,
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    },
    { onConflict: "work_id" },
  );
  if (ce) console.warn("work_metadata_cache upsert failed", ce.message);
  return inserted.id;
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
    const { data: mine, error: me } = await supabase
      .from("indications")
      .select("id")
      .eq("work_id", workId)
      .eq("indicated_by", userId)
      .maybeSingle();
    if (me) throw new Error("Não foi possível salvar a indicação.");
    // One active indication per person: re-indicating renews it (keeps original author/date) and bumps activity via trigger.
    const { error: we } = mine
      ? await supabase
          .from("indications")
          .update({ renewed_at: new Date().toISOString() })
          .eq("id", mine.id)
      : await supabase
          .from("indications")
          .insert({ space_id: data.spaceId, work_id: workId, indicated_by: userId });
    if (we) throw new Error("Não foi possível salvar a indicação.");
    const { error: ie } = await supabase
      .from("interests")
      .upsert(
        { work_id: workId, user_id: userId, reaction: data.reaction },
        { onConflict: "user_id,work_id" },
      );
    if (ie) throw new Error("A indicação foi salva, mas sua reação não. Tente de novo.");
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
    // Old strategy versions or suspiciously thin cast (e.g. a single actor) are refetched.
    const valid =
      cached &&
      cached.v === DETAILS_CACHE_VERSION &&
      Array.isArray(cached.cast) &&
      cached.cast.length >= 3 &&
      new Date(cache!.expires_at) > new Date();
    if (valid) return cached;
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
      if (cached) {
        console.warn("TMDB details failed; serving cached metadata for", data.workId);
        return cached;
      }
      friendly(e);
    }
  });

export const getSeasonEpisodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ workId: z.string().uuid().optional(), tmdbId: z.number().int().positive().optional(), season: z.number().int().min(1) }).refine((v) => v.workId || v.tmdbId).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!data.workId && data.tmdbId) {
      try { return await fetchSeason(data.tmdbId, data.season); } catch (e) { friendly(e); }
    }
    if (!data.workId) throw new Error("Série indisponível.");
    const { data: work } = await context.supabase
      .from("works")
      .select("tmdb_id, media_type")
      .eq("id", data.workId)
      .maybeSingle();
    if (!work || work.media_type !== "tv") throw new Error("Série não encontrada.");
    // season_cache keeps episode lists for 3 days so switching seasons skips TMDB.
    const { data: hit } = await context.supabase
      .from("season_cache")
      .select("payload, updated_at")
      .eq("work_id", data.workId)
      .eq("season_number", data.season)
      .maybeSingle();
    const fresh = hit && Date.now() - new Date(hit.updated_at).getTime() < 3 * 864e5;
    if (fresh && Array.isArray(hit.payload)) return hit.payload as unknown as TmdbEpisode[];
    try {
      const eps = await fetchSeason(work.tmdb_id, data.season);
      await context.supabase.from("season_cache").upsert(
        {
          work_id: data.workId,
          season_number: data.season,
          name: `Temporada ${data.season}`,
          episode_count: eps.length,
          payload: eps as never,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "work_id,season_number" },
      );
      return eps;
    } catch (e) {
      if (hit && Array.isArray(hit.payload)) {
        console.warn("TMDB season failed; serving cached season", data.workId, data.season);
        return hit.payload as unknown as TmdbEpisode[];
      }
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
        .select(
          "id, title, media_type, tmdb_id, activity_at, genres, indications(indicated_by), interests(user_id, reaction), ratings(user_id, score), joint_watch_sessions(id)",
        )
        .eq("space_id", data.spaceId)
        .order("activity_at", { ascending: false }),
      supabase.from("discover_dismissals").select("media_type, tmdb_id").eq("user_id", userId),
      supabase
        .from("prior_watch_status")
        .select("work_id")
        .eq("user_id", userId)
        .eq("watched", true),
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
      let visible = items.filter((i) => !hidden.has(key(i.mediaType, i.tmdbId)));
      if (data.page === 1) {
        const { data: lastMatch } = await supabase
          .from("match_sessions")
          .select("result_work_ids")
          .eq("space_id", data.spaceId)
          .eq("status", "closed")
          .order("closed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        visible = await rerankWithGemini(visible, all, userId, supabase, lastMatch?.result_work_ids ?? []);
      }
      return {
        items: visible.map((i) => ({
          ...i,
          existingWorkId: existing.get(key(i.mediaType, i.tmdbId)) ?? null,
        })),
        hasMore: items.length > 0 && data.page < 20,
      };
    } catch (e) {
      friendly(e);
    }
  });

/**
 * Optional Gemini selection/rerank of the first Descobrir page. TMDB stays the source of truth:
 * only TMDB candidates can be returned, and any failure keeps the TMDB order.
 */
async function rerankWithGemini<
  T extends { title: string; year: number | null; mediaType: string; genres?: string[] },
>(
  candidates: T[],
  works: {
    id: string;
    title: string;
    genres: string[];
    interests: { user_id: string; reaction: string }[];
    ratings: { user_id: string; score: number }[];
    joint_watch_sessions: { id: string }[];
  }[],
  userId: string,
  supabase: AuthedClient,
  matchIds: string[],
): Promise<T[]> {
  const { geminiConfig, geminiJson } = await import("./gemini.server");
  if (!(await geminiConfig()).configured || candidates.length < 6) return candidates;
  // Compact taste profile from data already loaded in one batch (no N+1).
  const titles = (pred: (w: (typeof works)[number]) => boolean, n: number) =>
    works.filter(pred).slice(0, n).map((w) => w.title);
  const mine = (w: (typeof works)[number]) => w.interests.find((i) => i.user_id === userId)?.reaction;
  const theirs = (w: (typeof works)[number]) => w.interests.find((i) => i.user_id !== userId)?.reaction;
  const myScore = (w: (typeof works)[number]) => w.ratings.find((r) => r.user_id === userId)?.score;
  const genreCount = new Map<string, number>();
  for (const w of works)
    if (mine(w) === "fire" || mine(w) === "like" || Number(myScore(w) ?? 0) >= 8)
      for (const g of w.genres) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
  const profile = {
    eu_amo: titles((w) => mine(w) === "fire", 8),
    eu_curto: titles((w) => mine(w) === "like", 5),
    eu_nao_quero: titles((w) => mine(w) === "dislike", 5),
    minhas_notas_altas: titles((w) => Number(myScore(w) ?? 0) >= 8, 6),
    minhas_notas_baixas: titles((w) => myScore(w) !== undefined && Number(myScore(w)) <= 4, 4),
    generos_favoritos: [...genreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g]) => g),
    os_dois_curtem: titles((w) => ["fire", "like"].includes(mine(w) ?? "") && ["fire", "like"].includes(theirs(w) ?? ""), 6),
    parceiro_ama: titles((w) => theirs(w) === "fire", 5),
    assistidos_juntos: titles((w) => w.joint_watch_sessions.length > 0, 6),
    ultimo_match: titles((w) => matchIds.includes(w.id), 5),
  };
  const pool = candidates.slice(0, 40);
  const list = pool
    .map((c, i) => `${i}|${c.title}|${c.year ?? ""}|${c.mediaType}|${(c.genres ?? []).join("/")}`)
    .join("\n");
  try {
    const res = await geminiJson<{ order?: number[] }>({
      supabase,
      userId,
      feature: "discover",
      system:
        'Você seleciona e ordena recomendações para UMA pessoa, ponderando compatibilidade com o parceiro. Mantenha diversidade: não repita demais gênero, franquia ou elenco; inclua alguma exploração. Use só os índices fornecidos. Responda JSON {"order":[índices]} com até 30 itens.',
      parts: [
        {
          text: `Perfil: ${JSON.stringify(profile)}\nCandidatos (índice|título|ano|tipo|gêneros):\n${list}`,
        },
      ],
      cacheTtlHours: 24,
      cacheSeed: `d2:${JSON.stringify(profile)}:${pool.map((c) => c.title).join(",")}`,
    });
    const order = (res.order ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < pool.length);
    if (order.length < 6) return candidates;
    const used = new Set(order);
    return [...new Set(order)]
      .map((i) => pool[i]!)
      .concat(
        pool.filter((_, i) => !used.has(i)),
        candidates.slice(40),
      );
  } catch (e) {
    console.warn("Discover rerank fell back to TMDB order:", e instanceof Error ? e.message : "error");
    return candidates;
  }
}

export const getDismissedDiscover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ spaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [{ data: dismissed, error }, { data: localWorks }] = await Promise.all([
      supabase
        .from("discover_dismissals")
        .select("media_type, tmdb_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("works")
        .select(
          "id, media_type, tmdb_id, title, original_title, poster_path, backdrop_path, release_year, overview",
        )
        .eq("space_id", data.spaceId),
    ]);
    if (error) throw new Error("Não foi possível carregar os dispensados.");

    const key = (mediaType: string, tmdbId: number) => `${mediaType}:${tmdbId}`;
    const local = new Map(
      (localWorks ?? []).map((work) => [key(work.media_type, work.tmdb_id), work]),
    );

    // Only the most recent dismissals not in the library hit TMDB, a few at a time.
    const rows = dismissed ?? [];
    let remote = 0;
    const MAX_REMOTE = 12;
    const mapRow = async (row: (typeof rows)[number]) => {
      const work = local.get(key(row.media_type, row.tmdb_id));
      if (work) {
        return {
          mediaType: work.media_type,
          tmdbId: work.tmdb_id,
          title: work.title,
          originalTitle: work.original_title,
          posterPath: work.poster_path,
          backdropPath: work.backdrop_path,
          year: work.release_year,
          overview: work.overview,
          existingWorkId: work.id,
        };
      }

      if (remote++ >= MAX_REMOTE) {
        return {
          mediaType: row.media_type,
          tmdbId: row.tmdb_id,
          title: row.media_type === "tv" ? "Série dispensada" : "Filme dispensado",
          originalTitle: null,
          posterPath: null,
          backdropPath: null,
          year: null,
          overview: null,
          existingWorkId: null,
        };
      }
      try {
        const details = await fetchDetails(row.media_type, row.tmdb_id);
        return {
          mediaType: details.mediaType,
          tmdbId: details.tmdbId,
          title: details.title,
          originalTitle: details.originalTitle,
          posterPath: details.posterPath,
          backdropPath: details.backdropPath,
          year: details.year,
          overview: details.overview,
          existingWorkId: null,
        };
      } catch {
        return {
          mediaType: row.media_type,
          tmdbId: row.tmdb_id,
          title: row.media_type === "tv" ? "Série dispensada" : "Filme dispensado",
          originalTitle: null,
          posterPath: null,
          backdropPath: null,
          year: null,
          overview: null,
          existingWorkId: null,
        };
      }
    };
    const out: Awaited<ReturnType<typeof mapRow>>[] = [];
    for (let i = 0; i < rows.length; i += 4)
      out.push(...(await Promise.all(rows.slice(i, i + 4).map(mapRow))));
    return out;
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
      .upsert(
        { work_id: workId, user_id: userId, watched: true },
        { onConflict: "user_id,work_id" },
      );
    if (error) throw new Error("Não foi possível salvar.");
    if (data.score !== null) {
      const { error: re } = await supabase
        .from("ratings")
        .upsert(
          { work_id: workId, user_id: userId, score: data.score },
          { onConflict: "user_id,work_id" },
        );
      if (re) throw new Error("Não foi possível salvar a nota.");
    }
    return { workId };
  });


export const getTitlePreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ mediaType: z.enum(["movie", "tv"]), tmdbId: z.number().int().positive(), spaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: work, error } = await context.supabase.from("works").select("id").eq("space_id", data.spaceId).eq("media_type", data.mediaType).eq("tmdb_id", data.tmdbId).maybeSingle();
    if (error) throw new Error("Não foi possível consultar a biblioteca.");
    try {
      if (work) {
        const { data: cache } = await context.supabase.from("work_metadata_cache").select("payload,expires_at").eq("work_id",work.id).maybeSingle();
        const cached = cache?.payload as TmdbDetails | undefined;
        if (cached?.v === DETAILS_CACHE_VERSION && cache && new Date(cache.expires_at).getTime() > Date.now()) return { details: cached, workId: work.id };
      }
      const details = await fetchDetails(data.mediaType, data.tmdbId);
      if (work) await context.supabase.from("work_metadata_cache").upsert({ work_id: work.id, payload: details as never, expires_at: new Date(Date.now()+7*864e5).toISOString() },{onConflict:"work_id"});
      return { details, workId: work?.id ?? null };
    }
    catch (e) { friendly(e); }
  });

export const getGalleryLogos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).max(6) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: works, error } = await context.supabase.from("works").select("id, media_type, tmdb_id").in("id", data.ids);
    if (error) throw new Error("Não foi possível carregar as artes.");
    const { data: caches } = await context.supabase.from("work_metadata_cache").select("work_id, payload, expires_at").in("work_id", data.ids);
    const result: Record<string, string | null> = {};
    const queue = [...(works ?? [])];
    await Promise.all([0, 1].map(async () => {
      while (queue.length) {
        const work = queue.shift(); if (!work) break;
        const cache = caches?.find((c) => c.work_id === work.id);
        const payload = cache?.payload as TmdbDetails | undefined;
        if (payload?.logoChecked && cache && new Date(cache.expires_at).getTime() > Date.now()) { result[work.id] = payload.logoPath ?? null; continue; }
        try {
          // Keep the entire existing JSON; a cold cache receives complete details, not a partial payload.
          const fresh = cache && new Date(cache.expires_at).getTime() > Date.now();
          const next = payload && fresh ? { ...payload, logoPath: await fetchLogo(work.media_type, work.tmdb_id), logoChecked: true } : await fetchDetails(work.media_type, work.tmdb_id);
          result[work.id] = next.logoPath ?? null;
          await context.supabase.from("work_metadata_cache").upsert({ work_id: work.id, payload: next as never, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() }, { onConflict: "work_id" });
        } catch { result[work.id] = null; }
      }
    }));
    return result;
  });
