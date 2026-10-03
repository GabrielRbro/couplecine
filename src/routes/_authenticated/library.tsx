import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, MediaCard } from "@/components/app/MediaCard";
import { DiscoverTab } from "@/components/app/DiscoverTab";
import { FilterPills, PosterGridSkeleton } from "@/components/app/ui";
import { isIndicated, isWatched, useLibrary, useSpace } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "Biblioteca — AppCinema" },
      { name: "description", content: "Indicações e obras assistidas pelo casal." },
    ],
  }),
  component: () => (
    <AppShell
      skeleton={
        <div className="px-4 pt-24">
          <PosterGridSkeleton />
        </div>
      }
    >
      <LibraryPage />
    </AppShell>
  ),
});

type Tab = "ind" | "disc" | "seen";
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function LibraryPage() {
  const { data: space } = useSpace();
  const { data: works = [], isLoading } = useLibrary(space?.spaceId);
  const [tab, setTab] = useState<Tab>("ind");
  const [kind, setKind] = useState<"all" | "movie" | "tv">("all");
  const [sort, setSort] = useState<"activity" | "title" | "year">("activity");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    let l = works.filter((w) => (tab === "seen" ? isWatched(w) : isIndicated(w)));
    if (kind !== "all") l = l.filter((w) => w.media_type === kind);
    if (q.trim())
      l = l.filter((w) => norm(`${w.title} ${w.original_title ?? ""}`).includes(norm(q)));
    if (sort === "title") l = [...l].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
    if (sort === "year") l = [...l].sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0));
    return l;
  }, [works, tab, kind, sort, q]);

  if (!space) return null;

  return (
    <div className="px-4 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Biblioteca</h1>
        <Link
          to="/add"
          aria-label="Adicionar"
          className="pressable hit flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
        >
          <Plus className="h-5 w-5" />
        </Link>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-card px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar títulos"
          className="w-full bg-transparent py-3 text-sm outline-none"
        />
      </div>
      <div className="mt-4 grid grid-cols-3 rounded-xl bg-card p-1 text-sm">
        {(
          [
            ["ind", "Indicações"],
            ["disc", "Descobrir"],
            ["seen", "Assistidos"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`pressable min-h-11 rounded-lg py-2 font-medium transition-colors ${tab === id ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "disc" ? (
        <>
          <div className="mt-4">
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
          <DiscoverTab space={space} kind={kind} />
        </>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-2">
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
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              aria-label="Ordenar"
              className="ml-auto min-h-10 rounded-lg border border-border bg-card px-2 text-xs"
            >
              <option value="activity">Recentes</option>
              <option value="title">A–Z</option>
              <option value="year">Ano</option>
            </select>
          </div>
          {isLoading && (
            <div className="mt-5">
              <PosterGridSkeleton />
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-5">
            {list.map((w) => (
              <MediaCard key={w.id} work={w} space={space} />
            ))}
          </div>
          {!isLoading && list.length === 0 && (
            <EmptyState
              title={tab === "seen" ? "Nada assistido ainda" : "Nenhuma indicação"}
              text="Use o botão + para adicionar uma obra."
            />
          )}
        </>
      )}
    </div>
  );
}
