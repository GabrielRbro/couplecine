import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/MediaCard";

export const Route = createFileRoute("/_authenticated/watch/dice")({
  head: () => ({ meta: [{ title: "Sortear — AppCinema" }, { name: "description", content: "Sorteio ponderado pelas reações chega na próxima fase." }] }),
  component: () => (
    <AppShell>
      <div className="px-4 pt-6">
        <h1 className="text-2xl font-semibold">Sortear</h1>
        <div className="mt-6"><EmptyState title="Em breve" text="Sorteio ponderado pelas reações chega na próxima fase." /></div>
      </div>
    </AppShell>
  ),
});
