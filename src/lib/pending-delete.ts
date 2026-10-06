import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Delayed work deletion that lives above routes (module scope), so leaving the work page
 * never kills the timer. If the app closes before the window ends, nothing is deleted.
 */
const UNDO_MS = 6000;
const pending = new Map<string, number>();
const deleted = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
export function restoreWorkDeletion(id: string) {
  deleted.delete(id);
  emit();
}
export function useWorkDeletion(id: string) {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => pending.has(id) ? "pending" : deleted.has(id) ? "deleted" : "active", () => "active");
}

export function scheduleWorkDelete(qc: QueryClient, workId: string, title: string) {
  if (pending.has(workId) || deleted.has(workId)) return;
  const prev = qc.getQueriesData({ queryKey: ["library"] });
  qc.setQueriesData({ queryKey: ["library"] }, (old: unknown) =>
    Array.isArray(old) ? old.filter((w: { id: string }) => w.id !== workId) : old,
  );
  const timer = window.setTimeout(async () => {
    const { error } = await supabase.from("works").delete().eq("id", workId);
    pending.delete(workId);
    if (error) {
      emit();
      prev.forEach(([k, v]) => qc.setQueryData(k, v));
      toast.error(`Não foi possível excluir "${title}".`);
      return;
    }
    deleted.add(workId);
    emit();
    qc.removeQueries({ queryKey: ["work", workId] });
    qc.invalidateQueries({ queryKey: ["library"] });
  }, UNDO_MS);
  pending.set(workId, timer);
  emit();
  toast(`"${title}" excluída`, {
    duration: UNDO_MS,
    action: {
      label: "Desfazer",
      onClick: () => {
        const t = pending.get(workId);
        if (t === undefined) return;
        window.clearTimeout(t);
        pending.delete(workId);
        emit();
        prev.forEach(([k, v]) => qc.setQueryData(k, v));
      },
    },
  });
}
