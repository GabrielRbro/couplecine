import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Dices } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { FilterPills, TogglePill } from "@/components/app/ui";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import type { Reaction } from "@/lib/format";
import { isIndicated, useLibrary, useSpace, type LibraryWork } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/watch/dice")({
  head: () => ({ meta: [{ title: "Sortear — AppCinema" }, { name: "description", content: "Sorteio ponderado pelas reações do casal." }] }),
  component: () => (
    <AppShell>
      <DicePage />
    </AppShell>
  ),
});

const WEIGHT: Record<Reaction, number> = { fire: 3, like: 2, neutral: 1, dislike: 0 };

function weightOf(w: LibraryWork) {
  if (w.interests.some((i) => i.reaction === "dislike")) return 0;
  return w.interests.reduce((s, i) => s + WEIGHT[i.reaction], 0) || 1;
}

function DicePage() {
  const { data: space } = useSpace();
  const { data: works = [] } = useLibrary(space?.spaceId);
  const [kind, setKind] = useState<"all" | "movie" | "tv">("all");
  const [picked, setPicked] = useState<LibraryWork | null>(null);
  if (!space) return null;
  const pool = works.filter((w) => isIndicated(w) && (kind === "all" || w.media_type === kind) && weightOf(w) > 0);
  const roll = () => {
    const total = pool.reduce((s, w) => s + weightOf(w), 0);
    let r = Math.random() * total;
    for (const w of pool) {
      r -= weightOf(w);
      if (r <= 0) return setPicked(w);
    }
    setPicked(pool[pool.length - 1] ?? null);
  };
  return (
    <div className="px-4 pt-6">
      <h1 className="text-2xl font-semibold">Sortear</h1>
      <p className="mt-1 text-sm text-muted-foreground">Obras com 🔥 têm mais chance. Se alguém marcou 👎, fica de fora.</p>
      <div className="mt-4 flex gap-2">
        <FilterPills options={[["all", "Todos"], ["movie", "Filmes"], ["tv", "Séries"]] as const} value={kind} onChange={setKind} />
      </div>
      {pool.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nada para sortear" text="Adicione indicações para usar o sorteio." /></div>
      ) : (
        <>
          {picked && (
            <Link to="/work/$id" params={{ id: picked.id }} className="mx-auto mt-6 block w-44">
              <Poster path={picked.poster_path} title={picked.title} />
              <p className="mt-2 text-center font-semibold">{picked.title}</p>
              <p className="text-center text-xs text-muted-foreground">Toque para ver detalhes</p>
            </Link>
          )}
          <button onClick={roll} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-semibold text-primary-foreground">
            <Dices className="h-5 w-5" /> {picked ? "Sortear de novo" : "Sortear"}
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">{pool.length} obras no sorteio</p>
        </>
      )}
    </div>
  );
}
