import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { BottomNav } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
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
