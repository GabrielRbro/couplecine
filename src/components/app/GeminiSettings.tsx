import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { removeGeminiKey, saveGeminiKey, testGeminiKey } from "@/lib/ai.functions";

type Status = {
  configured: boolean;
  model: string;
  isOwner: boolean;
  source: "app" | "environment" | "none" | null;
  last4: string | null;
};

const RESULT: Record<string, string> = {
  success: "Conexão OK: a chave funciona.",
  invalid_key: "Chave inválida ou sem permissão.",
  rate_limited: "Chave válida, mas o limite do Gemini foi atingido agora.",
  unavailable: "O Gemini não respondeu. Tente de novo mais tarde.",
};

/** Owner manages the key (never shown back); partner only sees on/off. */
export function GeminiSettings({ status, onChanged }: { status?: Status; onChanged: () => void }) {
  const test = useServerFn(testGeminiKey);
  const save = useServerFn(saveGeminiKey);
  const remove = useServerFn(removeGeminiKey);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | "remove" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = key.trim().length >= 20;

  const label = !status
    ? "…"
    : status.configured
      ? `Ativo${status.isOwner && status.source === "environment" ? " · ambiente" : status.isOwner && status.source === "app" ? " · app" : ""}`
      : "Não configurado";

  async function run(kind: "test" | "save") {
    if (!valid) return;
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "test") {
        const r = await test({ data: { key: key.trim() } });
        setMessage({ ok: r.result === "success", text: RESULT[r.result]! });
      } else {
        const r = await save({ data: { key: key.trim() } });
        if (!r.ok) setMessage({ ok: false, text: RESULT[r.result]! });
        else {
          setKey("");
          setEditing(false);
          toast.success("Chave do Gemini salva");
          onChanged();
        }
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Erro inesperado." });
    } finally {
      setBusy(null);
    }
  }

  async function doRemove() {
    if (!window.confirm("Remover a chave do Gemini salva no app?")) return;
    setBusy("remove");
    try {
      await remove();
      toast.success("Chave removida");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível remover.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex justify-between text-sm">
        <span>IA (Gemini)</span>
        <span className={`text-xs ${status?.configured ? "text-primary" : "text-muted-foreground"}`}>
          {label}
        </span>
      </div>
      {status?.isOwner && (
        <>
          {status.source === "app" && status.last4 && !editing && (
            <p className="mt-1 text-xs text-muted-foreground">Chave salva terminando em ••••{status.last4}</p>
          )}
          {editing || status.source !== "app" ? (
            <div className="mt-3">
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Cole a chave do Gemini"
                aria-label="Chave do Gemini"
                className="min-h-11 w-full rounded-xl border border-input bg-secondary px-3 text-sm outline-none"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  disabled={!valid || !!busy}
                  onClick={() => run("test")}
                  className="pressable min-h-11 rounded-xl border border-border text-sm disabled:opacity-50"
                >
                  {busy === "test" ? "Testando…" : "Testar conexão"}
                </button>
                <button
                  disabled={!valid || !!busy}
                  onClick={() => run("save")}
                  className="pressable min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {busy === "save" ? "Salvando…" : "Salvar e usar"}
                </button>
              </div>
              {editing && (
                <button
                  onClick={() => {
                    setEditing(false);
                    setKey("");
                    setMessage(null);
                  }}
                  className="pressable mt-1 min-h-11 w-full text-xs text-muted-foreground"
                >
                  Cancelar
                </button>
              )}
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => setEditing(true)}
                className="pressable min-h-11 rounded-xl border border-border text-sm"
              >
                Trocar
              </button>
              <button
                disabled={!!busy}
                onClick={doRemove}
                className="pressable min-h-11 rounded-xl border border-destructive/40 text-sm text-destructive disabled:opacity-50"
              >
                {busy === "remove" ? "Removendo…" : "Remover"}
              </button>
            </div>
          )}
          {message && (
            <p
              role="status"
              className={`mt-2 text-xs ${message.ok ? "text-primary" : "text-destructive"}`}
            >
              {message.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
