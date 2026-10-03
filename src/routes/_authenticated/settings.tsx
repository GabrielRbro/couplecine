import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useSpace } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configurações — AppCinema" }, { name: "description", content: "Espaço do casal, convites e integrações." }] }),
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

function SettingsPage() {
  const { data: space } = useSpace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const invites = useQuery({
    queryKey: ["invites", space?.spaceId],
    enabled: !!space?.spaceId,
    queryFn: async () => (await supabase.from("authorized_users").select("id, email, accepted_by").eq("space_id", space!.spaceId!)).data ?? [],
  });

  async function invite() {
    const value = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(value)) { toast.error("Digite um e-mail válido."); return; }
    const { error } = await supabase.from("authorized_users").insert({ space_id: space!.spaceId!, email: value, invited_by: space!.userId });
    if (error) { toast.error("Não foi possível convidar."); return; }
    setEmail("");
    toast.success("Convite registrado. Peça para a pessoa entrar com esse Google.");
    invites.refetch();
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!space) return null;
  const integrations = ["Envio para a TV", "Tracker de séries", "Importação com IA"];

  return (
    <div className="space-y-6 px-4 pt-6">
      <div className="flex items-center gap-3">
        <Link to="/" aria-label="Voltar" className="pressable -ml-2 flex h-11 w-11 items-center justify-center rounded-full"><ArrowLeft className="h-5 w-5" /></Link>
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
          <p className="mt-1 text-sm text-muted-foreground">{space.partner.display_name} já está no espaço.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">Convide pelo e-mail Google da outra pessoa.</p>
            <div className="mt-3 flex gap-2">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@gmail.com" className="min-w-0 flex-1 rounded-xl border border-input bg-secondary px-3 py-2 text-sm outline-none" />
              <button onClick={invite} className="rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Convidar</button>
            </div>
          </>
        )}
        {invites.data?.map((i) => (
          <p key={i.id} className="mt-2 text-xs text-muted-foreground">{i.email} · {i.accepted_by ? "aceito" : "pendente"}</p>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-semibold">Integrações</h2>
        {integrations.map((n) => (
          <div key={n} className="mt-2 flex justify-between text-sm"><span>{n}</span><span className="text-xs text-muted-foreground">Não configurado</span></div>
        ))}
        <div className="mt-2 flex justify-between text-sm"><span>Catálogo (TMDB)</span><span className="text-xs text-primary">Ativo</span></div>
      </section>

      <button onClick={signOut} className="w-full rounded-xl border border-border py-3 text-sm font-medium text-destructive">Sair</button>
    </div>
  );
}
