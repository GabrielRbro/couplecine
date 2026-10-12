import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { z } from "zod";
import { useNavigate } from "@tanstack/react-router";
import { closeOverlaysThen } from "@/lib/overlay";
import { markShared } from "@/lib/shared-transition";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGalleryLogos } from "@/lib/catalog.functions";
import {
  Baby,
  CalendarDays,
  Clapperboard,
  Clock3,
  Compass,
  Eye,
  Ghost,
  Heart,
  Landmark,
  Laugh,
  Music,
  Rocket,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Theater,
  Users,
  WandSparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { TouchSlider } from "@/components/app/TouchSlider";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { ScrollToTop } from "@/components/app/ScrollToTop";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { FilterPills, TogglePill } from "@/components/app/ui";
import { EmptyState } from "@/components/app/MediaCard";
import { formatRuntime, REACTION_EMOJI, tmdbImage } from "@/lib/format";
import {
  firstName,
  isIndicated,
  type LibraryWork,
  type SpaceInfo,
  useLibrary,
  useSpace,
} from "@/lib/space";

export const Route = createFileRoute("/_authenticated/watch/gallery")({
  head: () => ({
    meta: [
      { title: "Galeria — AppCinema" },
      { name: "description", content: "Galeria de escolha entre as indicações do casal." },
      { property: "og:title", content: "Galeria — AppCinema" },
      { property: "og:description", content: "Escolham um filme ou série entre as indicações do casal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Filters live in the URL so opening a work and coming back restores them.
  validateSearch: z.object({
    kind: z.enum(["all", "movie", "tv"]).catch("all").default("all"),
    duration: z.number().catch(0).default(0),
    genres: z.preprocess((value) => Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [], z.array(z.string()).max(20)).catch([]).default([]),
    decades: z.preprocess((value) => {
      const values = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
      return values.map(Number).filter((item) => Number.isInteger(item) && item >= 1880 && item <= 2100);
    }, z.array(z.number().int()).max(30)).catch([]).default([]),
    both: z.boolean().catch(false).default(false),
  }),
  component: () => (
    <AppShell>
      <GalleryPage />
    </AppShell>
  ),
});

const GENRE_ICONS: Record<string, LucideIcon> = {
  "Ação": Zap,
  "Aventura": Compass,
  "Animação": Sparkles,
  "Comédia": Laugh,
  "Crime": ShieldAlert,
  "Documentário": Clapperboard,
  "Drama": Theater,
  "Família": Users,
  "Fantasia": WandSparkles,
  "Ficção científica": Rocket,
  "Guerra": Swords,
  "História": Landmark,
  "Infantil": Baby,
  "Mistério": Search,
  "Música": Music,
  "Romance": Heart,
  "Terror": Ghost,
  "Thriller": Eye,
};

function normalizedGenres(genres: string[]) {
  const out = new Set<string>();
  for (const genre of genres) {
    const key = genre.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
    if (key.includes("sci-fi") || key.includes("ficcao cientifica") || key.includes("science fiction")) out.add("Ficção científica");
    if (key.includes("fantasia") || key.includes("fantasy")) out.add("Fantasia");
    if (key.includes("acao") || key.includes("action")) out.add("Ação");
    if (key.includes("aventura") || key.includes("adventure")) out.add("Aventura");
    if (key.includes("guerra") || key.includes("war")) out.add("Guerra");
    const compound = /sci-fi|ficcao cientifica|science fiction|fantasia|fantasy|acao e aventura|action\s*(?:&|e)\s*adventure|guerra e politica|war\s*(?:&|e)\s*politics/.test(key);
    if (!compound) out.add(genre);
  }
  return [...out];
}

function decadeLabel(decade: number) {
  return `${decade}s`;
}

/** Cinematic choice card: horizontal backdrop with only what matters to decide now. */
function GalleryCard({ work, space, requestLogo, logo }: { work: LibraryWork; space: SpaceInfo; requestLogo: (id: string) => void; logo?: string | null | undefined }) {
  const mine = work.interests.find((i) => i.user_id === space.userId);
  const theirs = space.partner
    ? work.interests.find((i) => i.user_id === space.partner?.id)
    : undefined;
  const art = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = art.current; if (!el) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { requestLogo(work.id); observer.disconnect(); } }, { rootMargin: "150px" });
    observer.observe(el); return () => observer.disconnect();
  }, [work.id, requestLogo]);
  const [logoFailed, setLogoFailed] = useState(false);
  const [titleFallback, setTitleFallback] = useState(logo === null);
  const fallbackLatched = useRef(logo === null);
  const [logoReady, setLogoReady] = useState(Boolean(logo));
  useEffect(() => {
    if (logo === null) { fallbackLatched.current = true; setTitleFallback(true); return; }
    if (logo) {
      let active = true;
      const image = new Image(); image.src = tmdbImage(logo, "w500") ?? "";
      image.decode().then(() => { if (active && !fallbackLatched.current) setLogoReady(true); }, () => { if (active) setTitleFallback(true); });
      return () => { active = false; };
    }
    const timeout = window.setTimeout(() => { fallbackLatched.current = true; setTitleFallback(true); }, 700);
    return () => clearTimeout(timeout);
  }, [logo]);
  const backdrop = tmdbImage(work.backdrop_path, "w780");
  const poster = tmdbImage(work.poster_path, "w342");
  const meta = [
    work.release_year,
    formatRuntime(work.runtime_minutes),
    work.genres[0] ?? (work.media_type === "tv" ? "Série" : "Filme"),
  ].filter(Boolean);
  return (
    <Link
      to="/work/$id"
      params={{ id: work.id }}
      aria-label={`Abrir ${work.title}`}
      onClick={() => markShared(art.current?.querySelector("img") ?? null, work.id, work.backdrop_path ? "backdrop" : "poster")}
      className="pressable block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div ref={art} className="relative aspect-[16/10] overflow-hidden rounded-3xl bg-card art-edge">
        {backdrop ? (
          <img
            src={backdrop}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : poster ? (
          // No backdrop: blurred poster as ambience, real poster undistorted on the side.
          <div className="flex h-full w-full items-center justify-end overflow-hidden">
            <img
              src={poster}
              alt=""
              className="absolute inset-0 h-full w-full scale-125 object-cover opacity-35 blur-xl"
            />
            <img
              src={poster}
              alt=""
              className="relative mr-5 h-[82%] rounded-lg object-contain shadow-xl"
            />
          </div>
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-secondary to-card" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
          <div className="min-w-0">
            {!titleFallback && logo && logoReady && !logoFailed ? <img src={tmdbImage(logo, "w500") ?? ""} alt={work.title} onError={() => setLogoFailed(true)} className="mb-2 max-h-16 max-w-[220px] w-auto object-contain object-left drop-shadow-md" /> : titleFallback || logoFailed ? <p className="line-clamp-2 font-display text-xl font-semibold leading-tight">{work.title}</p> : <div aria-hidden className="skeleton mb-2 h-10 w-40" />}
            <p className="mt-1 text-xs text-foreground/70">{meta.join(" · ")}</p>
          </div>
          <div className="emoji flex shrink-0 items-center gap-1.5 rounded-full bg-background/50 px-2.5 py-1 text-sm backdrop-blur">
            <span aria-label="Eu">{mine ? REACTION_EMOJI[mine.reaction] : "·"}</span>
            {space.partner && (
              <>
                <span className="h-3.5 w-px bg-border" />
                <span aria-label={firstName(space.partner.display_name)}>
                  {theirs ? REACTION_EMOJI[theirs.reaction] : "·"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function GalleryPage() {
  const { data: space } = useSpace();
  const { data: works = [] } = useLibrary(space?.spaceId);
  const reduce = useReducedMotion();
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  const qc = useQueryClient();
  const fetchLogos = useServerFn(getGalleryLogos);
  const requestLogo = useMemo(() => (id: string) => setVisibleIds((old) => old.includes(id) ? old : [...old, id]), []);
  const batch = visibleIds.filter((id) => !(id in logos) && qc.getQueryData(["gallery-logo", id]) === undefined).slice(0, 6);
  const logoQuery = useQuery({ queryKey: ["gallery-logos", batch.join(",")], enabled: batch.length > 0, staleTime: 3600_000,
    queryFn: () => fetchLogos({ data: { ids: batch } }) });
  useEffect(() => { if (logoQuery.data) { const resolved=logoQuery.data; Object.entries(resolved).forEach(([id, logo]) => qc.setQueryData(["gallery-logo", id], logo)); setLogos((old) => ({ ...old, ...resolved })); qc.setQueriesData<LibraryWork[]>({queryKey:["library",space?.spaceId]},(old)=>old?.map((w)=>Object.prototype.hasOwnProperty.call(resolved,w.id) ? {...w,work_metadata_cache:[{...w.work_metadata_cache[0],seasons:w.work_metadata_cache[0]?.seasons ?? null,logoPath:resolved[w.id] ?? null,logoChecked:true,expires_at:new Date(Date.now()+7*864e5).toISOString()}]} : w)); } }, [logoQuery.data]);
  const urlFilters = Route.useSearch();
  const [draft,setDraft] = useState<typeof urlFilters | null>(null);
  const { kind, duration, genres: selectedGenres, decades: selectedDecades, both: bothLike } = draft ?? urlFilters;
  const nav = useNavigate({ from: "/watch/gallery" });
  const set = (patch: Partial<{ kind: "all" | "movie" | "tv"; duration: number; genres: string[]; decades: number[]; both: boolean }>) => {
    const current = { kind, duration, genres: selectedGenres, decades: selectedDecades, both: bothLike };
    if (sheet) { setDraft({...current,...patch}); return; }
    void nav({to:".",search:(p)=>({...p,...patch}),replace:true,viewTransition:false});
  };
  const setKind = (k: "all" | "movie" | "tv") => {
    const available = pool.filter((w) => k === "all" || w.media_type === k);
    set({
      kind: k,
      genres: selectedGenres.filter((genre) => available.some((work) => normalizedGenres(work.genres).includes(genre))),
      decades: selectedDecades.filter((decade) => available.some((work) => work.release_year !== null && work.release_year >= decade && work.release_year < decade + 10)),
    });
  };
  const toggleGenre = (genre: string) => set({ genres: selectedGenres.includes(genre) ? selectedGenres.filter((item) => item !== genre) : [...selectedGenres, genre] });
  const toggleDecade = (decade: number) => set({ decades: selectedDecades.includes(decade) ? selectedDecades.filter((item) => item !== decade) : [...selectedDecades, decade] });
  const setBothLike = (f: (v: boolean) => boolean) => set({ both: f(bothLike) });
  const [sheet, setSheet] = useState<"filters" | "duration" | null>(null);
  const [filterSection, setFilterSection] = useState<"genres" | "decades">("genres");
  const closeSheet = () => closeOverlaysThen(() => {
    setSheet(null);
    setDraft(null);
    void nav({to:".",search:{kind,duration,genres:selectedGenres,decades:selectedDecades,both:bothLike},replace:true,viewTransition:false});
  });
  useEffect(() => {
    if (sheet || !draft) return;
    const timer=window.setTimeout(()=>{setDraft(null);void nav({to:".",search:draft,replace:true,viewTransition:false});},0);
    return ()=>window.clearTimeout(timer);
  },[sheet,draft,nav]);
  const pool = works.filter(isIndicated);
  const genres = useMemo(
    () => [...new Set(pool.filter((w) => kind === "all" || w.media_type === kind).flatMap((w) => normalizedGenres(w.genres)))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [pool, kind],
  );
  const decades = useMemo(
    () => [...new Set(pool.filter((w) => (kind === "all" || w.media_type === kind) && w.release_year).map((w) => Math.floor((w.release_year ?? 0) / 10) * 10))].sort((a, b) => b - a),
    [pool, kind],
  );
  if (!space) return null;
  const advanced = selectedGenres.length + selectedDecades.length + (bothLike ? 1 : 0);
  const list = pool.filter(
    (w) =>
      (kind === "all" || w.media_type === kind) &&
      (kind !== "movie" || !duration || (w.runtime_minutes !== null && w.runtime_minutes <= duration)) &&
      (!selectedGenres.length || normalizedGenres(w.genres).some((genre) => selectedGenres.includes(genre))) &&
      (!selectedDecades.length || (w.release_year !== null && selectedDecades.some((decade) => w.release_year! >= decade && w.release_year! < decade + 10))) &&
      (!bothLike ||
        w.interests.filter((i) => i.reaction === "fire" || i.reaction === "like").length >=
          (space.partner ? 2 : 1)),
  );
  return (
    <div className="px-4 pt-6"><ScrollToTop />
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
        Modo de escolha
      </span>
      <h1 className="mt-1 font-display text-2xl font-semibold">Galeria</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">O que vamos assistir?</p>
      <div className="-mx-4 mt-3 flex min-h-11 items-center gap-2 px-4 py-1">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          <FilterPills options={[["all", "Todos"], ["movie", "Filmes"], ["tv", "Séries"]] as const} value={kind} onChange={setKind} />
          {kind === "movie" && (
            <TogglePill on={Boolean(duration)} onClick={() => setSheet("duration")}>
              <span className="flex items-center gap-1.5">
                <Clock3 className="h-4 w-4" />
                {duration ? formatRuntime(duration) : "Duração"}
              </span>
            </TogglePill>
          )}
        </div>
        <button aria-label="Filtros" onClick={() => setSheet("filters")} className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
          <SlidersHorizontal className={`h-5 w-5 ${advanced > 0 ? "text-primary" : "text-muted-foreground"}`} />
        </button>
      </div>
      <div className="mt-4 space-y-4">
        <AnimatePresence initial={false} mode="popLayout">
          {list.map((w) => (
            <motion.div
              key={w.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
            >
              <GalleryCard work={w} space={space} requestLogo={requestLogo} logo={w.work_metadata_cache[0]?.logoChecked && new Date(w.work_metadata_cache[0]?.expires_at ?? "").getTime() > Date.now() ? w.work_metadata_cache[0]?.logoPath ?? null : (logos[w.id] !== undefined ? logos[w.id] : qc.getQueryData<string | null>(["gallery-logo", w.id]))} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {list.length === 0 && (
        <div className="mt-2">
          <EmptyState
            title="Nada com esses filtros"
            text="Ajuste os filtros acima ou volte às indicações na Biblioteca."
          />
          <Link
            to="/library"
            className="pressable mt-3 block min-h-11 rounded-lg border border-border bg-card px-4 py-3 text-center text-sm font-medium"
          >
            Ver indicações
          </Link>
        </div>
      )}
      <AnimatedSheet open={sheet === "filters"} onClose={closeSheet} labelledBy="gal-filters" panelClassName="flex h-[min(72dvh,620px)] flex-col overflow-hidden pb-[max(env(safe-area-inset-bottom),20px)]">
        <h2 id="gal-filters" className="text-base font-semibold">Filtros</h2>
        <div className="mt-4 grid grid-cols-2 gap-2" role="tablist" aria-label="Categoria do filtro">
          <Button role="tab" aria-selected={filterSection === "genres"} variant={filterSection === "genres" ? "secondary" : "ghost"} className="min-h-11 justify-start rounded-xl" onClick={() => setFilterSection("genres")}><Sparkles className="h-4 w-4" />Gêneros{selectedGenres.length > 0 && <span className="ml-auto text-xs text-primary">{selectedGenres.length}</span>}</Button>
          <Button role="tab" aria-selected={filterSection === "decades"} variant={filterSection === "decades" ? "secondary" : "ghost"} className="min-h-11 justify-start rounded-xl" onClick={() => setFilterSection("decades")}><CalendarDays className="h-4 w-4" />Décadas{selectedDecades.length > 0 && <span className="ml-auto text-xs text-primary">{selectedDecades.length}</span>}</Button>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {filterSection === "genres" ? (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Gêneros">
              {genres.map((genre) => {
                const Icon = GENRE_ICONS[genre] ?? Clapperboard;
                const active = selectedGenres.includes(genre);
                return <button key={genre} type="button" aria-pressed={active} onClick={() => toggleGenre(genre)} className={`pressable flex min-h-12 items-center gap-2 rounded-xl border px-3 text-left text-xs ${active ? "border-primary bg-primary/15 text-primary" : "border-border bg-background text-muted-foreground"}`}><Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 leading-tight">{genre}</span></button>;
              })}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Décadas">
              {decades.map((decade) => {
                const active = selectedDecades.includes(decade);
                return <button key={decade} type="button" aria-pressed={active} onClick={() => toggleDecade(decade)} className={`pressable min-h-12 rounded-xl border px-3 text-xs ${active ? "border-primary bg-primary/15 font-semibold text-primary" : "border-border bg-background text-muted-foreground"}`}>{decadeLabel(decade)}</button>;
              })}
            </div>
          )}
        </div>
        <button type="button" role="checkbox" aria-checked={bothLike} onClick={() => setBothLike((value) => !value)} className="pressable mt-3 flex min-h-14 w-full items-center justify-between rounded-xl border border-border bg-background px-4 text-left text-sm">
          <span><strong className="block font-medium">Os dois curtiram</strong><span className="mt-0.5 block text-[11px] text-muted-foreground">Mostrar só escolhas em comum</span></span>
          <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded border border-primary/60 ${bothLike ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>{bothLike && <span className="text-xs">✓</span>}</span>
        </button>
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-3"><Button variant="outline" className="min-h-12" onClick={()=>set({genres:[],decades:[],both:false})}>Limpar</Button><Button className="min-h-12" onClick={closeSheet}>Ver {list.length} {list.length === 1 ? "obra" : "obras"}</Button></div>
      </AnimatedSheet>
      <AnimatedSheet open={sheet === "duration"} onClose={closeSheet} labelledBy="gal-duration" panelClassName="pb-[max(env(safe-area-inset-bottom),20px)]">
        <h2 id="gal-duration" className="flex items-center gap-2 text-base font-semibold"><Clock3 className="h-4 w-4 text-primary" />Duração máxima</h2>
        <p className="mt-5 text-center font-display text-3xl font-semibold text-primary">{duration ? formatRuntime(duration) : "Sem limite"}</p>
        <TouchSlider label="Duração máxima em minutos" min={40} max={240} step={10} value={duration || 240} valueText={formatRuntime(duration) ?? "Sem limite"} onChange={(value)=>set({duration:value})} />
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-3"><Button variant="outline" className="min-h-12" onClick={()=>set({duration:0})}>Sem limite</Button><Button className="min-h-12" onClick={closeSheet}>Aplicar</Button></div>
      </AnimatedSheet>
    </div>
  );
}
