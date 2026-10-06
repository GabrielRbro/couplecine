import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LoaderCircle, Search, Sparkles } from "lucide-react";
import { BackButton, FilterPills, ScrollRow } from "@/components/app/ui";
import { AppShell } from "@/components/app/AppShell";
import { IntelligentLoading } from "@/components/app/IntelligentLoading";
import { Poster } from "@/components/app/MediaCard";
import { Button } from "@/components/ui/button";
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
  validateSearch: (s: Record<string, unknown>): { q?: string; kind?: string; mode?: string } => ({ q: typeof s["q"] === "string" ? s["q"] : "", kind: typeof s["kind"] === "string" ? s["kind"] : "all", mode: typeof s["mode"] === "string" ? s["mode"] : "tmdb" }),
  component: () => <AppShell><AddPage /></AppShell>,
});

function AddPage() {
  const { data: space } = useSpace();
  const { q = "", kind = "all", mode = "tmdb" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const reduce = useReducedMotion();
  const search = useServerFn(searchCatalog);
  const smart = useServerFn(smartSearch);
  const [debounced, setDebounced] = useState(q);
  const qc = useQueryClient();

  const ai = useMutation({ mutationFn: (query: string) => {
    if (!space?.spaceId) throw new Error("Espaço indisponível.");
    return smart({ data: { query, spaceId: space.spaceId, kind: kind === "movie" ? "movie" : kind === "tv" ? "tv" : "all" } });
  }, onSuccess: (data, query) => { qc.setQueryData(["smart-search-view", query.trim(), space?.spaceId, kind], data); } });
  useEffect(() => { const t = window.setTimeout(() => setDebounced(q), 350); return () => clearTimeout(t); }, [q]);
  const normal = useQuery({ queryKey: ["catalog-search", debounced, space?.spaceId], enabled: mode !== "ai" && debounced.trim().length >= 2 && Boolean(space?.spaceId), staleTime: 5 * 60_000,
    queryFn: () => {
      if (!space?.spaceId) throw new Error("Espaço indisponível.");
      return search({ data: { query: debounced.trim(), spaceId: space.spaceId } });
    } });
  // Cached results survive preview → Back, with no stale request overwriting a newer key.
  const intelligent = useQuery({ queryKey: ["smart-search-view", q.trim(), space?.spaceId, kind], enabled: false,
    queryFn: () => { throw new Error("A pesquisa inteligente precisa ser solicitada."); }, staleTime: Infinity });
  const data = mode === "ai" ? intelligent.data as Awaited<ReturnType<typeof smartSearch>> | undefined : undefined;
  const items = (mode === "ai" ? data?.items ?? [] : q.trim().length >= 2 ? normal.data ?? [] : []).filter((r) => kind === "all" || r.mediaType === kind);
  const pending = mode === "ai" ? ai.isPending : normal.isFetching || (q !== debounced && q.length >= 2);
  const update = (patch: Partial<{ q: string; kind: string; mode: string }>) => navigate({ to: ".", search: (p) => ({ ...p, ...patch }), replace: true, viewTransition: false, resetScroll: false });
  return <div className="px-4 pt-6">
    <div className="flex min-w-0 items-center gap-3"><BackButton /><h1 className="text-xl font-semibold">Adicionar obra</h1></div>
    <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border bg-card px-3">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input aria-label="Título, ator ou diretor" value={q} onChange={(e) => { update({ q: e.target.value, mode: "tmdb" }); }} placeholder="Título, ator ou diretor" className="min-w-0 bg-transparent py-3 text-sm outline-none" />
      <span className="flex h-5 w-5 items-center">{pending && <LoaderCircle className="h-4 w-4 animate-spin text-primary" />}</span>
    </div>
    <ScrollRow className="mt-2"><FilterPills options={[["all", "Todos"], ["movie", "Filmes"], ["tv", "Séries"]]} value={kind} onChange={(value) => update({ kind: value })} /></ScrollRow>
    <Button variant="outline" disabled={q.trim().length < 3 || ai.isPending} onClick={() => { update({ mode: "ai" }); ai.mutate(q.trim()); }} className="mt-2 min-h-11 w-full gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" />Pesquisa inteligente</Button>
    <AnimatePresence initial={false} mode="wait">
      {mode === "ai" && pending ? <motion.div key="interpreting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-28">
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
    {(normal.error || ai.error || intelligent.error) && <p className="mt-4 text-sm text-destructive">{normal.error?.message ?? ai.error?.message ?? intelligent.error?.message}</p>}
  </div>;
}
