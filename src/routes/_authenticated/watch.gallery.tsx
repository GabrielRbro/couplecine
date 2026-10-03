import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Film, Tv } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { FilterPills, TogglePill } from "@/components/app/ui";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { REACTION_EMOJI, tmdbImage } from "@/lib/format";
import { firstName, isIndicated, type LibraryWork, type SpaceInfo, useLibrary, useSpace } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/watch/gallery")({
  head: () => ({
    meta: [
      { title: "Galeria — AppCinema" },
      { name: "description", content: "Galeria de escolha entre as indicações do casal." },
    ],
  }),
  component: () => (
    <AppShell>
      <GalleryPage />
    </AppShell>
  ),
});

/** Cartão do modo de escolha: poster protagonista com reações sobre o próprio poster. */
function GalleryCard({ work, space }: { work: LibraryWork; space: SpaceInfo }) {
  const mine = work.interests.find((i) => i.user_id === space.userId);
  const theirs = space.partner
    ? work.interests.find((i) => i.user_id === space.partner!.id)
    : undefined;
  return (
    <Link
      to="/work/$id"
      params={{ id: work.id }}
      aria-label={`Abrir ${work.title}`}
      className="pressable block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="relative overflow-hidden rounded-xl border border-border/60 shadow-lg">
        <Poster path={work.poster_path} title={work.title} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/85 to-transparent px-2.5 pb-2.5 pt-10">
          <div className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0 text-muted-foreground">
              {work.media_type === "tv" ? (
                <Tv className="h-3.5 w-3.5" strokeWidth={1.8} />
              ) : (
                <Film className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
            </span>
            <p className="min-w-0 line-clamp-2 text-sm font-semibold leading-snug">
              {work.title}
            </p>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Você {mine ? REACTION_EMOJI[mine.reaction] : "—"}
            {space.partner
              ? ` | ${firstName(space.partner.display_name)} ${theirs ? REACTION_EMOJI[theirs.reaction] : "—"}`
              : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}

function GalleryPage() {
  const { data: space } = useSpace();
  const { data: works = [] } = useLibrary(space?.spaceId);
  const [kind, setKind] = useState<"all" | "movie" | "tv">("all");
  const [genre, setGenre] = useState("");
  const [bothLike, setBothLike] = useState(false);
  const pool = works.filter(isIndicated);
  const genres = useMemo(
    () => [...new Set(pool.flatMap((w) => w.genres))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [pool],
  );
  if (!space) return null;
  const list = pool.filter(
    (w) =>
      (kind === "all" || w.media_type === kind) &&
      (!genre || w.genres.includes(genre)) &&
      (!bothLike ||
        w.interests.filter((i) => i.reaction === "fire" || i.reaction === "like").length >=
          (space.partner ? 2 : 1)),
  );
  return (
    <div className="px-4 pt-6">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          Modo de escolha
        </span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold">Galeria</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        O que assistir agora? Toque numa obra para decidir juntos.
      </p>
      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4">
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
        <TogglePill on={bothLike} onClick={() => setBothLike((v) => !v)}>
          Os dois curtiram
        </TogglePill>
      </div>
      {genres.length > 0 && (
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          aria-label="Gênero"
          className="mt-3 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
        >
          <option value="">Todos os gêneros</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      )}
      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
        {list.length} {list.length === 1 ? "obra pronta para escolher" : "obras prontas para escolher"}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-5">
        {list.map((w) => (
          <GalleryCard key={w.id} work={w} space={space} />
        ))}
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
    </div>
  );
}
