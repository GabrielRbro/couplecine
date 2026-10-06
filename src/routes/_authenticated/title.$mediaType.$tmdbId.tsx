import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { WorkDetails } from "@/components/app/WorkDetails";
export const Route = createFileRoute("/_authenticated/title/$mediaType/$tmdbId")({
  head: () => ({ meta: [{ title: "Obra do catálogo — AppCinema" }, { name: "description", content: "Conheça filmes e séries e acompanhe a obra na biblioteca do casal." }, { property: "og:title", content: "Obra do catálogo — AppCinema" }, { property: "og:description", content: "Arte, temporadas, elenco e histórico em uma ficha única." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: TitlePage,
});
function TitlePage() {
  const { mediaType, tmdbId } = Route.useParams(); const id = Number(tmdbId);
  if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isInteger(id) || id <= 0) return <AppShell><p className="p-6">Obra indisponível.</p></AppShell>;
  return <AppShell><WorkDetails key={`${mediaType}-${id}`} mediaType={mediaType} tmdbId={id} /></AppShell>;
}
