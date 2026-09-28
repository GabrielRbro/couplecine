import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Dices, Heart, Home, Images, Library, Popcorn, X } from "lucide-react";
import { useSpace } from "@/lib/space";

function PageGate({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useSpace();
  const navigate = useNavigate();
  useEffect(() => {
    if (data && !data.spaceId) navigate({ to: "/onboarding", replace: true });
  }, [data, navigate]);
  if (isLoading || (data && !data.spaceId))
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">Não foi possível carregar seu espaço.</div>;
  return <>{children}</>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-md pb-28">
      <PageGate>{children}</PageGate>
      <BottomNav />
    </div>
  );
}

const RADIAL = [
  { to: "/watch/gallery" as const, label: "Galeria", icon: Images, pos: "-translate-x-20 -translate-y-6" },
  { to: "/watch/dice" as const, label: "Sortear", icon: Dices, pos: "-translate-y-20" },
  { to: "/match" as const, label: "Match", icon: Heart, pos: "translate-x-20 -translate-y-6" },
];

export function BottomNav() {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tab = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`;
  return (
    <>
      {open && <button aria-label="Fechar menu" className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm" onClick={() => setOpen(false)} />}
      <nav className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md px-4 pb-[max(env(safe-area-inset-bottom),12px)]">
        <div className="relative flex items-end rounded-2xl border border-border bg-card/95 px-2 backdrop-blur">
          <Link to="/" className={tab(path === "/")} onClick={() => setOpen(false)}>
            <Home className="h-5 w-5" /> Início
          </Link>
          <div className="relative flex flex-1 justify-center">
            {RADIAL.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={`absolute bottom-6 flex flex-col items-center gap-1 transition-all duration-200 ${open ? `${item.pos} opacity-100` : "pointer-events-none translate-y-0 opacity-0"}`}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="text-[11px] text-foreground">{item.label}</span>
              </Link>
            ))}
            <button
              aria-label={open ? "Fechar" : "Assistir"}
              onClick={() => setOpen((v) => !v)}
              className="-mt-7 mb-2 flex flex-col items-center gap-1"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-lg">
                {open ? <X className="h-6 w-6" /> : <Popcorn className="h-6 w-6" strokeWidth={1.8} />}
              </span>
              <span className="text-[11px] font-medium text-foreground">Assistir</span>
            </button>
          </div>
          <Link to="/library" className={tab(path.startsWith("/library"))} onClick={() => setOpen(false)}>
            <Library className="h-5 w-5" /> Biblioteca
          </Link>
        </div>
      </nav>
    </>
  );
}
