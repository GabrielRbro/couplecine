import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { BottomNav } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Local session read (no network) so navigation never waits on Auth.
    // Security is unchanged: every query is validated server-side by RLS/JWT.
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) throw redirect({ to: "/auth" });
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      <Outlet />
      {path !== "/onboarding" && <BottomNav />}
    </>
  );
}
