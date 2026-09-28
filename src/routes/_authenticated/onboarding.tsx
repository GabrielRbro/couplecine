import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSpace } from "@/lib/space";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Criar espaço — AppCinema" }, { name: "description", content: "Crie ou entre no espaço do casal." }] }),
  component: Onboarding,
});

function Onboarding() {
  const { data: space } = useSpace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("Nosso cinema");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (space?.spaceId) navigate({ to: "/", replace: true });
  }, [space, navigate]);

  const invite = useQuery({
    queryKey: ["invite", space?.email],
    enabled: !!space?.email,
    queryFn: async () => {
      const { data } = await supabase.from("authorized_users").select("id, space_id").ilike("email", space!.email).limit(1).maybeSingle();
      return data;
    },
  });

  async function done() {
    await qc.invalidateQueries({ queryKey: ["space"] });
    navigate({ to: "/", replace: true });
  }

  async function join() {
    if (!invite.data || !space) return;
    setBusy(true);
    const { error } = await supabase.from("space_members").insert({ space_id: invite.data.space_id, user_id: space.userId });
    if (error) { toast.error("Não foi possível entrar no espaço."); setBusy(false); return; }
    await supabase.from("authorized_users").update({ accepted_by: space.userId }).eq("id", invite.data.id);
    await done();
  }

  async function create() {
    if (!space) return;
    setBusy(true);
    const id = crypto.randomUUID();
    const { error } = await supabase.from("couple_spaces").insert({ id, name: name.trim() || "Nosso cinema", created_by: space.userId });
    const r2 = error ? null : await supabase.from("space_members").insert({ space_id: id, user_id: space.userId });
    if (error || r2?.error) { toast.error("Não foi possível criar o espaço."); setBusy(false); return; }
    await done();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Bem-vindo ao AppCinema</h1>
      {invite.data ? (
        <>
          <p className="mt-2 text-muted-foreground">Você foi convidado para um espaço de casal.</p>
          <button onClick={join} disabled={busy} className="mt-8 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">Entrar no espaço</button>
        </>
      ) : (
        <>
          <p className="mt-2 text-muted-foreground">Crie o espaço do casal. Você pode usar sozinho e convidar a outra pessoa depois, em Configurações.</p>
          <label className="mt-8 text-xs text-muted-foreground">Nome do espaço</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 rounded-xl border border-input bg-card px-4 py-3 outline-none focus:border-primary" />
          <button onClick={create} disabled={busy || invite.isLoading} className="mt-4 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60">Criar espaço</button>
        </>
      )}
    </main>
  );
}
