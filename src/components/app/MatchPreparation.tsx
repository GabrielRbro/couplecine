import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterPills } from "./ui";
import { materializeMatchCandidates, getSoloMatchCandidates } from "@/lib/catalog.functions";
import { refineMatch } from "@/lib/ai.functions";
import { isIndicated, type LibraryWork } from "@/lib/space";

export function MatchPreparation({ works, spaceId, onStart, solo = false }: { works: LibraryWork[]; spaceId: string; onStart: (ids: string[], extras: LibraryWork[]) => void; solo?: boolean }) {
  const [ai,setAi] = useState(false);
  const [base,setBase] = useState<Awaited<ReturnType<typeof getSoloMatchCandidates>>>([]);
  const [basePending,setBasePending] = useState(false);
  const fetchBase = useServerFn(getSoloMatchCandidates);
  const [kind,setKind] = useState("all");
  const [intent,setIntent] = useState("");
  const [pending,setPending] = useState(false);
  const [refined,setRefined] = useState<string[] | null>(null);
  const [external,setExternal] = useState<Awaited<ReturnType<typeof refineMatch>>["external"]>([]);
  const materialize = useServerFn(materializeMatchCandidates);
  const [message,setMessage] = useState<string | null>(null);
  const request = useRef(0);
  const refine = useServerFn(refineMatch);
  const pool = works.filter((w) => isIndicated(w) && !w.interests.some((i) => i.reaction === "dislike") && (kind === "all" || w.media_type === kind));
  const ids = ai ? refined ?? pool.map((w) => w.id) : pool.map((w) => w.id);
  useEffect(() => {
    if (!solo) return;
    let active=true;setBase([]);setBasePending(true);
    fetchBase({data:{spaceId,kind:kind === "tv" ? "tv" : kind === "movie" ? "movie" : "all"}}).then(items=>{if(active)setBase(items);}).catch(()=>{if(active)setMessage("Não foi possível carregar candidatos do catálogo.");}).finally(()=>{if(active)setBasePending(false);});
    return ()=>{active=false;};
  },[solo,spaceId,kind]);
  useEffect(() => {
    if (!ai) return;
    const timer=window.setTimeout(()=>{void run();},700);
    return ()=>window.clearTimeout(timer);
  },[ai,intent,kind]);
  async function run() {
    if (!ai || pending) return;
    setPending(true);
    const version = ++request.current;
    try {
      const result = await refine({ data: { spaceId, kind: kind === "movie" ? "movie" : kind === "tv" ? "tv" : "all", query:intent.trim().length >= 3 ? intent.trim() : "Escolha variada para assistir hoje", ids:pool.slice(0,40).map((w) => w.id) } });
      if (version === request.current && ai) { setRefined(result.refined ? result.ids : null); setExternal(result.external);setMessage(result.reason); }
    } catch { if (version === request.current && ai) {setExternal([]);setRefined(null);setMessage("IA indisponível · o Match normal continua disponível.");} }
    finally { setPending(false); }
  }
  return <section className="mt-6 space-y-3">
    <FilterPills options={[["all","Todos"],["movie","Filmes"],["tv","Séries"]]} value={kind} onChange={(v) => {if (v === kind) return; request.current++;setKind(v);setRefined(null);setExternal([]);setMessage(null);}} />
    <div className="flex min-w-0 items-center gap-1 rounded-xl border border-border bg-card pl-3 pr-1">
      <input aria-label="Intenção para o Match" value={intent} maxLength={180} onChange={(e) => {request.current++;setIntent(e.target.value);setRefined(null);setExternal([]);setMessage(null);}} placeholder="Algo leve, até 2h, suspense…" className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
      {pending && <LoaderCircle className="h-4 w-4 animate-spin text-primary" />}
      <Button variant="ghost" size="icon" title="Limpar intenção" aria-label="Limpar intenção" onClick={()=>setIntent("")} className={`h-9 w-9 ${intent ? "text-muted-foreground" : "invisible"}`}><X className="h-3 w-3" /></Button>
      <Button variant={ai ? "default" : "ghost"} size="icon" role="switch" aria-checked={ai} aria-label="IA no Match" title="IA no Match" onClick={()=>{request.current++;setAi(v=>!v);setExternal([]);setRefined(null);setMessage(null);}} className={`h-9 w-9 ${ai ? "text-primary-foreground" : "text-foreground"}`}><Sparkles /></Button>
    </div>
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    <Button disabled={pending || basePending || ids.length + (ai ? external.length : base.length) < 2} onClick={async () => {
      setPending(true);
      try {
        const selected = ai ? external : solo ? base : [];
        const extras: LibraryWork[] = selected.map((w) => ({ id:`tmdb-${w.mediaType}-${w.tmdbId}`, tmdb_id:w.tmdbId, voteAverage:w.voteAverage, title:w.title,original_title:w.originalTitle,media_type:w.mediaType,poster_path:w.posterPath,backdrop_path:w.backdropPath,release_year:w.year,runtime_minutes:null,genres:w.genres ?? [],activity_at:"",created_at:"",interests:[],ratings:[],indications:[],joint_watch_sessions:[],watch:null,series_states:[],work_metadata_cache:[] }));
        if (!solo && external.length) {
          const extraIds = await materialize({data:{spaceId,items:external.map((w) => ({mediaType:w.mediaType,tmdbId:w.tmdbId}))}});
          onStart([...ids,...extraIds],extras.map((w,i)=>({...w,id:extraIds[i] ?? w.id})));
        } else onStart(ids,extras);
      } catch { setMessage("Não foi possível preparar candidatos. Tente de novo."); }
      finally { setPending(false); }
    }} className="min-h-12 w-full">{solo ? "Iniciar simulação" : "Iniciar Match"}</Button>
  </section>;
}