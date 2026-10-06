import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ScoreForm } from "@/components/app/ScorePicker";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Film, Plus, RotateCcw, Tv, X } from "lucide-react";
import { toast } from "sonner";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { PosterGridSkeleton } from "@/components/app/ui";
import { supabase } from "@/integrations/supabase/client";
import {
  addWork,
  getDiscover,
  getDismissedDiscover,
  markSeenBefore,
} from "@/lib/catalog.functions";
import { ADD_REACTIONS, REACTION_EMOJI, REACTION_LABEL } from "@/lib/format";
import type { SpaceInfo } from "@/lib/space";

type Item = NonNullable<Awaited<ReturnType<typeof getDiscover>>>["items"][number];
type SheetState = { item: Item; mode: "react" | "seen" } | null;
const k = (i: { mediaType: string; tmdbId: number }) => `${i.mediaType}:${i.tmdbId}`;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function DiscoverTab({
  space,
  kind,
  q = "",
}: {
  space: SpaceInfo;
  kind: "all" | "movie" | "tv";
  q?: string;
}) {
  const qc = useQueryClient();
  const fetchFeed = useServerFn(getDiscover);
  const fetchDismissed = useServerFn(getDismissedDiscover);
  const add = useServerFn(addWork);
  const seen = useServerFn(markSeenBefore);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const goneRef = useRef(gone);
  const [restored, setRestored] = useState<Map<string, Item>>(new Map());
  const [sheet, setSheet] = useState<SheetState>(null);
  const setGoneState = (next: Set<string>) => {
    goneRef.current = next;
    setGone(next);
  };
  const hide = (i: Item) => setGoneState(new Set(goneRef.current).add(k(i)));
  const show = (i: Item) => {
    const next = new Set(goneRef.current);
    next.delete(k(i));
    setGoneState(next);
  };
  const refreshLibrary = () => qc.invalidateQueries({ queryKey: ["library", space.spaceId] });
  const dismissedKey = ["discover-dismissed", space.userId, space.spaceId] as const;

  const feed = useInfiniteQuery({
    queryKey: ["discover", space.spaceId],
    initialPageParam: 1,
    staleTime: 5 * 60_000,
    queryFn: ({ pageParam }) => fetchFeed({ data: { spaceId: space.spaceId, page: pageParam } }),
    getNextPageParam: (last, pages) => (last?.hasMore ? pages.length + 1 : undefined),
  });
  const dismissed = useQuery({
    queryKey: dismissedKey,
    queryFn: () => fetchDismissed({ data: { spaceId: space.spaceId } }),
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
    onMutate: async (i) => {
      await qc.cancelQueries({ queryKey: dismissedKey });
      const previous = qc.getQueryData<Item[]>(dismissedKey);
      hide(i);
      setRestored((current) => {
        const next = new Map(current);
        next.delete(k(i));
        return next;
      });
      qc.setQueryData<Item[]>(dismissedKey, (current = []) =>
        current.some((item) => k(item) === k(i)) ? current : [i, ...current],
      );
      return { previous };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dismissedKey }),
    onError: (_e, i, context) => {
      show(i);
      qc.setQueryData(dismissedKey, context?.previous);
      toast.error("Não foi possível dispensar.");
    },
  });
  const restore = useMutation({
    mutationFn: async (i: Item) => {
      const { error } = await supabase
        .from("discover_dismissals")
        .delete()
        .eq("user_id", space.userId)
        .eq("media_type", i.mediaType)
        .eq("tmdb_id", i.tmdbId);
      if (error) throw error;
    },
    onMutate: async (i) => {
      await qc.cancelQueries({ queryKey: dismissedKey });
      const previous = qc.getQueryData<Item[]>(dismissedKey);
      qc.setQueryData<Item[]>(dismissedKey, (current = []) =>
        current.filter((item) => k(item) !== k(i)),
      );
      show(i);
      setRestored((current) => new Map(current).set(k(i), i));
      return { previous };
    },
    onSuccess: (_data, i) => {
      qc.invalidateQueries({ queryKey: dismissedKey });
      toast.success(`${i.title} restaurado`);
    },
    onError: (_error, i, context) => {
      qc.setQueryData(dismissedKey, context?.previous);
      hide(i);
      setRestored((current) => {
        const next = new Map(current);
        next.delete(k(i));
        return next;
      });
      toast.error("Não foi possível restaurar.");
    },
  });
  const optimisticallyRemove = (i: Item) => {
    const key = k(i);
    const wasGone = goneRef.current.has(key);
    const restoredItem = restored.get(key);
    const previousSheet = sheet;
    hide(i);
    setRestored((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setSheet(null);
    return { wasGone, restoredItem, previousSheet };
  };
  const rollbackRemove = (
    i: Item,
    context:
      { wasGone: boolean; restoredItem: Item | undefined; previousSheet: SheetState } | undefined,
  ) => {
    if (!context?.wasGone) show(i);
    if (context?.restoredItem)
      setRestored((current) => new Map(current).set(k(i), context.restoredItem as Item));
    setSheet(context?.previousSheet ?? null);
  };
  const indicate = useMutation({
    mutationFn: ({ i, reaction }: { i: Item; reaction: "fire" | "like" | "neutral" }) =>
      add({ data: { spaceId: space.spaceId, mediaType: i.mediaType, tmdbId: i.tmdbId, reaction } }),
    onMutate: ({ i }) => optimisticallyRemove(i),
    onSuccess: (_d, { i }) => {
      toast.success(`${i.title} indicado`);
      refreshLibrary();
    },
    onError: (e, { i }, context) => {
      rollbackRemove(i, context);
      toast.error(e.message);
    },
  });
  const markSeen = useMutation({
    mutationFn: ({ i, score }: { i: Item; score: number | null }) =>
      seen({ data: { spaceId: space.spaceId, mediaType: i.mediaType, tmdbId: i.tmdbId, score } }),
    onMutate: ({ i }) => optimisticallyRemove(i),
    onSuccess: (_d, { i }) => {
      toast.success(`${i.title} marcado como já assistido`);
      refreshLibrary();
    },
    onError: (e, { i }, context) => {
      rollbackRemove(i, context);
      toast.error(e.message);
    },
  });

  const seenKeys = new Set<string>();
  const items = (feed.data?.pages ?? [])
    .flatMap((p) => p?.items ?? [])
    .filter((i) => {
      const key = k(i);
      if (seenKeys.has(key) || gone.has(key) || restored.has(key)) return false;
      seenKeys.add(key);
      if (q.trim() && !fold(`${i.title} ${i.originalTitle ?? ""}`).includes(fold(q))) return false;
      return kind === "all" || i.mediaType === kind;
    });

  return (
    <div className="mt-5">
      {restored.size > 0 && (
        <section className="mb-6" aria-labelledby="restored-title">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="restored-title" className="text-sm font-semibold">
              Restaurados
            </h2>
            <span className="text-xs text-muted-foreground">Disponíveis novamente</span>
          </div>
          <DiscoverGrid
            items={[...restored.values()]}
            onReact={(item) => setSheet({ item, mode: "react" })}
            onSeen={(item) => setSheet({ item, mode: "seen" })}
            onDismiss={(item) => dismiss.mutate(item)}
          />
        </section>
      )}
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
      ) : items.length === 0 && restored.size === 0 && !feed.hasNextPage ? (
        <EmptyState title="Nada novo por aqui" text="Volte depois para mais sugestões." />
      ) : (
        <DiscoverGrid
          items={items}
          onReact={(item) => setSheet({ item, mode: "react" })}
          onSeen={(item) => setSheet({ item, mode: "seen" })}
          onDismiss={(item) => dismiss.mutate(item)}
        />
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
      {(dismissed.data?.length ?? 0) > 0 && (
        <section className="mt-7 border-t border-border pt-5" aria-labelledby="dismissed-title">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="dismissed-title" className="text-sm font-semibold">
              Dispensados
            </h2>
            <span className="text-xs text-muted-foreground">{dismissed.data?.length}</span>
          </div>
          <div className="space-y-1">
            {dismissed.data?.map((item) => (
              <div key={k(item)} className="flex min-h-14 items-center gap-3 py-1">
                <div className="w-9 shrink-0 overflow-hidden rounded-md">
                  <Poster path={item.posterPath} title={item.title} className="rounded-md" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.mediaType === "tv" ? "Série" : "Filme"}
                  </p>
                </div>
                <button
                  aria-label={`Restaurar ${item.title}`}
                  onClick={() => restore.mutate(item)}
                  disabled={restore.isPending}
                  className="pressable flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs text-muted-foreground disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" /> Restaurar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <AnimatedSheet
        open={Boolean(sheet)}
        onClose={() => setSheet(null)}
        labelledBy="discover-sheet-title"
        panelClassName="pb-[max(env(safe-area-inset-bottom),24px)]"
      >
        {sheet && (
          <>
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
                      disabled={indicate.isPending || markSeen.isPending}
                      onClick={() =>
                        indicate.mutate({
                          i: sheet.item,
                          reaction: r as "fire" | "like" | "neutral",
                        })
                      }
                      className="pressable flex min-h-16 flex-col items-center justify-center rounded-xl border border-border disabled:opacity-50"
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
                <div className="mt-3">
                  <ScoreForm
                    title="Sua nota"
                    initial={null}
                    saving={indicate.isPending || markSeen.isPending}
                    onSave={(score) => markSeen.mutate({ i: sheet.item, score })}
                  />
                </div>
                <button
                  disabled={indicate.isPending || markSeen.isPending}
                  onClick={() => markSeen.mutate({ i: sheet.item, score: null })}
                  className="pressable mt-2 min-h-11 w-full rounded-xl bg-secondary text-sm font-medium disabled:opacity-50"
                >
                  Salvar sem nota
                </button>
              </>
            )}
          </>
        )}
      </AnimatedSheet>
    </div>
  );
}

function DiscoverGrid({
  items,
  onReact,
  onSeen,
  onDismiss,
}: {
  items: Item[];
  onReact: (item: Item) => void;
  onSeen: (item: Item) => void;
  onDismiss: (item: Item) => void;
}) {
  const reduce = useReducedMotion();
  const action =
    "pressable flex min-h-11 flex-1 items-center justify-center rounded-xl bg-background/55 text-foreground backdrop-blur";
  return (
    <div className="grid grid-cols-2 gap-3">
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((i) => (
          <motion.div
            key={k(i)}
            layout={!reduce}
            initial={reduce ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="relative min-w-0 overflow-hidden rounded-2xl"
          >
            <Poster path={i.posterPath} title={i.title} className="rounded-2xl" />
            <span className="absolute left-2 top-2 rounded-md bg-background/60 p-1 text-muted-foreground backdrop-blur">
              {i.mediaType === "tv" ? <Tv className="h-3 w-3" /> : <Film className="h-3 w-3" />}
            </span>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/85 to-transparent px-2 pb-2 pt-12">
              <p className="line-clamp-2 px-0.5 text-sm font-semibold leading-tight">{i.title}</p>
              <p className="px-0.5 text-[11px] text-foreground/70">
                {[i.mediaType === "tv" ? "Série" : "Filme", i.year].filter(Boolean).join(" · ")}
                {i.existingWorkId && " · na biblioteca"}
              </p>
              <div className="mt-1.5 flex gap-1">
                <button aria-label={`Indicar ${i.title}`} onClick={() => onReact(i)} className={`${action} bg-primary/90 text-primary-foreground`}>
                  <Plus className="h-4 w-4" />
                </button>
                <button aria-label={`Já assisti ${i.title}`} onClick={() => onSeen(i)} className={action}>
                  <Check className="h-4 w-4" />
                </button>
                <button aria-label={`Dispensar ${i.title}`} onClick={() => onDismiss(i)} className={action}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
