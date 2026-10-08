import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { Dices, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOverlayHistory } from "@/lib/overlay";
import { Poster } from "./MediaCard";
import { formatRuntime, tmdbImage } from "@/lib/format";
import type { LibraryWork } from "@/lib/space";

export function MatchWinner({ work, onRoll, onRestart, onClose, onOpen, isNew = false }: { work: LibraryWork; onRoll: () => void; onRestart: () => void; onClose?: () => void; onOpen?: () => void; isNew?: boolean }) {
  const reduce = useReducedMotion();
  const [arrived,setArrived]=useState(!isNew);
  const [closing,setClosing]=useState(false);
  const [geometry,setGeometry]=useState<{from:{left:number;top:number;width:number;height:number};to:{left:number;top:number;width:number;height:number}}|null>(null);
  useLayoutEffect(()=>{
    const width=Math.min(224,window.innerWidth*.54),height=width*1.5;
    const to={left:(window.innerWidth-width)/2,top:Math.max(48,(window.innerHeight-height-240)/2),width,height};
    const source=document.querySelector(`[data-match-poster="${work.id}"]`)?.getBoundingClientRect();
    setGeometry({from:source ? {left:source.left,top:source.top,width:source.width,height:source.height} : to,to});
    
  },[work.id]);
  useOverlayHistory(true,()=>onClose?.());
  const rewind=()=>{if(closing)return;setClosing(true);setArrived(false);window.setTimeout(onRoll,reduce ? 1 : 240);};
  const target = work.id.startsWith("tmdb-") ? { to: "/title/$mediaType/$tmdbId" as const, params: { mediaType: work.media_type, tmdbId: String((work as LibraryWork & { tmdb_id: number }).tmdb_id) } } : { to: "/work/$id" as const, params: { id: work.id } };
  const seasons=work.work_metadata_cache[0]?.seasons?.length;
  const rating=(work as LibraryWork & {voteAverage?:number}).voteAverage;
  const metadata=[work.release_year,work.media_type==="tv" ? "Série" : "Filme",work.media_type==="tv" ? seasons ? `${seasons} temp.` : null : formatRuntime(work.runtime_minutes),work.genres.slice(0,2).join(" · "),rating ? `★ ${rating.toFixed(1)} TMDB` : null].filter(Boolean).join(" · ");
  if(!geometry || typeof document==="undefined")return null;
  return createPortal(<section role="dialog" aria-modal="true" aria-label={`Escolhido: ${work.title}`} className="fixed inset-0 z-[150] overflow-y-auto overscroll-contain">
    <Button variant="ghost" size="icon" aria-label="Fechar resultado" onClick={onClose} className="fixed right-4 top-[max(16px,env(safe-area-inset-top))] z-30 h-11 w-11 rounded-full bg-background/50"><X /></Button>
    <motion.div className="pointer-events-none fixed inset-0 nav-glass" initial={{opacity:isNew ? 0 : 1}} animate={{opacity:closing ? 0 : 1}} transition={{duration:reduce ? .01 : .4}} />
    <motion.div className="pointer-events-none fixed z-10 art-edge rounded-xl" initial={reduce || !isNew ? geometry.to : geometry.from} animate={closing ? {opacity:0} : {...geometry.to,opacity:1}} transition={{duration:reduce ? .01 : closing ? .22 : .5,ease:[.22,1,.36,1]}} onAnimationComplete={()=>{if(!closing)setArrived(true);}}><Poster eager path={work.poster_path} title={work.title} /></motion.div>
    <motion.div className="relative z-20 mx-auto max-w-sm px-5 pb-[max(env(safe-area-inset-bottom),24px)] text-center" style={{paddingTop:geometry.to.top+geometry.to.height+20}} initial={{opacity:isNew ? 0 : 1,y:isNew ? 10 : 0}} animate={{opacity:arrived && !closing ? 1 : 0,y:arrived ? 0 : 10}} transition={{duration:.2}}>
    <h2 className="text-xl font-semibold">{work.title}</h2>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{metadata}</p>
    <div className="mt-5 space-y-2">
      <Button asChild className="min-h-12 w-full"><Link {...target} onClick={onOpen}><Play />Assistir</Link></Button>
      <Button variant="secondary" disabled={closing} className="min-h-12 w-full" onClick={rewind}><Dices />Sortear de novo</Button>
      <Button variant="ghost" className="min-h-12 w-full" onClick={onRestart}><RotateCcw />Reiniciar</Button>
    </div>
    </motion.div>
  </section>,document.body);
}