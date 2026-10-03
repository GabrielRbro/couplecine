import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { AppShell } from "@/components/app/AppShell";
import { Poster } from "@/components/app/MediaCard";
import { addWork, searchCatalog } from "@/lib/catalog.functions";
import { ADD_REACTIONS, REACTION_EMOJI, REACTION_LABEL, type Reaction } from "@/lib/format";
import { useSpace } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/add")({
  head: () => ({
    meta: [
      { title: "Adicionar obra — AppCinema" },
      { name: "description", content: "Encontre filmes e séries por título, ator ou diretor." },
      { property: "og:title", content: "Adicionar obra — AppCinema" },
      {
        property: "og:description",
        content: "Encontre filmes e séries por título, ator ou diretor.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <AddPage />
    </AppShell>
  ),
});

type Result = NonNullable<Awaited<ReturnType<typeof searchCatalog>>>[number];

function AddPage() {
  const { data: space } = useSpace();
  const search = useServerFn(searchCatalog);
  const add = useServerFn(addWork);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Result | null>(null);

  const s = useMutation({
    mutationFn: (query: string) => search({ data: { query, spaceId: space!.spaceId! } }),
  });
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || !space?.spaceId) return;
    const id = setTimeout(() => s.mutate(t), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, space?.spaceId]);
  const a = useMutation({
    mutationFn: (reaction: Reaction) =>
      add({
        data: {
          spaceId: space!.spaceId!,
          mediaType: picked!.mediaType,
          tmdbId: picked!.tmdbId,
          reaction: reaction as "fire",
        },
      }),
    onSuccess: async ({ workId }) => {
      await qc.invalidateQueries({ queryKey: ["library"] });
      toast.success("Indicação salva");
      navigate({ to: "/work/$id", params: { id: workId } });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="px-4 pt-6">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          aria-label="Voltar"
          className="pressable -ml-2 flex h-11 w-11 items-center justify-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold">Adicionar obra</h1>
      </div>
      <form
        className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-card px-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) s.mutate(q.trim());
        }}
      >
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Título, ator ou diretor"
          className="w-full bg-transparent py-3 text-sm outline-none"
        />
        <button className="pressable min-h-11 px-1 text-sm font-medium text-primary">Buscar</button>
      </form>
      {s.isPending && !s.data && (
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-[88px] rounded-xl" />
          ))}
        </div>
      )}
      {s.error && <p className="mt-6 text-sm text-destructive">{s.error.message}</p>}
      <div className="mt-4 space-y-2">
        {s.data?.map((r) => (
          <button
            key={`${r.mediaType}-${r.tmdbId}`}
            onClick={() => setPicked(r)}
            className="pressable flex w-full items-center gap-3 rounded-xl border border-border bg-card p-2 text-left"
          >
            <div className="w-12 shrink-0">
              <Poster path={r.posterPath} title={r.title} className="rounded-lg" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 font-medium">{r.title}</p>
              <p className="text-xs text-muted-foreground">
                {r.mediaType === "tv" ? "Série" : "Filme"}
                {r.year ? ` · ${r.year}` : ""}
                {r.existingWorkId ? " · já na biblioteca" : ""}
              </p>
            </div>
          </button>
        ))}
        {s.data && s.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum filme ou série encontrado por esse título, ator ou diretor.
          </p>
        )}
      </div>

      <AnimatedSheet
        open={Boolean(picked)}
        onClose={() => setPicked(null)}
        closeDisabled={a.isPending}
        panelClassName="pb-[max(env(safe-area-inset-bottom),32px)]"
      >
        {picked && (
          <>
            <p className="text-xs text-muted-foreground">Qual sua vontade de ver?</p>
            <h2 className="mt-1 text-lg font-semibold">{picked.title}</h2>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {ADD_REACTIONS.map((r) => (
                <button
                  key={r}
                  disabled={a.isPending}
                  onClick={() => a.mutate(r)}
                  className="pressable rounded-2xl border border-border bg-secondary py-4 disabled:opacity-50"
                >
                  <span className="text-2xl">{REACTION_EMOJI[r]}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {REACTION_LABEL[r]}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              A escolha já salva a indicação.
            </p>
          </>
        )}
      </AnimatedSheet>
    </div>
  );
}
