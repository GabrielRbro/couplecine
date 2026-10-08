import { Sparkles } from "lucide-react";

export function IntelligentLoading() {
  return <div role="status" className="mt-5 overflow-hidden rounded-xl border border-border bg-card px-4 py-6">
    <div aria-hidden className="mx-auto flex h-24 items-center justify-center gap-2">{[0,1,2,3].map((n) => <div key={n} className={`ai-film-frame ai-film-${n} relative h-20 w-12 overflow-hidden rounded-md border border-border bg-secondary`}><div className="skeleton absolute inset-0" /><Sparkles className="absolute left-3 top-7 h-5 w-5 text-primary/50" /></div>)}</div>
    <p className="mt-3 text-center text-sm text-muted-foreground">Buscando…</p>
  </div>;
}