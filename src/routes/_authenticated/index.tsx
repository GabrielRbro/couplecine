import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Heart, Plus, Settings, Star, Upload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HomeSkeleton } from "@/components/app/ui";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState, Poster } from "@/components/app/MediaCard";
import { greeting, SERIES_STATUS_LABEL, tmdbImage } from "@/lib/format";
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
  return items.length === 0 ? (
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
              {w.media_type === "tv" ? "Série" : "Filme"}
              {w.release_year ? ` · ${w.release_year}` : ""}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );
}

/** Continue-watching card: wide (1 item) or compact poster card (2 or 3+). */
function ContinueCard({
  work: w,
  wide,
  className = "",
}: {
  work: LibraryWork;
  wide: boolean;
  className?: string;
}) {
  const p = seriesProgress(w);
  const pct = p.total ? Math.min(100, (p.seen / p.total) * 100) : 0;
  const label = p.next
    ? `Próximo ${p.next}`
    : SERIES_STATUS_LABEL[w.series_states[0]?.status ?? "watching"];
  const backdrop = tmdbImage(w.backdrop_path, "w780");
  const bar = (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
  if (wide)
    return (
      <Link
        to="/work/$id"
        params={{ id: w.id }}
        className="pressable relative block overflow-hidden rounded-2xl border border-border"
      >
        <div className="aspect-[16/9] bg-card">
          {backdrop && (
            <img
              src={backdrop}
              alt=""
              style={{ viewTransitionName: `backdrop-${w.id}` }}
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="font-display text-lg font-semibold leading-tight">{w.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{label}</span> · {p.seen} de{" "}
            {p.total || "?"} episódios
          </p>
          {bar}
        </div>
      </Link>
    );
  return (
    <Link to="/work/$id" params={{ id: w.id }} className={`pressable block min-w-0 ${className}`}>
      <div style={{ viewTransitionName: `poster-${w.id}` }}>
        <Poster path={w.poster_path} title={w.title} className="rounded-xl" />
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-semibold">{w.title}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {bar}
    </Link>
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
        .not("closed_at", "is", null)
        .order("closed_at", { ascending: false })
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

  const quick =
    "pressable flex min-h-24 flex-col items-start justify-between gap-1 rounded-xl border border-border bg-card p-3";

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

      <section className="mt-5 grid grid-cols-3 gap-2" aria-label="Atalhos">
        {unrated[0] ? (
          <Link to="/work/$id" params={{ id: unrated[0].id }} className={quick}>
            <Star className="h-5 w-5 text-primary" />
            <span className="text-xs font-semibold">Não avaliados</span>
            <span className="text-[11px] text-muted-foreground">{unrated.length} pendentes</span>
          </Link>
        ) : (
          <div className={`${quick} opacity-55`}>
            <Star className="h-5 w-5 text-primary" />
            <span className="text-xs font-semibold">Não avaliados</span>
            <span className="text-[11px] text-muted-foreground">Tudo em dia</span>
          </div>
        )}
        <Link to="/match" className={quick}>
          <Heart className="h-5 w-5 text-primary" />
          <span className="text-xs font-semibold">Último Match</span>
          <span className="text-[11px] text-muted-foreground">
            {lastMatch.data
              ? `${lastMatch.data.result_work_ids?.length ?? 0} em comum`
              : "Nenhum ainda"}
          </span>
        </Link>
        <div className={`${quick} border-dashed`} aria-label="Importações, em breve">
          <Upload className="h-5 w-5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground">Importações</span>
          <span className="text-[11px] text-muted-foreground">Em breve</span>
        </div>
      </section>

      <section className="mt-7">
        <h2 className="mb-3 text-base font-semibold">Continuar assistindo</h2>
        {continuing.length === 0 ? (
          <EmptyState
            title="Nenhuma série em andamento"
            text="Marque episódios numa série para ela aparecer aqui."
          />
        ) : (
          <div
            className={
              continuing.length === 1
                ? ""
                : continuing.length === 2
                  ? "grid grid-cols-2 gap-3"
                  : "no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4"
            }
          >
            {continuing.map((w) => (
              <ContinueCard
                key={w.id}
                work={w}
                wide={continuing.length === 1}
                className={continuing.length >= 3 ? "w-[38%] shrink-0 snap-start" : ""}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3">
          <h2 className="text-base font-semibold">Novidades pra ti</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Indicações do casal esperando sua reação.
          </p>
        </div>
        <ContextList items={news} empty="Nenhuma indicação nova esperando sua reação." />
      </section>
      <section className="mt-8">
        <div className="mb-3">
          <h2 className="text-base font-semibold">Interesse em comum</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ainda não assistidas, e os dois reagiram com 🔥 ou 👍.
          </p>
        </div>
        <ContextList items={both} empty="Quando os dois curtirem uma obra, ela aparece aqui." />
      </section>
    </div>
  );
}
