import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Heart, Plus, Settings, Sparkles, Star, Upload } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { greeting, SERIES_STATUS_LABEL } from "@/lib/format";
import { firstName, isWatched, useLibrary, useSpace, type LibraryWork } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Início — AppCinema" },
      { name: "description", content: "O que o casal está assistindo, novidades e indicações." },
      { property: "og:title", content: "AppCinema" },
      { property: "og:description", content: "Biblioteca privada de filmes e séries do casal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <Home />
    </AppShell>
  ),
});

function Row({ title, items, empty }: { title: string; items: LibraryWork[]; empty: string }) {
  return (
    <section className="mt-7">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {items.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
          {items.map((w) => (
            <Link key={w.id} to="/work/$id" params={{ id: w.id }} className="w-28 shrink-0">
              <Poster path={w.poster_path} title={w.title} />
              <p className="mt-1.5 line-clamp-1 text-xs font-medium">{w.title}</p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Home() {
  const { data: space } = useSpace();
  const { data: works = [] } = useLibrary(space?.spaceId);
  if (!space) return null;
  const continuing = works.filter((w) => w.media_type === "tv" && w.series_states[0]?.status === "watching");
  const unrated = works.filter((w) => isWatched(w) && !w.ratings.some((r) => r.user_id === space.userId));
  const news = works.filter(
    (w) => w.indications.some((i) => i.indicated_by !== space.userId) && !w.interests.some((i) => i.user_id === space.userId),
  );
  const both = works.filter(
    (w) =>
      !isWatched(w) &&
      w.interests.filter((i) => i.reaction === "fire" || i.reaction === "like").length >= (space.partner ? 2 : 1),
  );

  const quick = [
    { label: "Continuar", value: continuing.length, icon: Clock },
    { label: "Não avaliados", value: unrated.length, icon: Star },
    { label: "Último Match", value: "—", icon: Heart },
    { label: "Importações", value: "—", icon: Upload },
  ];

  return (
    <div className="px-4 pt-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{greeting()},</p>
          <h1 className="text-2xl font-semibold">{firstName(space.me.display_name)}</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/add" aria-label="Adicionar" className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card">
            <Plus className="h-5 w-5" />
          </Link>
          <Link to="/settings" aria-label="Configurações" className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card">
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-4 gap-2">
        {quick.map((q) => (
          <div key={q.label} className="rounded-xl border border-border bg-card p-2.5">
            <q.icon className="h-4 w-4 text-primary" />
            <p className="mt-2 text-lg font-semibold leading-none">{q.value}</p>
            <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{q.label}</p>
          </div>
        ))}
      </div>

      <section className="mt-7">
        <h2 className="mb-3 text-base font-semibold">Continuar assistindo</h2>
        {continuing.length === 0 ? (
          <EmptyState title="Nenhuma série em andamento" text="Marque episódios numa série para ela aparecer aqui." />
        ) : (
          <div className="space-y-2">
            {continuing.slice(0, 3).map((w) => (
              <Link key={w.id} to="/work/$id" params={{ id: w.id }} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2">
                <div className="w-12 shrink-0"><Poster path={w.poster_path} title={w.title} className="rounded-lg" /></div>
                <div className="min-w-0">
                  <p className="line-clamp-1 font-medium">{w.title}</p>
                  <p className="text-xs text-muted-foreground">{w.watch_events.length} episódios vistos · {SERIES_STATUS_LABEL[w.series_states[0]!.status]}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Row title="Novidades pra ti" items={news} empty="Nenhuma indicação nova esperando sua reação." />
      <Row title="Talvez vocês gostem" items={both} empty="Quando os dois curtirem uma obra, ela aparece aqui." />
      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5" /> Recomendações personalizadas chegam numa próxima fase.</p>
    </div>
  );
}
