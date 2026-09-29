import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/MediaCard";

export const Route = createFileRoute("/_authenticated/match")({
  head: () => ({ meta: [{ title: "Match — AppCinema" }, { name: "description", content: "Match secreto em tempo real chega numa próxima fase." }] }),
  component: () => (
    <AppShell>
      <div className="px-4 pt-6">
        <h1 className="text-2xl font-semibold">Match</h1>
        <div className="mt-6"><EmptyState title="Em breve" text="Match secreto em tempo real chega numa próxima fase." /></div>
      </div>
    </AppShell>
  ),
});
