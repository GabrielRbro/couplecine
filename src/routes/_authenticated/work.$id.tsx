import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Check, Tv } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { Poster } from "@/components/app/MediaCard";
import { supabase } from "@/integrations/supabase/client";
import { getSeasonEpisodes, getWorkDetails } from "@/lib/catalog.functions";
import { ALL_REACTIONS, formatDate, formatRuntime, formatScore, REACTION_EMOJI, SERIES_STATUS_LABEL, tmdbImage, type Reaction } from "@/lib/format";
import { firstName, useSpace, type SpaceInfo } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/work/$id")({
  head: () => ({ meta: [{ title: "Detalhes — AppCinema" }, { name: "description", content: "Detalhes, reações e notas do casal." }] }),
  component: () => (
    <AppShell>
      <WorkPage />
    </AppShell>
  ),
});

const SCORES = Array.from({ length: 21 }, (_, i) => i / 2);

function useWork(id: string) {
  return useQuery({
    queryKey: ["work", id],
    queryFn: async () => {
      const [w, i, r, p, s, e, j] = await Promise.all([
        supabase.from("works").select("*").eq("id", id).maybeSingle(),
        supabase.from("interests").select("user_id, reaction").eq("work_id", id),
        supabase.from("ratings").select("user_id, score").eq("work_id", id),
        supabase.from("prior_watch_status").select("user_id, watched").eq("work_id", id),
        supabase.from("series_states").select("*").eq("work_id", id).maybeSingle(),
        supabase.from("watch_events").select("id, season_number, episode_number, watched_at").eq("work_id", id),
        supabase.from("joint_watch_sessions").select("id, watched_at").eq("work_id", id).order("watched_at", { ascending: false }),
      ]);
      if (!w.data) throw new Error("Obra não encontrada");
      return { work: w.data, interests: i.data ?? [], ratings: r.data ?? [], prior: p.data ?? [], state: s.data, events: e.data ?? [], sessions: j.data ?? [] };
    },
  });
}

function WorkPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { data: space } = useSpace();
  const { data, isLoading, error } = useWork(id);
  const details = useServerFn(getWorkDetails);
  const meta = useQuery({ queryKey: ["meta", id], queryFn: () => details({ data: { workId: id } }), staleTime: 3600_000 });
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["work", id] }); qc.invalidateQueries({ queryKey: ["library"] }); };

  if (isLoading || !space) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
  if (error || !data) return <p className="p-6 text-sm text-destructive">Obra não encontrada.</p>;
  const { work } = data;
  const m = meta.data;
  const isTv = work.media_type === "tv";

  return (
    <div>
      <div className="relative h-44 overflow-hidden">
        {tmdbImage(work.backdrop_path, "w780") && <img src={tmdbImage(work.backdrop_path, "w780")!} alt="" className="h-full w-full object-cover opacity-40" />}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
        <button onClick={() => router.history.back()} aria-label="Voltar" className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-background/70"><ArrowLeft className="h-5 w-5" /></button>
      </div>
      <div className="-mt-24 relative flex gap-4 px-4">
        <div className="w-28 shrink-0"><Poster path={work.poster_path} title={work.title} /></div>
        <div className="min-w-0 self-end">
          <h1 className="text-xl font-semibold leading-tight">{work.title}</h1>
          {work.original_title && work.original_title !== work.title && <p className="text-xs text-muted-foreground">{work.original_title}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {[isTv ? "Série" : "Filme", work.release_year, isTv && m?.seasonCount ? `${m.seasonCount} temp.` : formatRuntime(work.runtime_minutes)].filter(Boolean).join(" · ")}
          </p>
          {work.genres.length > 0 && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{work.genres.join(", ")}</p>}
          <button disabled className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground" title="Envio para a TV não configurado">
            <Tv className="h-3.5 w-3.5" /> TV · não configurado
          </button>
        </div>
      </div>

      <div className="space-y-6 px-4 pt-6">
        <Comparison space={space} workId={id} interests={data.interests as { user_id: string; reaction: Reaction }[]} ratings={data.ratings} onChange={refresh} />
        <PriorWatch space={space} workId={id} prior={data.prior} onChange={refresh} />

        {isTv ? (
          <SeriesBlock space={space} workId={id} state={data.state} events={data.events} seasons={m?.seasons ?? []} overview={m?.overview ?? work.overview} onChange={refresh} />
        ) : (
          <>
            <Synopsis text={m?.overview ?? work.overview} />
            <MovieWatched space={space} workId={id} sessions={data.sessions} onChange={refresh} />
          </>
        )}

        {m && (
          <section>
            <h2 className="mb-3 font-semibold">Elenco</h2>
            <div className="no-scrollbar -mx-4 flex items-start gap-3 overflow-x-auto px-4">
              {m.crewLead && (
                <>
                  <Person name={m.crewLead.name} top={m.crewLead.role} path={m.crewLead.profilePath} />
                  <div className="h-24 w-px shrink-0 self-center bg-border" />
                </>
              )}
              {m.cast.map((c) => <Person key={c.name + c.character} top={c.character} name={c.name} path={c.profilePath} />)}
            </div>
          </section>
        )}
        {meta.error && <p className="text-xs text-muted-foreground">{meta.error.message}</p>}
        <section>
          <h2 className="mb-2 font-semibold">Posts relacionados</h2>
          <p className="text-xs text-muted-foreground">Importação de posts chega numa próxima fase.</p>
        </section>
      </div>
    </div>
  );
}

function Synopsis({ text }: { text: string | null }) {
  return (
    <section>
      <h2 className="mb-2 font-semibold">Sinopse</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">{text || "Sem sinopse disponível."}</p>
    </section>
  );
}

function Person({ top, name, path }: { top: string; name: string; path: string | null }) {
  const src = tmdbImage(path, "w185");
  return (
    <div className="w-20 shrink-0 text-center">
      {src ? <img src={src} alt={name} className="mx-auto h-20 w-20 rounded-full object-cover" /> : <div className="mx-auto h-20 w-20 rounded-full bg-muted" />}
      <p className="mt-1.5 line-clamp-2 text-xs font-semibold">{top}</p>
      <p className="line-clamp-1 text-[11px] text-muted-foreground">{name}</p>
    </div>
  );
}

function Comparison({ space, workId, interests, ratings, onChange }: {
  space: SpaceInfo; workId: string; interests: { user_id: string; reaction: Reaction }[]; ratings: { user_id: string; score: number }[]; onChange: () => void;
}) {
  const [editing, setEditing] = useState<"reaction" | "score" | null>(null);
  const mine = interests.find((i) => i.user_id === space.userId);
  const myScore = ratings.find((r) => r.user_id === space.userId);
  const partnerId = space.partner?.id;
  const theirs = interests.find((i) => i.user_id === partnerId);
  const theirScore = ratings.find((r) => r.user_id === partnerId);
  const avg = myScore && theirScore ? (Number(myScore.score) + Number(theirScore.score)) / 2 : null;

  async function setReaction(reaction: Reaction) {
    const { error } = await supabase.from("interests").upsert({ work_id: workId, user_id: space.userId, reaction }, { onConflict: "user_id,work_id" });
    if (error) toast.error("Não foi possível salvar."); else onChange();
    setEditing(null);
  }
  async function setScore(score: number | null) {
    const { error } = score === null
      ? await supabase.from("ratings").delete().eq("work_id", workId).eq("user_id", space.userId)
      : await supabase.from("ratings").upsert({ work_id: workId, user_id: space.userId, score }, { onConflict: "user_id,work_id" });
    if (error) toast.error("Não foi possível salvar."); else onChange();
    setEditing(null);
  }

  const Col = ({ label, r, s, own }: { label: string; r: Reaction | undefined; s: number | undefined; own: boolean }) => (
    <div className="flex-1 rounded-xl bg-secondary p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-center justify-between">
        <button disabled={!own} onClick={() => setEditing("reaction")} className="text-2xl" aria-label="Reação">{r ? REACTION_EMOJI[r] : "—"}</button>
        <button disabled={!own} onClick={() => setEditing("score")} className="text-lg font-semibold" aria-label="Nota">{s !== undefined ? formatScore(Number(s)) : own ? <span className="text-xs text-primary">Dar nota</span> : "—"}</button>
      </div>
    </div>
  );

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <div className="flex gap-2">
        <Col label="Você" r={mine?.reaction} s={myScore?.score} own />
        <Col label={space.partner ? firstName(space.partner.display_name) : "Parceiro (convide)"} r={theirs?.reaction} s={theirScore?.score} own={false} />
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">{avg !== null ? `Média do casal: ${formatScore(avg)}` : "A média aparece quando os dois avaliarem."}</p>
      {editing === "reaction" && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {ALL_REACTIONS.map((r) => (
            <button key={r} onClick={() => setReaction(r)} className={`rounded-xl border py-2 text-2xl ${mine?.reaction === r ? "border-primary" : "border-border"}`}>{REACTION_EMOJI[r]}</button>
          ))}
        </div>
      )}
      {editing === "score" && (
        <div className="mt-3">
          <div className="grid grid-cols-7 gap-1.5">
            {SCORES.map((s) => (
              <button key={s} onClick={() => setScore(s)} className={`rounded-lg border py-1.5 text-xs ${Number(myScore?.score) === s ? "border-primary bg-accent" : "border-border"}`}>{formatScore(s)}</button>
            ))}
          </div>
          {myScore && <button onClick={() => setScore(null)} className="mt-2 text-xs text-muted-foreground underline">Remover minha nota</button>}
        </div>
      )}
    </section>
  );
}

function PriorWatch({ space, workId, prior, onChange }: { space: SpaceInfo; workId: string; prior: { user_id: string; watched: boolean }[]; onChange: () => void }) {
  const mine = prior.find((p) => p.user_id === space.userId)?.watched ?? false;
  const theirs = prior.find((p) => p.user_id === space.partner?.id)?.watched ?? false;
  async function toggle() {
    const { error } = await supabase.from("prior_watch_status").upsert({ work_id: workId, user_id: space.userId, watched: !mine }, { onConflict: "user_id,work_id" });
    if (error) toast.error("Não foi possível salvar."); else onChange();
  }
  return (
    <div className="flex items-center justify-between text-sm">
      <button onClick={toggle} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${mine ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
        {mine && <Check className="h-3.5 w-3.5" />} Eu já assisti antes
      </button>
      {theirs && <span className="text-xs text-muted-foreground">{firstName(space.partner?.display_name)} já assistiu antes</span>}
    </div>
  );
}

function MovieWatched({ space, workId, sessions, onChange }: { space: SpaceInfo; workId: string; sessions: { id: string; watched_at: string }[]; onChange: () => void }) {
  const mark = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("joint_watch_sessions").insert({ space_id: space.spaceId!, work_id: workId, created_by: space.userId });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Marcado como assistido juntos"); onChange(); },
    onError: () => toast.error("Não foi possível salvar."),
  });
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="font-semibold">Assistido juntos</h2>
      {sessions.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{sessions.map((s) => formatDate(s.watched_at)).join(" · ")}</p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Ainda não assistiram juntos.</p>
      )}
      <button onClick={() => mark.mutate()} disabled={mark.isPending} className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
        {sessions.length > 0 ? "Assistimos de novo" : "Assistimos juntos"}
      </button>
    </section>
  );
}

type Ev = { id: string; season_number: number | null; episode_number: number | null };

function SeriesBlock({ space, workId, state, events, seasons, overview, onChange }: {
  space: SpaceInfo; workId: string; state: { id: string; status: string } | null; events: Ev[];
  seasons: { seasonNumber: number; name: string; episodeCount: number }[]; overview: string | null; onChange: () => void;
}) {
  const [season, setSeason] = useState(1);
  const fetchSeason = useServerFn(getSeasonEpisodes);
  const eps = useQuery({ queryKey: ["season", workId, season], queryFn: () => fetchSeason({ data: { workId, season } }), staleTime: 3600_000, enabled: seasons.length > 0 });
  const seen = new Set(events.map((e) => `${e.season_number}:${e.episode_number}`));
  const total = seasons.reduce((a, s) => a + s.episodeCount, 0);

  let next: { s: number; e: number } | null = null;
  for (const s of seasons) {
    for (let e = 1; e <= s.episodeCount; e++) if (!seen.has(`${s.seasonNumber}:${e}`)) { next = { s: s.seasonNumber, e }; break; }
    if (next) break;
  }

  async function writeState(status: string) {
    const payload = { status: status as "watching", next_season: next?.s ?? null, next_episode: next?.e ?? null, updated_by: space.userId };
    const { error } = state
      ? await supabase.from("series_states").update(payload).eq("id", state.id)
      : await supabase.from("series_states").insert({ ...payload, space_id: space.spaceId!, work_id: workId });
    if (error) toast.error("Não foi possível salvar o status."); else onChange();
  }

  async function toggle(s: number, e: number) {
    const key = `${s}:${e}`;
    const existing = events.find((x) => `${x.season_number}:${x.episode_number}` === key);
    const { error } = existing
      ? await supabase.from("watch_events").delete().eq("id", existing.id)
      : await supabase.from("watch_events").insert({ space_id: space.spaceId!, work_id: workId, season_number: s, episode_number: e, created_by: space.userId });
    if (error) { toast.error("Não foi possível salvar."); return; }
    if (!state) await writeState("watching"); else onChange();
  }

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Progresso do casal</h2>
          <select value={state?.status ?? ""} onChange={(e) => writeState(e.target.value)} className="rounded-lg border border-border bg-secondary px-2 py-1 text-xs">
            {!state && <option value="">Não iniciada</option>}
            {Object.entries(SERIES_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: total ? `${Math.min(100, (seen.size / total) * 100)}%` : "0%" }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {seen.size} de {total || "?"} episódios · {next ? `Próximo: T${next.s} E${next.e}` : total ? "Tudo em dia" : ""}
        </p>
      </section>

      <Synopsis text={overview} />

      {seasons.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Temporadas</h2>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {seasons.map((s) => (
              <button key={s.seasonNumber} onClick={() => setSeason(s.seasonNumber)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${season === s.seasonNumber ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
                T{s.seasonNumber}
              </button>
            ))}
          </div>
          <div className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4">
            {eps.isLoading && <p className="text-xs text-muted-foreground">Carregando episódios…</p>}
            {eps.data?.map((ep) => {
              const done = seen.has(`${ep.seasonNumber}:${ep.episodeNumber}`);
              const img = tmdbImage(ep.stillPath, "w300");
              return (
                <button key={ep.episodeNumber} onClick={() => toggle(ep.seasonNumber, ep.episodeNumber)} className="w-44 shrink-0 text-left">
                  <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
                    {img && <img src={img} alt="" loading="lazy" className={`h-full w-full object-cover ${done ? "opacity-50" : ""}`} />}
                    <span className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full ${done ? "bg-primary text-primary-foreground" : "border border-foreground/40 bg-background/60"}`}>
                      {done && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-xs font-medium">E{ep.episodeNumber} · {ep.name}</p>
                  <p className="text-[11px] text-muted-foreground">{formatRuntime(ep.runtimeMinutes) ?? formatDate(ep.airDate) ?? ""}</p>
                </button>
              );
            })}
          </div>
        </section>
      )}
      <Link to="/library" className="hidden" />
    </>
  );
}
