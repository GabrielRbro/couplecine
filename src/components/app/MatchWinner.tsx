import { Link } from "@tanstack/react-router";
import { Dices, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Poster } from "./MediaCard";
import { tmdbImage } from "@/lib/format";
import type { LibraryWork } from "@/lib/space";

export function MatchWinner({ work, onRoll, onRestart }: { work: LibraryWork; onRoll: () => void; onRestart: () => void }) {
  const art = tmdbImage(work.backdrop_path ?? work.poster_path, "w780");
  const target = work.id.startsWith("tmdb-") ? { to: "/title/$mediaType/$tmdbId" as const, params: { mediaType: work.media_type, tmdbId: String((work as LibraryWork & { tmdb_id: number }).tmdb_id) } } : { to: "/work/$id" as const, params: { id: work.id } };
  return <section className="relative isolate mt-5 overflow-hidden rounded-2xl px-4 py-7">
    {art && <img src={art} alt="" className="absolute inset-0 -z-20 h-full w-full scale-110 object-cover blur-2xl" />}
    <div className="absolute inset-0 -z-10 bg-background/65" />
    <div className="mx-auto w-48 match-picked"><Poster eager path={work.poster_path} title={work.title} /></div>
    <h2 className="mt-5 text-center text-xl font-semibold">{work.title}</h2>
    <div className="mt-5 space-y-2">
      <Button asChild className="min-h-12 w-full"><Link {...target}><Play />Assistir</Link></Button>
      <Button variant="secondary" className="min-h-12 w-full" onClick={onRoll}><Dices />Sortear de novo</Button>
      <Button variant="ghost" className="min-h-12 w-full" onClick={onRestart}><RotateCcw />Reiniciar</Button>
    </div>
  </section>;
}