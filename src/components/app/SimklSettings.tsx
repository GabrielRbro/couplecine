import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { disconnectSimkl, getSimklSetup, startSimklAuth, syncSimkl } from "@/lib/simkl.functions";

const AUTO_MS = 20 * 60_000;
const RESULT: Record<string, string> = { connected: "Simkl conectado.", cancelled: "Conexão com o Simkl cancelada.", expired: "O pedido de conexão expirou. Tente de novo.", invalid: "Resposta de conexão inválida.", failed: "O Simkl recusou a troca de autorização. Tente de novo.", not_configured: "Simkl precisa de configuração." };

/** Individual, read-only Simkl evidence. Never writes to library, watch history or Simkl. */
export function SimklSettings() {
  const qc = useQueryClient();
  const setupFn = useServerFn(getSimklSetup);
  const start = useServerFn(startSimklAuth);
  const sync = useServerFn(syncSimkl);
  const unlink = useServerFn(disconnectSimkl);
  const [busy, setBusy] = useState<null | "connect" | "sync" | "disconnect">(null);
  const setup = useQuery({ queryKey: ["simkl-setup"], queryFn: () => setupFn(), staleTime: 300_000 });
  const account = useQuery({
    queryKey: ["simkl-account"],
    queryFn: async () => (await supabase.from("integration_accounts").select("status, external_username, sync_status, sync_error, last_sync_at").eq("provider", "simkl").maybeSingle()).data,
  });
  const items = useQuery({
    queryKey: ["simkl-items"],
    enabled: !!account.data,
    queryFn: async () => (await supabase.from("external_watch_items").select("external_type, title, year, status, last_watched_at, watched_episodes_count, dated_episodes_count").eq("provider", "simkl").order("last_watched_at", { ascending: false, nullsFirst: false }).limit(1000)).data ?? [],
  });

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("simkl");
    if (r && RESULT[r]) { (r === "connected" ? toast.success : toast)(RESULT[r]); history.replaceState(history.state, "", window.location.pathname); }
  }, []);

  async function runSync(manual: boolean) {
    setBusy("sync");
    try {
      const r = await sync({ data: { manual } });
      if (!r.ok) toast.error(r.reason);
      else if (manual && "skipped" in r && r.skipped) toast("Sincronizado há pouco; aguarde um minuto.");
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ["simkl-account"] });
      void qc.invalidateQueries({ queryKey: ["simkl-items"] });
    }
  }

  // Automatic delta only while this screen is visible and the last sync is older than 20 min. No background polling.
  const autoRan = useRef(false);
  const acc = account.data;
  useEffect(() => {
    if (autoRan.current || !acc || acc.status !== "connected" || document.visibilityState !== "visible") return;
    if (acc.last_sync_at && Date.now() - new Date(acc.last_sync_at).getTime() < AUTO_MS) return;
    autoRan.current = true;
    void runSync(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acc]);

  const list = items.data ?? [];
  const count = (t: string) => list.filter((i) => i.external_type === t).length;
  const eps = list.reduce((n, i) => n + (i.watched_episodes_count ?? 0), 0);
  const dated = list.reduce((n, i) => n + i.dated_episodes_count, 0);

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="font-semibold">Simkl</h2>
      {setup.isLoading ? <p className="mt-1 text-xs text-muted-foreground">Verificando…</p> : !setup.data?.configured ? (
        <div className="mt-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Simkl precisa de configuração</p>
          <p className="mt-1">Registre um app Simkl AUTH V2 do tipo “Server app”, com escopo media:read e o endereço de retorno exato https://couplecine.lovable.app/api/public/simkl/callback. Depois salve SIMKL_CLIENT_ID, SIMKL_CLIENT_SECRET e SIMKL_REDIRECT_URI nos segredos do projeto.</p>
        </div>
      ) : !acc ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">Leitura individual da sua conta (somente leitura). Nada é marcado na biblioteca do casal.</p>
          <Button className="mt-3 min-h-11" disabled={!!busy} onClick={async () => { setBusy("connect"); const r = await start().catch(() => null); if (r?.ok) window.location.assign(r.url); else { setBusy(null); toast.error(r && !r.ok ? r.reason : "Não foi possível iniciar."); } }}>{busy === "connect" && <LoaderCircle className="animate-spin" />}Conectar minha conta Simkl</Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {acc.status === "reauth_required" ? "Acesso expirou — conecte de novo." : `Conectado${acc.external_username ? ` como ${acc.external_username}` : ""}`}
            {" · "}{acc.sync_status === "syncing" ? "sincronizando…" : acc.last_sync_at ? `última sincronização ${new Date(acc.last_sync_at).toLocaleString("pt-BR")}` : "ainda não sincronizado"}
          </p>
          {acc.sync_error && <p role="status" className="mt-1 text-xs text-destructive">{acc.sync_error}</p>}
          {list.length > 0 && (
            <>
              <p className="mt-2 text-xs">{count("movies")} filmes · {count("shows")} séries · {count("anime")} animes · {eps} episódios ({dated} com data real, {Math.max(0, eps - dated)} sem data conhecida)</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{list.slice(0, 5).map((i) => <li key={i.external_type + i.title + i.year} className="truncate">{i.title}{i.year ? ` (${i.year})` : ""} · {i.status ?? "—"}{i.last_watched_at ? ` · ${new Date(i.last_watched_at).toLocaleDateString("pt-BR")}` : ""}</li>)}</ul>
              <p className="mt-2 text-[11px] text-muted-foreground">Prévia individual. Ainda não é atribuída ao casal.</p>
            </>
          )}
          <div className="mt-3 flex gap-2">
            {acc.status === "reauth_required"
              ? <Button className="min-h-11" disabled={!!busy} onClick={async () => { const r = await start().catch(() => null); if (r?.ok) window.location.assign(r.url); }}>Conectar de novo</Button>
              : <Button variant="secondary" className="min-h-11" disabled={!!busy} onClick={() => runSync(true)}>{busy === "sync" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Sincronizar agora</Button>}
            <Button variant="ghost" className="min-h-11" disabled={!!busy} onClick={async () => { setBusy("disconnect"); await unlink().catch(() => null); setBusy(null); void qc.invalidateQueries({ queryKey: ["simkl-account"] }); }}>Desconectar</Button>
          </div>
        </>
      )}
    </section>
  );
}
