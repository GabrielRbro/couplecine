import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { BottomNav } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Local session read (no network) so navigation never waits on Auth.
    // Security is unchanged: every query is validated server-side by RLS/JWT.
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    // Keeps the destination (e.g. shared content on /import) through Google sign-in.
    if (!user) throw redirect({ to: "/auth", search: location.pathname === "/" ? {} : { next: location.href } });
    return { user };
  },
  component: AuthenticatedLayout,
});

// Fullscreen experiences render without the BottomNav.
const NO_NAV = new Set(["/onboarding", "/match", "/import"]);

function AuthenticatedLayout() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      <Outlet />
      <div hidden={NO_NAV.has(path)}><BottomNav /></div>
    </>
  );
}
