import { useEffect, useState } from "react";
import { Check, Minus, Plus, Star, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TouchSlider } from "./TouchSlider";
import { AnimatedSheet } from "./AnimatedSheet";
import { formatScore } from "@/lib/format";

/** Normalizes typed input ("7,5", "8.") to a valid 0–10 step-0.5 score, or null. */
export function parseScore(raw: string): number | null {
  const n = Number(raw.replace(",", ".").trim());
  if (!raw.trim() || !Number.isFinite(n) || n < 0 || n > 10) return null;
  return Math.round(n * 2) / 2;
}

export function ScorePicker({
  open,
  title,
  initial,
  saving = false,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  title: string;
  initial: number | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (score: number) => void | Promise<void>;
  onRemove?: (() => void) | undefined;
}) {
  return (
    <AnimatedSheet
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      labelledBy="score-title"
      panelClassName="pb-[max(env(safe-area-inset-bottom),24px)]"
    >
      <ScoreForm
        key={String(open)}
        title={title}
        initial={initial}
        saving={saving}
        onSave={onSave}
        onRemove={onRemove}
      />
    </AnimatedSheet>
  );
}

export function ScoreForm({
  title,
  initial,
  saving,
  onSave,
  onRemove,
  saveLabel = "Salvar nota",
}: {
  title: string;
  initial: number | null;
  saving: boolean;
  onSave: (score: number) => void | Promise<void>;
  onRemove?: (() => void) | undefined;
  saveLabel?: string;
}) {
  const [value, setValue] = useState<number>(initial ?? 5);
  const [text, setText] = useState(formatScore(initial ?? 5));
  useEffect(() => setText(formatScore(value)), [value]);
  const [feedback, setFeedback] = useState<number | null>(null);
  const typed = parseScore(text);
  const confirm = async () => {
    if (saving || feedback !== null || typed === null) return;
    setFeedback(value);
    await new Promise((resolve) => window.setTimeout(resolve, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 480));
    try { await onSave(value); } finally { setFeedback(null); }
  };
  const set = (n: number) => setValue(Math.min(10, Math.max(0, Math.round(n * 2) / 2)));
  return (
    <div className="relative">
      {feedback !== null && <div role="status" data-score-tone={feedback <= 2 ? "low" : feedback >= 9 ? "high" : "normal"} className={`score-feedback absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-card/95 ${feedback <= 2 ? "text-destructive" : "text-primary"}`}>
        {feedback <= 2 ? <ThumbsDown className="h-9 w-9" /> : feedback >= 9 ? <Star className="h-9 w-9" /> : <Check className="h-9 w-9" />}
        <span className="sr-only">Confirmando nota · {formatScore(feedback)}</span>
      </div>}
      <h2 id="score-title" className="line-clamp-1 text-lg font-semibold">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Nota de 0 a 10, de meio em meio ponto.</p>
      <div className="mt-5 flex items-center justify-center gap-4">
        <Button variant="ghost"
          type="button"
          aria-label="Diminuir meio ponto"
          onClick={() => set(value - 0.5)}
          className="pressable flex h-12 w-12 items-center justify-center rounded-full border border-border"
        >
          <Minus className="h-5 w-5" />
        </Button>
        <input
          inputMode="decimal"
          aria-label="Nota"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseScore(e.target.value);
            if (p !== null) setValue(p);
          }}
          onBlur={() => setText(formatScore(value))}
          className={`w-24 rounded-2xl border bg-background py-2 text-center font-display text-4xl font-semibold outline-none focus:border-primary ${typed === null ? "border-destructive" : "border-border"}`}
        />
        <Button variant="ghost"
          type="button"
          aria-label="Aumentar meio ponto"
          onClick={() => set(value + 0.5)}
          className="pressable flex h-12 w-12 items-center justify-center rounded-full border border-border"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>
      {typed === null && (
        <p className="mt-1 text-center text-xs text-destructive">Use um número de 0 a 10.</p>
      )}
      <TouchSlider label="Ajustar nota" min={0} max={10} step={0.5} value={value} valueText={formatScore(value)} onChange={set} />
      <div className="flex justify-between px-1 text-[11px] text-muted-foreground">
        <span>0</span>
        <span>5</span>
        <span>10</span>
      </div>
      <div className="mt-5 flex gap-2">
        {onRemove && (
          <Button variant="ghost"
            type="button"
            disabled={saving}
            onClick={onRemove}
            className="pressable min-h-12 rounded-xl border border-border px-4 text-sm text-muted-foreground disabled:opacity-50"
          >
            Remover
          </Button>
        )}
        <Button variant="ghost"
          type="button"
          disabled={saving || feedback !== null || typed === null}
          onClick={confirm}
          className="pressable min-h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Salvando…" : `${saveLabel} · ${formatScore(value)}`}
        </Button>
      </div>
    </div>
  );
}
