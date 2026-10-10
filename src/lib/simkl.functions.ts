import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAuthorizeUrl, disconnect, runSync, simklConfig } from "./simkl.server";

/** Status only: whether the app is configured. Account state is read via RLS from integration_accounts. */
export const getSimklSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const cfg = simklConfig();
    return { configured: !!cfg, redirectUri: cfg?.redirectUri ?? null };
  });

export const startSimklAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cfg = simklConfig();
    if (!cfg) return { ok: false as const, reason: "Simkl precisa de configuração." };
    return { ok: true as const, url: await buildAuthorizeUrl(cfg, context.userId) };
  });

export const syncSimkl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ manual: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const cfg = simklConfig();
    if (!cfg) return { ok: false as const, reason: "Simkl precisa de configuração." };
    return runSync(cfg, context.userId, data.manual);
  });

export const disconnectSimkl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await disconnect(simklConfig(), context.userId);
    return { ok: true };
  });
