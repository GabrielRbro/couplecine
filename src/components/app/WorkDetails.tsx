import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Plus, Trash2, Tv, X } from "lucide-react";
import { DetailSkeleton, useBack } from "@/components/app/ui";
import { toast } from "sonner";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { Poster } from "@/components/app/MediaCard";
import { SuperReaction } from "./SuperReaction";
import { ScorePicker } from "@/components/app/ScorePicker";
import { supabase } from "@/integrations/supabase/client";
import { addWork, getSeasonEpisodes, getTitlePreview } from "@/lib/catalog.functions";
import {
  ALL_REACTIONS,
  ADD_REACTIONS,
  REACTION_LABEL,
  formatDate,
  formatRuntime,
  formatScore,
  REACTION_EMOJI,
  SERIES_STATUS_LABEL,
  tmdbImage,
  type Reaction,
} from "@/lib/format";
import { firstName, useLibrary, useSpace, type LibraryWork, type SpaceInfo } from "@/lib/space";
import { useBackdropHandoff, useSharedStyle } from "@/lib/shared-transition";
import { Button } from "@/components/ui/button";
import { restoreWorkDeletion, scheduleWorkDelete, useWorkDeletion } from "@/lib/pending-delete";

function hasDifferentOriginalTitle(title: string, originalTitle: string | null) {
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  return Boolean(originalTitle && normalize(title) !== normalize(originalTitle));
}

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

export function workQuery(id: string) {
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
        supabase.from("watch_events").select("id, season_number, episode_number, watched_at").eq("work_id", id),
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
      if (!w.data) return null;
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

export function WorkDetails({
  workId,
  mediaType,
  tmdbId,
}: {
  workId?: string;
  mediaType?: "movie" | "tv";
  tmdbId?: number;
}) {
  const { data: space } = useSpace();
  const { data: library = [] } = useLibrary(space?.spaceId);
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState(workId ?? null);
  const [identity, setIdentity] = useState(mediaType && tmdbId ? { mediaType, tmdbId } : null);
  const [picking, setPicking] = useState(false);
  const [optimisticReaction, setOptimisticReaction] = useState<"fire" | "like" | "neutral" | null>(null);
  const [burst, setBurst] = useState<{ emoji: string; origin: { x: number; y: number } } | null>(null);
  const deletion = useWorkDeletion(activeId ?? "");
  const local = useQuery({ ...workQuery(activeId ?? ""), enabled: Boolean(activeId) && deletion === "active" });
  const retained = useRef(local.data?.work ?? null);
  if (local.data?.work) retained.current = local.data.work;
  useEffect(() => {
    if (local.data?.work) setIdentity({ mediaType: local.data.work.media_type, tmdbId: local.data.work.tmdb_id });
  }, [local.data?.work]);
  const details = useServerFn(getTitlePreview);
  const meta = useQuery({
    queryKey: ["title-preview", identity?.mediaType, identity?.tmdbId, space?.spaceId],
    enabled: Boolean(identity && space?.spaceId),
    staleTime: 3600_000,
    queryFn: () => {
      if (!identity || !space?.spaceId) throw new Error("Obra indisponível.");
      return details({ data: { ...identity, spaceId: space.spaceId } });
    },
  });
  useEffect(() => {
    if (!activeId && meta.data?.workId) setActiveId(meta.data.workId);
  }, [activeId, meta.data?.workId]);
  const refresh = () => {
    if (activeId) qc.invalidateQueries({ queryKey: ["work", activeId] });
    qc.invalidateQueries({ queryKey: ["library"] });
  };
  const add = useServerFn(addWork);
  const save = useMutation({
    mutationFn: (reaction: "fire" | "like" | "neutral") => {
      if (!identity || !space?.spaceId) throw new Error("Espaço indisponível.");
      return add({ data: { ...identity, spaceId: space.spaceId, reaction } });
    },
    onMutate: (reaction) => {
      const snapshots = qc.getQueriesData({ queryKey: ["discover", space?.spaceId] });
      const library = qc.getQueryData<LibraryWork[]>(["library", space?.spaceId]);
      setOptimisticReaction(reaction);
      setPicking(false);
      void qc.cancelQueries({ queryKey: ["discover", space?.spaceId] });
      if (identity)
        qc.setQueriesData(
          { queryKey: ["discover", space?.spaceId] },
          (old: { pages: { items: { mediaType: string; tmdbId: number }[] }[] } | undefined) =>
            old && {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.filter((i) => i.mediaType !== identity.mediaType || i.tmdbId !== identity.tmdbId),
              })),
            },
        );
      const details = meta.data?.details;
      if (details && space) {
        void qc.cancelQueries({ queryKey: ["library", space.spaceId] });
        const temp: LibraryWork = {
          id: activeId ?? `optimistic-${details.mediaType}-${details.tmdbId}`,
          tmdb_id: details.tmdbId,
          title: details.title,
          original_title: details.originalTitle,
          media_type: details.mediaType,
          poster_path: details.posterPath,
          backdrop_path: details.backdropPath,
          release_year: details.year,
          runtime_minutes: details.runtimeMinutes,
          genres: details.genres,
          activity_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          interests: [{ user_id: space.userId, reaction }],
          ratings: [],
          indications: [{ indicated_by: space.userId, created_at: new Date().toISOString(), renewed_at: null }],
          joint_watch_sessions: [],
          watch: null,
          series_states: [],
          work_metadata_cache: [],
        };
        qc.setQueryData(["library", space.spaceId], [temp, ...(library ?? []).filter((w) => w.id !== temp.id)]);
      }
      return { snapshots, library, activeId };
    },
    onSuccess: async ({ workId: nextId }) => {
      restoreWorkDeletion(nextId);
      // Keep the optimistic surface until the authoritative snapshot is ready.
      const loaded = await qc.fetchQuery(workQuery(nextId)).catch(() => null);
      setActiveId(nextId);
      if (loaded) setOptimisticReaction(null);
      void qc.invalidateQueries({ queryKey: ["library"] });
      toast.success("Indicação salva");
    },
    onError: (e, _reaction, context) => {
      context?.snapshots.forEach(([key, value]) => qc.setQueryData(key, value));
      if (context?.library) qc.setQueryData(["library", space?.spaceId], context.library);
      else qc.removeQueries({ queryKey: ["library", space?.spaceId], exact: true });
      setActiveId(context?.activeId ?? null);
      setOptimisticReaction(null);
      setBurst(null);
      setPicking(true);
      toast.error(e.message);
    },
  });
  useEffect(() => {
    if (optimisticReaction && !save.isPending && local.data?.indications.length) setOptimisticReaction(null);
  }, [local.data, save.isPending, optimisticReaction]);
  const transitionId = workId ?? `tmdb-${mediaType}-${tmdbId}`;
  // The hero uses the already-cached gallery image and animates in its final bounds.
  // It deliberately does not morph a short card crop into a tall hero snapshot.
  const sharedPoster = useSharedStyle(transitionId, "poster");
  const backdropHandoff = useBackdropHandoff(transitionId);
  const m = meta.data?.details;
  const internal =
    Boolean(optimisticReaction) ||
    Boolean(
      activeId &&
      deletion === "active" &&
      local.data?.work &&
      (local.data.indications.length ||
        local.data.interests.length ||
        local.data.prior.length ||
        local.data.events.length ||
        local.data.sessions.length),
    );
  const work =
    local.data?.work ??
    retained.current ??
    (m
      ? {
          title: m.title,
          original_title: m.originalTitle,
          media_type: m.mediaType,
          tmdb_id: m.tmdbId,
          backdrop_path: m.backdropPath,
          poster_path: m.posterPath,
          release_year: m.year,
          runtime_minutes: m.runtimeMinutes,
          genres: m.genres,
          overview: m.overview,
        }
      : null);
  const data =
    optimisticReaction && space
      ? {
          interests: [{ user_id: space.userId, reaction: optimisticReaction }],
          ratings: [],
          indications: [
            { id: "optimistic", indicated_by: space.userId, created_at: new Date().toISOString(), renewed_at: null },
          ],
          prior: [],
          sessions: [],
          state: null,
          events: [],
        }
      : internal && local.data
        ? local.data
        : { interests: [], ratings: [], indications: [], prior: [], sessions: [], state: null, events: [] };
  const id = activeId ?? "";
  if (!space || !work) {
    if (local.error || meta.error)
      return (
        <div className="p-6">
          <BackOverlay />
          <p className="mt-12 text-sm text-destructive">{local.error?.message ?? meta.error?.message}</p>
        </div>
      );
    return <DetailSkeleton />;
  }
  const isTv = work.media_type === "tv";
  const cachedSeasons = library.find((w) => w.id === id)
    ?.work_metadata_cache[0]?.seasons;
  const seasons = m?.seasons?.length
    ? m.seasons
    : Array.from({ length: m?.seasonCount ?? cachedSeasons?.length ?? 0 }, (_, i) => ({
        seasonNumber: i + 1,
        name: `Temporada ${i + 1}`,
        episodeCount: cachedSeasons?.[i]?.episodeCount ?? 0,
      }));
  const seasonCount = m?.seasonCount ?? seasons.length;
  return (
    <div>
      <div className="relative h-64 overflow-hidden">
        {tmdbImage(work.backdrop_path, "w780") ? (
          <img
            src={tmdbImage(work.backdrop_path, "w780") ?? ""}
            alt=""
            className={`h-full w-full object-cover opacity-80 ${backdropHandoff ? "detail-backdrop-arrive" : ""}`}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-accent to-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-transparent to-background" />
        <div
          style={{ viewTransitionName: "detail-controls" }}
          className="absolute inset-0 pointer-events-none [&_button]:pointer-events-auto"
        >
          <BackOverlay />
        </div>
      </div>
      <div className="relative z-10 -mt-28 flex gap-4 px-4">
        <div className="relative z-10 w-28 shrink-0 shadow-2xl">
          <Poster
            path={work.poster_path}
            title={work.title}
            transitionStyle={sharedPoster}
          />
        </div>
        <div className="min-w-0 self-end" style={{ viewTransitionName: "detail-meta" }}>
          <h1 className="text-2xl font-semibold leading-tight">{work.title}</h1>
          {hasDifferentOriginalTitle(work.title, work.original_title) && (
            <p className="text-xs text-muted-foreground">{work.original_title}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {isTv ? "Série" : "Filme"}
            {work.release_year ? ` · ${work.release_year}` : ""}
            {isTv ? (
              <span className="inline-block min-w-[4.5rem]">{seasonCount ? ` · ${seasonCount} temp.` : ""}</span>
            ) : work.runtime_minutes ? (
              ` · ${formatRuntime(work.runtime_minutes)}`
            ) : (
              ""
            )}
          </p>
          {work.genres.length > 0 && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{work.genres.join(", ")}</p>
          )}
        </div>
      </div>

      {internal && isTv && (data.state || data.events.length > 0) && (
        <div className="px-4 pt-3">
          <SeriesProgressStrip
            space={space}
            workId={id}
            state={data.state}
            events={data.events}
            seasons={seasons}
            onChange={refresh}
          />
        </div>
      )}
      <div className="space-y-6 px-4 pt-5">
        <button
          disabled
          aria-label="Assistir na TV, não configurado"
          title="Envio para a TV não configurado"
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground"
        >
          <Tv className="h-4 w-4" /> Assistir na TV · não configurado
        </button>
        {deletion === "pending" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Exclusão pendente · Desfazer disponível.
          </p>
        ) : !internal ? (
          <Button disabled={save.isPending} onClick={() => setPicking(true)} className="min-h-12 w-full">
            <Plus />
            Adicionar à biblioteca
          </Button>
        ) : null}
        {internal && (
          <div aria-busy={save.isPending} className={optimisticReaction ? "pointer-events-none" : ""}>
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
                >
                  <PriorWatch space={space} workId={id} prior={data.prior} onChange={refresh} />
                </IndicationsBlock>
                {!isTv && <MovieWatched space={space} workId={id} sessions={data.sessions} onChange={refresh} />}
              </div>
            </section>
          </div>
        )}
        {isTv ? (
          <>
            <Synopsis text={m?.overview ?? work.overview} />
            <SeriesBlock
              space={space}
              workId={internal ? id : ""}
              tmdbId={work.tmdb_id}
              state={data.state}
              events={data.events}
              seasons={seasons}
              fallbackImage={work.backdrop_path}
              title={work.title}
              logoPath={m?.logoPath ?? null}
              onChange={refresh}
            />
          </>
        ) : (
          <Synopsis text={m?.overview ?? work.overview} />
        )}

        {m?.universe && m.universe.parts.length > 1 && (
          <Universe
            title={m.universe.name}
            currentTmdbId={work.tmdb_id}
            parts={m.universe.parts}
            library={library}
          />
        )}

        {m && (
          <section>
            <h2 className="mb-3 font-semibold">Elenco</h2>
            <div className="no-scrollbar -mx-4 flex items-start gap-3 overflow-x-auto px-4">
              {(m.crewLeads?.length || m.crewLead) && (
                <>
                  {(m.crewLeads ?? (m.crewLead ? [m.crewLead] : [])).map((lead) => (
                    <Person key={lead.name} name={lead.name} top={lead.role} path={lead.profilePath} />
                  ))}
                  <div className="h-24 w-px shrink-0 self-center bg-border" />
                </>
              )}
              {m.cast.map((c) => (
                <Person key={c.name + c.character} top={c.character} name={c.name} path={c.profilePath} />
              ))}
            </div>
          </section>
        )}
        {meta.error && <p className="text-xs text-muted-foreground">{meta.error.message}</p>}
      </div>
      <AnimatedSheet
        open={picking}
        onClose={() => setPicking(false)}
        closeDisabled={save.isPending}
        labelledBy="add-reaction-title"
      >
        <h2 id="add-reaction-title" className="font-semibold">
          {work.title}
        </h2>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {ADD_REACTIONS.map((r) => (
            <Button
              key={r}
              variant="outline"
              disabled={save.isPending}
              onClick={(e) => {
                if (r !== "dislike") {
                  const box = e.currentTarget.getBoundingClientRect();
                  setBurst({
                    emoji: REACTION_EMOJI[r],
                    origin: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
                  });
                  save.mutate(r);
                }
              }}
              className="h-auto min-h-16 flex-col"
            >
              <span className="emoji text-2xl">{REACTION_EMOJI[r]}</span>
              <span>{REACTION_LABEL[r]}</span>
            </Button>
          ))}
        </div>
      </AnimatedSheet>
      {burst && <SuperReaction {...burst} onComplete={() => setBurst(null)} />}
    </div>
  );
}

function Universe({
  title,
  currentTmdbId,
  parts,
  library,
}: {
  title: string;
  currentTmdbId: number;
  parts: { tmdbId: number; title: string; posterPath: string | null; year: number | null }[];
  library: LibraryWork[];
}) {
  const others = parts.filter((part) => part.tmdbId !== currentTmdbId);
  if (!others.length) return null;
  const local = new Map(library.filter((work) => work.media_type === "movie").map((work) => [work.tmdb_id, work]));
  return (
    <section>
      <h2 className="font-semibold">Universo</h2>
      <p className="mt-1 text-xs text-muted-foreground">{title}</p>
      <div className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1">
        {others.map((part) => {
          const saved = local.get(part.tmdbId);
          const target = saved
            ? { to: "/work/$id" as const, params: { id: saved.id } }
            : { to: "/title/$mediaType/$tmdbId" as const, params: { mediaType: "movie", tmdbId: String(part.tmdbId) } };
          return (
            <Link key={part.tmdbId} {...target} className="pressable w-24 shrink-0 text-left">
              <Poster path={part.posterPath} title={part.title} className="rounded-xl" />
              <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-tight">{part.title}</p>
              {part.year && <p className="mt-0.5 text-[11px] text-muted-foreground">{part.year}</p>}
            </Link>
          );
        })}
      </div>
    </section>
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
      .upsert({ work_id: workId, user_id: space.userId, reaction }, { onConflict: "user_id,work_id" });
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
            .upsert({ work_id: workId, user_id: space.userId, score }, { onConflict: "user_id,work_id" });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar.");
      return;
    }
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
              <span className="emoji text-xl leading-none">{mine ? REACTION_EMOJI[mine.reaction] : "—"}</span>
              <span className="text-[10px] text-muted-foreground">Eu</span>
            </button>
            <div className={cell} aria-label={`${partnerLabel}: interesse`}>
              <span className="emoji text-xl leading-none">{theirs ? REACTION_EMOJI[theirs.reaction] : "—"}</span>
              <span className="text-[10px] text-muted-foreground">{partnerLabel}</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-2 py-1.5">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-[11px] font-semibold text-muted-foreground">Avaliação</h2>
            {avg !== null && <span className="text-[10px] font-semibold text-primary">Média {formatScore(avg)}</span>}
          </div>
          <div className="flex divide-x divide-border">
            <button onClick={() => setEditing("score")} aria-label="Eu: dar nota" className={cell}>
              <span className="text-base font-semibold leading-tight">
                {myScore ? formatScore(Number(myScore.score)) : <span className="text-xs text-primary">Dar nota</span>}
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
        onSave={setScore}
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
      .upsert({ work_id: workId, user_id: space.userId, watched: !mine }, { onConflict: "user_id,work_id" });
    if (error) toast.error("Não foi possível salvar.");
    else onChange();
  }
  return (
    <div className="flex flex-col items-center gap-2 text-center text-sm">
      <Button variant="ghost"
        onClick={toggle}
        aria-pressed={mine}
        className={`pressable inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] ${mine ? "border-primary/35 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
      >
        {mine && <Check className="h-3.5 w-3.5" />} Eu já assisti antes
      </Button>
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
    for (let e = 1; e <= s.episodeCount; e++) if (!seen.has(`${s.seasonNumber}:${e}`)) return { s: s.seasonNumber, e };
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
  const [choosingStatus, setChoosingStatus] = useState(false);
  const [writing, setWriting] = useState(false);
  const seen = new Set(events.map((e) => `${e.season_number}:${e.episode_number}`));
  const next = nextEpisode(seen, seasons);
  const total = seasons.reduce((a, s) => a + s.episodeCount, 0);
  async function writeState(status: string) {
    if (writing || !space.spaceId) return;
    setWriting(true);
    const payload = {
      status: status as "watching",
      next_season: next?.s ?? null,
      next_episode: next?.e ?? null,
      updated_by: space.userId,
    };
    const { error } = state
      ? await supabase.from("series_states").update(payload).eq("id", state.id)
      : await supabase.from("series_states").insert({ ...payload, space_id: space.spaceId, work_id: workId });
    setWriting(false);
    setChoosingStatus(false);
    if (error) toast.error("Não foi possível salvar o status.");
    else onChange();
  }
  return (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-2">
      <Button
        variant="ghost"
        aria-label="Status da série"
        onClick={() => setChoosingStatus(true)}
        className="mb-1 h-11 px-0 text-xs"
      >
        <span>{SERIES_STATUS_LABEL[state?.status ?? ""] ?? "Não iniciada"}</span>
        <ChevronDown className="h-3 w-3" />
      </Button>
      <div className="min-w-0">
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
      <AnimatedSheet
        open={choosingStatus}
        onClose={() => setChoosingStatus(false)}
        closeDisabled={writing}
        labelledBy="series-status-title"
      >
        <h2 id="series-status-title" className="font-semibold">
          Status da série
        </h2>
        <div className="mt-3 space-y-1">
          {Object.entries(SERIES_STATUS_LABEL).map(([key, label]) => (
            <Button
              key={key}
              variant="ghost"
              disabled={writing}
              onClick={() => writeState(key)}
              className="min-h-12 w-full justify-between"
            >
              {label}
              {state?.status === key && <Check />}
            </Button>
          ))}
        </div>
      </AnimatedSheet>
    </div>
  );
}

function EpisodeArt({
  ep,
  posterPath,
  fallbackImage,
  big = false,
}: {
  ep: Episode;
  posterPath: string | null;
  fallbackImage: string | null;
  big?: boolean;
}) {
  // A horizontal frame always dominates; absent stills use the series backdrop, never a vertical slot.
  const src = tmdbImage(ep.stillPath ?? fallbackImage, big ? "w780" : "w300");
  void posterPath;
  return (
    <div className="relative h-full w-full bg-muted">
      {src && <img src={src} alt="" loading={big ? "eager" : "lazy"} className="h-full w-full object-cover" />}
      {big && <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/70 to-transparent" />}
    </div>
  );
}

function SeriesBlock({
  space,
  workId,
  tmdbId,
  events,
  seasons,
  fallbackImage,
  title,
  logoPath,
  onChange,
}: {
  space: SpaceInfo;
  workId: string;
  tmdbId: number;
  state: { id: string; status: string } | null;
  events: Ev[];
  seasons: SeasonMeta[];
  fallbackImage: string | null;
  title: string;
  logoPath: string | null;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  // Optimistic per-episode overrides: only the tapped card changes; others never re-render as disabled.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const seen = new Set(events.map((e) => `${e.season_number}:${e.episode_number}`));
  for (const [k, v] of Object.entries(overrides)) if (v) seen.add(k); else seen.delete(k);
  const next = nextEpisode(seen, seasons);
  const [season, setSeason] = useState<number | null>(null);
  const [openEp, setOpenEp] = useState<Episode | null>(null);
  const saving = false;
  const activeSeason = season ?? (seasons.length ? (next?.s ?? seasons[0]?.seasonNumber ?? 1) : 1);
  const episodeRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    episodeRow.current?.scrollTo({ left: 0, behavior: "instant" });
  }, [activeSeason]);
  const fetchSeason = useServerFn(getSeasonEpisodes);
  const seasonQuery = (n: number) => ({
    queryKey: ["season", workId || `tmdb-${tmdbId}`, n],
    queryFn: () => fetchSeason({ data: { ...(workId ? { workId } : { tmdbId }), season: n } }),
    staleTime: 6 * 3600_000,
  });
  const eps = useQuery({ ...seasonQuery(activeSeason), enabled: seasons.length > 0 });
  const seasonPoster = (n: number) => seasons.find((s) => s.seasonNumber === n)?.posterPath ?? null;
  // Image priority (no invented sources): season poster → TMDB still → series artwork.
  const epArt = (ep: Episode) => {
    const poster = seasonPoster(ep.seasonNumber);
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
        if (s.seasonNumber !== activeSeason) await qc.prefetchQuery(seasonQuery(s.seasonNumber)).catch(() => {});
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
        return tmdbImage(a.path, "w300");
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
    if (key in overrides) return;
    setOverrides((o) => ({ ...o, [key]: watched }));
    const drop = () => setOverrides((o) => { const { [key]: _, ...rest } = o; void _; return rest; });
    const { error } = await supabase.rpc("set_episode_watched", {
      _work: workId,
      _season: s,
      _episode: e,
      _watched: watched,
      _next_season: n?.s ?? (null as unknown as number),
      _next_episode: n?.e ?? (null as unknown as number),
    });
    if (error) {
      drop();
      toast.error("Não foi possível salvar.");
      return;
    }
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
    await qc.invalidateQueries({ queryKey: ["work", workId] });
    drop();
  }
  void onChange;

  const openDone = openEp ? seen.has(`${openEp.seasonNumber}:${openEp.episodeNumber}`) : false;

  return (
    <section>
      <h2 className="mb-3 font-semibold">Temporadas</h2>
      {seasons.length > 0 && (
        <div>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {seasons.map((s) => (
              <button
                key={s.seasonNumber}
                onClick={() => {
                  if (activeSeason !== s.seasonNumber) setSeason(s.seasonNumber);
                }}
                className={`${activeSeason === s.seasonNumber ? "" : "pressable"} min-h-11 shrink-0 rounded-full px-4 text-xs font-medium ${activeSeason === s.seasonNumber ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
              >
                T{s.seasonNumber}
              </button>
            ))}
          </div>
          <div
            ref={episodeRow}
            key={activeSeason}
            className="no-scrollbar -mx-4 mt-2 flex gap-3 overflow-x-auto px-4 py-1.5"
          >
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
                <div key={ep.episodeNumber} className="relative w-44 shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpenEp(ep)}
                    aria-label={`Abrir T${ep.seasonNumber}E${ep.episodeNumber}, ${ep.name}${done ? ", assistido" : ""}`}
                    className="pressable block w-full text-left"
                  >
                    <div
                      className={`relative aspect-video overflow-hidden rounded-xl bg-muted ${isNext ? "ring-2 ring-primary" : ""} ${done ? "opacity-60" : ""}`}
                    >
                      <EpisodeArt ep={ep} posterPath={seasonPoster(ep.seasonNumber)} fallbackImage={fallbackImage} />
                      {isNext && (
                        <span className="absolute left-1.5 top-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          Próximo
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-1 text-xs font-semibold">
                      T{ep.seasonNumber}E{ep.episodeNumber} · {ep.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatRuntime(ep.runtimeMinutes) ?? "—"}</p>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!workId}
                    aria-label={`${done ? "Desmarcar" : "Marcar"} T${ep.seasonNumber}E${ep.episodeNumber} assistido`}
                    aria-pressed={done}
                    onClick={() => toggle(ep.seasonNumber, ep.episodeNumber, !done)}
                    className="absolute right-0 top-0 z-10 h-11 w-11 rounded-full hover:bg-transparent"
                  >
                    {/* Small visual mark inside the full 44px touch target. */}
                    <span className={`grid h-6 w-6 place-items-center rounded-full transition-colors ${done ? "nav-glass text-primary" : "bg-background/50 text-foreground/60"}`}><Check className="h-3.5 w-3.5" /></span>
                  </Button>
                </div>
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
        panelClassName="relative max-h-[88dvh] overflow-visible p-0 pb-[max(env(safe-area-inset-bottom),20px)]"
      >
        {openEp && (
          <>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Fechar episódio"
              disabled={saving}
              onClick={() => setOpenEp(null)}
              className="absolute -top-8 right-[max(env(safe-area-inset-right),4px)] z-20 h-11 w-11 rounded-full border border-border shadow-lg"
            >
              <X />
            </Button>
            <div className="max-h-[82dvh] overflow-y-auto overscroll-contain rounded-t-3xl">
              <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                <EpisodeArt
                  ep={openEp}
                  posterPath={seasonPoster(openEp.seasonNumber)}
                  fallbackImage={fallbackImage}
                  big
                />
                <div className="absolute bottom-4 left-5 right-5">
                  {logoPath ? (
                    <img
                      src={tmdbImage(logoPath, "w300") ?? ""}
                      alt={title}
                      className="max-h-12 max-w-[45%] object-contain object-left"
                    />
                  ) : (
                    <p className="text-sm font-semibold">{title}</p>
                  )}
                </div>
              </div>
              <div className="p-6">
                <h3 id="ep-title" className="text-lg font-semibold leading-tight">
                  T{openEp.seasonNumber}E{openEp.episodeNumber} · {openEp.name}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[formatRuntime(openEp.runtimeMinutes), formatDate(openEp.airDate)].filter(Boolean).join(" · ") ||
                    "Sem data"}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {openEp.overview || "Sem sinopse disponível."}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Status do episódio">
                  <button
                    disabled={!workId || saving || !openDone}
                    onClick={() => toggle(openEp.seasonNumber, openEp.episodeNumber, false)}
                    aria-pressed={!openDone}
                    className={`pressable min-h-12 rounded-xl border text-sm font-medium ${!openDone ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}
                  >
                    Não assistido
                  </button>
                  <button
                    disabled={!workId || saving || openDone}
                    onClick={() => toggle(openEp.seasonNumber, openEp.episodeNumber, true)}
                    aria-pressed={openDone}
                    className={`pressable flex min-h-12 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold ${openDone ? "bg-primary text-primary-foreground" : "border border-border"}`}
                  >
                    <Check className="h-4 w-4" /> Assistido
                  </button>
                </div>
              </div>
            </div>
          </>
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
  children,
  indications,
  onChange,
}: {
  space: SpaceInfo;
  workId: string;
  title: string;
  children?: React.ReactNode;
  indications: Ind[];
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const mine = indications.find((i) => i.indicated_by === space.userId);
  const nameOf = (id: string) => (id === space.userId ? "Você" : firstName(space.partner?.display_name));

  async function removeMine() {
    if (!mine || removing) return;
    setRemoving(true);
    const { error } = await supabase.from("indications").delete().eq("id", mine.id);
    setRemoving(false);
    if (error) toast.error("Não foi possível remover.");
    else {
      qc.setQueryData(
        ["work", workId],
        (old: Awaited<ReturnType<ReturnType<typeof workQuery>["queryFn"]>> | undefined) =>
          old && { ...old, indications: old.indications.filter((i) => i.id !== mine.id) },
      );
      qc.setQueriesData<LibraryWork[]>({ queryKey: ["library"] }, (old) =>
        old?.map((w) =>
          w.id === workId ? { ...w, indications: w.indications.filter((i) => i.indicated_by !== space.userId) } : w,
        ),
      );
      toast.success("Sua indicação foi removida");
      onChange();
    }
  }

  function deleteWork() {
    setConfirming(false);
    scheduleWorkDelete(qc, workId, title);
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
          <button onClick={removeMine} className="pressable min-h-11 flex-1 rounded-xl border border-border text-xs">
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
      <div className="mt-3">{children}</div>
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
          A obra sai da biblioteca dos dois, junto com reações, notas, indicações, episódios e sessões assistidas. Você
          terá alguns segundos para desfazer.
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

