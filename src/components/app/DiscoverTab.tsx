import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Film, Plus, RotateCcw, Tv, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { PosterGridSkeleton } from "@/components/app/ui";
import { supabase } from "@/integrations/supabase/client";
import { addWork, getDiscover, markSeenBefore } from "@/lib/catalog.functions";
import { ADD_REACTIONS, REACTION_EMOJI, REACTION_LABEL, formatScore } from "@/lib/format";
import type { SpaceInfo } from "@/lib/space";

type Item = NonNullable<Awaited<ReturnType<typeof getDiscover>>>["items"][number];
const SCORES = Array.from({ length: 21 }, (_, i) => i / 2);
const k = (i: { mediaType: string; tmdbId: number }) => `${i.mediaType}:${i.tmdbId}`;

export function DiscoverTab({ space, kind }: { space: SpaceInfo; kind: "all" | "movie" | "tv" }) {
  const qc = useQueryClient();
  const fetchFeed = useServerFn(getDiscover);
  const add = useServerFn(addWork);
  const seen = useServerFn(markSeenBefore);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<{ item: Item; mode: "react" | "seen" } | null>(null);
  const hide = (i: Item) => setGone((g) => new Set(g).add(k(i)));
  const refreshLibrary = () => qc.invalidateQueries({ queryKey: ["library", space.spaceId] });

  const feed = useInfiniteQuery({
    queryKey: ["discover", space.spaceId],
    initialPageParam: 1,
    staleTime: 5 * 60_000,
    queryFn: ({ pageParam }) => fetchFeed({ data: { spaceId: space.spaceId, page: pageParam } }),
    getNextPageParam: (last, pages) => (last?.hasMore ? pages.length + 1 : undefined),
  });
  const dismissedCount = useQuery({
    queryKey: ["discover-dismissed", space.userId],
    queryFn: async () => {
      const { count } = await supabase
        .from("discover_dismissals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", space.userId);
      return count ?? 0;
    },
  });

  const dismiss = useMutation({
    mutationFn: async (i: Item) => {
      const { error } = await supabase
        .from("discover_dismissals")
        .upsert(
          { user_id: space.userId, media_type: i.mediaType, tmdb_id: i.tmdbId },
          { onConflict: "user_id,media_type,tmdb_id" },
        );
      if (error) throw error;
    },
    onMutate: hide,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discover-dismissed", space.userId] }),
    onError: (_e, i) => {
      setGone((g) => {
        const n = new Set(g);
        n.delete(k(i));
        return n;
      });
      toast.error("Não foi possível dispensar.");
    },
  });
  const restore = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("discover_dismissals")
        .delete()
        .eq("user_id", space.userId);
      if (error) throw error;
    },
    onSuccess: () => {
      setGone(new Set());
      qc.invalidateQueries({ queryKey: ["discover-dismissed", space.userId] });
      qc.resetQueries({ queryKey: ["discover", space.spaceId] });
      toast("Dispensados restaurados.");
    },
  });
  const indicate = useMutation({
    mutationFn: ({ i, reaction }: { i: Item; reaction: "fire" | "like" | "neutral" }) =>
      add({ data: { spaceId: space.spaceId, mediaType: i.mediaType, tmdbId: i.tmdbId, reaction } }),
    onMutate: ({ i }) => {
      hide(i);
      setSheet(null);
    },
    onSuccess: (_d, { i }) => {
      toast.success(`${i.title} indicado`);
      refreshLibrary();
    },
    onError: (e) => toast.error(e.message),
  });
  const markSeen = useMutation({
    mutationFn: ({ i, score }: { i: Item; score: number | null }) =>
      seen({ data: { spaceId: space.spaceId, mediaType: i.mediaType, tmdbId: i.tmdbId, score } }),
    onMutate: ({ i }) => {
      hide(i);
      setSheet(null);
    },
    onSuccess: (_d, { i }) => {
      toast.success(`${i.title} marcado como já assistido`);
      refreshLibrary();
    },
    onError: (e) => toast.error(e.message),
  });

  const seenKeys = new Set<string>();
  const items = (feed.data?.pages ?? [])
    .flatMap((p) => p?.items ?? [])
    .filter((i) => {
      const key = k(i);
      if (seenKeys.has(key) || gone.has(key)) return false;
      seenKeys.add(key);
      return kind === "all" || i.mediaType === kind;
    });

  return (
    <div className="mt-5">
      {feed.isLoading ? (
        <PosterGridSkeleton />
      ) : feed.isError ? (
        <div className="text-center">
          <EmptyState title="Não foi possível carregar sugestões" text={feed.error.message} />
          <button
            onClick={() => feed.refetch()}
            className="pressable mt-3 min-h-11 rounded-xl border border-border px-5 text-sm"
          >
            Tentar de novo
          </button>
        </div>
      ) : items.length === 0 && !feed.hasNextPage ? (
        <EmptyState title="Nada novo por aqui" text="Volte depois para mais sugestões." />
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5">
          {items.map((i) => (
            <div key={k(i)} className="fade-enter min-w-0">
              <div className="relative">
                <Poster path={i.posterPath} title={i.title} />
                <span className="absolute left-2 top-2 rounded-md bg-background/80 p-1 text-muted-foreground">
                  {i.mediaType === "tv" ? <Tv className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
                </span>
              </div>
              <p className="mt-2 line-clamp-1 text-sm font-semibold">{i.title}</p>
              <p className="text-xs text-muted-foreground">
                {[i.mediaType === "tv" ? "Série" : "Filme", i.year].filter(Boolean).join(" · ")}
                {i.existingWorkId && " · na biblioteca"}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <button
                  aria-label={`Indicar ${i.title}`}
                  onClick={() => setSheet({ item: i, mode: "react" })}
                  className="pressable flex min-h-11 items-center justify-center rounded-xl bg-secondary text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  aria-label={`Já assisti ${i.title}`}
                  onClick={() => setSheet({ item: i, mode: "seen" })}
                  className="pressable flex min-h-11 items-center justify-center rounded-xl border border-border text-muted-foreground"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  aria-label={`Dispensar ${i.title}`}
                  onClick={() => dismiss.mutate(i)}
                  className="pressable flex min-h-11 items-center justify-center rounded-xl border border-border text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {feed.hasNextPage && !feed.isLoading && (
        <button
          onClick={() => feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
          className="pressable mt-6 min-h-11 w-full rounded-xl border border-border text-sm disabled:opacity-50"
        >
          {feed.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
        </button>
      )}
      {(dismissedCount.data ?? 0) > 0 && (
        <button
          onClick={() => restore.mutate()}
          disabled={restore.isPending}
          className="pressable mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm text-muted-foreground disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" /> Restaurar dispensados ({dismissedCount.data})
        </button>
      )}

      {sheet && (
        <div
          className="fade-enter fixed inset-0 z-[60] flex items-end bg-background/80"
          onClick={() => setSheet(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="discover-sheet-title"
            className="sheet-enter mx-auto w-full max-w-md rounded-t-3xl border border-border bg-card p-5 pb-[max(env(safe-area-inset-bottom),24px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="discover-sheet-title" className="line-clamp-1 text-lg font-semibold">
              {sheet.item.title}
            </h2>
            {sheet.mode === "react" ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Qual é o seu interesse?</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {ADD_REACTIONS.map((r) => (
                    <button
                      key={r}
                      onClick={() =>
                        indicate.mutate({ i: sheet.item, reaction: r as "fire" | "like" | "neutral" })
                      }
                      className="pressable flex min-h-16 flex-col items-center justify-center rounded-xl border border-border"
                    >
                      <span className="text-2xl">{REACTION_EMOJI[r]}</span>
                      <span className="text-[11px] text-muted-foreground">{REACTION_LABEL[r]}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  Já assistiu antes? Dê uma nota, se quiser.
                </p>
                <div className="mt-4 grid grid-cols-7 gap-1.5">
                  {SCORES.map((s) => (
                    <button
                      key={s}
                      onClick={() => markSeen.mutate({ i: sheet.item, score: s })}
                      className="pressable min-h-11 rounded-lg border border-border text-xs"
                    >
                      {formatScore(s)}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => markSeen.mutate({ i: sheet.item, score: null })}
                  className="pressable mt-3 min-h-11 w-full rounded-xl bg-secondary text-sm font-medium"
                >
                  Salvar sem nota
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
