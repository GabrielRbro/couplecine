import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterPills } from "./ui";
import { refineMatch } from "@/lib/ai.functions";
import { isIndicated, type LibraryWork } from "@/lib/space";

export function MatchPreparation({ works, spaceId, onStart, solo = false }: { works: LibraryWork[]; spaceId: string; onStart: (ids: string[]) => void; solo?: boolean }) {
  const [kind,setKind] = useState("all");
  const [intent,setIntent] = useState("");
  const [pending,setPending] = useState(false);
  const [refined,setRefined] = useState<string[] | null>(null);
  const [message,setMessage] = useState<string | null>(null);
  const refine = useServerFn(refineMatch);
  const pool = works.filter((w) => isIndicated(w) && !w.interests.some((i) => i.reaction === "dislike") && (kind === "all" || w.media_type === kind));
  const ids = refined ?? pool.map((w) => w.id);
  async function run() {
    if (!intent.trim() || pending) return;
    setPending(true);
    try {
      const result = await refine({ data: { spaceId, kind: kind === "movie" ? "movie" : kind === "tv" ? "tv" : "all", query:intent.trim(), ids:pool.slice(0,40).map((w) => w.id) } });
      setRefined(result.refined ? result.ids : null); setMessage(result.reason ?? "Conjunto refinado");
    } catch { setRefined(null);setMessage("IA indisponível · o Match normal continua disponível."); }
    finally { setPending(false); }
  }
  return <section className="mt-6 space-y-3">
    <FilterPills options={[["all","Todos"],["movie","Filmes"],["tv","Séries"]]} value={kind} onChange={(v) => {setKind(v);setRefined(null);setMessage(null);}} />
    <input aria-label="Intenção para o Match" value={intent} maxLength={180} onChange={(e) => {setIntent(e.target.value);setRefined(null);}} placeholder="Algo leve, até 2h, suspense…" className="min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm" />
    <Button variant="outline" onClick={run} disabled={pending || intent.trim().length < 3 || pool.length < 2} className="min-h-11 w-full"><Sparkles className={pending ? "animate-pulse" : ""} />{pending ? "Refinando candidatos…" : "Refinar com IA"}</Button>
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    <Button disabled={pending || ids.length < 2} onClick={() => onStart(ids)} className="min-h-12 w-full">{solo ? "Iniciar simulação" : "Iniciar Match"}</Button>
  </section>;
}