import type { TmdbSearchItem } from "./tmdb.server";

const PREFIX = "import-choice-v1:";
export type ReviewChoice = Pick<TmdbSearchItem, "mediaType" | "tmdbId" | "title" | "originalTitle" | "year" | "posterPath" | "overview">;
export type ReviewChoices = { mentionedTitle: string | null; selectedOverview: string | null; alternatives: ReviewChoice[] };

export function choiceNote(item: TmdbSearchItem & { mentionedTitle?: string; reviewAlternatives?: TmdbSearchItem[] }) {
  if (!item.reviewAlternatives?.length) return null;
  const data: ReviewChoices = {
    mentionedTitle: item.mentionedTitle ?? null,
    selectedOverview: item.overview,
    alternatives: item.reviewAlternatives.slice(0, 2).map(({ mediaType, tmdbId, title, originalTitle, year, posterPath, overview }) =>
      ({ mediaType, tmdbId, title, originalTitle, year, posterPath, overview })),
  };
  return PREFIX + JSON.stringify(data);
}

export function parseChoiceNote(note: string | null): ReviewChoices | null {
  if (!note?.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(note.slice(PREFIX.length)) as ReviewChoices;
    if (!Array.isArray(value.alternatives) || value.alternatives.length > 2 || !value.alternatives.length) return null;
    if (!value.alternatives.every((a) => (a.mediaType === "movie" || a.mediaType === "tv") && Number.isInteger(a.tmdbId) && a.tmdbId > 0 && typeof a.title === "string")) return null;
    return value;
  } catch { return null; }
}
