import { useEffect, useState } from "react";

/** Scoped to this tab and account; never shared with real Match votes. */
export function useMatchLocal<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const hydrated = loadedKey === key;
  useEffect(() => {
    try { const saved = sessionStorage.getItem(key); setValue(saved ? JSON.parse(saved) as T : initial); } catch { /* unavailable storage */ }
    setLoadedKey(key);
  }, [key]);
  useEffect(() => { if (hydrated) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private browsing */ } } }, [key, value, hydrated]);
  return [value, setValue, hydrated] as const;
}

export function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i], b = out[j];
    if (a !== undefined && b !== undefined) { out[i] = b; out[j] = a; }
  }
  return out;
}

export function nextHighlight(ids: string[], visited: string[]) {
  const windowSize = Math.min(3, Math.max(0, ids.length - 1));
  const recent = windowSize ? visited.slice(-windowSize) : [];
  const options = ids.filter((id) => !recent.includes(id));
  return options[Math.floor(Math.random() * options.length)] ?? ids[0] ?? null;
}