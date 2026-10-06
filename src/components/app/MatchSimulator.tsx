import { useMemo, useRef, useState } from "react";
import { Dices, Heart, RotateCcw, Undo2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Poster } from "./MediaCard";
import { readyPoster } from "@/lib/image-ready";
import { isIndicated, isWatched, type LibraryWork } from "@/lib/space";

/** Deliberately has no database or real Match service imports. */
export function MatchSimulator({ works, onExit }: { works: LibraryWork[]; onExit: () => void }) {
  const deck = useMemo(() => works.filter((w) => isIndicated(w) && !isWatched(w) && !w.interests.some((i) => i.reaction === "dislike")).slice(0, 15), [works]);
  const [votes, setVotes] = useState<{ id: string; liked: boolean }[]>([]);
  const [finished, setFinished] = useState(false);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [spinning, setSpinning] = useState<string | null>(null);
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
    setChosen(null);setSpinning(null);
    const selected = results[Math.floor(Math.random() * results.length)];
    if (!selected) { lock.current = false; return; }
    let previous = "";
    for (let i = 0; i < 12; i++) {
      const options = results.filter((w) => w.id !== previous);
      const next = options[Math.floor(Math.random()*options.length)] ?? selected;
      previous = next.id; setSpinning(next.id); await delay(55 + i * 14);
    }
    setSpinning(null); setChosen(selected.id); lock.current = false;
  }
  const restart = () => { if (lock.current) return; setVotes([]); setFinished(false); setChosen(null); };
  return <div className="px-4 pt-6 pb-8">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><div><h1 className="text-2xl font-semibold">Match</h1><p className="mt-1 text-xs text-primary">Modo de teste</p></div><Button variant="ghost" size="icon" aria-label="Sair do teste" onClick={onExit} className="h-11 w-11"><X /></Button></div>
    {finished ? <section className="mt-6"><h2 className="text-xl font-semibold">{results.length} {results.length === 1 ? "match simulado" : "matches simulados"}</h2><p className="mt-1 text-xs text-muted-foreground">Somente suas escolhas neste teste.</p>
      <div className="mt-4 grid grid-cols-3 gap-3">{results.map((w) => <Link key={w.id} to="/work/$id" params={{ id: w.id }} className={`block rounded-xl ${spinning === w.id || chosen === w.id ? "match-picked ring-2 ring-primary" : ""}`}><Poster path={w.poster_path} title={w.title} /><p className="mt-1 line-clamp-2 text-xs">{w.title}</p></Link>)}</div>
      <Button variant="outline" className="mt-5 min-h-12 w-full" disabled={!results.length || Boolean(spinning)} onClick={roll}><Dices />Sortear entre os matches</Button>
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