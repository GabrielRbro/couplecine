import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, MediaCard } from "@/components/app/MediaCard";
import { isIndicated, useLibrary, useSpace } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/watch/gallery")({
  head: () => ({ meta: [{ title: "Galeria — AppCinema" }, { name: "description", content: "Galeria filtrável das indicações do casal." }] }),
  component: () => (
    <AppShell>
      <GalleryPage />
    </AppShell>
  ),
});

function GalleryPage() {
  const { data: space } = useSpace();
  const { data: works = [] } = useLibrary(space?.spaceId);
  const [kind, setKind] = useState<"all" | "movie" | "tv">("all");
  const [genre, setGenre] = useState("");
  const [bothLike, setBothLike] = useState(false);
  const pool = works.filter(isIndicated);
  const genres = useMemo(() => [...new Set(pool.flatMap((w) => w.genres))].sort((a, b) => a.localeCompare(b, "pt-BR")), [pool]);
  if (!space) return null;
  const list = pool.filter(
    (w) =>
      (kind === "all" || w.media_type === kind) &&
      (!genre || w.genres.includes(genre)) &&
      (!bothLike || w.interests.filter((i) => i.reaction === "fire" || i.reaction === "like").length >= (space.partner ? 2 : 1)),
  );
  const pill = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${on ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`;
  return (
    <div className="px-4 pt-6">
      <h1 className="text-2xl font-semibold">Galeria</h1>
      <p className="mt-1 text-sm text-muted-foreground">Escolham juntos entre as indicações.</p>
      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4">
        <button className={pill(kind === "all")} onClick={() => setKind("all")}>Todos</button>
        <button className={pill(kind === "movie")} onClick={() => setKind("movie")}>Filmes</button>
        <button className={pill(kind === "tv")} onClick={() => setKind("tv")}>Séries</button>
        <button className={pill(bothLike)} onClick={() => setBothLike((v) => !v)}>Os dois curtiram</button>
      </div>
      {genres.length > 0 && (
        <select value={genre} onChange={(e) => setGenre(e.target.value)} className="mt-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <option value="">Todos os gêneros</option>
          {genres.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      )}
      <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-5">
        {list.map((w) => <MediaCard key={w.id} work={w} space={space} />)}
      </div>
      {list.length === 0 && <EmptyState title="Nada com esses filtros" text="Tente outros filtros ou adicione indicações." />}
    </div>
  );
}
