import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { AnimatedSheet } from "@/components/app/AnimatedSheet";
import { Poster } from "@/components/app/MediaCard";
import { BackButton, DetailSkeleton } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { addWork, getTitlePreview } from "@/lib/catalog.functions";
import { ADD_REACTIONS, REACTION_EMOJI, REACTION_LABEL, formatRuntime, tmdbImage } from "@/lib/format";
import { useSpace } from "@/lib/space";
import { useSharedStyle } from "@/lib/shared-transition";

export const Route = createFileRoute("/_authenticated/title/$mediaType/$tmdbId")({
  head: () => ({ meta: [
    { title: "Prévia do catálogo — AppCinema" },
    { name: "description", content: "Conheça uma obra do catálogo antes de adicioná-la à biblioteca do casal." },
    { property: "og:title", content: "Prévia do catálogo — AppCinema" },
    { property: "og:description", content: "Arte, sinopse e elenco de filmes e séries do catálogo." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <AppShell><TitlePreview /></AppShell>,
});

function TitlePreview() {
  const { mediaType, tmdbId } = Route.useParams();
  const { data: space } = useSpace();
  const get = useServerFn(getTitlePreview);
  const add = useServerFn(addWork);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const type = mediaType === "movie" || mediaType === "tv" ? mediaType : null;
  const id = Number(tmdbId);
  const posterStyle = useSharedStyle(`tmdb-${mediaType}-${tmdbId}`, "poster");
  const preview = useQuery({
    queryKey: ["title-preview", mediaType, id, space?.spaceId],
    enabled: Boolean(type && Number.isInteger(id) && id > 0 && space?.spaceId),
    staleTime: 3600_000,
    queryFn: () => {
      if (!type || !space?.spaceId) throw new Error("Obra indisponível.");
      return get({ data: { mediaType: type, tmdbId: id, spaceId: space.spaceId } });
    },
  });
  const save = useMutation({
    mutationFn: (reaction: "fire" | "like" | "neutral") => {
      if (!type || !space?.spaceId) throw new Error("Espaço indisponível.");
      return add({ data: { mediaType: type, tmdbId: id, spaceId: space.spaceId, reaction } });
    },
    onSuccess: async ({ workId }) => {
      setPicking(false);
      await qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["title-preview", mediaType, id] });
      toast.success("Indicação salva");
      navigate({ to: "/work/$id", params: { id: workId }, replace: true });
    },
    onError: (e) => toast.error(e.message),
  });
  if (!type || !Number.isInteger(id) || id <= 0) return <div className="p-4"><BackButton /><p>Obra indisponível.</p></div>;
  if (preview.isPending) return <DetailSkeleton />;
  const result = preview.data;
  if (!result) return <div className="p-4"><BackButton /><p className="mt-4 text-sm text-destructive">{preview.error?.message ?? "Não foi possível abrir esta obra."}</p><Button variant="outline" onClick={() => preview.refetch()} className="mt-4">Tentar de novo</Button></div>;
  const d = result.details;
  const backdrop = tmdbImage(d.backdropPath, "w1280");
  return <div>
    <div className="relative h-64 overflow-hidden bg-card">
      {backdrop && <img src={backdrop} alt="" className="h-full w-full object-cover opacity-80" />}
      <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-transparent to-background" />
      <div className="absolute left-4 top-4 rounded-full bg-background/70"><BackButton /></div>
    </div>
    <div className="relative -mt-28 flex gap-4 px-4">
      <div style={posterStyle} className="relative z-10 w-28 shrink-0"><Poster eager path={d.posterPath} title={d.title} /></div>
      <div className="min-w-0 self-end"><h1 className="text-2xl font-semibold leading-tight">{d.title}</h1>
        {d.originalTitle && d.originalTitle !== d.title && <p className="mt-1 text-xs text-muted-foreground">{d.originalTitle}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{[type === "tv" ? "Série" : "Filme", d.year, type === "tv" ? `${d.seasonCount ?? "—"} temp.` : formatRuntime(d.runtimeMinutes)].filter(Boolean).join(" · ")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{d.genres.join(", ")}</p>
      </div>
    </div>
    <div className="space-y-6 px-4 pt-5">
      {result.workId ? <Button asChild className="min-h-12 w-full"><Link to="/work/$id" params={{ id: result.workId }}>Abrir na biblioteca</Link></Button> : <Button className="min-h-12 w-full" onClick={() => setPicking(true)}>Adicionar à biblioteca</Button>}
      <section><h2 className="mb-2 font-semibold">Sinopse</h2><p className="text-sm leading-relaxed text-muted-foreground">{d.overview ?? "Sem sinopse disponível."}</p></section>
      <section><h2 className="mb-3 font-semibold">Elenco</h2><div className="flex gap-3 overflow-x-auto">
        {[...(d.crewLead ? [{ name: d.crewLead.name, character: d.crewLead.role, profilePath: d.crewLead.profilePath }] : []), ...d.cast].map((p) => <div key={p.name + p.character} className="w-20 shrink-0 text-center">
          {p.profilePath ? <img src={tmdbImage(p.profilePath, "w185") ?? ""} alt="" loading="lazy" className="h-20 w-20 rounded-full object-cover" /> : <div className="h-20 w-20 rounded-full bg-muted" />}
          <p className="mt-2 line-clamp-2 text-xs font-semibold">{p.character}</p><p className="text-[11px] text-muted-foreground">{p.name}</p>
        </div>)}
      </div></section>
    </div>
    <AnimatedSheet open={picking} onClose={() => setPicking(false)} closeDisabled={save.isPending} labelledBy="title-reaction">
      <h2 id="title-reaction" className="font-semibold">{d.title}</h2><p className="mt-1 text-xs text-muted-foreground">Qual sua vontade de ver?</p>
      <div className="mt-5 grid grid-cols-3 gap-2">{ADD_REACTIONS.map((r) => <Button key={r} variant="outline" disabled={save.isPending} onClick={() => { if (r !== "dislike") save.mutate(r); }} className="h-auto flex-col py-4"><span className="emoji text-2xl">{REACTION_EMOJI[r]}</span><span className="text-xs">{REACTION_LABEL[r]}</span></Button>)}</div>
    </AnimatedSheet>
  </div>;
}