import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterPills } from "./ui";
import { materializeMatchCandidates } from "@/lib/catalog.functions";
import { refineMatch } from "@/lib/ai.functions";
import { isIndicated, type LibraryWork } from "@/lib/space";

export function MatchPreparation({ works, spaceId, onStart, solo = false }: { works: LibraryWork[]; spaceId: string; onStart: (ids: string[], extras: LibraryWork[]) => void; solo?: boolean }) {
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
  const ids = refined ?? pool.map((w) => w.id);
  async function run() {
    if (!intent.trim() || pending) return;
    setPending(true);
    const version = ++request.current;
    try {
      const result = await refine({ data: { spaceId, kind: kind === "movie" ? "movie" : kind === "tv" ? "tv" : "all", query:intent.trim(), ids:pool.slice(0,40).map((w) => w.id) } });
      if (version === request.current) { setRefined(result.refined ? result.ids : null); setExternal(result.external);setMessage(result.reason ?? "Conjunto refinado"); }
    } catch { if (version === request.current) {setExternal([]);setRefined(null);setMessage("IA indisponível · o Match normal continua disponível.");} }
    finally { setPending(false); }
  }
  return <section className="mt-6 space-y-3">
    <FilterPills options={[["all","Todos"],["movie","Filmes"],["tv","Séries"]]} value={kind} onChange={(v) => {if (v === kind) return; request.current++;setKind(v);setRefined(null);setExternal([]);setMessage(null);}} />
    <input aria-label="Intenção para o Match" value={intent} maxLength={180} onChange={(e) => {request.current++;setIntent(e.target.value);setRefined(null);setExternal([]);setMessage(null);}} placeholder="Algo leve, até 2h, suspense…" className="min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm" />
    <Button variant="outline" onClick={run} disabled={pending || intent.trim().length < 3 || pool.length === 0} className="min-h-11 w-full"><Sparkles className={pending ? "animate-pulse" : ""} />{pending ? "Refinando candidatos…" : "Refinar com IA"}</Button>
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    <Button disabled={pending || ids.length + external.length < 2} onClick={async () => {
      setPending(true);
      try {
        const extras: LibraryWork[] = external.map((w) => ({ id:`tmdb-${w.mediaType}-${w.tmdbId}`, tmdb_id:w.tmdbId, voteAverage:w.voteAverage, title:w.title,original_title:w.originalTitle,media_type:w.mediaType,poster_path:w.posterPath,backdrop_path:w.backdropPath,release_year:w.year,runtime_minutes:null,genres:w.genres ?? [],activity_at:"",created_at:"",interests:[],ratings:[],indications:[],joint_watch_sessions:[],watch:null,series_states:[],work_metadata_cache:[] }));
        if (!solo && external.length) {
          const extraIds = await materialize({data:{spaceId,items:external.map((w) => ({mediaType:w.mediaType,tmdbId:w.tmdbId}))}});
          onStart([...ids,...extraIds],extras.map((w,i)=>({...w,id:extraIds[i] ?? w.id})));
        } else onStart(ids,extras);
      } catch { setMessage("Não foi possível preparar candidatos. Tente de novo."); }
      finally { setPending(false); }
    }} className="min-h-12 w-full">{solo ? "Iniciar simulação" : "Iniciar Match"}</Button>
  </section>;
}