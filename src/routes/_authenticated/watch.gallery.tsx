import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useNavigate } from "@tanstack/react-router";
import { markShared } from "@/lib/shared-transition";
import { SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { AppShell } from "@/components/app/AppShell";
import { FilterPills, ScrollRow, TogglePill } from "@/components/app/ui";
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
    ],
  }),
  // Filters live in the URL so opening a work and coming back restores them.
  validateSearch: z.object({
    kind: z.enum(["all", "movie", "tv"]).catch("all").default("all"),
    short: z.boolean().catch(false).default(false),
    genre: z.string().catch("").default(""),
    both: z.boolean().catch(false).default(false),
  }),
  component: () => (
    <AppShell>
      <GalleryPage />
    </AppShell>
  ),
});

/** Cinematic choice card: horizontal backdrop with only what matters to decide now. */
function GalleryCard({ work, space }: { work: LibraryWork; space: SpaceInfo }) {
  const mine = work.interests.find((i) => i.user_id === space.userId);
  const theirs = space.partner
    ? work.interests.find((i) => i.user_id === space.partner!.id)
    : undefined;
  const art = useRef<HTMLDivElement>(null);
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
      onClick={() => markShared(art.current, work.id, work.backdrop_path ? "backdrop" : "poster")}
      className="pressable block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div ref={art} className="relative aspect-[16/10] overflow-hidden rounded-3xl bg-card shadow-[0_18px_40px_-24px_rgb(0_0_0/0.8)]">
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
            <p className="line-clamp-2 font-display text-xl font-semibold leading-tight">
              {work.title}
            </p>
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
  const { kind, short, genre, both: bothLike } = Route.useSearch();
  const nav = useNavigate({ from: "/watch/gallery" });
  const set = (patch: Partial<{ kind: "all" | "movie" | "tv"; short: boolean; genre: string; both: boolean }>) =>
    nav({ search: (p) => ({ ...p, ...patch }), replace: true, viewTransition: false });
  const setKind = (k: "all" | "movie" | "tv") => set({ kind: k });
  const setShort = (f: (v: boolean) => boolean) => set({ short: f(short) });
  const setGenre = (g: string) => set({ genre: g });
  const setBothLike = (f: (v: boolean) => boolean) => set({ both: f(bothLike) });
  const [sheet, setSheet] = useState(false);
  const pool = works.filter(isIndicated);
  const genres = useMemo(
    () => [...new Set(pool.flatMap((w) => w.genres))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [pool],
  );
  if (!space) return null;
  const advanced = (genre ? 1 : 0) + (bothLike ? 1 : 0);
  const list = pool.filter(
    (w) =>
      (kind === "all" || w.media_type === kind) &&
      (!short || (w.runtime_minutes !== null && w.runtime_minutes <= 120)) &&
      (!genre || w.genres.includes(genre)) &&
      (!bothLike ||
        w.interests.filter((i) => i.reaction === "fire" || i.reaction === "like").length >=
          (space.partner ? 2 : 1)),
  );
  return (
    <div className="px-4 pt-6">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
        Modo de escolha
      </span>
      <h1 className="mt-1 font-display text-2xl font-semibold">Galeria</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">O que vamos assistir?</p>
      <ScrollRow className="mt-3">
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
        <TogglePill on={short} onClick={() => setShort((v) => !v)}>
          Até 2h
        </TogglePill>
        <TogglePill on={advanced > 0} onClick={() => setSheet(true)}>
          <span className="inline-flex items-center gap-1">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros{advanced ? ` · ${advanced}` : ""}
          </span>
        </TogglePill>
      </ScrollRow>
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
              <GalleryCard work={w} space={space} />
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
      <AnimatedSheet open={sheet} onClose={() => setSheet(false)} labelledBy="gal-filters">
        <h2 id="gal-filters" className="text-base font-semibold">
          Filtros
        </h2>
        <label className="mt-4 block text-xs text-muted-foreground" htmlFor="gal-genre">
          Gênero
        </label>
        <select
          id="gal-genre"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
        >
          <option value="">Todos os gêneros</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <div className="mt-4">
          <TogglePill on={bothLike} onClick={() => setBothLike((v) => !v)}>
            Os dois curtiram
          </TogglePill>
        </div>
        <button
          onClick={() => setSheet(false)}
          className="pressable mt-5 min-h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        >
          Ver {list.length} {list.length === 1 ? "obra" : "obras"}
        </button>
      </AnimatedSheet>
    </div>
  );
}
