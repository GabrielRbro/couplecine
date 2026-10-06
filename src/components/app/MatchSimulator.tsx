import { useRef, useState } from "react";
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
  const [state, setState, hydrated] = useMatchLocal<{ order: string[]; votes: { id: string; liked: boolean }[]; finished: boolean; chosen: string | null; visited: string[]; spinning: string | null; rolling: boolean }>(storageKey, { order: [], votes: [], finished: false, chosen: null, visited: [], spinning: null, rolling: false });
  const { votes, finished, chosen, spinning } = state;
  const eligible = works.filter((w) => !isWatched(w) && !w.interests.some((i) => i.reaction === "dislike"));
  useEffect(() => { if (hydrated && !state.order.length && eligible.length) setState((old) => ({ ...old, order: shuffled(eligible.map((w) => w.id)).slice(0,15) })); }, [hydrated, works]);
  const deck = state.order.map((id) => works.find((w) => w.id === id)).filter((w): w is LibraryWork => Boolean(w));
  const setVotes = (update: (old: typeof votes) => typeof votes) => setState((old) => ({ ...old, votes: update(old.votes) }));
  const setFinished = (value: boolean) => setState((old) => ({ ...old, finished: value }));
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
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
    if (votes.length + 1 >= deck.length) setFinished(true);
  }
  async function roll() {
    if (lock.current || !results.length) return;
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
    lock.current = false;
  }
  // An interrupted roulette resumes as a fresh local roll; votes and the winner remain untouched.
  useEffect(() => { if (hydrated && state.rolling && !lock.current) { setState((old) => ({ ...old, rolling: false, spinning: null })); void roll(); } }, [hydrated]);
  const restart = () => { if (lock.current) return; setState({ order: shuffled(eligible.map((w) => w.id)).slice(0,15), votes: [], finished: false, chosen: null, spinning: null, rolling: false, visited: [] }); };
  const winner = results.find((w) => w.id === chosen);
  if (!hydrated) return null;
  return <div className="px-4 pt-6 pb-8">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><div><h1 className="text-2xl font-semibold">Match</h1><p className="mt-1 text-xs text-primary">Modo de teste</p></div><Button variant="ghost" size="icon" aria-label="Sair do teste" onClick={onExit} className="h-11 w-11"><X /></Button></div>
    {winner ? <MatchWinner work={winner} onRoll={roll} onRestart={restart} /> : finished ? <section className="mt-6"><h2 className="text-xl font-semibold">{results.length} {results.length === 1 ? "match simulado" : "matches simulados"}</h2><p className="mt-1 text-xs text-muted-foreground">Somente suas escolhas neste teste.</p>
      <div className="mt-4 grid grid-cols-3 gap-3">{results.map((w) => <Link key={w.id} {...(w.id.startsWith("tmdb-") ? { to: "/title/$mediaType/$tmdbId" as const, params: { mediaType: w.media_type, tmdbId: String((w as LibraryWork & { tmdb_id: number }).tmdb_id) } } : { to: "/work/$id" as const, params: { id: w.id } })} className={`block rounded-xl ${spinning === w.id || false ? "match-picked ring-2 ring-primary" : ""}`}><Poster path={w.poster_path} title={w.title} /><p className="mt-1 line-clamp-2 text-xs">{w.title}</p></Link>)}</div>
      <Button variant="outline" className="mt-5 min-h-12 w-full" disabled={!results.length || state.rolling} onClick={roll}><Dices />Sortear entre os matches</Button>
      {chosen && <p role="status" className="mt-3 text-center text-sm">A sorte escolheu {results.find((w) => w.id === chosen)?.title}</p>}
      <Button variant="ghost" className="mt-3 min-h-11 w-full" onClick={restart}><RotateCcw />Reiniciar teste</Button>
    </section> : current ? <>
      <div className="match-stack mx-auto mt-7"><div className="match-stack-back match-stack-back-far" /><div className="match-stack-back match-stack-back-near" /><div key={current.id} data-exit-direction={direction ?? undefined} className={`match-stack-current ${direction === "left" ? "match-card-exit-left" : direction === "right" ? "match-card-exit-right" : "match-card-arrive"}`}><SimulatorPoster work={current} /></div></div>
      <p className="mt-4 text-center font-semibold">{current.title}</p>
      <div className="mt-5 flex justify-center gap-6"><Button variant="outline" aria-label="Não hoje" disabled={Boolean(direction)} onClick={() => vote(false)} className="h-16 w-16 rounded-full"><X className="h-6 w-6" /></Button><Button aria-label="Quero ver hoje" disabled={Boolean(direction)} onClick={() => vote(true)} className="h-16 w-16 rounded-full"><Heart className="h-6 w-6" /></Button></div>
      <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="outline" disabled={!votes.length || Boolean(direction)} onClick={() => { if (!lock.current) setVotes((old) => old.slice(0, -1)); }}><Undo2 />Desfazer último</Button><Button variant="secondary" disabled={Boolean(direction)} onClick={() => setFinished(true)}>Encerrar teste</Button></div>
    </> : <p className="mt-8 text-sm text-muted-foreground">Nenhuma indicação elegível para simular.</p>}
  </div>;
}

import { useEffect } from "react";
function SimulatorPoster({ work }: { work: LibraryWork }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { let active = true; readyPoster(work.poster_path).then((ok) => { if (active) setReady(ok); }); return () => { active = false; }; }, [work.poster_path]);
  return ready ? <Poster eager path={work.poster_path} title={work.title} /> : <div className="match-stack-back" />;
}