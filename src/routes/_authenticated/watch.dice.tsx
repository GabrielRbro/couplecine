import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, useEffect } from "react";
import { Check, Dices, Film, Grid2X2, Monitor, RotateCcw, Shuffle, Sparkles, Users, X } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { readyPoster } from "@/lib/image-ready";
import type { Reaction } from "@/lib/format";
import { isIndicated, isWatched, useLibrary, useSpace, type LibraryWork, type SpaceInfo } from "@/lib/space";

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
      const { data, error } = await supabase.from("prior_watch_status").select("work_id, user_id, watched");
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
  const reduce = useReducedMotion();
  const [ready, setReady] = useState<Set<string>>(new Set());

  const pool = works.filter((w) => {
    if (declined.has(w.id)) return false;
    if (kind !== "all" && w.media_type !== kind) return false;
    if (history !== "rewatch" && !isIndicated(w)) return false;
    const watchedTogether = isWatched(w);
    const watchedBefore = priorWatch.some((status) => status.work_id === w.id && status.watched);
    if (
      history === "jointFresh" &&
      watchedTogether &&
      !(w.media_type === "tv" && w.series_states[0]?.status === "watching")
    )
      return false;
    if (history === "nobody" && (watchedTogether || watchedBefore)) return false;
    if (history === "rewatch" && !watchedTogether) return false;
    return space ? weightOf(w, space, includeDislike) > 0 : false;
  });

  useEffect(() => {
    if (picked && !pool.some((w) => w.id === picked.id)) setPicked(null);
  }, [kind, history, includeDislike, works, priorWatch, declined, picked]);
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
    if (!choice) {
      rollLock.current = false;
      return;
    }
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

      {/* Approved filter composition: full-width segmented type selector;
          centered, narrower history pills over a recessed child card with only bottom corners. */}
      <div
        role="group"
        aria-label="Tipo de obra"
        className="mt-4 grid grid-cols-3 overflow-hidden rounded-full border border-border bg-card p-1"
      >
        {(
          [
            ["all", "Todos", Grid2X2],
            ["movie", "Filmes", Film],
            ["tv", "Séries", Monitor],
          ] as const
        ).map(([value, label, Icon], index) => (
          <Button
            key={value}
            variant="ghost"
            aria-pressed={kind === value}
            onClick={() => {
              if (kind !== value) setKind(value);
            }}
            className={`relative h-11 min-w-0 rounded-full px-2 text-xs ${kind === value ? "bg-primary text-background hover:bg-primary/90 hover:text-background" : "text-muted-foreground hover:bg-secondary"} ${index > 0 && kind !== value ? "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-px before:bg-border" : ""}`}
          >
            <Icon aria-hidden className="shrink-0" />
            {label}
          </Button>
        ))}
      </div>
      <div className="relative isolate mx-auto mt-2 w-[89%]">
        <div
          role="group"
          aria-label="Histórico"
          className="relative z-10 grid grid-cols-[1.25fr_1fr_.86fr_1.09fr] gap-1"
        >
          {(
            [
              ["jointFresh", "Não juntos", Users],
              ["nobody", "Inéditos", Sparkles],
              ["rewatch", "Rever", RotateCcw],
              ["any", "Qualquer", Shuffle],
            ] as const
          ).map(([value, label, Icon]) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={history === value}
              onClick={() => {
                if (history !== value) setHistory(value);
              }}
              className={`h-11 min-w-0 gap-1 rounded-full border px-1 text-[10px] [&_svg]:size-3 ${history === value ? "border-primary/40 bg-accent text-primary hover:bg-accent hover:text-primary" : "border-border bg-card text-muted-foreground hover:bg-secondary"}`}
            >
              <Icon aria-hidden className="shrink-0" />
              {label}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          role="checkbox"
          aria-label="Incluir 👎🏻"
          aria-checked={includeDislike}
          onClick={() => setIncludeDislike((v) => !v)}
          className="relative mx-auto -mt-4 grid h-[60px] w-[94%] grid-cols-[minmax(0,1fr)_auto] items-center rounded-t-none rounded-b-xl border border-t-0 border-border bg-card px-3 pb-1 pt-5 text-left text-[11px] font-normal text-muted-foreground hover:bg-secondary"
        >
          <span className="min-w-0">Incluir 👎🏻</span>
          <span
            aria-hidden
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-primary/60 ${includeDislike ? "bg-primary text-background" : "bg-primary/10 text-primary"}`}
          >
            {includeDislike && <Check className="!size-3" />}
          </span>
        </Button>
      </div>

      {pool.length === 0 && !picked ? (
        <div className="mt-6">
          <EmptyState
            title="Nada para sortear"
            text={declined.size ? "Vocês recusaram tudo nesta rodada." : "Ajuste os filtros ou adicione indicações."}
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
          <div className="relative mx-auto mt-10 w-60 aspect-[2/3]">
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
                  {ready.has(flick.work.id) ? (
                    <Poster eager path={flick.work.poster_path} title={flick.work.title} className="shadow-xl" />
                  ) : (
                    <div className="match-stack-back" />
                  )}
                </div>
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                {picked ? (
                  <motion.div
                    key={picked.id}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97, y: 5 }}
                    transition={{ duration: 0.16 }}
                    className="relative isolate h-full"
                  >
                    <div
                      aria-hidden
                      className="absolute inset-x-3 top-2 bottom-1 -z-10 rotate-2 rounded-xl border border-border bg-secondary"
                    />
                    <Link
                      key={picked.id}
                      to="/work/$id"
                      params={{ id: picked.id }}
                      className="match-picked pressable relative block h-full overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                    >
                      {ready.has(picked.id) ? (
                        <Poster eager path={picked.poster_path} title={picked.title} />
                      ) : (
                        <div className="relative aspect-[2/3]">
                          <div className="match-stack-back" />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/80 to-transparent px-3 pb-4 pt-12">
                        <p className="text-center text-sm font-semibold">{picked.title}</p>
                        <p className="mt-1 text-center text-xs text-muted-foreground">
                          {picked.release_year} · {picked.media_type === "tv" ? "Série" : "Filme"}
                        </p>
                      </div>
                    </Link>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="relative aspect-[2/3]"
                    aria-hidden
                  >
                    <div className="match-stack-back match-stack-back-far" />
                    <div className="match-stack-back match-stack-back-near" />
                    <div className="match-stack-back z-[2]" />
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
          <div className="mx-auto mt-6 flex h-[112px] w-60 flex-col items-center gap-2">
            <motion.div layout className="w-full">
              <Button
                onClick={roll}
                disabled={pool.length === 0 || rolling}
                className="pressable min-h-14 w-full rounded-2xl font-semibold"
              >
                <Dices className={`h-5 w-5 transition-transform duration-200 ${rolling ? "rotate-180" : ""}`} />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={picked ? "again" : "start"}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                  >
                    {picked ? "Sortear de novo" : "Sortear"}
                  </motion.span>
                </AnimatePresence>
              </Button>
            </motion.div>
            <div className="relative h-12 w-full">
              <AnimatePresence>
                {picked && (
                  <motion.div
                    key="decline"
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.95 }}
                    transition={{ duration: reduce ? 0.01 : 0.18 }}
                  >
                    <Button
                      variant="outline"
                      onClick={decline}
                      disabled={!picked || rolling}
                      aria-label="Recusar nesta rodada"
                      className="pressable min-h-11 w-full rounded-2xl"
                    >
                      <X className="h-4 w-4" />
                      Hoje não
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {pool.length} obras no sorteio
            {declined.size ? ` · ${declined.size} recusadas nesta rodada` : ""}
          </p>
        </>
      )}
    </div>
  );
}
