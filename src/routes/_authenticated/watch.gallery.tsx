import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/MediaCard";

export const Route = createFileRoute("/_authenticated/watch/gallery")({
  head: () => ({ meta: [{ title: "Galeria — AppCinema" }, { name: "description", content: "Galeria filtrável das indicações do casal chega na próxima fase." }] }),
  component: () => (
    <AppShell>
      <div className="px-4 pt-6">
        <h1 className="text-2xl font-semibold">Galeria</h1>
        <div className="mt-6"><EmptyState title="Em breve" text="Galeria filtrável das indicações do casal chega na próxima fase." /></div>
      </div>
    </AppShell>
  ),
});
