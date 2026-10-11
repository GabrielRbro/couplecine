/** Only accept a title/year stated on the first caption line; everything else goes to AI review. */
export function explicitTitle(text: string) {
  const first = text.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  const label = first.match(/^(movie|film|filme|series|série|tv show)(?:\s+(?:name|title|nome|título))?\s*[:\-–]+\s*/i);
  const line = label ? first.slice(label[0].length) : first;
  const match = line.match(/^([^#\r\n]{2,100}?)\s*\(((?:19|20)\d{2})\)(?:\s*(?:[#.!?].*)?)?$/);
  if (!match) return null;
  const title = match[1]!.trim();
  if (!title || /[.!?]$|\((?:19|20)\d{2}\)/.test(title)) return null;
  return { title, year: Number(match[2]), mediaType: label ? (/^(series|série|tv show)/i.test(label[1]!) ? "tv" as const : "movie" as const) : null };
}
