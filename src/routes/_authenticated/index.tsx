import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Heart, Plus, Settings, Sparkles, Star, Tv, Upload } from "lucide-react";
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

function Row({ title, items, empty }: { title: string; items: LibraryWork[]; empty: string }) {
  return (
    <section className="mt-7">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {items.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
          {items.map((w) => (
            <Link
              key={w.id}
              to="/work/$id"
              params={{ id: w.id }}
              className="pressable w-28 shrink-0"
            >
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

  const quick = [
    { label: "Continuar", value: continuing.length, icon: Clock },
    { label: "Não avaliados", value: unrated.length, icon: Star },
    {
      label: "Último Match",
      value: lastMatch.data ? String(lastMatch.data.result_work_ids?.length ?? 0) : "Nenhum",
      icon: Heart,
      to: "/match" as const,
    },
    { label: "Importações", value: "Em breve", icon: Upload, muted: true },
  ];

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

      <div className="mt-6 grid grid-cols-4 gap-2">
        {quick.map((q) => {
          const body = (
            <>
              <q.icon
                className={`h-4 w-4 ${"muted" in q ? "text-muted-foreground" : "text-primary"}`}
              />
              <p
                className={`mt-2 font-semibold leading-none ${typeof q.value === "number" || /^\d+$/.test(String(q.value)) ? "text-lg" : "text-xs text-muted-foreground"}`}
              >
                {q.value}
              </p>
              <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{q.label}</p>
            </>
          );
          const cls = `flex min-h-[74px] flex-col rounded-xl border border-border bg-card p-2.5 ${"muted" in q ? "border-dashed" : ""}`;
          return "to" in q && q.to ? (
            <Link key={q.label} to={q.to} className={`pressable ${cls}`}>
              {body}
            </Link>
          ) : (
            <div key={q.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>

      <section className="mt-7">
        <h2 className="mb-3 text-base font-semibold">Continuar assistindo</h2>
        {continuing.length === 0 ? (
          <EmptyState
            title="Nenhuma série em andamento"
            text="Marque episódios numa série para ela aparecer aqui."
          />
        ) : (
          <div className="space-y-2">
            {continuing.slice(0, 3).map((w) => {
              const p = seriesProgress(w);
              const pct = p.total ? Math.min(100, (p.seen / p.total) * 100) : 0;
              return (
                <div
                  key={w.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-2"
                >
                  <Link
                    to="/work/$id"
                    params={{ id: w.id }}
                    className="pressable flex min-w-0 flex-1 items-center gap-3"
                  >
                    <div className="w-14 shrink-0">
                      <Poster path={w.poster_path} title={w.title} className="rounded-lg" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 font-medium">{w.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.next ? (
                          <>
                            Próximo <span className="font-semibold text-foreground">{p.next}</span>
                          </>
                        ) : (
                          SERIES_STATUS_LABEL[w.series_states[0]!.status]
                        )}
                      </p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
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
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Row
        title="Novidades pra ti"
        items={news}
        empty="Nenhuma indicação nova esperando sua reação."
      />
      <Row
        title="Talvez vocês gostem"
        items={both}
        empty="Quando os dois curtirem uma obra, ela aparece aqui."
      />
      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" /> Recomendações personalizadas chegam numa próxima fase.
      </p>
    </div>
  );
}
