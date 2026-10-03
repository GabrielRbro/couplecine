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

export async function searchMulti(query: string): Promise<TmdbSearchItem[]> {
  const data = await call("/search/multi", { query, include_adult: "false", page: "1" });
  const results = Array.isArray(data["results"]) ? (data["results"] as Json[]) : [];
  const expanded = await Promise.all(
    results.slice(0, 20).map(async (item): Promise<TmdbSearchItem[]> => {
      const direct = mapListItem(item);
      if (direct) return [direct];
      if (item["media_type"] !== "person") return [];

      const personId = Number(item["id"]);
      if (!Number.isInteger(personId) || personId <= 0) return [];
      const credits = await call(`/person/${personId}/combined_credits`);
      const cast = Array.isArray(credits["cast"]) ? (credits["cast"] as Json[]) : [];
      const crew = Array.isArray(credits["crew"]) ? (credits["crew"] as Json[]) : [];
      const department = String(item["known_for_department"] ?? "");
      const relevant =
        department === "Directing"
          ? crew.filter((credit) => credit["job"] === "Director")
          : department === "Acting"
            ? cast
            : [...cast, ...crew.filter((credit) => credit["job"] === "Director")];

      return relevant
        .filter((credit) => credit["adult"] !== true)
        .sort((a, b) => Number(b["popularity"] ?? 0) - Number(a["popularity"] ?? 0))
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

export type TmdbDetails = {
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
  seasons: { seasonNumber: number; name: string; episodeCount: number }[];
};

export async function fetchDetails(
  mediaType: "movie" | "tv",
  tmdbId: number,
): Promise<TmdbDetails> {
  const data = await call(`/${mediaType}/${tmdbId}`, { append_to_response: "credits" });
  const credits = (data["credits"] as Json | undefined) ?? {};
  const crew = Array.isArray(credits["crew"]) ? (credits["crew"] as Json[]) : [];
  const cast = Array.isArray(credits["cast"]) ? (credits["cast"] as Json[]) : [];
  const createdBy = Array.isArray(data["created_by"]) ? (data["created_by"] as Json[]) : [];
  const genres = Array.isArray(data["genres"]) ? (data["genres"] as Json[]) : [];
  const seasons = Array.isArray(data["seasons"]) ? (data["seasons"] as Json[]) : [];

  const director = crew.find((member) => member["job"] === "Director");
  const creator = createdBy[0];
  const lead = director ?? creator;

  return {
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
    cast: cast.slice(0, 8).map((member) => ({
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
