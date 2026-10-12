const BASE = "https://api.themoviedb.org/3";

export type TmdbSearchItem = {
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  year: number | null;
  overview: string | null;
  genres?: string[];
  voteAverage?: number;
  voteCount?: number;
  popularity?: number;
  originalLanguage?: string | null;
};

// TMDB's fixed genre ids (movie + tv), used to give rerankers real genre signals.
const GENRES: Record<number, string> = {
  28: "Ação", 12: "Aventura", 16: "Animação", 35: "Comédia", 80: "Crime", 99: "Documentário",
  18: "Drama", 10751: "Família", 14: "Fantasia", 36: "História", 27: "Terror", 10402: "Música",
  9648: "Mistério", 10749: "Romance", 878: "Ficção científica", 10770: "Filme de TV",
  53: "Thriller", 10752: "Guerra", 37: "Faroeste", 10759: "Ação e Aventura", 10762: "Infantil",
  10763: "Notícias", 10764: "Reality", 10765: "Sci-Fi e Fantasia", 10766: "Novela",
  10767: "Talk show", 10768: "Guerra e Política",
};

type Json = Record<string, unknown>;

function key(): string {
  const value = process.env["TMDB_API_KEY"];
  if (!value) throw new Error("TMDB_NOT_CONFIGURED");
  return value;
}

async function call(path: string, params: Record<string, string> = {}): Promise<Json> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_key", key());
  url.searchParams.set("language", "pt-BR");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const body = await response.text();
    console.error(`TMDB ${path} failed [${response.status}]: ${body}`);
    throw new Error("TMDB_REQUEST_FAILED");
  }
  return (await response.json()) as Json;
}

function year(value: unknown): number | null {
  if (typeof value !== "string" || value.length < 4) return null;
  const parsed = Number(value.slice(0, 4));
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function posterUrl(path: string | null, size: "w342" | "w780" | "original" = "w342") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

/** Hard cap: 1 search + at most 3 credits OR one additional title page. */
export async function searchMulti(query: string, page = 1): Promise<TmdbSearchItem[]> {
  const role=/dire(c|ç)ão|diretor|directed|director/i.test(query) ? "Directing" : /ator|atriz|actor|actress/i.test(query) ? "Acting" : null;
  const cleaned=query.replace(/\b(diretor|director|directed|ator|atriz|actor|actress)\b/gi,"").trim();
  const data=await call("/search/multi",{query:cleaned,include_adult:"false",page:String(page)});
  const raw=Array.isArray(data["results"]) ? data["results"] as Json[] : [];
  const people=raw.filter(r=>r["media_type"] === "person" && (!role || r["known_for_department"] === role)).sort((a,b)=>Number(b["popularity"] ?? 0)-Number(a["popularity"] ?? 0));
  const principal=people[0];
  const personIntent=principal && (role || people.length>0 && raw.filter(r=>mapListItem(r)).length<10);
  // A dominant directing result means the user's intent is that director, not every namesake.
  const selected=personIntent && principal?.["known_for_department"] === "Directing" ? [principal] : people.slice(0,3);
  const direct=raw.map(r=>mapListItem(r)).filter((r):r is TmdbSearchItem=>Boolean(r));
  const expanded=await Promise.all(selected.map(async person=>{
    const credits=await call(`/person/${Number(person["id"])}/combined_credits`);
    const cast=Array.isArray(credits["cast"]) ? credits["cast"] as Json[] : [];
    const crew=Array.isArray(credits["crew"]) ? credits["crew"] as Json[] : [];
    const directing=role === "Directing" || person["known_for_department"] === "Directing";
    return (directing ? crew.filter(c=>c["job"] === "Director") : cast).filter(c=>c["adult"] !== true).map(c=>mapListItem(c)).filter((c):c is TmdbSearchItem=>Boolean(c));
  }));
  let candidates=personIntent ? expanded.flat() : [...direct,...expanded.flat()];
  if (!personIntent && page === 1 && cleaned.length>=3) {
    // Rank beyond TMDB's literal first page without title-specific IDs or heuristics.
    const next=await call("/search/multi",{query:cleaned,include_adult:"false",page:"2"}).catch(()=>({} as Json));
    candidates.push(...(Array.isArray(next["results"]) ? next["results"] as Json[] : []).map(r=>mapListItem(r)).filter((r):r is TmdbSearchItem=>Boolean(r)));
  }
  const unique=[...new Map(candidates.map(w=>[`${w.mediaType}:${w.tmdbId}`,w])).values()];
  const {rankSearch}=await import("./search-ranking");
  return rankSearch(unique,personIntent ? "" : cleaned).slice(0,20);
}

/** Bump when the details strategy changes; older cached payloads are refetched. */
export const DETAILS_CACHE_VERSION = 3;

export type TmdbDetails = {
  v?: number;
  logoPath?: string | null;
  logoChecked?: boolean;
  no_logo?: boolean;
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  year: number | null;
  runtimeMinutes: number | null;
  seasonCount: number | null;
  genres: string[];
  crewLeads?: { name: string; role: string; profilePath: string | null }[];
  crewLead: { name: string; role: string; profilePath: string | null } | null;
  cast: { name: string; character: string; profilePath: string | null }[];
  seasons: {
    seasonNumber: number;
    name: string;
    episodeCount: number;
    posterPath?: string | null;
  }[];
};

export async function fetchDetails(
  mediaType: "movie" | "tv",
  tmdbId: number,
): Promise<TmdbDetails> {
  // Series use aggregate_credits (whole run); movies keep regular credits.
  const data = await call(`/${mediaType}/${tmdbId}`, {
    append_to_response: mediaType === "tv" ? "aggregate_credits,credits,images" : "credits,images",
    include_image_language: "pt,en,null",
  });
  const credits = (data["credits"] as Json | undefined) ?? {};
  const agg = (data["aggregate_credits"] as Json | undefined) ?? {};
  const crew = Array.isArray(credits["crew"]) ? (credits["crew"] as Json[]) : [];
  const aggCast = Array.isArray(agg["cast"]) ? (agg["cast"] as Json[]) : [];
  const cast: Json[] =
    mediaType === "tv" && aggCast.length
      ? [...aggCast]
          .sort(
            (a, b) =>
              Number(b["total_episode_count"] ?? 0) - Number(a["total_episode_count"] ?? 0) ||
              Number(a["order"] ?? 999) - Number(b["order"] ?? 999),
          )
          .map((m) => {
            const roles = Array.isArray(m["roles"]) ? (m["roles"] as Json[]) : [];
            return { ...m, character: roles[0]?.["character"] ?? "" };
          })
      : Array.isArray(credits["cast"])
        ? (credits["cast"] as Json[])
        : [];
  const createdBy = Array.isArray(data["created_by"]) ? (data["created_by"] as Json[]) : [];
  const genres = Array.isArray(data["genres"]) ? (data["genres"] as Json[]) : [];
  const seasons = Array.isArray(data["seasons"]) ? (data["seasons"] as Json[]) : [];

  const director = crew.find((member) => member["job"] === "Director");
  const creator = createdBy[0];
  const lead = director ?? creator;

  return {
    v: DETAILS_CACHE_VERSION,
    logoPath: chooseLogo(data["images"] as Json | undefined),
    logoChecked: true,
    no_logo: !chooseLogo(data["images"] as Json | undefined),
    mediaType,
    tmdbId,
    title: String(data[mediaType === "tv" ? "name" : "title"] ?? "Sem título"),
    originalTitle: str(data[mediaType === "tv" ? "original_name" : "original_title"]),
    overview: str(data["overview"]),
    posterPath: str(data["poster_path"]),
    backdropPath: str(data["backdrop_path"]),
    year: year(data[mediaType === "tv" ? "first_air_date" : "release_date"]),
    runtimeMinutes:
      typeof data["runtime"] === "number"
        ? data["runtime"]
        : Array.isArray(data["episode_run_time"]) && data["episode_run_time"].length > 0
          ? Number((data["episode_run_time"] as number[])[0])
          : null,
    seasonCount: typeof data["number_of_seasons"] === "number" ? data["number_of_seasons"] : null,
    genres: genres.map((genre) => String(genre["name"])).filter(Boolean),
    crewLeads: (crew.filter(m=>m["job"] === "Director").length ? crew.filter(m=>m["job"] === "Director") : createdBy).map(m=>({name:String(m["name"]),role:director ? "Diretor" : "Criação",profilePath:str(m["profile_path"])})),
    crewLead: lead
      ? {
          name: String(lead["name"]),
          role: director ? "Diretor" : "Criação e direção",
          profilePath: str(lead["profile_path"]),
        }
      : null,
    cast: cast.slice(0, 12).map((member) => ({
      name: String(member["name"]),
      character: String(member["character"] ?? ""),
      profilePath: str(member["profile_path"]),
    })),
    seasons: seasons
      .filter((season) => Number(season["season_number"]) > 0)
      .map((season) => ({
        seasonNumber: Number(season["season_number"]),
        name: String(season["name"] ?? `Temporada ${season["season_number"]}`),
        episodeCount: Number(season["episode_count"] ?? 0),
        posterPath: str(season["poster_path"]),
      })),
  };
}

export type TmdbEpisode = {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  overview: string | null;
  stillPath: string | null;
  runtimeMinutes: number | null;
  airDate: string | null;
};

export async function fetchSeason(tmdbId: number, seasonNumber: number): Promise<TmdbEpisode[]> {
  const data = await call(`/tv/${tmdbId}/season/${seasonNumber}`);
  const episodes = Array.isArray(data["episodes"]) ? (data["episodes"] as Json[]) : [];
  return episodes.map((episode) => ({
    seasonNumber,
    episodeNumber: Number(episode["episode_number"]),
    name: String(episode["name"] ?? ""),
    overview: str(episode["overview"]),
    stillPath: str(episode["still_path"]),
    runtimeMinutes: typeof episode["runtime"] === "number" ? episode["runtime"] : null,
    airDate: str(episode["air_date"]),
  }));
}

function mapListItem(item: Json, fallback?: "movie" | "tv"): TmdbSearchItem | null {
  const t = item["media_type"] ?? fallback;
  if (t !== "movie" && t !== "tv") return null;
  const tv = t === "tv";
  return {
    mediaType: t,
    tmdbId: Number(item["id"]),
    title: String(item[tv ? "name" : "title"] ?? "Sem título"),
    originalTitle: str(item[tv ? "original_name" : "original_title"]),
    posterPath: str(item["poster_path"]),
    backdropPath: str(item["backdrop_path"]),
    year: year(item[tv ? "first_air_date" : "release_date"]),
    overview: str(item["overview"]),
    voteAverage: Number(item["vote_average"] ?? 0),
    voteCount: Number(item["vote_count"] ?? 0),
    popularity: Number(item["popularity"] ?? 0),
    originalLanguage: str(item["original_language"]),
    genres: Array.isArray(item["genre_ids"])
      ? (item["genre_ids"] as unknown[]).map((g) => GENRES[Number(g)]).filter((g): g is string => !!g)
      : [],
  };
}

async function list(path: string, page: number, fallback?: "movie" | "tv") {
  const data = await call(path, { page: String(page) });
  const results = Array.isArray(data["results"]) ? (data["results"] as Json[]) : [];
  return results.map((r) => mapListItem(r, fallback)).filter((x): x is TmdbSearchItem => !!x);
}

/** Recommendations from a few seed works, interleaved with trending as fallback. */
export async function discoverFeed(
  seeds: { mediaType: "movie" | "tv"; tmdbId: number }[],
  page: number,
): Promise<TmdbSearchItem[]> {
  const lists = await Promise.all([
    ...seeds.map((s) =>
      list(`/${s.mediaType}/${s.tmdbId}/recommendations`, page, s.mediaType).catch(() => []),
    ),
    list("/trending/all/week", page),
  ]);
  const out: TmdbSearchItem[] = [];
  const seen = new Set<string>();
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++)
    for (const l of lists) {
      const it = l[i];
      if (!it) continue;
      const k = `${it.mediaType}:${it.tmdbId}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(it);
      }
    }
  return out;
}

/** Validates an AI guess on TMDB: returns the best real work for title (+year/type), or null. */
export async function findTitle(guess: {
  title: string;
  year?: number | null;
  mediaType?: "movie" | "tv" | null;
}): Promise<TmdbSearchItem | null> {
  const path = guess.mediaType ? `/search/${guess.mediaType}` : "/search/multi";
  const data = await call(path, {
    query: guess.title.slice(0, 100),
    include_adult: "false",
    page: "1",
  });
  const results = Array.isArray(data["results"]) ? (data["results"] as Json[]) : [];
  const items = results
    .map((r) => mapListItem(r, guess.mediaType ?? undefined))
    .filter((x): x is TmdbSearchItem => !!x);
  if (!items.length) return null;
  const normalize = (title: string) => title.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const query = normalize(guess.title);
  const score = (item: TmdbSearchItem) => {
    const title = Math.max(...[item.title, item.originalTitle ?? ""].map((text) => {
      const t = normalize(text);
      if (t === query) return 100;
      const a = new Set(query.split(" ")), b = new Set(t.split(" "));
      return 70 * [...a].filter((word) => b.has(word)).length / new Set([...a, ...b]).size;
    }));
    return title + (guess.year && item.year ? Math.max(0, 12 - Math.abs(item.year - guess.year) * 4) : 0);
  };
  const best = items.filter(item => !guess.year || item.year === guess.year).sort((a,b) => score(b)-score(a))[0];
  return best && score(best) >= 45 ? best : null;
}

function normalizedTitle(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function transcriptionClose(a: string, b: string) {
  if (a === b) return true;
  // A one-character subtitle transcription error, e.g. "underton" → "Undertone".
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (a.length <= b.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Import matching: corroborate the title heard in a transcript against TMDB's
 * translated/alternative-title search and an independent canonical-title query.
 * Guessed years rank ties but never discard a title (release years often differ). */
export async function findImportTitle(guess: {
  title: string;
  originalTitle?: string | null;
  mentionedTitle?: string | null;
  year?: number | null;
  mediaType?: "movie" | "tv" | null;
}): Promise<TmdbSearchItem | null> {
  const spoken = guess.mentionedTitle?.trim();
  const aliases = [...new Set([guess.title, guess.originalTitle].filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()))];
  if (!aliases.length) return null;
  const path = guess.mediaType ? `/search/${guess.mediaType}` : "/search/multi";
  const search = async (query: string) => {
    const data = await call(path, { query: query.slice(0, 100), include_adult: "false", page: "1" });
    return (Array.isArray(data["results"]) ? data["results"] as Json[] : [])
      .map((r) => mapListItem(r, guess.mediaType ?? undefined)).filter((x): x is TmdbSearchItem => !!x);
  };
  const queries = [...new Set([spoken, ...aliases].filter((x): x is string => !!x).map((x) => x.trim()))].slice(0, 3);
  const lists = await Promise.all(queries.map((q) => search(q).catch(() => [])));
  const spokenIds = new Set(spoken ? lists[0]!.map((i) => `${i.mediaType}:${i.tmdbId}`) : []);
  const byId = new Map<string, TmdbSearchItem>();
  for (const list of lists) for (const item of list) byId.set(`${item.mediaType}:${item.tmdbId}`, item);
  const canonical = aliases.map(normalizedTitle);
  const heard = spoken ? normalizedTitle(spoken) : null;
  const original = guess.originalTitle ? normalizedTitle(guess.originalTitle) : null;
  const distinctOriginal = original && original !== normalizedTitle(guess.title);
  let candidates = [...byId.values()].filter((item) => {
    const names = [item.title, item.originalTitle ?? ""].map(normalizedTitle);
    if (!canonical.some((alias) => names.includes(alias))) return false;
    if (!heard) return true;
    if (spokenIds.has(`${item.mediaType}:${item.tmdbId}`) || names.some((name) => transcriptionClose(heard, name))) return true;
    // Search can miss translated names. A distinct original title and a close release
    // year together corroborate an independently queried catalog result.
    return !!(distinctOriginal && names[1] === original && guess.year && item.year && Math.abs(item.year - guess.year) <= 1);
  });
  // A localized word from automatic subtitles may itself be an unrelated film.
  // When TMDB also confirms the distinct original title, that identity wins.
  if (original) {
    const originalMatches = candidates.filter((item) => normalizedTitle(item.originalTitle ?? "") === original);
    if (originalMatches.length) candidates = originalMatches;
  }
  candidates.sort((a, b) => {
    const rank = (item: TmdbSearchItem) => {
      const names = [item.title, item.originalTitle ?? ""].map(normalizedTitle);
      return (heard && names.includes(heard) ? 100 : 0) +
        (canonical.some((x) => names.includes(x)) ? 50 : 0) +
        (guess.year && item.year && Math.abs(item.year - guess.year) <= 1 ? 10 : 0) +
        Math.min(9, Math.log10(1 + (item.voteCount ?? 0)));
    };
    return rank(b) - rank(a);
  });
  return candidates[0] ?? null;
}

/** A single explicitly named film can survive an AI misread: look up the
 * transcribed word itself, then its common final-silent-e spelling. Accept
 * only a catalog title within one character of what was actually spoken. */
export async function findSpokenTitle(text: string): Promise<TmdbSearchItem | null> {
  const named = text.match(/\b(?:se chama|chama-se)\s+([\p{L}]{4,35})(?=\s|$)/iu)?.[1];
  if (!named) return null;
  const heard = normalizedTitle(named);
  const queries = [named, ...(!/e$/i.test(named) && named.length >= 6 ? [`${named}e`] : [])];
  for (const query of queries) {
    const data = await call("/search/multi", { query, include_adult: "false", page: "1" });
    const matches = (Array.isArray(data["results"]) ? data["results"] as Json[] : [])
      .map((r) => mapListItem(r)).filter((item): item is TmdbSearchItem => !!item)
      .filter((item) => [item.title, item.originalTitle ?? ""].some((name) => transcriptionClose(heard, normalizedTitle(name))))
      .sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
    if (matches[0]) return matches[0];
  }
  return null;
}

function chooseLogo(images: Json | undefined): string | null {
  const logos = Array.isArray(images?.["logos"]) ? images["logos"] as Json[] : [];
  const rank = (lang: unknown) => lang === "pt" || lang === "pt-BR" ? 0 : lang === "en" ? 1 : lang == null ? 2 : 9;
  const logo = logos.filter((l) => rank(l["iso_639_1"]) < 9 && Number(l["aspect_ratio"]) > 1 && String(l["file_path"]).endsWith(".png"))
    .sort((a, b) => rank(a["iso_639_1"]) - rank(b["iso_639_1"]) || Number(b["vote_average"] ?? 0) - Number(a["vote_average"] ?? 0))[0];
  return logo ? str(logo["file_path"]) : null;
}
export async function fetchLogo(mediaType: "movie" | "tv", id: number) {
  return chooseLogo(await call(`/${mediaType}/${id}/images`, { include_image_language: "pt,en,null" }));
}

/** Deterministic import lookups: explicit TMDB ids and IMDb ids (via /find). */
export async function lookupTmdb(mediaType: "movie" | "tv", id: number): Promise<TmdbSearchItem | null> {
  const data = await call(`/${mediaType}/${id}`).catch(() => null);
  if (!data) return null;
  const genres = Array.isArray(data["genres"]) ? (data["genres"] as Json[]).map((g) => Number(g["id"])) : [];
  return mapListItem({ ...data, genre_ids: genres }, mediaType);
}
export async function findImdb(imdbId: string): Promise<TmdbSearchItem[]> {
  const data = await call(`/find/${imdbId}`, { external_source: "imdb_id" }).catch(() => null);
  if (!data) return [];
  const movies = Array.isArray(data["movie_results"]) ? (data["movie_results"] as Json[]) : [];
  const tv = Array.isArray(data["tv_results"]) ? (data["tv_results"] as Json[]) : [];
  return [...movies.map((r) => mapListItem(r, "movie")), ...tv.map((r) => mapListItem(r, "tv"))].filter((x): x is TmdbSearchItem => !!x);
}
