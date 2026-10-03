import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Dices, RotateCcw, X } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { FilterPills, TogglePill } from "@/components/app/ui";
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

type History = "fresh" | "rewatch" | "any";

function DicePage() {
  const { data: space } = useSpace();
  const { data: works = [] } = useLibrary(space?.spaceId);
  const [kind, setKind] = useState<"all" | "movie" | "tv">("all");
  const [history, setHistory] = useState<History>("fresh");
  const [includeDislike, setIncludeDislike] = useState(false);
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<LibraryWork | null>(null);
  const [rolling, setRolling] = useState(false);
  if (!space) return null;

  const pool = works.filter((w) => {
    if (declined.has(w.id)) return false;
    if (kind !== "all" && w.media_type !== kind) return false;
    const seen = isWatched(w);
    if (history === "fresh" && (seen || !isIndicated(w))) return false;
    if (history === "rewatch" && !seen) return false;
    return weightOf(w, space, includeDislike) > 0;
  });

  const roll = () => {
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
    setRolling(true);
    setTimeout(() => {
      setPicked(choice);
      setRolling(false);
    }, 180);
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
      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 py-1">
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
      </div>
      <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 py-1">
        <FilterPills
          options={
            [
              ["fresh", "Nenhum viu"],
              ["rewatch", "Rever"],
              ["any", "Qualquer"],
            ] as const
          }
          value={history}
          onChange={setHistory}
        />
        <TogglePill on={includeDislike} onClick={() => setIncludeDislike((v) => !v)}>
          Incluir 👎
        </TogglePill>
      </div>

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
            <button
              onClick={() => setDeclined(new Set())}
              className="pressable mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm"
            >
              <RotateCcw className="h-4 w-4" /> Nova rodada
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mx-auto mt-6 w-44" style={{ minHeight: picked ? undefined : 0 }}>
            {picked && (
              <Link
                key={picked.id}
                to="/work/$id"
                params={{ id: picked.id }}
                className={`pressable block transition-[opacity,transform] duration-200 ${rolling ? "scale-95 opacity-0" : "fade-enter"}`}
              >
                <Poster path={picked.poster_path} title={picked.title} />
                <p className="mt-2 text-center font-semibold">{picked.title}</p>
                <p className="text-center text-xs text-muted-foreground">Toque para ver detalhes</p>
              </Link>
            )}
          </div>
          <div className="mt-6 flex gap-2">
            {picked && (
              <button
                onClick={decline}
                aria-label="Recusar nesta rodada"
                className="pressable flex min-h-14 items-center justify-center gap-1.5 rounded-2xl border border-border px-4 text-sm"
              >
                <X className="h-4 w-4" /> Hoje não
              </button>
            )}
            <button
              onClick={roll}
              disabled={pool.length === 0}
              className="pressable flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Dices
                className={`h-5 w-5 transition-transform duration-200 ${rolling ? "rotate-180" : ""}`}
              />{" "}
              {picked ? "Sortear de novo" : "Sortear"}
            </button>
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
