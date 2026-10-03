import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Heart, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { Sk } from "@/components/app/ui";
import { supabase } from "@/integrations/supabase/client";
import { firstName, isIndicated, useLibrary, useSpace } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/match")({
  head: () => ({ meta: [{ title: "Match — AppCinema" }, { name: "description", content: "Votem em segredo e descubram o que os dois querem ver." }] }),
  component: () => (
    <AppShell>
      <MatchPage />
    </AppShell>
  ),
});

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

  const open = useQuery({
    queryKey: ["match-open", spaceId],
    enabled: !!spaceId,
    queryFn: async () => {
      const { data } = await supabase.from("match_sessions").select("id, work_ids, created_at").eq("space_id", spaceId!).eq("status", "open").maybeSingle();
      return data;
    },
  });
  const sid = open.data?.id;

  // Everything below returns only *my* data, plus a boolean "partner asked to close".
  const me = useQuery({
    queryKey: ["match-me", sid],
    enabled: !!sid,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data: limit, error } = await supabase.rpc("match_join", { _session: sid! });
      if (error) throw error;
      const [{ data: votes }, { data: part }, { data: partnerWants }] = await Promise.all([
        supabase.from("match_votes").select("work_id, created_at").eq("session_id", sid!).order("created_at"),
        supabase.from("match_participants").select("close_requested").eq("session_id", sid!).maybeSingle(),
        supabase.rpc("match_partner_wants_close", { _session: sid! }),
      ]);
      return { limit: limit ?? 0, voted: new Set((votes ?? []).map((v) => v.work_id)), lastVote: votes?.at(-1)?.work_id ?? null, iWant: !!part?.close_requested, partnerWants: !!partnerWants };
    },
  });

  const last = useQuery({
    queryKey: ["last-match", spaceId],
    enabled: !!spaceId,
    queryFn: async () => {
      const { data } = await supabase.from("match_sessions").select("id, result_work_ids, closed_at").eq("space_id", spaceId!).eq("status", "closed").order("closed_at", { ascending: false }).limit(1).maybeSingle();
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
      const ids = works.filter(isIndicated).map((w) => w.id);
      if (ids.length < 2) throw new Error("Adicione pelo menos 2 indicações antes de começar.");
      const { error } = await supabase.from("match_sessions").insert({ space_id: spaceId!, created_by: space!.userId, work_ids: ids });
      if (error) throw new Error("Já existe um Match em andamento.");
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });
  const vote = useMutation({
    mutationFn: async ({ workId, liked }: { workId: string; liked: boolean }) => {
      const { error } = await supabase.from("match_votes").insert({ session_id: sid!, user_id: space!.userId, work_id: workId, liked });
      if (error) throw error;
    },
    onMutate: ({ workId }) => {
      // Optimistic: advance the deck immediately.
      qc.setQueryData(["match-me", sid], (old: typeof me.data) => old && { ...old, voted: new Set(old.voted).add(workId), lastVote: workId });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["match-me", sid] }),
    onError: () => toast.error("Não foi possível salvar o voto."),
  });
  const undo = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("match_undo", { _session: sid! });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["match-me", sid] }),
  });
  const extend = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("match_extend", { _session: sid! });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["match-me", sid] }),
  });
  const requestClose = useMutation({
    mutationFn: async (want: boolean) => {
      const { data, error } = await supabase.rpc("match_request_close", { _session: sid!, _want: want });
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
      const { error } = await supabase.rpc("match_abandon", { _session: sid! });
      if (error) throw error;
    },
    onSuccess: () => { toast("Match abandonado. Nada foi revelado."); invalidate(); },
  });

  const byId = useMemo(() => new Map(works.map((w) => [w.id, w])), [works]);
  const deck = useMemo(
    () => (open.data && space ? seededShuffle(open.data.work_ids.filter((id) => byId.has(id)), `${open.data.id}:${space.userId}`) : []),
    [open.data, space, byId],
  );

  if (!space) return null;
  const partnerName = space.partner ? firstName(space.partner.display_name) : "seu parceiro";
  const header = (
    <>
      <h1 className="text-2xl font-semibold">Match</h1>
      <p className="mt-1 text-sm text-muted-foreground">Cada um vota em segredo. O resultado só aparece quando os dois encerrarem.</p>
    </>
  );

  const results = (last.data?.result_work_ids ?? []).map((id) => byId.get(id)).filter(Boolean);
  const lastResult = last.data && (
    <section className="mt-8">
      <h2 className="mb-3 text-base font-semibold">Último resultado</h2>
      {results.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma obra em comum no último Match.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {results.map((w) => (
            <Link key={w!.id} to="/work/$id" params={{ id: w!.id }} className="pressable">
              <Poster path={w!.poster_path} title={w!.title} />
              <p className="mt-1 line-clamp-1 text-xs font-medium">{w!.title}</p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );

  if (open.isLoading || (sid && !me.data))
    return (
      <div className="px-4 pt-6">
        {header}
        <Sk className="mx-auto mt-6 aspect-[2/3] w-52 rounded-xl" />
      </div>
    );

  if (!open.data)
    return (
      <div className="px-4 pt-6">
        {header}
        <button disabled={start.isPending} onClick={() => start.mutate()} className="pressable mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-50">
          <Heart className="h-5 w-5" /> Começar Match
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">Usa as indicações ainda não assistidas.</p>
        {lastResult}
      </div>
    );

  const m = me.data!;
  const myDeck = deck.slice(0, m.limit);
  const next = myDeck.find((id) => !m.voted.has(id));
  const current = next ? byId.get(next)! : null;
  const deckDone = !current;
  const canExtend = deckDone && m.limit < deck.length;

  return (
    <div className="px-4 pt-6">
      {header}
      {m.partnerWants && !m.iWant && (
        <p className="fade-enter mt-4 rounded-xl border border-border bg-card p-3 text-sm">{partnerName} quer encerrar. Encerre também para ver o resultado.</p>
      )}

      {current ? (
        <div key={current.id} className="page-enter mt-5">
          <div className="mx-auto w-52"><Poster path={current.poster_path} title={current.title} /></div>
          <p className="mt-3 text-center font-semibold">{current.title}</p>
          <p className="text-center text-xs text-muted-foreground">
            {[current.media_type === "tv" ? "Série" : "Filme", current.release_year, current.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-5 flex items-center justify-center gap-6">
            <button aria-label="Não hoje" disabled={vote.isPending} onClick={() => vote.mutate({ workId: current.id, liked: false })} className="pressable flex h-16 w-16 flex-col items-center justify-center rounded-full border border-border bg-card disabled:opacity-50">
              <X className="h-6 w-6" />
            </button>
            <button aria-label="Quero ver hoje" disabled={vote.isPending} onClick={() => vote.mutate({ workId: current.id, liked: true })} className="pressable flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
              <Heart className="h-6 w-6" />
            </button>
          </div>
          <div className="mt-2 flex justify-center gap-10 text-[11px] text-muted-foreground"><span>👎 não hoje</span><span>❤️ hoje</span></div>
        </div>
      ) : canExtend ? (
        <div className="mt-6 text-center">
          <button onClick={() => extend.mutate()} disabled={extend.isPending} className="pressable min-h-12 rounded-2xl bg-primary px-6 font-semibold text-primary-foreground">Ver mais opções</button>
        </div>
      ) : (
        <div className="mt-5"><EmptyState title="Você votou em tudo por agora" text={space.partner ? "Quando quiser, peça para encerrar. O resultado aparece quando os dois encerrarem." : "Convide seu parceiro em Configurações para dar match."} /></div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2">
        <button onClick={() => undo.mutate()} disabled={!m.lastVote || undo.isPending} className="pressable flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border text-sm disabled:opacity-40">
          <Undo2 className="h-4 w-4" /> Desfazer último
        </button>
        <button onClick={() => requestClose.mutate(!m.iWant)} disabled={requestClose.isPending} className={`pressable min-h-11 rounded-xl text-sm ${m.iWant ? "border border-primary text-primary" : "bg-secondary"}`}>
          {m.iWant ? "Aguardando o outro…" : "Encerrar"}
        </button>
      </div>
      {deckDone && !canExtend && !m.iWant && <p className="mt-2 text-center text-xs text-muted-foreground">Encerrar é necessário dos dois lados.</p>}
      <button onClick={() => confirm("Abandonar este Match? Os votos não serão revelados.") && abandon.mutate()} className="pressable mt-6 min-h-11 w-full rounded-xl text-sm text-muted-foreground">
        Abandonar este Match
      </button>
      {lastResult}
    </div>
  );
}
