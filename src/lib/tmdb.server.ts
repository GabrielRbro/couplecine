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

export async function searchMulti(query: string, page = 1): Promise<TmdbSearchItem[]> {
  const data = await call("/search/multi", { query, include_adult: "false", page: String(page) });
  const results = Array.isArray(data["results"]) ? (data["results"] as Json[]) : [];
  // Fan-out guard: only the top 3 distinct people are expanded into credits.
  const personIds = [
    ...new Set(
      results
        .filter((r) => r["media_type"] === "person")
        .map((r) => Number(r["id"]))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ].slice(0, 3);
  const expanded = await Promise.all(
    results.slice(0, 20).map(async (item): Promise<TmdbSearchItem[]> => {
      const direct = mapListItem(item);
      if (direct) return [direct];
      if (item["media_type"] !== "person") return [];

      const personId = Number(item["id"]);
      if (!personIds.includes(personId)) return [];
      personIds.splice(personIds.indexOf(personId), 1);
      const credits = await call(`/person/${personId}/combined_credits`);
      const cast = Array.isArray(credits["cast"]) ? (credits["cast"] as Json[]) : [];
      const crew = Array.isArray(credits["crew"]) ? (credits["crew"] as Json[]) : [];
      const knownFor = Array.isArray(item["known_for"]) ? (item["known_for"] as Json[]) : [];
      const department = String(item["known_for_department"] ?? "");
      const relevant =
        department === "Directing"
          ? crew.filter((credit) => credit["job"] === "Director")
          : department === "Acting"
            ? cast
            : [...cast, ...crew.filter((credit) => credit["job"] === "Director")];

      return [...knownFor, ...relevant]
        .filter((credit) => credit["adult"] !== true)
        .map((credit) => mapListItem(credit))
        .filter((credit): credit is TmdbSearchItem => Boolean(credit))
        .slice(0, 12);
    }),
  );

  const unique = new Map<string, TmdbSearchItem>();
  for (const item of expanded.flat()) {
    const resultKey = `${item.mediaType}:${item.tmdbId}`;
    if (!unique.has(resultKey)) unique.set(resultKey, item);
  }
  return [...unique.values()].slice(0, 20);
}

/** Bump when the details strategy changes; older cached payloads are refetched. */
export const DETAILS_CACHE_VERSION = 2;

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
  const best = [...items].sort((a,b) => score(b)-score(a))[0];
  return best && score(best) >= 45 ? best : null;
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
