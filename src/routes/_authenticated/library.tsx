import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Plus, Search, ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, MediaCard } from "@/components/app/MediaCard";
import { ScrollToTop } from "@/components/app/ScrollToTop";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { Button } from "@/components/ui/button";
import { DiscoverTab } from "@/components/app/DiscoverTab";
import { FilterPills, PosterGridSkeleton } from "@/components/app/ui";
import { isIndicated, isWatched, useLibrary, useSpace } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "Biblioteca — AppCinema" },
      { name: "description", content: "Indicações e obras assistidas pelo casal." },
      { property: "og:title", content: "Biblioteca — AppCinema" },
      { property: "og:description", content: "Indicações e obras assistidas pelo casal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Tab/filters/search live in the URL so opening a work and going back restores them.
  validateSearch: z.object({
    tab: z.enum(["ind", "disc", "seen"]).catch("ind").default("ind"),
    kind: z.enum(["all", "movie", "tv"]).catch("all").default("all"),
    sort: z.enum(["activity", "title", "year"]).catch("activity").default("activity"),
    q: z.string().catch("").default(""),
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
  const { tab, kind, sort, q } = Route.useSearch();
  const reduce = useReducedMotion();
  const [ordering,setOrdering] = useState(false);
  const navigate = useNavigate({ from: "/library" });
  const set = (patch: Partial<{ tab: Tab; kind: typeof kind; sort: typeof sort; q: string }>) => {
    const current = { tab, kind, sort, q };
    if (Object.entries(patch).every(([k, v]) => current[k as keyof typeof current] === v)) return;
    navigate({ to: ".", search: (prev) => ({ ...prev, ...patch }), replace: true, viewTransition: false });
  };
  const setTab = (tab: Tab) => set({ tab });
  const setKind = (kind: "all" | "movie" | "tv") => set({ kind });
  const setSort = (sort: "activity" | "title" | "year") => set({ sort });
  const setQ = (q: string) => set({ q });

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
    <div className="px-4 pt-6"><ScrollToTop />
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
          placeholder={tab === "disc" ? "Filtrar sugestões" : "Buscar títulos"}
          aria-label="Buscar"
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
            className={`${tab === id ? "" : "pressable"} min-h-11 rounded-lg py-2 font-medium transition-colors ${tab === id ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* One shared filter row for the three tabs; Ordenar only applies to the local lists. */}
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
        {tab !== "disc" && (
          <>
            <Button variant="ghost" aria-label="Ordenar" onClick={()=>setOrdering(true)} className="ml-auto min-h-11 px-2 text-xs">{sort === "title" ? "A–Z" : sort === "year" ? "Ano" : "Recentes"}<ChevronDown className="h-3 w-3" /></Button>
            <AnimatedSheet open={ordering} onClose={()=>setOrdering(false)} labelledBy="library-order"><h2 id="library-order" className="font-semibold">Ordenar</h2>{([["activity","Recentes"],["title","A–Z"],["year","Ano"]] as const).map(([value,label])=><Button key={value} variant={sort===value ? "secondary" : "ghost"} className="min-h-12 w-full justify-start" onClick={()=>{setSort(value);setOrdering(false);}}>{label}</Button>)}</AnimatedSheet>
          </>
        )}
      </div>
      {tab === "disc" ? (
        <DiscoverTab space={space} kind={kind} q={q} />
      ) : (
        <>

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
            <Button variant="ghost" aria-label="Ordenar" onClick={()=>setOrdering(true)} className="ml-auto min-h-11 px-2 text-xs">{sort === "title" ? "A–Z" : sort === "year" ? "Ano" : "Recentes"}<ChevronDown className="h-3 w-3" /></Button>
            <AnimatedSheet open={ordering} onClose={()=>setOrdering(false)} labelledBy="library-order"><h2 id="library-order" className="font-semibold">Ordenar</h2>{([["activity","Recentes"],["title","A–Z"],["year","Ano"]] as const).map(([value,label])=><Button key={value} variant={sort===value ? "secondary" : "ghost"} className="min-h-12 w-full justify-start" onClick={()=>{setSort(value);setOrdering(false);}}>{label}</Button>)}</AnimatedSheet>
          </div>
          {isLoading && (
            <div className="mt-5">
              <PosterGridSkeleton />
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <AnimatePresence initial={false} mode="popLayout">
              {list.map((w) => (
                <motion.div
                  key={w.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                >
                  <MediaCard work={w} space={space} />
                </motion.div>
              ))}
            </AnimatePresence>
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
