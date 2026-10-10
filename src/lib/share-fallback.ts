/** Rebuilds a failed Web Share payload for the manual field without ever cutting the URL:
 * URL first (kept whole), then title and text trimmed to fit the remaining budget. */
export function shareFallbackText(p: { title?: string | undefined; text?: string | undefined; url?: string | undefined }, max = 4000) {
  const url = (p.url ?? "").trim();
  const rest = [p.title, p.text].map((v) => (v ?? "").trim()).filter((v) => v && v !== url).join("\n");
  if (!url) return rest.slice(0, max);
  const budget = Math.max(0, max - url.length - 1);
  return rest && budget ? `${url}\n${rest.slice(0, budget)}` : url;
}
