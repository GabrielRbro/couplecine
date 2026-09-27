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
  return results
    .filter((item) => item["media_type"] === "movie" || item["media_type"] === "tv")
    .map((item) => {
      const mediaType = item["media_type"] === "tv" ? ("tv" as const) : ("movie" as const);
      return {
        mediaType,
        tmdbId: Number(item["id"]),
        title: String(item[mediaType === "tv" ? "name" : "title"] ?? "Sem título"),
        originalTitle: str(item[mediaType === "tv" ? "original_name" : "original_title"]),
        posterPath: str(item["poster_path"]),
        backdropPath: str(item["backdrop_path"]),
        year: year(item[mediaType === "tv" ? "first_air_date" : "release_date"]),
        overview: str(item["overview"]),
      };
    })
    .slice(0, 20);
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
