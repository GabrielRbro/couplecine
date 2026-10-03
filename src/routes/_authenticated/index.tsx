import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock, Heart, Plus, Settings, Star, Tv, Upload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HomeSkeleton } from "@/components/app/ui";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { greeting, SERIES_STATUS_LABEL } from "@/lib/format";
import {
  firstName,
  isWatched,
  seriesProgress,
  useLibrary,
  useSpace,
  type LibraryWork,
} from "@/lib/space";

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
    <AppShell skeleton={<HomeSkeleton />}>
      <Home />
    </AppShell>
  ),
});

function ContextList({ items, empty }: { items: LibraryWork[]; empty: string }) {
  return (
    items.length === 0 ? (
      <EmptyState title={empty} />
    ) : (
      <div className="divide-y divide-border border-y border-border">
        {items.slice(0, 3).map((w) => (
          <Link
            key={w.id}
            to="/work/$id"
            params={{ id: w.id }}
            className="pressable flex min-h-16 items-center gap-3 py-2.5"
          >
            <div className="w-9 shrink-0">
              <Poster path={w.poster_path} title={w.title} className="rounded-md" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-semibold">{w.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {w.media_type === "tv" ? "Série" : "Filme"}{w.release_year ? ` · ${w.release_year}` : ""}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    )
  );
}

function Home() {
  const { data: space } = useSpace();
  const { data: works = [], isLoading } = useLibrary(space?.spaceId);
  // Only the most recent *revealed* Match result; open sessions are never read here.
  const lastMatch = useQuery({
    queryKey: ["last-match", space?.spaceId],
    enabled: !!space?.spaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("match_sessions")
        .select("result_work_ids, closed_at")
        .eq("space_id", space!.spaceId!)
        .eq("status", "closed")
        .not("closed_at", "is", null).order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  if (!space || isLoading) return <HomeSkeleton />;
  const continuing = works.filter(
    (w) => w.media_type === "tv" && w.series_states[0]?.status === "watching",
  );
  const unrated = works.filter(
    (w) => isWatched(w) && !w.ratings.some((r) => r.user_id === space.userId),
  );
  const news = works.filter(
    (w) =>
      w.indications.some((i) => i.indicated_by !== space.userId) &&
      !w.interests.some((i) => i.user_id === space.userId),
  );
  const both = works.filter(
    (w) =>
      !isWatched(w) &&
      w.interests.filter((i) => i.reaction === "fire" || i.reaction === "like").length >=
        (space.partner ? 2 : 1),
  );

  const scrollToContinuing = () =>
    document.querySelector("#continuar-assistindo")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="px-4 pt-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{greeting()},</p>
          <h1 className="text-2xl font-semibold">{firstName(space.me.display_name)}</h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/add"
            aria-label="Adicionar"
            className="pressable hit flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          >
            <Plus className="h-5 w-5" />
          </Link>
          <Link
            to="/settings"
            aria-label="Configurações"
            className="pressable hit flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-2" aria-label="Atalhos">
        <button
          type="button"
          onClick={scrollToContinuing}
          disabled={continuing.length === 0}
          className="pressable flex min-h-20 items-center gap-3 rounded-xl border border-border bg-card p-3 text-left disabled:opacity-55"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <Clock className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Continuar</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{continuing.length} em andamento</span>
          </span>
        </button>
        {unrated[0] ? (
          <Link
            to="/work/$id"
            params={{ id: unrated[0].id }}
            className="pressable flex min-h-20 items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
              <Star className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Não avaliados</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{unrated.length} pendentes</span>
            </span>
          </Link>
        ) : (
          <div className="flex min-h-20 items-center gap-3 rounded-xl border border-border bg-card p-3 opacity-55">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
              <Star className="h-5 w-5" />
            </span>
            <span><span className="block text-sm font-semibold">Não avaliados</span><span className="mt-0.5 block text-xs text-muted-foreground">Tudo em dia</span></span>
          </div>
        )}
        <Link
          to="/match"
          className="pressable flex min-h-16 items-center gap-3 rounded-xl border border-border bg-card p-3"
        >
          <Heart className="h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0"><span className="block text-sm font-semibold">Último Match</span><span className="block text-xs text-muted-foreground">{lastMatch.data ? `${lastMatch.data.result_work_ids?.length ?? 0} em comum` : "Nenhum ainda"}</span></span>
        </Link>
        <div className="flex min-h-16 items-center gap-3 rounded-xl border border-dashed border-border p-3" aria-label="Importações, em breve">
          <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span><span className="block text-sm font-semibold text-muted-foreground">Importações</span><span className="block text-xs text-muted-foreground">Em breve</span></span>
        </div>
      </section>

      <section id="continuar-assistindo" className="scroll-mt-4 mt-8">
        <h2 className="mb-3 text-base font-semibold">Continuar assistindo</h2>
        {continuing.length === 0 ? (
          <EmptyState
            title="Nenhuma série em andamento"
            text="Marque episódios numa série para ela aparecer aqui."
          />
        ) : (
          <div className="space-y-3">
            {continuing.slice(0, 3).map((w) => {
              const p = seriesProgress(w);
              const pct = p.total ? Math.min(100, (p.seen / p.total) * 100) : 0;
              return (
                <article key={w.id} className="flex min-h-32 items-center gap-3 rounded-xl border border-border bg-card p-3">
                  <Link
                    to="/work/$id"
                    params={{ id: w.id }}
                    className="pressable flex min-w-0 flex-1 items-center gap-3"
                  >
                    <div className="w-20 shrink-0">
                      <Poster path={w.poster_path} title={w.title} className="rounded-lg" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 font-medium">{w.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.next ? (
                          <>
                            Próximo <span className="font-semibold text-foreground">{p.next}</span>
                          </>
                        ) : (
                          SERIES_STATUS_LABEL[w.series_states[0]!.status]
                        )}
                      </p>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-200"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {p.seen} de {p.total || "?"} episódios
                      </p>
                    </div>
                  </Link>
                  <button
                    disabled
                    title="Envio para a TV não configurado"
                    aria-label="Assistir na TV (não configurado)"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground opacity-60"
                  >
                    <Tv className="h-4 w-4" />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3">
          <h2 className="text-base font-semibold">Novidades pra ti</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Indicações do casal esperando sua reação.</p>
        </div>
        <ContextList items={news} empty="Nenhuma indicação nova esperando sua reação." />
      </section>
      <section className="mt-8">
        <div className="mb-3">
          <h2 className="text-base font-semibold">Talvez vocês gostem</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Poucas escolhas em que os interesses de vocês combinam.</p>
        </div>
        <ContextList items={both} empty="Quando os dois curtirem uma obra, ela aparece aqui." />
      </section>
    </div>
  );
}
