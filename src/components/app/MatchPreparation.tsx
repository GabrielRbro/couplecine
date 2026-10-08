import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterPills } from "./ui";
import { materializeMatchCandidates } from "@/lib/catalog.functions";
import { refineMatch } from "@/lib/ai.functions";
import { isIndicated, type LibraryWork } from "@/lib/space";

export function MatchPreparation({ works, spaceId, onStart, solo = false }: { works: LibraryWork[]; spaceId: string; onStart: (ids: string[], extras: LibraryWork[]) => void; solo?: boolean }) {
  const [ai,setAi] = useState(false);
  const [kind,setKind] = useState("all");
  const [intent,setIntent] = useState("");
  const [pending,setPending] = useState(false);
  const [message,setMessage] = useState<string | null>(null);
  const request = useRef(0);
  const busy = useRef(false);
  const materialize = useServerFn(materializeMatchCandidates);
  const refine = useServerFn(refineMatch);
  const pool = works.filter((w) => isIndicated(w) && !w.interests.some((i) => i.reaction === "dislike") && (kind === "all" || w.media_type === kind));
  useEffect(() => () => { request.current++; }, []);
  const invalidate = () => { request.current++;setMessage(null); };

  async function start() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    const version = ++request.current;
    const normalIds = pool.map(w => w.id);
    let ids = normalIds;
    let external: Awaited<ReturnType<typeof refineMatch>>["external"] = [];
    try {
      if (ai) {
        try {
          const result = await refine({ data: { spaceId, kind: kind === "movie" ? "movie" : kind === "tv" ? "tv" : "all", query: intent.trim().length >= 3 ? intent.trim() : "Escolha variada para assistir hoje", ids: normalIds.slice(0,40) } });
          if (version !== request.current) return;
          external = [...new Map(result.external.filter(w => !w.existingWorkId && (kind === "all" || w.mediaType === kind)).map(w => [`${w.mediaType}:${w.tmdbId}`, w])).values()];
          // Without new candidates keep the complete normal pool, not a too-small AI subset.
          if (external.length) ids = [...new Set(result.ids.filter(id => normalIds.includes(id)))];
          if (ids.length + external.length < 2 && normalIds.length >= 2) { ids = normalIds;external = []; }
          if (result.reason) setMessage(result.reason);
        } catch {
          if (version !== request.current) return;
          setMessage("IA indisponível · o Match normal continua disponível.");
        }
      }
      if (version !== request.current) return;
      if (ids.length + external.length < 2) {
        setMessage("São necessários pelo menos 2 candidatos elegíveis para iniciar.");
        return;
      }
      const extras: LibraryWork[] = external.map(w => ({ id:`tmdb-${w.mediaType}-${w.tmdbId}`, tmdb_id:w.tmdbId, voteAverage:w.voteAverage, title:w.title,original_title:w.originalTitle,media_type:w.mediaType,poster_path:w.posterPath,backdrop_path:w.backdropPath,release_year:w.year,runtime_minutes:null,genres:w.genres ?? [],activity_at:"",created_at:"",interests:[],ratings:[],indications:[],joint_watch_sessions:[],watch:null,series_states:[],work_metadata_cache:[] }));
      if (!solo && external.length) {
        const extraIds = await materialize({data:{spaceId,items:external.map(w => ({mediaType:w.mediaType,tmdbId:w.tmdbId}))}});
        if (version !== request.current) return;
        onStart([...ids,...extraIds],extras.map((w,i)=>({...w,id:extraIds[i] ?? w.id})));
      } else onStart(ids,extras);
    } catch {
      if (version === request.current) setMessage("Não foi possível preparar candidatos. Tente de novo.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return <section className="mt-6 space-y-3">
    <FilterPills options={[["all","Todos"],["movie","Filmes"],["tv","Séries"]]} value={kind} onChange={v => {if (v === kind) return;invalidate();setKind(v);}} />
    <div className="flex min-w-0 items-center gap-1 rounded-xl border border-border bg-card pl-3 pr-1">
      <input aria-label="Intenção para o Match" value={intent} maxLength={180} onChange={e => {invalidate();setIntent(e.target.value);}} placeholder="Algo leve, até 2h, suspense…" className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
      {pending && <LoaderCircle className="h-4 w-4 animate-spin text-primary" />}
      <Button variant="ghost" size="icon" title="Limpar intenção" aria-label="Limpar intenção" onClick={()=>{invalidate();setIntent("");}} className={`h-9 w-9 ${intent ? "text-muted-foreground" : "invisible"}`}><X className="h-3 w-3" /></Button>
      <Button variant={ai ? "default" : "ghost"} size="icon" role="switch" aria-checked={ai} aria-label="IA no Match" title="IA no Match" onClick={()=>{invalidate();setAi(v=>!v);}} className={`h-9 w-9 ${ai ? "text-primary-foreground" : "text-foreground"}`}><Sparkles /></Button>
    </div>
    {!ai && pool.length < 2 && <p role="status" className="text-xs text-muted-foreground">{pool.length === 0 ? "Nenhuma indicação elegível neste filtro." : "São necessárias pelo menos 2 indicações elegíveis neste filtro."}</p>}
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    <Button disabled={pending || (!ai && pool.length < 2)} aria-busy={pending} onClick={() => void start()} className="min-h-12 w-full">{solo ? "Iniciar simulação" : "Iniciar Match"}</Button>
  </section>;
}
