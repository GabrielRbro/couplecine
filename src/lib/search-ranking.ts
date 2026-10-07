export type Rankable = { title: string; originalTitle: string | null; year: number | null; tmdbId: number; popularity?: number; voteAverage?: number; voteCount?: number };
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
export function relevanceScore(item: Rankable, query: string) {
  const q = fold(query), tokens = q.split(" ").filter(Boolean);
  const titleSignal = Math.max(...[item.title,item.originalTitle ?? ""].map((title) => { const t = fold(title); if (!q || !t) return 0; const coverage = tokens.filter((word) => t.split(" ").includes(word)).length / tokens.length; return t === q ? 36 : t.startsWith(q) ? 30 : t.includes(q) ? 26 : coverage * 24; }));
  // Bounded title advantage: canonical, well-supported works can outrank obscure exact matches.
  const confidence = Math.min(1,Math.log1p(item.voteCount ?? 0)/Math.log(10001));
  const acclaim = (item.voteAverage ?? 0) * confidence * 3;
  const popular = Math.min(25,Math.log1p(item.popularity ?? 0)*5);
  const recognition = Math.min(20,Math.log1p(item.voteCount ?? 0)*2);
  const recency = item.year ? Math.max(0,5-Math.max(0,new Date().getUTCFullYear()-item.year)/12) : 0;
  return titleSignal+acclaim+popular+recognition+recency;
}
export function rankSearch<T extends Rankable>(items: T[], query: string): T[] {
  return [...items].sort((a,b) => relevanceScore(b,query)-relevanceScore(a,query) || a.tmdbId-b.tmdbId);
}