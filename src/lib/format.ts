export type Reaction = "fire" | "like" | "neutral" | "dislike";

export const REACTION_EMOJI: Record<Reaction, string> = {
  fire: "🔥",
  like: "👍",
  neutral: "😐",
  dislike: "👎",
};

export const REACTION_LABEL: Record<Reaction, string> = {
  fire: "Quero muito",
  like: "Curti",
  neutral: "Tanto faz",
  dislike: "Não quero",
};

export const ADD_REACTIONS: Reaction[] = ["fire", "like", "neutral"];
export const ALL_REACTIONS: Reaction[] = ["fire", "like", "neutral", "dislike"];

export const SERIES_STATUS_LABEL: Record<string, string> = {
  watching: "Em andamento",
  waiting: "Aguardando novos episódios",
  paused: "Pausada",
  abandoned: "Abandonada",
  completed: "Concluída",
};

export function tmdbImage(path: string | null | undefined, size = "w342") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export function formatRuntime(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}min` : `${rest}min`;
}

export function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined) return "—";
  return score.toFixed(1).replace(".", ",");
}

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 6) return "Boa madrugada";
  if (hour < 12) return "Bom dia";
  if (hour < 19) return "Boa tarde";
  return "Boa noite";
}

export function formatDate(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
