import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Clapperboard, Dices, Film, Heart, Home, Popcorn, X } from "lucide-react";
import { useSpace } from "@/lib/space";
import { closeOverlaysThen, useOverlayHistory, useScrollKeyboardDismiss } from "@/lib/overlay";
import { Button } from "@/components/ui/button";
import { HomeSkeleton } from "./ui";

function PageGate({ children, skeleton }: { children: ReactNode; skeleton?: ReactNode }) {
  const { data, isLoading, error, refetch } = useSpace();
  const navigate = useNavigate();
  useEffect(() => {
    // Only a confirmed "no space" sends to onboarding — never a network error.
    if (data && !data.spaceId) navigate({ to: "/onboarding", replace: true });
  }, [data, navigate]);
  if (error && !data)
    return (
      <div className="p-6 text-sm">
        <p className="text-destructive">Não foi possível carregar seu espaço.</p>
        <button
          onClick={() => refetch()}
          className="pressable mt-3 min-h-11 rounded-xl border border-border px-4"
        >
          Tentar de novo
        </button>
      </div>
    );
  if (isLoading || (data && !data.spaceId)) return <>{skeleton ?? <HomeSkeleton />}</>;
  return <>{children}</>;
}

export function AppShell({
  children,
  skeleton,
  fullscreen = false,
}: {
  children: ReactNode;
  skeleton?: ReactNode;
  fullscreen?: boolean;
}) {
  useScrollKeyboardDismiss();
  return (
    <div
      className="mx-auto min-h-screen min-h-[100dvh] max-w-md"
      style={{
        paddingBottom: fullscreen ? "env(safe-area-inset-bottom)" : "var(--nav-space)",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <PageGate skeleton={skeleton}>{children}</PageGate>
    </div>
  );
}

// Positions relative to the central button; stagger is applied via transition-delay.
const RADIAL = [
  { to: "/watch/gallery" as const, label: "Galeria", icon: Film, x: -76, y: -22 },
  { to: "/match" as const, label: "Match", icon: Heart, x: 0, y: -78 },
  { to: "/watch/dice" as const, label: "Sortear", icon: Dices, x: 76, y: -22 },
];

export function BottomNav() {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  type Dest = (typeof RADIAL)[number]["to"] | "/" | "/library";

  // One silent history entry while open: Back/Escape close it, router never sees it.
  useOverlayHistory(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (event: MouseEvent<HTMLAnchorElement>, to: Dest) => {
    if (path === to) {
      event.preventDefault();
      if (open) closeOverlaysThen(() => {});
      return;
    }
    if (!open) return;
    event.preventDefault();
    closeOverlaysThen(() => navigate({ to }));
  };

  const tab = (active: boolean) =>
    `nav-tab flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`;
  return (
    <>
      <Button variant="ghost"
        aria-label="Fechar menu"
        tabIndex={open ? 0 : -1}
        className={`fixed inset-0 z-40 h-auto w-auto rounded-none p-0 bg-background/80 hover:bg-background/80 backdrop-blur-sm transition-opacity duration-150 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setOpen(false)}
      />
      <nav
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md px-4 pb-[max(env(safe-area-inset-bottom),12px)]"
      >
        <div style={{ viewTransitionName: "bottom-nav" }} className="relative flex items-end rounded-2xl border border-border nav-glass px-2">
          <Link to="/" className={tab(path === "/")} onClick={(e) => go(e, "/")}>
            <Home className="h-5 w-5" /> Início
          </Link>
          <div className="relative flex flex-1 justify-center">
            {RADIAL.map((item, i) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={(event) => go(event, item.to)}
                tabIndex={open ? 0 : -1}
                aria-hidden={!open}
                style={{
                  transform: open
                    ? `translate(${item.x}px, ${item.y}px) scale(1)`
                    : "translate(0, 8px) scale(0.6)",
                  transitionDelay: open ? `${i * 30}ms` : "0ms",
                  pointerEvents: open ? "auto" : "none",
                }}
                className={`absolute bottom-6 z-10 flex flex-col items-center gap-1 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "opacity-100" : "opacity-0"}`}
              >
                <span className={`pressable flex h-12 w-12 items-center justify-center rounded-full border border-border ${item.to === "/match" ? "bg-primary text-primary-foreground shadow-lg" : "bg-secondary text-foreground"}`}>
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="text-[11px] text-foreground">{item.label}</span>
              </Link>
            ))}
            <Button variant="ghost"
              aria-label={open ? "Fechar" : "Assistir"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="-mt-7 mb-2 flex h-auto flex-col items-center gap-1 p-0 hover:bg-transparent"
            >
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-lg">
                <Popcorn
                  className={`absolute h-6 w-6 transition-all duration-200 ${open ? "rotate-90 scale-50 opacity-0" : "opacity-100"}`}
                  strokeWidth={1.8}
                />
                <X
                  className={`absolute h-6 w-6 transition-all duration-200 ${open ? "opacity-100" : "-rotate-90 scale-50 opacity-0"}`}
                />
              </span>
              <span className="text-[11px] font-medium text-foreground">Assistir</span>
            </Button>
          </div>
          <Link
            to="/library"
            className={tab(path.startsWith("/library"))}
            onClick={(e) => go(e, "/library")}
          >
            <Clapperboard className="h-5 w-5" /> Biblioteca
          </Link>
        </div>
      </nav>
    </>
  );
}
