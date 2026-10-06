import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Trash2, Tv } from "lucide-react";
import { DetailSkeleton, useBack } from "@/components/app/ui";
import { toast } from "sonner";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { AppShell } from "@/components/app/AppShell";
import { Poster } from "@/components/app/MediaCard";
import { ScorePicker } from "@/components/app/ScorePicker";
import { supabase } from "@/integrations/supabase/client";
import { getSeasonEpisodes, getWorkDetails } from "@/lib/catalog.functions";
import {
  ALL_REACTIONS,
  formatDate,
  formatRuntime,
  formatScore,
  REACTION_EMOJI,
  SERIES_STATUS_LABEL,
  tmdbImage,
  type Reaction,
} from "@/lib/format";
import { firstName, useSpace, type LibraryWork, type SpaceInfo } from "@/lib/space";
import { useSharedStyle } from "@/lib/shared-transition";
import { scheduleWorkDelete } from "@/lib/pending-delete";

function BackOverlay() {
  const back = useBack("/library");
  return (
    <button
      onClick={back}
      aria-label="Voltar"
      className="pressable absolute left-4 top-[max(env(safe-area-inset-top),16px)] flex h-11 w-11 items-center justify-center rounded-full bg-background/70 backdrop-blur"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}

export const Route = createFileRoute("/_authenticated/work/$id")({
  head: () => ({
    meta: [
      { title: "Detalhes — AppCinema" },
      { name: "description", content: "Detalhes, reações e notas do casal." },
    ],
  }),
  // Primes the work query so the page (and its shared poster) renders with data on arrival.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(workQuery(params.id));
  },
  errorComponent: () => (
    <p className="p-6 text-sm text-destructive">Não foi possível abrir a obra.</p>
  ),
  notFoundComponent: () => <p className="p-6 text-sm">Obra não encontrada.</p>,
  component: () => (
    <AppShell skeleton={<DetailSkeleton />}>
      <WorkPage />
    </AppShell>
  ),
});


function useWork(id: string) {
  return useQuery(workQuery(id));
}

function workQuery(id: string) {
  return {
    queryKey: ["work", id],
    staleTime: 30_000,
    queryFn: async () => {
      const [w, i, r, p, s, e, j, n] = await Promise.all([
        supabase.from("works").select("*").eq("id", id).maybeSingle(),
        supabase.from("interests").select("user_id, reaction").eq("work_id", id),
        supabase.from("ratings").select("user_id, score").eq("work_id", id),
        supabase.from("prior_watch_status").select("user_id, watched").eq("work_id", id),
        supabase.from("series_states").select("*").eq("work_id", id).maybeSingle(),
        supabase
          .from("watch_events")
          .select("id, season_number, episode_number, watched_at")
          .eq("work_id", id),
        supabase
          .from("joint_watch_sessions")
          .select("id, watched_at")
          .eq("work_id", id)
          .order("watched_at", { ascending: false }),
        supabase
          .from("indications")
          .select("id, indicated_by, created_at, renewed_at")
          .eq("work_id", id)
          .order("created_at"),
      ]);
      // Any failed read is an error, never an empty interest/rating/history.
      const failed = [w, i, r, p, s, e, j, n].find((x) => x.error);
      if (failed?.error) throw new Error("Não foi possível carregar a obra. Tente de novo.");
      if (!w.data) throw new Error("Obra não encontrada");
      return {
        work: w.data,
        interests: i.data ?? [],
        ratings: r.data ?? [],
        prior: p.data ?? [],
        state: s.data,
        events: e.data ?? [],
        sessions: j.data ?? [],
        indications: n.data ?? [],
      };
    },
  };
}

function WorkPage() {
  const { id } = Route.useParams();
  const { data: space } = useSpace();
  const { data, isLoading, error } = useWork(id);
  const details = useServerFn(getWorkDetails);
  const meta = useQuery({
    queryKey: ["meta", id],
    queryFn: () => details({ data: { workId: id } }),
    staleTime: 3600_000,
  });
  const qc = useQueryClient();
  const sharedBackdrop = useSharedStyle(id, "backdrop");
  const sharedPoster = useSharedStyle(id, "poster");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["work", id] });
    qc.invalidateQueries({ queryKey: ["library"] });
  };

  if (isLoading || !space) return <DetailSkeleton />;
  if (error || !data)
    return (
      <div className="p-6 text-sm">
        <p className="text-destructive">{error?.message ?? "Obra não encontrada."}</p>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["work", id] })}
          className="pressable mt-3 min-h-11 rounded-xl border border-border px-4"
        >
          Tentar de novo
        </button>
      </div>
    );
  const { work } = data;
  const m = meta.data;
  const isTv = work.media_type === "tv";
  // Season count comes from the cached summary first, so "N temp." never pops in late.
  const cachedSeasons = (
    qc.getQueryData<LibraryWork[]>(["library", space.spaceId]) ?? []
  ).find((w) => w.id === id)?.work_metadata_cache[0]?.seasons?.length;
  const seasonCount = m?.seasonCount ?? cachedSeasons ?? null;

  return (
    <div>
      <div className="relative h-64 overflow-hidden">
        {tmdbImage(work.backdrop_path, "w1280") ? (
          <img
            src={tmdbImage(work.backdrop_path, "w1280")!}
            alt=""
            style={sharedBackdrop}
            className="h-full w-full object-cover opacity-80"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-accent to-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-transparent to-background" />
        <BackOverlay />
      </div>
      <div className="relative -mt-28 flex gap-4 px-4">
        <div className="w-28 shrink-0 shadow-2xl" style={sharedPoster}>
          <Poster path={work.poster_path} title={work.title} />
        </div>
        <div className="min-w-0 self-end">
          <h1 className="text-2xl font-semibold leading-tight">{work.title}</h1>
          {work.original_title && work.original_title !== work.title && (
            <p className="text-xs text-muted-foreground">{work.original_title}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {isTv ? "Série" : "Filme"}
            {work.release_year ? ` · ${work.release_year}` : ""}
            {isTv ? (
              <span className="inline-block min-w-[4.5rem]">
                {seasonCount ? ` · ${seasonCount} temp.` : ""}
              </span>
            ) : work.runtime_minutes ? (
              ` · ${formatRuntime(work.runtime_minutes)}`
            ) : (
              ""
            )}
          </p>
          {work.genres.length > 0 && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {work.genres.join(", ")}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-6 px-4 pt-5">
        {isTv && (
          <SeriesProgressStrip
            space={space}
            workId={id}
            state={data.state}
            events={data.events}
            seasons={m?.seasons ?? []}
            onChange={refresh}
          />
        )}
        <button
          disabled
          aria-label="Assistir na TV, não configurado"
          title="Envio para a TV não configurado"
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground"
        >
          <Tv className="h-4 w-4" /> Assistir na TV · não configurado
        </button>
        <Comparison
          space={space}
          workId={id}
          interests={data.interests as { user_id: string; reaction: Reaction }[]}
          ratings={data.ratings}
          onChange={refresh}
        />
        <section>
          <h2 className="mb-3 font-semibold">Indicação e histórico</h2>
          <div className="space-y-3">
            <IndicationsBlock
              space={space}
              workId={id}
              title={work.title}
              indications={data.indications}
              onChange={refresh}
            />
            <PriorWatch space={space} workId={id} prior={data.prior} onChange={refresh} />
            {!isTv && (
              <MovieWatched space={space} workId={id} sessions={data.sessions} onChange={refresh} />
            )}
          </div>
        </section>

        {isTv ? (
          <>
            <Synopsis text={m?.overview ?? work.overview} />
            <SeriesBlock
              space={space}
              workId={id}
              state={data.state}
              events={data.events}
              seasons={m?.seasons ?? []}
              fallbackImage={work.backdrop_path ?? work.poster_path}
              onChange={refresh}
            />
          </>
        ) : (
          <Synopsis text={m?.overview ?? work.overview} />
        )}

        {m && (
          <section>
            <h2 className="mb-3 font-semibold">Elenco</h2>
            <div className="no-scrollbar -mx-4 flex items-start gap-3 overflow-x-auto px-4">
              {m.crewLead && (
                <>
                  <Person
                    name={m.crewLead.name}
                    top={m.crewLead.role}
                    path={m.crewLead.profilePath}
                  />
                  <div className="h-24 w-px shrink-0 self-center bg-border" />
                </>
              )}
              {m.cast.map((c) => (
                <Person
                  key={c.name + c.character}
                  top={c.character}
                  name={c.name}
                  path={c.profilePath}
                />
              ))}
            </div>
          </section>
        )}
        {meta.error && <p className="text-xs text-muted-foreground">{meta.error.message}</p>}
        <section>
          <h2 className="mb-2 font-semibold">Posts relacionados</h2>
          <p className="text-xs text-muted-foreground">
            Importação de posts chega numa próxima fase.
          </p>
        </section>
      </div>
    </div>
  );
}

function Synopsis({ text }: { text: string | null }) {
  return (
    <section>
      <h2 className="mb-2 font-semibold">Sinopse</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {text || "Sem sinopse disponível."}
      </p>
    </section>
  );
}

function Person({ top, name, path }: { top: string; name: string; path: string | null }) {
  const src = tmdbImage(path, "w185");
  return (
    <div className="w-20 shrink-0 text-center">
      {src ? (
        <img src={src} alt={name} className="mx-auto h-20 w-20 rounded-full object-cover" />
      ) : (
        <div className="mx-auto h-20 w-20 rounded-full bg-muted" />
      )}
      <p className="mt-1.5 line-clamp-2 text-xs font-semibold">{top}</p>
      <p className="line-clamp-1 text-[11px] text-muted-foreground">{name}</p>
    </div>
  );
}

function Comparison({
  space,
  workId,
  interests,
  ratings,
  onChange,
}: {
  space: SpaceInfo;
  workId: string;
  interests: { user_id: string; reaction: Reaction }[];
  ratings: { user_id: string; score: number }[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<"reaction" | "score" | null>(null);
  const [saving, setSaving] = useState(false);
  const mine = interests.find((i) => i.user_id === space.userId);
  const myScore = ratings.find((r) => r.user_id === space.userId);
  const partnerId = space.partner?.id;
  const theirs = interests.find((i) => i.user_id === partnerId);
  const theirScore = ratings.find((r) => r.user_id === partnerId);
  const avg = myScore && theirScore ? (Number(myScore.score) + Number(theirScore.score)) / 2 : null;
  const partnerLabel = space.partner ? firstName(space.partner.display_name) : "Parceiro";

  async function setReaction(reaction: Reaction) {
    const { error } = await supabase
      .from("interests")
      .upsert(
        { work_id: workId, user_id: space.userId, reaction },
        { onConflict: "user_id,work_id" },
      );
    if (error) toast.error("Não foi possível salvar.");
    else onChange();
    setEditing(null);
  }
  async function setScore(score: number | null) {
    setSaving(true);
    const { error } =
      score === null
        ? await supabase.from("ratings").delete().eq("work_id", workId).eq("user_id", space.userId)
        : await supabase
            .from("ratings")
            .upsert(
              { work_id: workId, user_id: space.userId, score },
              { onConflict: "user_id,work_id" },
            );
    setSaving(false);
    if (error) return toast.error("Não foi possível salvar.");
    onChange();
    setEditing(null);
  }

  const cell = "pressable flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center";
  return (
    <section>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-card px-2 py-1.5">
          <h2 className="px-1 text-[11px] font-semibold text-muted-foreground">Interesse</h2>
          <div className="flex divide-x divide-border">
            <button
              onClick={() => setEditing(editing === "reaction" ? null : "reaction")}
              aria-label="Eu: interesse"
              aria-expanded={editing === "reaction"}
              className={cell}
            >
              <span className="emoji text-xl leading-none">
                {mine ? REACTION_EMOJI[mine.reaction] : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground">Eu</span>
            </button>
            <div className={cell} aria-label={`${partnerLabel}: interesse`}>
              <span className="emoji text-xl leading-none">
                {theirs ? REACTION_EMOJI[theirs.reaction] : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground">{partnerLabel}</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-2 py-1.5">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-[11px] font-semibold text-muted-foreground">Avaliação</h2>
            {avg !== null && (
              <span className="text-[10px] font-semibold text-primary">
                Média {formatScore(avg)}
              </span>
            )}
          </div>
          <div className="flex divide-x divide-border">
            <button onClick={() => setEditing("score")} aria-label="Eu: dar nota" className={cell}>
              <span className="text-base font-semibold leading-tight">
                {myScore ? (
                  formatScore(Number(myScore.score))
                ) : (
                  <span className="text-xs text-primary">Dar nota</span>
                )}
              </span>
              <span className="text-[10px] text-muted-foreground">Eu</span>
            </button>
            <div className={cell} aria-label={`${partnerLabel}: avaliação`}>
              <span className="text-base font-semibold leading-tight">
                {theirScore ? formatScore(Number(theirScore.score)) : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground">{partnerLabel}</span>
            </div>
          </div>
        </div>
      </div>
      {editing === "reaction" && (
        <div className="fade-enter mt-2 grid grid-cols-4 gap-2">
          {ALL_REACTIONS.map((r) => (
            <button
              key={r}
              onClick={() => setReaction(r)}
              aria-label={r}
              className={`pressable emoji min-h-11 rounded-xl border text-2xl ${mine?.reaction === r ? "border-primary bg-accent" : "border-border"}`}
            >
              {REACTION_EMOJI[r]}
            </button>
          ))}
        </div>
      )}
      <ScorePicker
        open={editing === "score"}
        title="Sua nota"
        initial={myScore ? Number(myScore.score) : null}
        saving={saving}
        onClose={() => setEditing(null)}
        onSave={(s) => setScore(s)}
        onRemove={myScore ? () => setScore(null) : undefined}
      />
    </section>
  );
}

function PriorWatch({
  space,
  workId,
  prior,
  onChange,
}: {
  space: SpaceInfo;
  workId: string;
  prior: { user_id: string; watched: boolean }[];
  onChange: () => void;
}) {
  const mine = prior.find((p) => p.user_id === space.userId)?.watched ?? false;
  const theirs = prior.find((p) => p.user_id === space.partner?.id)?.watched ?? false;
  async function toggle() {
    const { error } = await supabase
      .from("prior_watch_status")
      .upsert(
        { work_id: workId, user_id: space.userId, watched: !mine },
        { onConflict: "user_id,work_id" },
      );
    if (error) toast.error("Não foi possível salvar.");
    else onChange();
  }
  return (
    <div className="flex items-center justify-between text-sm">
      <button
        onClick={toggle}
        className={`hit pressable inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${mine ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
      >
        {mine && <Check className="h-3.5 w-3.5" />} Eu já assisti antes
      </button>
      {theirs && (
        <span className="text-xs text-muted-foreground">
          {firstName(space.partner?.display_name)} já assistiu antes
        </span>
      )}
    </div>
  );
}

function MovieWatched({
  space,
  workId,
  sessions,
  onChange,
}: {
  space: SpaceInfo;
  workId: string;
  sessions: { id: string; watched_at: string }[];
  onChange: () => void;
}) {
  const mark = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("joint_watch_sessions")
        .insert({ space_id: space.spaceId!, work_id: workId, created_by: space.userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marcado como assistido juntos");
      onChange();
    },
    onError: () => toast.error("Não foi possível salvar."),
  });
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="font-semibold">Assistido juntos</h2>
      {sessions.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {sessions.map((s) => formatDate(s.watched_at)).join(" · ")}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Ainda não assistiram juntos.</p>
      )}
      <button
        onClick={() => mark.mutate()}
        disabled={mark.isPending}
        className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
      >
        {sessions.length > 0 ? "Assistimos de novo" : "Assistimos juntos"}
      </button>
    </section>
  );
}

type Ev = { id: string; season_number: number | null; episode_number: number | null };

type Episode = NonNullable<Awaited<ReturnType<typeof getSeasonEpisodes>>>[number];

/** Warms the browser image cache a couple of images at a time, never blocking the page. */
function prefetchImages(urls: string[], concurrency = 2) {
  const queue = [...urls];
  let cancelled = false;
  const next = () => {
    const url = queue.shift();
    if (!url || cancelled) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = img.onerror = () => next();
    img.src = url;
  };
  for (let i = 0; i < concurrency; i++) next();
  return () => {
    cancelled = true;
  };
}

type SeasonMeta = { seasonNumber: number; name: string; episodeCount: number; posterPath?: string | null };

function nextEpisode(seen: Set<string>, seasons: SeasonMeta[]) {
  for (const s of seasons)
    for (let e = 1; e <= s.episodeCount; e++)
      if (!seen.has(`${s.seasonNumber}:${e}`)) return { s: s.seasonNumber, e };
  return null;
}

/** Discreet progress line under the hero: status + progress + next episode. */
function SeriesProgressStrip({
  space,
  workId,
  state,
  events,
  seasons,
  onChange,
}: {
  space: SpaceInfo;
  workId: string;
  state: { id: string; status: string } | null;
  events: Ev[];
  seasons: SeasonMeta[];
  onChange: () => void;
}) {
  const seen = new Set(events.map((e) => `${e.season_number}:${e.episode_number}`));
  const next = nextEpisode(seen, seasons);
  const total = seasons.reduce((a, s) => a + s.episodeCount, 0);
  async function writeState(status: string) {
    const payload = {
      status: status as "watching",
      next_season: next?.s ?? null,
      next_episode: next?.e ?? null,
      updated_by: space.userId,
    };
    const { error } = state
      ? await supabase.from("series_states").update(payload).eq("id", state.id)
      : await supabase
          .from("series_states")
          .insert({ ...payload, space_id: space.spaceId!, work_id: workId });
    if (error) toast.error("Não foi possível salvar o status.");
    else onChange();
  }
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: total ? `${Math.min(100, (seen.size / total) * 100)}%` : "0%" }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {state || seen.size ? (
            <>
              {seen.size} de {total || "?"} ·{" "}
              <span className="font-semibold text-foreground">
                {next ? `Próximo T${next.s}E${next.e}` : total ? "Tudo em dia" : ""}
              </span>
            </>
          ) : (
            "Ainda não começaram"
          )}
        </p>
      </div>
      <select
        value={state?.status ?? ""}
        onChange={(e) => writeState(e.target.value)}
        aria-label="Status da série"
        className="min-h-11 max-w-[46%] rounded-xl border border-border bg-card px-2 text-xs"
      >
        {!state && <option value="">Não iniciada</option>}
        {Object.entries(SERIES_STATUS_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

function SeriesBlock({
  space,
  workId,
  events,
  seasons,
  fallbackImage,
  onChange,
}: {
  space: SpaceInfo;
  workId: string;
  state: { id: string; status: string } | null;
  events: Ev[];
  seasons: SeasonMeta[];
  fallbackImage: string | null;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const seen = new Set(events.map((e) => `${e.season_number}:${e.episode_number}`));
  const next = nextEpisode(seen, seasons);
  const [season, setSeason] = useState<number | null>(null);
  const [openEp, setOpenEp] = useState<Episode | null>(null);
  const [saving, setSaving] = useState(false);
  const activeSeason = season ?? (seasons.length ? (next?.s ?? seasons[0]!.seasonNumber) : 1);
  const fetchSeason = useServerFn(getSeasonEpisodes);
  const seasonQuery = (n: number) => ({
    queryKey: ["season", workId, n],
    queryFn: () => fetchSeason({ data: { workId, season: n } }),
    staleTime: 6 * 3600_000,
  });
  const eps = useQuery({ ...seasonQuery(activeSeason), enabled: seasons.length > 0 });
  const seasonPoster = (n: number) => seasons.find((s) => s.seasonNumber === n)?.posterPath ?? null;
  // Image priority (no invented sources): season poster → TMDB still → series artwork.
  const epArt = (ep: Episode) => {
    const poster = seasonPoster(ep.seasonNumber);
    if (poster) return { kind: "poster" as const, path: poster };
    if (ep.stillPath) return { kind: "still" as const, path: ep.stillPath };
    return { kind: "series" as const, path: fallbackImage };
  };

  const loaded = eps.isSuccess;
  useEffect(() => {
    if (!loaded || seasons.length < 2) return;
    let stop = false;
    (async () => {
      const order = [...seasons].sort(
        (a, b) => Math.abs(a.seasonNumber - activeSeason) - Math.abs(b.seasonNumber - activeSeason),
      );
      for (const s of order) {
        if (stop) return;
        if (s.seasonNumber !== activeSeason)
          await qc.prefetchQuery(seasonQuery(s.seasonNumber)).catch(() => {});
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, workId, seasons.length]);

  useEffect(() => {
    if (!eps.data) return;
    const urls = eps.data
      .map((ep) => {
        const a = epArt(ep);
        return tmdbImage(a.path, a.kind === "poster" ? "w342" : "w300");
      })
      .filter((u): u is string => !!u);
    return prefetchImages([...new Set(urls)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eps.data]);

  // One transactional RPC: watch event + series state (next episode) together.
  async function toggle(s: number, e: number, watched: boolean) {
    const key = `${s}:${e}`;
    const after = new Set(seen);
    if (watched) after.add(key);
    else after.delete(key);
    const n = nextEpisode(after, seasons);
    setSaving(true);
    const { error } = await supabase.rpc("set_episode_watched", {
      _work: workId,
      _season: s,
      _episode: e,
      _watched: watched,
      _next_season: n?.s ?? (null as unknown as number),
      _next_episode: n?.e ?? (null as unknown as number),
    });
    setSaving(false);
    if (error) return toast.error("Não foi possível salvar.");
    // Patch only this work in the library summary instead of refetching everything.
    qc.setQueriesData<LibraryWork[]>({ queryKey: ["library", space.spaceId] }, (old) =>
      old?.map((w) =>
        w.id !== workId
          ? w
          : {
              ...w,
              watch: {
                seen_count: after.size,
                last_watched_at: new Date().toISOString(),
                seen_keys: [...after],
              },
              series_states: [
                {
                  status: w.series_states[0]?.status ?? "watching",
                  next_season: n?.s ?? null,
                  next_episode: n?.e ?? null,
                },
              ],
            },
      ),
    );
    qc.invalidateQueries({ queryKey: ["work", workId] });
  }
  void onChange;

  const openDone = openEp ? seen.has(`${openEp.seasonNumber}:${openEp.episodeNumber}`) : false;

  const Art = ({ ep, big }: { ep: Episode; big?: boolean }) => {
    const a = epArt(ep);
    const src = tmdbImage(a.path, a.kind === "poster" ? "w342" : big ? "w780" : "w300");
    if (!src) return null;
    if (a.kind === "poster")
      return (
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
          <img src={src} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-40 blur-lg" />
          <img src={src} alt="" loading="lazy" className="relative h-[88%] rounded-md object-contain shadow-lg" />
        </div>
      );
    return <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />;
  };

  return (
    <section>
      <h2 className="mb-3 font-semibold">Temporadas</h2>
      {seasons.length > 0 && (
        <div>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {seasons.map((s) => (
              <button
                key={s.seasonNumber}
                onClick={() => setSeason(s.seasonNumber)}
                className={`pressable min-h-11 shrink-0 rounded-full px-4 text-xs font-medium ${activeSeason === s.seasonNumber ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
              >
                T{s.seasonNumber}
              </button>
            ))}
          </div>
          <div className="no-scrollbar -mx-4 mt-2 flex gap-3 overflow-x-auto px-4 py-1.5">
            {eps.isLoading &&
              Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="w-44 shrink-0">
                  <div className="skeleton aspect-video w-full rounded-xl" />
                  <div className="skeleton mt-2 h-3 w-3/4" />
                </div>
              ))}
            {eps.data?.map((ep) => {
              const done = seen.has(`${ep.seasonNumber}:${ep.episodeNumber}`);
              const isNext = next?.s === ep.seasonNumber && next?.e === ep.episodeNumber;
              return (
                <button
                  type="button"
                  key={ep.episodeNumber}
                  onClick={() => setOpenEp(ep)}
                  aria-label={`Abrir T${ep.seasonNumber}E${ep.episodeNumber}, ${ep.name}${done ? ", assistido" : ""}`}
                  className="pressable w-44 shrink-0 text-left"
                >
                  <div
                    className={`relative aspect-video overflow-hidden rounded-xl bg-muted ${isNext ? "ring-2 ring-primary" : ""} ${done ? "opacity-60" : ""}`}
                  >
                    <Art ep={ep} />
                    {isNext && (
                      <span className="absolute left-1.5 top-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                        Próximo
                      </span>
                    )}
                    {done && (
                      <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-xs font-semibold">
                    T{ep.seasonNumber}E{ep.episodeNumber} · {ep.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatRuntime(ep.runtimeMinutes) ?? "—"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <AnimatedSheet
        open={!!openEp}
        onClose={() => setOpenEp(null)}
        closeDisabled={saving}
        labelledBy="ep-title"
        panelClassName="max-h-[88dvh] overflow-y-auto p-0 pb-[max(env(safe-area-inset-bottom),20px)]"
      >
        {openEp && (
          <div>
            <div className="aspect-video overflow-hidden rounded-t-3xl bg-muted">
              <Art ep={openEp} big />
            </div>
            <div className="p-5">
              <h3 id="ep-title" className="text-lg font-semibold leading-tight">
                T{openEp.seasonNumber}E{openEp.episodeNumber} · {openEp.name}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {[formatRuntime(openEp.runtimeMinutes), formatDate(openEp.airDate)]
                  .filter(Boolean)
                  .join(" · ") || "Sem data"}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {openEp.overview || "Sem sinopse disponível."}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Status do episódio">
                <button
                  disabled={saving || !openDone}
                  onClick={() => toggle(openEp.seasonNumber, openEp.episodeNumber, false)}
                  aria-pressed={!openDone}
                  className={`pressable min-h-12 rounded-xl border text-sm font-medium ${!openDone ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}
                >
                  Não assistido
                </button>
                <button
                  disabled={saving || openDone}
                  onClick={() => toggle(openEp.seasonNumber, openEp.episodeNumber, true)}
                  aria-pressed={openDone}
                  className={`pressable flex min-h-12 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold ${openDone ? "bg-primary text-primary-foreground" : "border border-border"}`}
                >
                  <Check className="h-4 w-4" /> Assistido
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatedSheet>
    </section>
  );
}

type Ind = { id: string; indicated_by: string; created_at: string; renewed_at: string | null };

function IndicationsBlock({
  space,
  workId,
  title,
  indications,
  onChange,
}: {
  space: SpaceInfo;
  workId: string;
  title: string;
  indications: Ind[];
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const mine = indications.find((i) => i.indicated_by === space.userId);
  const nameOf = (id: string) =>
    id === space.userId ? "Você" : firstName(space.partner?.display_name);

  async function removeMine() {
    if (!mine) return;
    const { error } = await supabase.from("indications").delete().eq("id", mine.id);
    if (error) toast.error("Não foi possível remover.");
    else {
      toast.success("Sua indicação foi removida");
      onChange();
    }
  }

  function deleteWork() {
    setConfirming(false);
    scheduleWorkDelete(qc, workId, title);
    navigate({ to: "/library" });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Indicações</h3>
      {indications.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Ninguém indicou ainda.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {indications.map((i) => (
            <li key={i.id}>
              {nameOf(i.indicated_by)} indicou em {formatDate(i.created_at)}
              {i.renewed_at ? ` · reindicou em ${formatDate(i.renewed_at)}` : ""}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        {mine && (
          <button
            onClick={removeMine}
            className="pressable min-h-11 flex-1 rounded-xl border border-border text-xs"
          >
            Remover minha indicação
          </button>
        )}
        <button
          onClick={() => setConfirming(true)}
          className="pressable flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-destructive/40 text-xs text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" /> Excluir obra
        </button>
      </div>
      <AnimatedSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        labelledBy="del-title"
        panelClassName="pb-[max(env(safe-area-inset-bottom),24px)]"
      >
        <h3 id="del-title" className="text-lg font-semibold">
          Excluir "{title}"?
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          A obra sai da biblioteca dos dois, junto com reações, notas, indicações, episódios e
          sessões assistidas. Você terá alguns segundos para desfazer.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => setConfirming(false)}
            className="pressable min-h-12 rounded-xl border border-border text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={deleteWork}
            className="pressable min-h-12 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground"
          >
            Excluir para os dois
          </button>
        </div>
      </AnimatedSheet>
    </div>
  );
}
