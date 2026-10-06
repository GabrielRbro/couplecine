import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AnimatedSheet } from "./AnimatedSheet";
import { Poster } from "./MediaCard";
import { ScoreForm } from "./ScorePicker";
import { supabase } from "@/integrations/supabase/client";
import type { LibraryWork, SpaceInfo } from "@/lib/space";

/** One pending work at a time on a scenic stack; saving flings the card away and advances. */
export function UnratedPile({
  open,
  onClose,
  works,
  space,
}: {
  open: boolean;
  onClose: () => void;
  works: LibraryWork[];
  space: SpaceInfo;
}) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const queue = works.filter((w) => !done.has(w.id));
  const current = queue[0];

  async function save(score: number) {
    if (!current) return;
    setSaving(true);
    const { error } = await supabase
      .from("ratings")
      .upsert(
        { work_id: current.id, user_id: space.userId, score },
        { onConflict: "user_id,work_id" },
      );
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar a nota.");
      return;
    }
    setDone((d) => new Set(d).add(current.id));
    qc.setQueriesData<LibraryWork[]>({ queryKey: ["library", space.spaceId] }, (old) =>
      old?.map((w) =>
        w.id === current.id
          ? { ...w, ratings: [...w.ratings.filter((r) => r.user_id !== space.userId), { user_id: space.userId, score }] }
          : w,
      ),
    );
  }

  return (
    <AnimatedSheet
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      labelledBy="score-title"
      panelClassName="max-h-[92dvh] overflow-y-auto pb-[max(env(safe-area-inset-bottom),24px)]"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Não avaliados</p>
      {current ? (
        <>
          <div className="relative mx-auto mt-4 aspect-[2/3] w-36">
            {queue.length > 1 && <div aria-hidden className="match-stack-back match-stack-back-far" />}
            {queue.length > 1 && <div aria-hidden className="match-stack-back match-stack-back-near" />}
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={current.id}
                className="absolute inset-0 z-[2]"
                initial={reduce ? { opacity: 0 } : { y: 24, scale: 0.94, opacity: 0 }}
                animate={{ y: 0, scale: 1, opacity: 1 }}
                exit={reduce ? { opacity: 0 } : { x: 220, rotate: 14, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
              >
                <Poster path={current.poster_path} title={current.title} className="shadow-2xl" />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-4">
            <ScoreForm
              key={current.id}
              title={current.title}
              initial={null}
              saving={saving}
              onSave={save}
              saveLabel="Salvar e próxima"
            />
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            {queue.length} {queue.length === 1 ? "pendente" : "pendentes"} · pode fechar e voltar depois
          </p>
        </>
      ) : (
        <div className="py-8 text-center">
          <p className="text-lg font-semibold">Tudo avaliado</p>
          <button
            onClick={onClose}
            className="pressable mt-4 min-h-11 rounded-xl border border-border px-6 text-sm"
          >
            Fechar
          </button>
        </div>
      )}
    </AnimatedSheet>
  );
}
