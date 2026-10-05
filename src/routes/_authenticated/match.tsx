import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Dices, Heart, Play, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { Sk } from "@/components/app/ui";
import { supabase } from "@/integrations/supabase/client";
import { firstName, isIndicated, useLibrary, useSpace } from "@/lib/space";
import { tmdbImage } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/match")({
  head: () => ({
    meta: [
      { title: "Match — AppCinema" },
      { name: "description", content: "Votem em segredo e descubram o que os dois querem ver." },
    ],
  }),
  component: () => (
    <AppShell>
      <MatchPage />
    </AppShell>
  ),
});

/** The real poster stays under a scenic cover until its image has decoded, so it never "pops" in. */
function MatchPoster({
  work,
  ready,
  onReady,
}: {
  work: { id: string; poster_path: string | null; title: string };
  ready: boolean;
  onReady: () => void;
}) {
  const src = tmdbImage(work.poster_path, "w500");
  return (
    <div className="relative h-full w-full">
      {src ? (
        <img
          src={src}
          alt={work.title}
          decoding="async"
          onLoad={onReady}
          onError={onReady}
          className={`aspect-[2/3] w-full rounded-xl object-cover transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}
        />
      ) : (
        <Poster path={null} title={work.title} />
      )}
      {!ready && <div className="match-stack-back" aria-hidden="true" />}
    </div>
  );
}

// Deterministic per-user shuffle: same candidates, different stable order on each person's device.
function seededShuffle<T>(items: T[], seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function MatchPage() {
  const { data: space } = useSpace();
  const { data: works = [] } = useLibrary(space?.spaceId);
  const qc = useQueryClient();
  const spaceId = space?.spaceId;
  const [resumedSessionId, setResumedSessionId] = useState<string | null>(null);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const [cardExit, setCardExit] = useState<{
    work: (typeof works)[number];
    direction: "left" | "right";
  } | null>(null);
  const [pickedResultId, setPickedResultId] = useState<string | null>(null);
  const attemptedExtensions = useRef(new Set<string>());
  const [, setRetryTick] = useState(0);
  // A session that already existed when this visit began shows Continuar/Abandonar;
  // a session created during this visit opens straight on the first card.
  const initialOpenId = useRef<string | null | undefined>(undefined);
  const autoStarted = useRef(false);
  const [loadedCardId, setLoadedCardId] = useState<string | null>(null);

  const open = useQuery({
    queryKey: ["match-open", spaceId],
    enabled: !!spaceId,
    queryFn: async () => {
      if (!spaceId) return null;
      const { data } = await supabase
        .from("match_sessions")
        .select("id, work_ids, created_at, created_by")
        .eq("space_id", spaceId)
        .eq("status", "open")
        .maybeSingle();
      return data;
    },
  });
  if (initialOpenId.current === undefined && open.isSuccess)
    initialOpenId.current = open.data?.id ?? null;
  const sid = open.data?.id;
  const hasResumed = !!sid && resumedSessionId === sid;

  // Everything below returns only *my* data, plus a boolean "partner asked to close".
  const me = useQuery({
    queryKey: ["match-me", sid],
    enabled: !!sid && hasResumed,
    refetchInterval: 5000,
    queryFn: async ({ signal }) => {
      if (!sid) throw new Error("Sessão indisponível.");
      const { data: limit, error } = await supabase
        .rpc("match_join", { _session: sid })
        .abortSignal(signal);
      if (error) throw error;
      const [{ data: votes }, { data: part }, { data: partnerWants }] = await Promise.all([
        supabase
          .from("match_votes")
          .select("work_id, created_at")
          .eq("session_id", sid)
          .order("created_at"),
        supabase
          .from("match_participants")
          .select("close_requested")
          .eq("session_id", sid)
          .maybeSingle(),
        supabase.rpc("match_partner_wants_close", { _session: sid }),
      ]);
      return {
        limit: limit ?? 0,
        voted: new Set((votes ?? []).map((v) => v.work_id)),
        lastVote: votes?.at(-1)?.work_id ?? null,
        iWant: !!part?.close_requested,
        partnerWants: !!partnerWants,
      };
    },
  });

  const last = useQuery({
    queryKey: ["last-match", spaceId],
    enabled: !!spaceId,
    queryFn: async () => {
      if (!spaceId) return null;
      const { data } = await supabase
        .from("match_sessions")
        .select("id, result_work_ids, closed_at")
        .eq("space_id", spaceId)
        .eq("status", "closed")
        .not("closed_at", "is", null)
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["match-open"] });
    qc.invalidateQueries({ queryKey: ["match-me"] });
    qc.invalidateQueries({ queryKey: ["last-match"] });
  };

  const start = useMutation({
    mutationFn: async () => {
      // Permanent 👎 from either person vetoes a work from the Match pool by default.
      const ids = works
        .filter((w) => isIndicated(w) && !w.interests.some((i) => i.reaction === "dislike"))
        .map((w) => w.id);
      if (ids.length < 2) throw new Error("Adicione pelo menos 2 indicações antes de começar.");
      if (!spaceId || !space) throw new Error("Espaço indisponível.");
      const { data, error } = await supabase
        .from("match_sessions")
        .insert({ space_id: spaceId, created_by: space.userId, work_ids: ids })
        .select("id")
        .single();
      if (error) throw new Error("Já existe um Match em andamento.");
      return data.id;
    },
    onSuccess: (id) => {
      setResumedSessionId(id);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const vote = useMutation({
    mutationFn: async ({ workId, liked }: { workId: string; liked: boolean }) => {
      if (!sid || !space) throw new Error("Sessão indisponível.");
      const { error } = await supabase
        .from("match_votes")
        .insert({ session_id: sid, user_id: space.userId, work_id: workId, liked });
      if (error) throw error;
    },
    onMutate: ({ workId }) => {
      // Optimistic: advance the deck immediately.
      qc.setQueryData(
        ["match-me", sid],
        (old: typeof me.data) =>
          old && { ...old, voted: new Set(old.voted).add(workId), lastVote: workId },
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["match-me", sid] }),
    onError: () => toast.error("Não foi possível salvar o voto."),
  });
  const undo = useMutation({
    mutationFn: async () => {
      if (!sid) throw new Error("Sessão indisponível.");
      const { error } = await supabase.rpc("match_undo", { _session: sid });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["match-me", sid] }),
  });
  const extend = useMutation({
    mutationFn: async () => {
      if (!sid) throw new Error("Sessão indisponível.");
      const { error } = await supabase.rpc("match_extend", { _session: sid });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["match-me", sid] }),
  });
  const requestClose = useMutation({
    mutationFn: async (want: boolean) => {
      if (!sid) throw new Error("Sessão indisponível.");
      const { data, error } = await supabase.rpc("match_request_close", {
        _session: sid,
        _want: want,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (status) => {
      if (status === "closed") toast.success("Resultado revelado");
      invalidate();
    },
  });
  const abandon = useMutation({
    mutationFn: async () => {
      if (!sid) throw new Error("Sessão indisponível.");
      const { error } = await supabase.rpc("match_abandon", { _session: sid });
      if (error) throw error;
    },
    onMutate: async () => {
      // Stop polling/joining before the session stops being open.
      setResumedSessionId(null);
      await qc.cancelQueries({ queryKey: ["match-me", sid] });
      qc.removeQueries({ queryKey: ["match-me", sid] });
    },
    onSuccess: () => {
      setConfirmingAbandon(false);
      setResumedSessionId(null);
      toast("Match abandonado. Nada foi revelado.");
      invalidate();
    },
    onError: () => toast.error("Não foi possível abandonar este Match."),
  });

  const byId = useMemo(() => new Map(works.map((w) => [w.id, w])), [works]);
  const deck = useMemo(
    () =>
      open.data && space
        ? seededShuffle(
            open.data.work_ids.filter((id) => byId.has(id)),
            `${open.data.id}:${space.userId}`,
          )
        : [],
    [open.data, space, byId],
  );

  const matchState = me.data;
  const visibleDeck = deck.slice(0, matchState?.limit ?? 0);
  const nextWorkId = matchState ? visibleDeck.find((id) => !matchState.voted.has(id)) : undefined;
  const currentWork = nextWorkId ? (byId.get(nextWorkId) ?? null) : null;
  const deckDone = Boolean(matchState) && !currentWork;
  const canRequestExtension =
    Boolean(matchState) && deckDone && (matchState?.limit ?? 0) < deck.length;
  const extensionKey = sid && matchState ? `${sid}:${matchState.limit}` : null;
  const extensionAttempted = extensionKey ? attemptedExtensions.current.has(extensionKey) : false;

  useEffect(() => {
    if (!canRequestExtension || !extensionKey || extensionAttempted || extend.isPending) return;
    attemptedExtensions.current.add(extensionKey);
    extend.mutate(undefined, {
      // Transient failure: forget the attempt and retry shortly instead of ending the deck.
      onError: () => {
        attemptedExtensions.current.delete(extensionKey);
        window.setTimeout(() => setRetryTick((t) => t + 1), 2500);
      },
    });
  }, [canRequestExtension, extensionAttempted, extensionKey, extend]);

  // Auto-start once per visit when there is no pending session.
  useEffect(() => {
    if (!open.isSuccess || open.data || initialOpenId.current !== null) return;
    if (autoStarted.current || !works.length || start.isPending) return;
    autoStarted.current = true;
    start.mutate();
  }, [open.isSuccess, open.data, works.length, start]);

  const castVote = async (liked: boolean) => {
    if (!currentWork || cardExit || vote.isPending) return;
    const direction = liked ? "right" : "left";
    setCardExit({ work: currentWork, direction });
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const exitFinished = new Promise((resolve) =>
      window.setTimeout(resolve, reduceMotion ? 1 : 210),
    );
    try {
      await Promise.all([vote.mutateAsync({ workId: currentWork.id, liked }), exitFinished]);
    } finally {
      setCardExit(null);
    }
  };

  if (!space) return null;
  const partnerName = space.partner ? firstName(space.partner.display_name) : "seu parceiro";
  const header = (
    <>
      <h1 className="text-2xl font-semibold">Match</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Cada um vota em segredo. O resultado só aparece quando os dois encerrarem.
      </p>
    </>
  );

  const results = (last.data?.result_work_ids ?? [])
    .map((id) => byId.get(id))
    .filter((work): work is NonNullable<typeof work> => Boolean(work));
  const pickRandomResult = () => {
    if (results.length === 0) return;
    const selected = results[Math.floor(Math.random() * results.length)];
    setPickedResultId(selected?.id ?? null);
  };
  const lastResult = last.data && (
    <section className="mt-8 border-t border-border pt-6">
      <p className="text-xs font-medium uppercase text-primary">Último resultado</p>
      <h2 className="mt-1 text-xl font-semibold">
        Vocês deram Match em {results.length} {results.length === 1 ? "obra" : "obras"}
      </h2>
      {results.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhuma obra em comum desta vez.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolham uma obra ou deixem a sorte decidir.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {results.map((w) => (
              <Link
                key={w.id}
                to="/work/$id"
                params={{ id: w.id }}
                className={`pressable rounded-xl ${pickedResultId === w.id ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
              >
                <Poster path={w.poster_path} title={w.title} />
                <p className="mt-1 line-clamp-2 text-xs font-medium">{w.title}</p>
              </Link>
            ))}
          </div>
          <button
            type="button"
            onClick={pickRandomResult}
            className="pressable mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary text-sm font-semibold"
          >
            <Dices className="h-4 w-4" /> Sortear entre os matches
          </button>
          {pickedResultId && (
            <p className="fade-enter mt-3 text-center text-sm font-medium" aria-live="polite">
              A sorte escolheu {byId.get(pickedResultId)?.title}
            </p>
          )}
        </>
      )}
    </section>
  );

  const abandonSheet = (
    <AnimatedSheet
      open={confirmingAbandon}
      onClose={() => setConfirmingAbandon(false)}
      closeDisabled={abandon.isPending}
      role="alertdialog"
      labelledBy="abandon-title"
      panelClassName="pb-[max(env(safe-area-inset-bottom),24px)]"
    >
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <h2 id="abandon-title" className="mt-3 text-lg font-semibold">
        Abandonar este Match?
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Os votos temporários desta sessão serão descartados. O último resultado concluído continuará
        salvo.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          disabled={abandon.isPending}
          onClick={() => setConfirmingAbandon(false)}
          className="pressable min-h-12 rounded-xl border border-border text-sm font-medium"
        >
          Cancelar
        </button>
        <button
          disabled={abandon.isPending}
          onClick={() => abandon.mutate()}
          className="pressable min-h-12 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-50"
        >
          Abandonar
        </button>
      </div>
    </AnimatedSheet>
  );

  if (open.isLoading || (hasResumed && !me.data && !me.error) || (!open.data && start.isPending))
    return (
      <div className="px-4 pt-6">
        {header}
        <div className="mt-8 flex justify-center">
          <div className="match-stack" aria-label="Preparando o Match">
            <div className="match-stack-back match-stack-back-far" />
            <div className="match-stack-back match-stack-back-near" />
            <div className="match-stack-back z-[2]" />
          </div>
        </div>
      </div>
    );

  if (open.data && !hasResumed) {
    const createdByPartner = open.data.created_by !== space.userId;
    return (
      <div className="px-4 pt-6">
        {header}
        <section className="fade-enter mt-6 rounded-2xl border border-border bg-card p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
            <Heart className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Match em andamento</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {createdByPartner
              ? `${partnerName} iniciou este Match. Seus votos continuam privados até vocês dois encerrarem.`
              : "Seus votos e sua posição foram salvos. Continue de onde parou quando quiser."}
          </p>
          <button
            onClick={() => setResumedSessionId(open.data?.id ?? null)}
            className="pressable mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground"
          >
            <Play className="h-5 w-5" /> Continuar Match
          </button>
          <button
            onClick={() => setConfirmingAbandon(true)}
            className="pressable mt-2 min-h-12 w-full rounded-xl text-sm text-muted-foreground"
          >
            Abandonar Match
          </button>
        </section>
        {lastResult}

        {abandonSheet}
      </div>
    );
  }

  if (!open.data)
    return (
      <div className="px-4 pt-6">
        {header}
        <button
          disabled={start.isPending}
          onClick={() => start.mutate()}
          className="pressable mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Heart className="h-5 w-5" /> Começar Match
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Usa as indicações ainda não assistidas.
        </p>
        {lastResult}
      </div>
    );

  if (!me.data) {
    return (
      <div className="px-4 pt-6 text-sm text-destructive">Não foi possível retomar este Match.</div>
    );
  }
  const m = me.data;
  const displayedWork = cardExit?.work ?? currentWork;

  return (
    <div className="px-4 pt-6">
      {header}
      {m.partnerWants && !m.iWant && (
        <p className="fade-enter mt-4 rounded-xl border border-border bg-card p-3 text-sm">
          {partnerName} quer encerrar. Encerre também para ver o resultado.
        </p>
      )}

      {displayedWork ? (
        <div className="mt-5">
          <div className="match-stack mx-auto" aria-live="polite">
            <div className="match-stack-back match-stack-back-far" aria-hidden="true" />
            <div className="match-stack-back match-stack-back-near" aria-hidden="true" />
            <div
              key={displayedWork.id}
              data-match-card={displayedWork.id}
              data-exit-direction={cardExit?.direction}
              className={`match-stack-current ${cardExit?.direction === "left" ? "match-card-exit-left" : cardExit?.direction === "right" ? "match-card-exit-right" : "match-card-arrive"}`}
            >
              <MatchPoster
                work={displayedWork}
                ready={
                  !!cardExit || loadedCardId === displayedWork.id || !displayedWork.poster_path
                }
                onReady={() => setLoadedCardId(displayedWork.id)}
              />
            </div>
          </div>
          <p
            className={`mt-4 text-center font-semibold transition-opacity duration-150 ${!cardExit && displayedWork.poster_path && loadedCardId !== displayedWork.id ? "opacity-0" : ""}`}
          >
            {displayedWork.title}
          </p>
          <p className="text-center text-xs text-muted-foreground">
            {[
              displayedWork.media_type === "tv" ? "Série" : "Filme",
              displayedWork.release_year,
              displayedWork.genres.slice(0, 2).join(", "),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-5 flex items-center justify-center gap-6">
            <button
              aria-label="Não hoje"
              disabled={Boolean(cardExit) || vote.isPending}
              onClick={() => castVote(false)}
              className="pressable flex h-16 w-16 flex-col items-center justify-center rounded-full border border-border bg-card disabled:opacity-50"
            >
              <X className="h-6 w-6" />
            </button>
            <button
              aria-label="Quero ver hoje"
              disabled={Boolean(cardExit) || vote.isPending}
              onClick={() => castVote(true)}
              className="pressable flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
            >
              <Heart className="h-6 w-6" />
            </button>
          </div>
          <div className="mt-2 flex justify-center gap-10 text-[11px] text-muted-foreground">
            <span>👎 não hoje</span>
            <span>❤️ hoje</span>
          </div>
        </div>
      ) : canRequestExtension && (!extensionAttempted || extend.isPending) ? (
        <div className="mt-6" aria-label="Preparando mais opções">
          <Sk className="mx-auto aspect-[2/3] w-52 rounded-xl" />
        </div>
      ) : (
        <div className="mt-5">
          <EmptyState
            title="Você votou em tudo por agora"
            text={
              space.partner
                ? "Quando quiser, peça para encerrar. O resultado aparece quando os dois encerrarem."
                : "Convide seu parceiro em Configurações para dar match."
            }
          />
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2">
        <button
          onClick={() => undo.mutate()}
          disabled={!m.lastVote || undo.isPending}
          className="pressable flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border text-sm disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" /> Desfazer último
        </button>
        <button
          onClick={() => requestClose.mutate(!m.iWant)}
          disabled={requestClose.isPending}
          className={`pressable min-h-11 rounded-xl text-sm ${m.iWant ? "border border-primary text-primary" : "bg-secondary"}`}
        >
          {m.iWant ? "Aguardando o outro…" : "Encerrar"}
        </button>
      </div>
      {deckDone && !canRequestExtension && !m.iWant && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Encerrar é necessário dos dois lados.
        </p>
      )}
      <button
        onClick={() => setConfirmingAbandon(true)}
        className="pressable mt-6 min-h-11 w-full rounded-xl text-sm text-muted-foreground"
      >
        Abandonar este Match
      </button>
      {lastResult}
      {abandonSheet}
    </div>
  );
}
