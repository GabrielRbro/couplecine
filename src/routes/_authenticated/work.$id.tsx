import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { WorkDetails } from "@/components/app/WorkDetails";
export const Route = createFileRoute("/_authenticated/work/$id")({
  head: () => ({ meta: [{ title: "Detalhes — AppCinema" }, { name: "description", content: "Metadados, interesse, avaliação e histórico da obra do casal." }, { property: "og:title", content: "Detalhes — AppCinema" }, { property: "og:description", content: "Filmes e séries na biblioteca do casal." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: WorkPage,
});
function WorkPage() { const { id } = Route.useParams(); return <AppShell><WorkDetails key={id} workId={id} /></AppShell>; }
