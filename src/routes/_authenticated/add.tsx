import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, LoaderCircle, Search, Sparkles } from "lucide-react";
import { BackButton, FilterPills, ScrollRow } from "@/components/app/ui";
import { AppShell } from "@/components/app/AppShell";
import { IntelligentLoading } from "@/components/app/IntelligentLoading";
import { Poster } from "@/components/app/MediaCard";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { Button } from "@/components/ui/button";
import { rankSearch } from "@/lib/search-ranking";
import { searchCatalog } from "@/lib/catalog.functions";
import { smartSearch } from "@/lib/ai.functions";
import { markShared } from "@/lib/shared-transition";
import { useSpace } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/add")({
  head: () => ({ meta: [
    { title: "Encontrar obra — AppCinema" },
    { name: "description", content: "Encontre filmes e séries por título, ator ou diretor e conheça a obra antes de adicionar." },
    { property: "og:title", content: "Encontrar obra — AppCinema" },
    { property: "og:description", content: "Busca e prévias de filmes e séries para a biblioteca do casal." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  validateSearch: (s: Record<string, unknown>): { q?: string; kind?: string; mode?: string; sort?: string } => ({ q: typeof s["q"] === "string" ? s["q"] : "", kind: typeof s["kind"] === "string" ? s["kind"] : "all", mode: typeof s["mode"] === "string" ? s["mode"] : "tmdb", sort: typeof s["sort"] === "string" ? s["sort"] : "relevance" }),
  component: () => <AppShell><AddPage /></AppShell>,
});

function AddPage() {
  const { data: space } = useSpace();
  const { q = "", kind = "all", mode = "tmdb", sort = "relevance" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const reduce = useReducedMotion();
  const search = useServerFn(searchCatalog);
  const smart = useServerFn(smartSearch);
  const qc = useQueryClient();

  const [debounced, setDebounced] = useState(q);
  const [ordering, setOrdering] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setDebounced(q), mode === "ai" ? 1100 : 350); return () => clearTimeout(t); }, [q, mode]);
  const normal = useInfiniteQuery({ queryKey: ["catalog-search", debounced, space?.spaceId], initialPageParam: 1, enabled: mode !== "ai" && debounced.trim().length >= 2 && Boolean(space?.spaceId), staleTime: 5 * 60_000,
    queryFn: ({ pageParam }) => {
      if (!space?.spaceId) throw new Error("Espaço indisponível.");
      return search({ data: { query: debounced.trim(), spaceId: space.spaceId, page: pageParam } });
    }, getNextPageParam: (last, pages) => last.length >= 20 && pages.length < 20 ? pages.length + 1 : undefined });
  const aiKey = ["smart-search-view", debounced.trim(), space?.spaceId, kind];
  const intelligent = useInfiniteQuery({ queryKey: aiKey, initialPageParam: 1, enabled: mode === "ai" && debounced.trim().length >= 3 && Boolean(space?.spaceId), staleTime: 72 * 3600_000, retry: false,
    queryFn: ({pageParam}) => {
      if (!space?.spaceId) throw new Error("Espaço indisponível.");
      const previous = qc.getQueryData<{pages:{items:{title:string;tmdbId:number;mediaType:"movie"|"tv"}[]}[]}>(aiKey)?.pages.flatMap((p)=>p.items) ?? [];
      return smart({ data: { query: debounced.trim(), spaceId: space.spaceId, kind: kind === "movie" ? "movie" : kind === "tv" ? "tv" : "all",page:pageParam,exclude:previous.slice(0,50) } });
    },getNextPageParam:(last,pages)=>last.ok && last.hasMore ? pages.length+1 : undefined });
  const data = intelligent.data?.pages.at(-1);
  const loaded = mode === "ai" ? intelligent.data?.pages.flatMap((p)=>p.items) ?? [] : q.trim().length >= 2 ? normal.data?.pages.flat() ?? [] : [];
  let items = [...new Map(loaded.filter((r) => kind === "all" || r.mediaType === kind).map((r) => [`${r.mediaType}:${r.tmdbId}`, r])).values()];
  if (sort === "relevance" && mode !== "ai") items = rankSearch(items,debounced);
  if (sort !== "relevance") items.sort((a,b) => sort === "rating" ? (b.voteAverage ?? 0) - (a.voteAverage ?? 0) : sort === "oldest" ? (a.year ?? 9999) - (b.year ?? 9999) : (b.year ?? 0) - (a.year ?? 0));
  const pending = mode === "ai" ? intelligent.isFetching || q !== debounced : normal.isFetching || (q !== debounced && q.length >= 2);
  const update = (patch: Partial<{ q: string; kind: string; mode: string; sort: string }>) => navigate({ to: ".", search: (p) => ({ ...p, ...patch }), replace: true, viewTransition: false, resetScroll: false });
  const orders: [string,string][] = [["relevance", "Relevância"], ["newest", "Mais recentes"], ["oldest", "Mais antigos"], ["rating", "Melhor avaliados"]];
  return <div className="px-4 pt-6">
    <div className="flex min-w-0 items-center gap-3"><BackButton /><h1 className="text-xl font-semibold">Adicionar obra</h1></div>
    <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border bg-card px-3">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input aria-label="Título, ator ou diretor" value={q} onChange={(e) => { update({ q: e.target.value }); }} placeholder="Título, ator ou diretor" className="min-w-0 bg-transparent py-3 text-sm outline-none" />
      <span className="flex h-5 w-5 items-center">{pending && <LoaderCircle className="h-4 w-4 animate-spin text-primary" />}</span>
    </div>
    <div className="mt-2 flex items-center justify-between gap-1"><FilterPills options={[["all", "Todos"], ["movie", "Filmes"], ["tv", "Séries"]]} value={kind} onChange={(value) => update({ kind: value })} /><Button variant={mode === "ai" ? "default" : "outline"} role="switch" aria-checked={mode === "ai"} aria-label="Busca inteligente" onClick={() => update({ mode: mode === "ai" ? "tmdb" : "ai" })} className={`ml-auto min-h-11 shrink-0 px-3 text-xs ${mode === "ai" ? "bg-primary text-primary-foreground" : "border-primary text-muted-foreground"}`}>IA<Sparkles className="h-3.5 w-3.5" /></Button></div>
    <Button variant="ghost" onClick={() => setOrdering(true)} className="min-h-11 px-0 text-xs text-muted-foreground">{orders.find(([value]) => value === sort)?.[1] ?? "Relevância"}<ChevronDown className="h-3 w-3" /></Button>
    <AnimatedSheet open={ordering} onClose={() => setOrdering(false)} labelledBy="search-order"><h2 id="search-order" className="font-semibold">Ordenação</h2><div className="mt-3">{orders.map(([value, label]) => <Button key={value} variant={sort === value ? "secondary" : "ghost"} className="min-h-12 w-full justify-start" onClick={() => { update({ sort: value }); setOrdering(false); }}>{label}</Button>)}</div></AnimatedSheet>
    <AnimatePresence initial={false} mode="wait">
      {mode === "ai" && pending && !intelligent.data ? <motion.div key="interpreting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-28">
         <IntelligentLoading />
       </motion.div> : <motion.div key="results" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 space-y-2">
        {mode === "tmdb" && pending && !normal.data && [0,1,2].map((i) => <div key={i} className="skeleton h-[88px] rounded-xl" />)}
        <AnimatePresence initial={false} mode="popLayout">{items.map((r) => <motion.div key={`${r.mediaType}-${r.tmdbId}`} layout={!reduce} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>
          <Link {...("existingWorkId" in r && r.existingWorkId ? { to: "/work/$id" as const, params: { id: r.existingWorkId } } : { to: "/title/$mediaType/$tmdbId" as const, params: { mediaType: r.mediaType, tmdbId: String(r.tmdbId) } })} onClick={(e) => markShared(e.currentTarget.querySelector<HTMLElement>("[data-poster]"), "existingWorkId" in r && r.existingWorkId ? r.existingWorkId : `tmdb-${r.mediaType}-${r.tmdbId}`, "poster")} className="pressable grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border bg-card p-2">
            <div data-poster><Poster path={r.posterPath} title={r.title} className="rounded-lg" /></div><div className="min-w-0"><p className="line-clamp-1 font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.mediaType === "tv" ? "Série" : "Filme"}{r.year ? ` · ${r.year}` : ""}{"existingWorkId" in r && r.existingWorkId ? " · já na biblioteca" : ""}</p></div>
          </Link>
        </motion.div>)}</AnimatePresence>
        {!pending && q.trim().length >= 2 && items.length === 0 && <p className="text-sm text-muted-foreground">{data && !data.ok ? data.reason : "Nenhum filme ou série encontrado."}</p>}
      </motion.div>}
    </AnimatePresence>
    {((mode !== "ai" && normal.hasNextPage) || (mode === "ai" && intelligent.hasNextPage)) && <Button variant="outline" disabled={mode === "ai" ? intelligent.isFetchingNextPage : normal.isFetchingNextPage} onClick={() => mode === "ai" ? intelligent.fetchNextPage() : normal.fetchNextPage()} className="mt-4 min-h-11 w-full">{(mode === "ai" ? intelligent.isFetchingNextPage : normal.isFetchingNextPage) ? "Carregando…" : "Ver mais resultados"}</Button>}
    {mode === "ai" && intelligent.isFetchingNextPage && <IntelligentLoading />}
    {(normal.error || intelligent.error) && <p className="mt-4 text-sm text-destructive">{normal.error?.message ?? intelligent.error?.message}</p>}
  </div>;
}
