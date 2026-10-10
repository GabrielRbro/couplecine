import { createFileRoute } from "@tanstack/react-router";
import { exchangeCode, SIMKL_ISSUER, simklConfig, takeState } from "@/lib/simkl.server";

// OAuth callback: public by necessity. Trust comes only from the single-use, expiring
// state row (bound to the user who started the flow) plus the RFC 9207 issuer check.
const back = (req: Request, result: string) => Response.redirect(new URL(`/settings?simkl=${result}`, req.url).toString(), 302);

export const Route = createFileRoute("/api/public/simkl/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cfg = simklConfig();
        if (!cfg) return back(request, "not_configured");
        const p = new URL(request.url).searchParams;
        const state = p.get("state");
        if (!state || state.length > 100) return back(request, "invalid");
        const bound = await takeState(state); // consumed even on error paths
        if (!bound) return back(request, "expired");
        if (p.get("iss") !== SIMKL_ISSUER) return back(request, "invalid");
        if (p.get("error")) return back(request, "cancelled");
        const code = p.get("code");
        if (!code || code.length > 500) return back(request, "invalid");
        try {
          await exchangeCode(cfg, bound.userId, code, bound.verifier);
          return back(request, "connected");
        } catch {
          return back(request, "failed");
        }
      },
    },
  },
});
