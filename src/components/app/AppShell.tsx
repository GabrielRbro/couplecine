import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Clapperboard, Dices, Film, Heart, Home, Popcorn, X } from "lucide-react";
import { useSpace } from "@/lib/space";
import { HomeSkeleton } from "./ui";

function PageGate({ children, skeleton }: { children: ReactNode; skeleton?: ReactNode }) {
  const { data, isLoading, error } = useSpace();
  const navigate = useNavigate();
  useEffect(() => {
    if (data && !data.spaceId) navigate({ to: "/onboarding", replace: true });
  }, [data, navigate]);
  if (isLoading || (data && !data.spaceId)) return <>{skeleton ?? <HomeSkeleton />}</>;
  if (error)
    return (
      <div className="p-6 text-sm text-destructive">Não foi possível carregar seu espaço.</div>
    );
  return <>{children}</>;
}

export function AppShell({ children, skeleton }: { children: ReactNode; skeleton?: ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-md" style={{ paddingBottom: "var(--nav-space)" }}>
      <PageGate skeleton={skeleton}>{children}</PageGate>
    </div>
  );
}

// Positions relative to the central button; stagger is applied via transition-delay.
const RADIAL = [
  { to: "/watch/gallery" as const, label: "Galeria", icon: Film, x: -76, y: -22 },
  { to: "/watch/dice" as const, label: "Sortear", icon: Dices, x: 0, y: -78 },
  { to: "/match" as const, label: "Match", icon: Heart, x: 76, y: -22 },
];

export function BottomNav() {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  type Dest = (typeof RADIAL)[number]["to"] | "/" | "/library";
  const pendingPath = useRef<Dest | null>(null);

  // Close on Escape and on browser/Android back.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && window.history.state?.radial) window.history.back();
    };
    const onPop = () => {
      setOpen(false);
      const destination = pendingPath.current;
      pendingPath.current = null;
      if (destination) navigate({ to: destination });
    };
    window.history.pushState({ radial: true }, "");
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
    };
  }, [navigate, open]);

  const close = (viaBack = true) => {
    if (viaBack && window.history.state?.radial) window.history.back();
    else setOpen(false);
  };

  // Any destination tapped while the radial is open first pops the synthetic entry, then navigates.
  const chooseRadial = (event: MouseEvent<HTMLAnchorElement>, to: Dest) => {
    if (!open || !window.history.state?.radial) return;
    event.preventDefault();
    pendingPath.current = to;
    window.history.back();
  };

  const tab = (active: boolean) =>
    `pressable flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`;
  return (
    <>
      <button
        aria-label="Fechar menu"
        tabIndex={open ? 0 : -1}
        className={`fixed inset-0 z-40 bg-background/70 backdrop-blur-sm transition-opacity duration-200 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => close()}
      />
      <nav style={{ viewTransitionName: "bottom-nav" }} className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md px-4 pb-[max(env(safe-area-inset-bottom),12px)]">
        <div className="relative flex items-end rounded-2xl border border-border bg-card/95 px-2 backdrop-blur">
          <Link to="/" className={tab(path === "/")} onClick={(e) => chooseRadial(e, "/")}>
            <Home className="h-5 w-5" /> Início
          </Link>
          <div className="relative flex flex-1 justify-center">
            {RADIAL.map((item, i) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={(event) => chooseRadial(event, item.to)}
                tabIndex={open ? 0 : -1}
                aria-hidden={!open}
                style={{
                  transform: open
                    ? `translate(${item.x}px, ${item.y}px) scale(1)`
                    : "translate(0, 8px) scale(0.6)",
                  transitionDelay: open ? `${i * 35}ms` : "0ms",
                }}
                className={`absolute bottom-6 flex flex-col items-center gap-1 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
              >
                <span className="pressable flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="text-[11px] text-foreground">{item.label}</span>
              </Link>
            ))}
            <button
              aria-label={open ? "Fechar" : "Assistir"}
              aria-expanded={open}
              onClick={() => (open ? close() : setOpen(true))}
              className="pressable -mt-7 mb-2 flex flex-col items-center gap-1"
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
            </button>
          </div>
          <Link
            to="/library"
            className={tab(path.startsWith("/library"))}
            onClick={(e) => chooseRadial(e, "/library")}
          >
            <Clapperboard className="h-5 w-5" /> Biblioteca
          </Link>
        </div>
      </nav>
    </>
  );
}
