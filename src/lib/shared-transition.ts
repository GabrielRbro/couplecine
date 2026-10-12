/**
 * Shared-element transitions are opt-in per tap: only the tapped card's art and the destination
 * hero carry a view-transition-name, and only for one navigation. Nothing else is ever named,
 * so lists never paint above the BottomNav during transitions.
 */
type Kind = "poster" | "backdrop";
let pending: { id: string; kind: Kind; at: number } | null = null;

export function markShared(el: HTMLElement | null, id: string, kind: Kind) {

  if (!el || typeof document === "undefined" || !("startViewTransition" in document)) return;
  clearShared();
  const image = el instanceof HTMLImageElement ? el : el.querySelector("img");
  if (!image) return;
  const started = Date.now();
  pending = { id, kind, at: started };
  // A landscape card crop and a full-width hero have incompatible geometry.
  // Let the destination hero animate in its own frame instead of stretching this
  // source bitmap through the View Transition snapshot.
  if (kind === "backdrop") document.documentElement.classList.add("shared-backdrop-active");
  else image.style.viewTransitionName = `shared-${kind}`;
  const cleanup = () => { image.style.viewTransitionName = ""; if (pending?.at === started) clearShared(); };
  // activeViewTransition is supported by modern Chromium; other engines expose pseudo animations.
  const watch = () => {
    const transition = (document as Document & { activeViewTransition?: { finished: Promise<void> } }).activeViewTransition;
    if (transition) { void transition.finished.then(cleanup, cleanup); return; }
    const animations = document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition"));
    if (animations.length) { void Promise.allSettled(animations.map((a) => a.finished)).then(cleanup); return; }
    if (Date.now() - started < 2000) requestAnimationFrame(watch); else cleanup();
  };
  requestAnimationFrame(watch);
}

/** Destination hero: returns a style only if this exact work/kind was just tapped. */
export function sharedStyle(id: string, kind: Kind): { viewTransitionName?: string } {
  if (kind !== "backdrop" && pending && pending.id === id && pending.kind === kind)
    return { viewTransitionName: `shared-${kind}` };
  return {};
}

/** Whether this detail page was opened from a landscape backdrop card. */
export function useBackdropHandoff(id: string) {
  const [active, setActive] = useState(() => Boolean(pending && pending.id === id && pending.kind === "backdrop"));
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const watch = () => {
      if (!pending) setActive(false); else frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return active;
}

export function clearShared() {
  pending = null;
  if (typeof document !== "undefined") document.documentElement.classList.remove("shared-backdrop-active");
}

import { useEffect, useState } from "react";
export function useSharedStyle(id: string, kind: Kind) {
  const [style, setStyle] = useState(() => sharedStyle(id, kind));
  useEffect(() => {
    if (!style.viewTransitionName) return;
    let frame = 0;
    const watch = () => {
      if (!pending) setStyle({}); else frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, [style.viewTransitionName]);
  return style;
}
