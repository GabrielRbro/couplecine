import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BackButton } from "@/components/app/ui";
import { GeminiSettings } from "@/components/app/GeminiSettings";
import { SimklSettings } from "@/components/app/SimklSettings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useSpace } from "@/lib/space";
import { useServerFn } from "@tanstack/react-start";
import { getAiStatus } from "@/lib/ai.functions";
import { promptInstall, useInstallState } from "@/lib/pwa";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Configurações — AppCinema" },
      { name: "description", content: "Espaço do casal, convites e integrações." },
      { property: "og:title", content: "Configurações — AppCinema" },
      { property: "og:description", content: "Espaço do casal, convites e integrações." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

function AppInstallSection() {
  const state = useInstallState();
  return (
    <section className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h2 className="font-semibold">Aplicativo</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {state === "installed"
            ? "AppCinema instalado"
            : state === "available"
              ? "Instale na tela inicial do celular."
              : "Menu do Chrome → Instalar app"}
        </p>
      </div>
      {state === "available" && (
        <button
          onClick={() => void promptInstall()}
          className="pressable min-h-11 shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Instalar AppCinema
        </button>
      )}
    </section>
  );
}

function SettingsPage() {
  const aiStatus = useServerFn(getAiStatus);
  const { data: space } = useSpace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const invites = useQuery({
    queryKey: ["invites", space?.spaceId],
    enabled: !!space?.spaceId,
    queryFn: async () =>
      (
        await supabase
          .from("authorized_users")
          .select("id, email, accepted_by")
          .eq("space_id", space!.spaceId!)
      ).data ?? [],
  });

  async function invite() {
    if (space?.partner) {
      toast.error("Este espaço já tem dois membros.");
      return;
    }
    const value = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      toast.error("Digite um e-mail válido.");
      return;
    }
    const { error } = await supabase
      .from("authorized_users")
      .insert({ space_id: space!.spaceId!, email: value, invited_by: space!.userId });
    if (error) {
      toast.error("Não foi possível convidar.");
      return;
    }
    setEmail("");
    toast.success("Convite registrado. Peça para a pessoa entrar com esse Google.");
    invites.refetch();
  }

  const ai = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => aiStatus(),
    staleTime: 60_000,
  });
  // Owner-only (RLS): counts works tracked in the removable demo batch.
  const demo = useQuery({
    queryKey: ["demo-batch"],
    queryFn: async () => {
      const { count } = await supabase
        .from("demo_batch_items")
        .select("id", { count: "exact", head: true })
        .eq("batch", "demo-v1")
        .not("work_id", "is", null);
      return count ?? 0;
    },
  });
  async function removeDemo() {
    if (!window.confirm("Remover todas as obras de demonstração?")) return;
    const { data, error } = await supabase.rpc("demo_cleanup", { _batch: "demo-v1" });
    if (error) {
      toast.error("Não foi possível remover.");
      return;
    }
    toast.success(`${data} obras de demonstração removidas`);
    qc.invalidateQueries();
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!space) return null;
  const integrations = ["Envio para a TV", "Tracker de séries"];

  return (
    <div className="space-y-6 px-4 pt-6">
      <div className="flex items-center gap-3">
        <BackButton />
        <h1 className="text-xl font-semibold">Configurações</h1>
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Conectado como</p>
        <p className="font-medium">{space.me.display_name}</p>
        <p className="text-xs text-muted-foreground">{space.email}</p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-semibold">Parceiro(a)</h2>
        {space.partner ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {space.partner.display_name} já está no espaço.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              Convide pelo e-mail Google da outra pessoa.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@gmail.com"
                className="min-w-0 flex-1 rounded-xl border border-input bg-secondary px-3 py-2 text-sm outline-none"
              />
              <button
                onClick={invite}
                className="pressable min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                Convidar
              </button>
            </div>
          </>
        )}
        {invites.data?.map((i) => (
          <p key={i.id} className="mt-2 text-xs text-muted-foreground">
            {i.email} · {i.accepted_by ? "aceito" : "pendente"}
          </p>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-semibold">Integrações</h2>
        {integrations.map((n) => (
          <div key={n} className="mt-2 flex justify-between text-sm">
            <span>{n}</span>
            <span className="text-xs text-muted-foreground">Não configurado</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between text-sm">
          <span>Catálogo (TMDB)</span>
          <span className="text-xs text-primary">Ativo</span>
        </div>
        <GeminiSettings status={ai.data} onChanged={() => ai.refetch()} />
        <SimklSettings />
      </section>

      <AppInstallSection />

      {demo.data ? (
        <section className="rounded-2xl border border-dashed border-border p-4">
          <h2 className="font-semibold">Dados de demonstração</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {demo.data} obras de teste identificadas. Remover apaga só esse lote; suas obras reais
            ficam.
          </p>
          <button
            onClick={removeDemo}
            className="pressable mt-3 min-h-11 w-full rounded-xl border border-destructive/40 text-sm text-destructive"
          >
            Remover dados de demonstração
          </button>
        </section>
      ) : null}

      <button
        onClick={signOut}
        className="w-full rounded-xl border border-border py-3 text-sm font-medium text-destructive"
      >
        Sair
      </button>
    </div>
  );
}
