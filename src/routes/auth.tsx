import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Popcorn } from "lucide-react";
import { toast } from "sonner";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — AppCinema" },
      { name: "description", content: "Entre no AppCinema, a biblioteca de filmes e séries do casal." },
      { property: "og:title", content: "Entrar — AppCinema" },
      { property: "og:description", content: "A biblioteca privada de filmes e séries do casal." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function signIn() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (result.error) {
      toast.error("Não foi possível entrar com o Google.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-primary">
        <Popcorn className="h-7 w-7" strokeWidth={1.8} />
      </div>
      <h1 className="text-3xl font-semibold">AppCinema</h1>
      <p className="mt-2 text-muted-foreground">Filmes e séries a dois: indicações, reações, notas e o que assistir hoje.</p>
      <button
        onClick={signIn}
        disabled={busy}
        className="mt-10 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60"
      >
        {busy ? "Abrindo o Google…" : "Entrar com Google"}
      </button>
      <p className="mt-4 text-center text-xs text-muted-foreground">Acesso privado: só quem foi convidado entra no espaço do casal.</p>
    </main>
  );
}
