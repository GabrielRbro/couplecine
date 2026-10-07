import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, useEffect } from "react";
import { Dices, RotateCcw, X } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { FilterPills, ScrollRow, TogglePill } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { readyPoster } from "@/lib/image-ready";
import type { Reaction } from "@/lib/format";
import {
  isIndicated,
  isWatched,
  useLibrary,
  useSpace,
  type LibraryWork,
  type SpaceInfo,
} from "@/lib/space";

export const Route = createFileRoute("/_authenticated/watch/dice")({
  head: () => ({
    meta: [
      { title: "Sortear — AppCinema" },
      { name: "description", content: "Sorteio ponderado pelas reações do casal." },
      { property: "og:title", content: "Sortear — AppCinema" },
      { property: "og:description", content: "Sorteio ponderado pelas reações do casal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <DicePage />
    </AppShell>
  ),
});

// "Sem resposta" (2) is deliberately different from 😐 (1).
const WEIGHT: Record<Reaction, number> = { fire: 4, like: 3, neutral: 1, dislike: 0 };
const NO_ANSWER = 2;

function weightOf(w: LibraryWork, space: SpaceInfo, includeDislike: boolean) {
  const people = [space.userId, space.partner?.id].filter(Boolean) as string[];
  let total = 0;
  for (const id of people) {
    const r = w.interests.find((i) => i.user_id === id)?.reaction;
    if (r === "dislike" && !includeDislike) return 0;
    total += r ? (r === "dislike" ? 0.5 : WEIGHT[r]) : NO_ANSWER;
  }
  return total;
}

type History = "jointFresh" | "nobody" | "rewatch" | "any";

function DicePage() {
  const { data: space } = useSpace();
  const { data: works = [] } = useLibrary(space?.spaceId);
  const { data: priorWatch = [] } = useQuery({
    queryKey: ["dice-prior-watch", space?.spaceId],
    enabled: Boolean(space?.spaceId),
    queryFn: async (): Promise<{ work_id: string; user_id: string; watched: boolean }[]> => {
      const spaceId = space?.spaceId;
      if (!spaceId) return [];
      const { data, error } = await supabase
        .from("prior_watch_status")
        .select("work_id, user_id, watched");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [kind, setKind] = useState<"all" | "movie" | "tv">("all");
  const [history, setHistory] = useState<History>("jointFresh");
  const [includeDislike, setIncludeDislike] = useState(false);
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<LibraryWork | null>(null);
  const [rolling, setRolling] = useState(false);
  const [flick, setFlick] = useState<{ work: LibraryWork; n: number } | null>(null);
  const rollLock = useRef(false);
  const reduce=useReducedMotion();
  const [ready, setReady] = useState<Set<string>>(new Set());


  const pool = works.filter((w) => {
    if (declined.has(w.id)) return false;
    if (kind !== "all" && w.media_type !== kind) return false;
    if (!isIndicated(w)) return false;
    const watchedTogether = isWatched(w);
    const watchedBefore = priorWatch.some(
      (status) => status.work_id === w.id && status.watched,
    );
    if (history === "jointFresh" && watchedTogether) return false;
    if (history === "nobody" && (watchedTogether || watchedBefore)) return false;
    if (history === "rewatch" && !watchedTogether) return false;
    return space ? weightOf(w, space, includeDislike) > 0 : false;
  });

  useEffect(() => { if (picked && !pool.some((w) => w.id === picked.id)) setPicked(null); }, [kind, history, includeDislike, works, priorWatch, declined, picked]);
  if (!space) return null;

  const roll = async () => {
    if (rollLock.current) return;
    rollLock.current = true;
    const total = pool.reduce((s, w) => s + weightOf(w, space, includeDislike), 0);
    let r = Math.random() * total;
    let choice = pool[pool.length - 1] ?? null;
    for (const w of pool) {
      r -= weightOf(w, space, includeDislike);
      if (r <= 0) {
        choice = w;
        break;
      }
    }
    if (!choice) { rollLock.current = false; return; }
    setRolling(true);
    const order = [...pool].sort(() => Math.random() - 0.5).slice(0, 4);
    const batch = [...new Map([...order, choice].map((w) => [w.id, w])).values()];
    const decoded = await Promise.all(batch.map(async (w) => [w.id, await readyPoster(w.poster_path)] as const));
    setReady(new Set(decoded.filter(([, ok]) => ok).map(([id]) => id)));
    // Shuffle: candidates flick past, decelerating, and land on the weighted choice.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || pool.length === 1) {
      setPicked(choice);
      setRolling(false);
      rollLock.current = false;
      return;
    }
    setRolling(true);
    setPicked(null);
    let i = 0;
    const steps = 11;
    const tick = (delay: number) =>
      window.setTimeout(() => {
        i++;
        if (i < steps) {
          setFlick({ work: order[i % order.length] ?? choice, n: i });
          tick(delay * 1.18);
        } else {
          setFlick(null);
          setPicked(choice);
          setRolling(false);
          rollLock.current = false;
        }
      }, delay);
    setFlick({ work: order[0] ?? choice, n: 0 });
    tick(60);
  };
  const decline = () => {
    if (!picked) return;
    setDeclined((d) => new Set(d).add(picked.id));
    setPicked(null);
  };

  return (
    <div className="px-4 pt-6">
      <h1 className="text-2xl font-semibold">Sortear</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        🔥 pesa mais. 👎 fica de fora, a menos que vocês incluam.
      </p>
      <div className="mt-4 flex items-center justify-between gap-1">
        <FilterPills
          options={
            [
              ["all", "Todos"],
              ["movie", "Filmes"],
              ["tv", "Séries"],
            ] as const
          }
          value={kind}
          onChange={setKind}
        />
        <TogglePill on={includeDislike} onClick={() => setIncludeDislike((v) => !v)}>Incluir 👎</TogglePill>
      </div>
      <ScrollRow className="mt-2">
        <FilterPills
          options={
            [
              ["jointFresh", "Ainda não juntos"],
              ["nobody", "Nenhum dos dois viu"],
              ["rewatch", "Rever juntos"],
              ["any", "Qualquer"],
            ] as const
          }
          value={history}
          onChange={setHistory}
        />

      </ScrollRow>

      {pool.length === 0 && !picked ? (
        <div className="mt-6">
          <EmptyState
            title="Nada para sortear"
            text={
              declined.size
                ? "Vocês recusaram tudo nesta rodada."
                : "Ajuste os filtros ou adicione indicações."
            }
          />
          {declined.size > 0 && (
            <Button
              variant="outline"
              onClick={() => setDeclined(new Set())}
              className="pressable mt-3 min-h-11 w-full rounded-xl"
            >
              <RotateCcw className="h-4 w-4" /> Nova rodada
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="relative mx-auto mt-7 w-56 aspect-[2/3]">
            {flick ? (
              <div className="relative aspect-[2/3]" aria-live="off" aria-label="Embaralhando">
                <div aria-hidden className="match-stack-back match-stack-back-far" />
                <div aria-hidden className="match-stack-back match-stack-back-near" />
                <div
                  key={flick.n}
                  className="dice-card z-[2]"
                  style={{
                    animation: "match-card-arrive 140ms var(--ease-out) both",
                    transform: `rotate(${flick.n % 2 ? 3 : -3}deg)`,
                  }}
                >
                  {ready.has(flick.work.id) ? <Poster eager path={flick.work.poster_path} title={flick.work.title} className="shadow-xl" /> : <div className="match-stack-back" />}
                </div>
              </div>
            ) : picked ? (
              <motion.div key={picked.id} initial={{opacity:0,scale:.96}} animate={{opacity:1,scale:1}} transition={{duration:.2}} className="relative isolate h-full">
                <div aria-hidden className="absolute inset-x-3 top-2 bottom-1 -z-10 rotate-2 rounded-xl border border-border bg-secondary" />
                <Link
                  key={picked.id}
                  to="/work/$id"
                  params={{ id: picked.id }}
                  className="match-picked pressable relative block h-full overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                >
                  {ready.has(picked.id) ? <Poster eager path={picked.poster_path} title={picked.title} /> : <div className="relative aspect-[2/3]"><div className="match-stack-back" /></div>}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/80 to-transparent px-3 pb-4 pt-12"><p className="text-center text-sm font-semibold">{picked.title}</p><p className="mt-1 text-center text-xs text-muted-foreground">{picked.release_year} · {picked.media_type === "tv" ? "Série" : "Filme"}</p></div>
                </Link>
              </motion.div>
            ) : (
              <div className="relative aspect-[2/3]" aria-hidden>
                <div className="match-stack-back match-stack-back-far" />
                <div className="match-stack-back match-stack-back-near" />
                <div className="match-stack-back z-[2]" />
              </div>
            )}
          </div>
          <motion.div layout className="mx-auto mt-6 grid h-14 w-full max-w-sm grid-cols-[112px_minmax(0,1fr)] gap-2">
            <div className="relative"><AnimatePresence>{picked && <motion.div key="decline" initial={{opacity:0,y:6,scale:.95}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:6,scale:.95}} transition={{duration:reduce ? .01 : .18}}>
              <Button
                variant="outline"
                onClick={decline}
                disabled={!picked || rolling}
                aria-label="Recusar nesta rodada"
                className="pressable min-h-14 w-full rounded-2xl px-2"
              >
                <X className="h-4 w-4" /> Hoje não
              </Button>
            </motion.div>}</AnimatePresence></div>
            <motion.div layout className="w-full"><Button
              onClick={roll}
              disabled={pool.length === 0 || rolling}
              className="pressable min-h-14 w-full rounded-2xl font-semibold"
            >
              <Dices
                className={`h-5 w-5 transition-transform duration-200 ${rolling ? "rotate-180" : ""}`}
              />{" "}
              <AnimatePresence mode="wait" initial={false}><motion.span key={picked ? "again" : "start"} initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:.12}}>{picked ? "Sortear de novo" : "Sortear"}</motion.span></AnimatePresence>
            </Button></motion.div>
          </motion.div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {pool.length} obras no sorteio
            {declined.size ? ` · ${declined.size} recusadas nesta rodada` : ""}
          </p>
        </>
      )}
    </div>
  );
}
