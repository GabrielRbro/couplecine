import { useEffect, useRef, useState } from "react";
import { Dices, Heart, RotateCcw, Undo2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MatchWinner } from "./MatchWinner";
import { nextHighlight, shuffled, useMatchLocal } from "@/lib/match-local";
import { Button } from "@/components/ui/button";
import { Poster } from "./MediaCard";
import { readyPoster } from "@/lib/image-ready";
import { isWatched, type LibraryWork } from "@/lib/space";

/** Deliberately has no database or real Match service imports. */
export function MatchSimulator({ works, onExit, storageKey }: { works: LibraryWork[]; onExit: () => void; storageKey: string }) {
  const [state, setState, hydrated] = useMatchLocal<{ order: string[]; votes: { id: string; liked: boolean }[]; finished: boolean; chosen: string | null; visited: string[]; spinning: string | null; rolling: boolean; limit?: number; extendedAfterGoal?: boolean }>(storageKey, { order: [], votes: [], finished: false, chosen: null, visited: [], spinning: null, rolling: false });
  const { votes, finished, chosen, spinning } = state;
  const eligible = works.filter((w) => !isWatched(w) && !w.interests.some((i) => i.reaction === "dislike"));
  useEffect(() => { if (hydrated && !state.order.length && eligible.length) setState((old) => ({ ...old, order: shuffled(eligible.map((w) => w.id)),limit:Math.min(eligible.length,10+Math.floor(Math.random()*6)),extendedAfterGoal:false })); }, [hydrated, works]);
  const deck = state.order.map((id) => works.find((w) => w.id === id)).filter((w): w is LibraryWork => Boolean(w));
  const setVotes = (update: (old: typeof votes) => typeof votes) => setState((old) => ({ ...old, votes: update(old.votes) }));
  const setFinished = (value: boolean) => setState((old) => ({ ...old, finished: value }));
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [isNewWinner, setIsNewWinner] = useState(false);
  const lock = useRef(false);
  const current = deck[votes.length];
  const results = deck.filter((w) => votes.some((v) => v.id === w.id && v.liked));
  const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : ms));
  async function vote(liked: boolean) {
    if (lock.current || !current) return;
    lock.current = true;
    setDirection(liked ? "right" : "left");
    await delay(330);
    setVotes((old) => [...old, { id: current.id, liked }]);
    setDirection(null);
    lock.current = false;
    const voted = votes.length + 1;
    const limit = state.limit ?? Math.min(15,deck.length);
    if (voted >= limit) {
      const likes = votes.filter((v)=>v.liked).length + Number(liked);
      if (limit >= deck.length || (likes >= 3 && state.extendedAfterGoal)) setFinished(true);
      else {
        const extra = likes >= 3 ? Math.floor(Math.random()*9) : 5+Math.floor(Math.random()*6);
        const newLimit=Math.min(deck.length,limit+extra);
        setState((old)=>({...old,limit:newLimit,extendedAfterGoal:likes >= 3,finished:newLimit===limit}));
      }
    }
  }
  async function roll() {
    if (lock.current || !results.length) return;
    setIsNewWinner(false);
    lock.current = true;
    setState((old) => ({ ...old, chosen: null, spinning: null, rolling: true }));
    await delay(180);
    const selected = results[Math.floor(Math.random() * results.length)];
    if (!selected) { lock.current = false; return; }
    const visited = [...state.visited];
    for (let i = 0; i < 12; i++) {
      const next = nextHighlight(results.map((w) => w.id), visited);
      if (!next) break;
      visited.push(next);
      setState((old) => ({ ...old, spinning: next, visited: visited.slice(-3) }));
      await delay(55 + i * 14);
    }
    setState((old) => ({ ...old, spinning: null, chosen: selected.id, rolling: false }));
    setIsNewWinner(true);
    lock.current = false;
  }
  // An interrupted roulette resumes as a fresh local roll; votes and the winner remain untouched.
  useEffect(() => { if (hydrated && state.rolling && !lock.current) { setState((old) => ({ ...old, rolling: false, spinning: null })); void roll(); } }, [hydrated]);
  const restart = () => { if (lock.current) return; setIsNewWinner(false); setState({ order: shuffled(eligible.map((w) => w.id)), votes: [], finished: false, chosen: null, spinning: null, rolling: false, visited: [],limit:Math.min(eligible.length,10+Math.floor(Math.random()*6)),extendedAfterGoal:false }); };
  const winner = results.find((w) => w.id === chosen);
  if (!hydrated) return null;
  return <div className="px-4 pt-6 pb-8">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><div><h1 className="text-2xl font-semibold">Match</h1><p className="mt-1 text-xs text-primary">Modo de teste</p></div><Button variant="ghost" size="icon" aria-label="Sair do teste" onClick={onExit} className="h-11 w-11"><X /></Button></div>
    {winner && <MatchWinner key={winner.id} work={winner} onRoll={roll} onRestart={restart} isNew={isNewWinner} />}{finished ? <section className="mt-6 flex flex-col min-h-[400px]"><h2 className="text-xl font-semibold">{results.length} {results.length === 1 ? "match simulado" : "matches simulados"}</h2><p className="mt-1 text-xs text-muted-foreground">Somente suas escolhas neste teste.</p>
      <div className="mt-4 grid grid-cols-3 gap-3 flex-1">{results.map((w) => <Link key={w.id} {...(w.id.startsWith("tmdb-") ? { to: "/title/$mediaType/$tmdbId" as const, params: { mediaType: w.media_type, tmdbId: String((w as LibraryWork & { tmdb_id: number }).tmdb_id) } } : { to: "/work/$id" as const, params: { id: w.id } })} className={`block rounded-xl ${spinning === w.id || false ? "match-picked ring-2 ring-primary" : ""}`}><div data-match-poster={w.id}><Poster path={w.poster_path} title={w.title} /></div><p className="mt-1 line-clamp-2 text-xs">{w.title}</p></Link>)}</div>
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="px-4 py-3 space-y-3">
          <Button variant="outline" className="min-h-12 w-full" disabled={!results.length || state.rolling} onClick={roll}><Dices />Sortear entre os matches</Button>
          {chosen && <p role="status" className="text-center text-sm">A sorte escolheu {results.find((w) => w.id === chosen)?.title}</p>}
          <Button variant="ghost" className="min-h-11 w-full" onClick={restart}><RotateCcw />Reiniciar teste</Button>
        </div>
      </div>
    </section> : current ? <>
      <div className="match-stack mx-auto mt-7"><div className="match-stack-back match-stack-back-far" /><div className="match-stack-back match-stack-back-near" /><div key={current.id} data-exit-direction={direction ?? undefined} className={`match-stack-current ${direction === "left" ? "match-card-exit-left" : direction === "right" ? "match-card-exit-right" : "match-card-arrive"}`}><SimulatorPoster work={current} /></div></div>
      <p className="mt-4 text-center font-semibold">{current.title}</p>
      <div className="mt-5 flex justify-center gap-6"><Button variant="outline" aria-label="Não hoje" disabled={Boolean(direction)} onClick={() => vote(false)} className="h-16 w-16 rounded-full"><X className="h-6 w-6" /></Button><Button aria-label="Quero ver hoje" disabled={Boolean(direction)} onClick={() => vote(true)} className="h-16 w-16 rounded-full"><Heart className="h-6 w-6" /></Button></div>
      <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="outline" disabled={!votes.length || Boolean(direction)} onClick={() => { if (!lock.current) setVotes((old) => old.slice(0, -1)); }}><Undo2 />Desfazer último</Button><Button variant="secondary" disabled={Boolean(direction)} onClick={() => setFinished(true)}>Encerrar teste</Button></div>
    </> : <p className="mt-8 text-sm text-muted-foreground">Nenhuma indicação elegível para simular.</p>}
  </div>;
}

function SimulatorPoster({ work }: { work: LibraryWork }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { let active = true; readyPoster(work.poster_path).then((ok) => { if (active) setReady(ok); }); return () => { active = false; }; }, [work.poster_path]);
  return ready ? <Poster eager path={work.poster_path} title={work.title} /> : <div className="match-stack-back" />;
}
