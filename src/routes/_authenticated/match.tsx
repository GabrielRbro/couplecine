import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, Poster } from "@/components/app/MediaCard";
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

function MatchPage() {
  const { data: space } = useSpace();
  const { data: works = [] } = useLibrary(space?.spaceId);
  const qc = useQueryClient();
  const spaceId = space?.spaceId;

  const session = useQuery({
    queryKey: ["match-session", spaceId],
    enabled: !!spaceId,
    refetchInterval: 4000,
    queryFn: async () => {
      const { data } = await supabase
        .from("match_sessions").select("id, work_ids, created_at")
        .eq("space_id", spaceId!).eq("status", "open")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });
  const sid = session.data?.id;

  const myVotes = useQuery({
    queryKey: ["match-votes", sid],
    enabled: !!sid,
    queryFn: async () => {
      const { data } = await supabase.from("match_votes").select("work_id").eq("session_id", sid!);
      return new Set((data ?? []).map((v) => v.work_id));
    },
  });
  const status = useQuery({
    queryKey: ["match-status", sid],
    enabled: !!sid,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("match_status", { _session: sid! });
      if (error) throw error;
      return data ?? [];
    },
  });

  const start = useMutation({
    mutationFn: async () => {
      const ids = works.filter(isIndicated).map((w) => w.id);
      if (ids.length === 0) throw new Error("Adicione indicações antes de começar.");
      const { error } = await supabase.from("match_sessions").insert({ space_id: spaceId!, created_by: space!.userId, work_ids: ids });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["match-session"] }),
    onError: (e) => toast.error(e.message),
  });
  const vote = useMutation({
    mutationFn: async ({ workId, liked }: { workId: string; liked: boolean }) => {
      const { error } = await supabase.from("match_votes").insert({ session_id: sid!, user_id: space!.userId, work_id: workId, liked });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match-votes", sid] });
      qc.invalidateQueries({ queryKey: ["match-status", sid] });
    },
    onError: () => toast.error("Não foi possível salvar o voto."),
  });
  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("match_sessions").update({ status: "closed" }).eq("id", sid!);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["match-session"] }),
  });

  if (!space) return null;
  const header = (
    <>
      <h1 className="text-2xl font-semibold">Match</h1>
      <p className="mt-1 text-sm text-muted-foreground">Cada um vota em segredo. Só aparece o que os dois quiserem ver.</p>
    </>
  );

  if (!session.isLoading && !session.data)
    return (
      <div className="px-4 pt-6">
        {header}
        <button disabled={start.isPending} onClick={() => start.mutate()} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-semibold text-primary-foreground disabled:opacity-50">
          <Heart className="h-5 w-5" /> Começar Match
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">Usa as indicações ainda não assistidas.</p>
      </div>
    );
  if (!session.data || !myVotes.data) return <div className="px-4 pt-6">{header}</div>;

  const byId = new Map(works.map((w) => [w.id, w]));
  const pool = session.data.work_ids.filter((id) => byId.has(id));
  const next = pool.find((id) => !myVotes.data.has(id));
  const total = pool.length;
  const partnerVoted = space.partner ? status.data?.find((s) => s.user_id === space.partner!.id)?.voted ?? 0 : null;
  const matches = (status.data?.[0]?.matches ?? []).map((id) => byId.get(id)).filter(Boolean);
  const current = next ? byId.get(next)! : null;

  return (
    <div className="px-4 pt-6">
      {header}
      <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
        <div className="rounded-xl border border-border bg-card p-2">Você · {myVotes.data.size}/{total}</div>
        <div className="rounded-xl border border-border bg-card p-2">
          {space.partner ? `${firstName(space.partner.display_name)} · ${partnerVoted}/${total}` : "Sem parceiro ainda"}
        </div>
      </div>

      {current ? (
        <div className="mt-5">
          <div className="mx-auto w-52"><Poster path={current.poster_path} title={current.title} /></div>
          <p className="mt-3 text-center font-semibold">{current.title}</p>
          <p className="text-center text-xs text-muted-foreground">{current.media_type === "tv" ? "Série" : "Filme"}{current.release_year ? ` · ${current.release_year}` : ""}</p>
          <div className="mt-5 flex justify-center gap-6">
            <button aria-label="Não" disabled={vote.isPending} onClick={() => vote.mutate({ workId: current.id, liked: false })} className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card disabled:opacity-50">
              <X className="h-7 w-7" />
            </button>
            <button aria-label="Quero ver" disabled={vote.isPending} onClick={() => vote.mutate({ workId: current.id, liked: true })} className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
              <Heart className="h-7 w-7" />
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5"><EmptyState title="Você votou em tudo" text={space.partner ? "Os matches aparecem aqui assim que os dois votarem." : "Convide seu parceiro em Configurações para dar match."} /></div>
      )}

      <section className="mt-7">
        <h2 className="mb-3 text-base font-semibold">Matches {matches.length > 0 && `(${matches.length})`}</h2>
        {matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum match ainda.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {matches.map((w) => (
              <Link key={w!.id} to="/work/$id" params={{ id: w!.id }}>
                <Poster path={w!.poster_path} title={w!.title} />
                <p className="mt-1 line-clamp-1 text-xs font-medium">{w!.title}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
      <button onClick={() => close.mutate()} className="mt-8 w-full rounded-xl border border-border py-3 text-sm text-muted-foreground">Encerrar e começar outro depois</button>
    </div>
  );
}
