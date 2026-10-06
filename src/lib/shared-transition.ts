/**
 * Shared-element transitions are opt-in per tap: only the tapped card's art and the destination
 * hero carry a view-transition-name, and only for one navigation. Nothing else is ever named,
 * so lists never paint above the BottomNav during transitions.
 */
type Kind = "poster" | "backdrop";
let pending: { id: string; kind: Kind; at: number } | null = null;

export function markShared(el: HTMLElement | null, id: string, kind: Kind) {
  if (kind === "backdrop") return;
  if (!el || typeof document === "undefined" || !("startViewTransition" in document)) return;
  clearShared();
  const image = el instanceof HTMLImageElement ? el : el.querySelector("img");
  if (!image) return;
  pending = { id, kind, at: Date.now() };
  image.style.viewTransitionName = `shared-${kind}`;
  // Cancelled or finished: always clear the source name.
  window.setTimeout(() => {
    image.style.viewTransitionName = "";
  }, 250);
}

/** Destination hero: returns a style only if this exact work/kind was just tapped. */
export function sharedStyle(id: string, kind: Kind): { viewTransitionName?: string } {
  if (pending && pending.id === id && pending.kind === kind && Date.now() - pending.at < 1500)
    return { viewTransitionName: `shared-${kind}` };
  return {};
}

export function clearShared() {
  pending = null;
}

import { useEffect, useState } from "react";
export function useSharedStyle(id: string, kind: Kind) {
  const [style, setStyle] = useState(() => sharedStyle(id, kind));
  useEffect(() => {
    if (!style.viewTransitionName) return;
    const t = window.setTimeout(() => {
      setStyle({});
      clearShared();
    }, 250);
    return () => window.clearTimeout(t);
  }, [style.viewTransitionName]);
  return style;
}
