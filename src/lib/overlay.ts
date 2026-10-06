import { useEffect, useRef } from "react";

/**
 * Overlay history: each open overlay (radial, sheet, modal, pile) owns one history entry, so
 * Android/browser Back closes the top-most overlay before leaving the route. Our popstate
 * listener runs in the capture phase and stops propagation, so the router never sees these
 * entries (no ghost navigation, no view transition).
 */
type Entry = { id: string; close: () => void };
const stack: Entry[] = [];
let swallow = 0;
let after: (() => void) | null = null;
let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(
    "popstate",
    (e) => {
      if (swallow > 0) {
        swallow--;
        e.stopImmediatePropagation();
        if (swallow === 0 && after) {
          const fn = after;
          after = null;
          fn();
        }
        return;
      }
      const top = stack[stack.length - 1];
      if (!top) return;
      if ((window.history.state as { __overlay?: string } | null)?.__overlay === top.id) return;
      e.stopImmediatePropagation();
      stack.pop();
      top.close();
    },
    { capture: true },
  );
}

export function overlayCount() {
  return stack.length;
}

/** Closes every open overlay (consuming their history entries) and then runs `fn`. */
export function closeOverlaysThen(fn: () => void) {
  const n = stack.length;
  if (n === 0) return fn();
  const entries = stack.splice(0, n);
  entries.forEach((en) => en.close());
  swallow = 1;
  after = fn;
  window.history.go(-n);
}

export function useOverlayHistory(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    install();
    const id = Math.random().toString(36).slice(2);
    const entry: Entry = { id, close: () => closeRef.current() };
    window.history.pushState({ ...(window.history.state ?? {}), __overlay: id }, "");
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i < 0) return; // already closed by Back
      stack.splice(i, 1);
      // Closed from the UI: consume our entry silently if it's still the current one.
      if ((window.history.state as { __overlay?: string } | null)?.__overlay === id) {
        swallow++;
        window.history.back();
      }
    };
  }, [open]);
}

/** Locks page scroll while any overlay that requested it is open. */
let locks = 0;
let restore: (() => void) | null = null;
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    if (locks++ === 0) {
      const body = document.body;
      const y = window.scrollY;
      const x = window.scrollX;
      const root = document.documentElement;
      const saved = { bodyOverflow: body.style.overflow, rootOverflow: root.style.overflow, touchAction: root.style.touchAction };
      body.style.overflow = "hidden";
      root.style.overflow = "hidden";
      root.style.touchAction = "none";
      root.dataset["overlayOpen"] = "true";
      restore = () => {
        body.style.overflow = saved.bodyOverflow;
        root.style.overflow = saved.rootOverflow;
        root.style.touchAction = saved.touchAction;
        delete root.dataset["overlayOpen"];
        window.scrollTo({ left: x, top: y, behavior: "instant" });
      };
    }
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) { restore?.(); restore = null; }
    };
  }, [active]);
}

/** Only intentional gestures dismiss the keyboard, never restoration/programmatic scroll. */
export function useScrollKeyboardDismiss() {
  useEffect(() => {
    const blur = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.matches("input:not([type=range]),textarea") || active.isContentEditable)) active.blur();
    };
    window.addEventListener("touchmove", blur, { passive: true });
    window.addEventListener("wheel", blur, { passive: true });
    return () => { window.removeEventListener("touchmove", blur); window.removeEventListener("wheel", blur); };
  }, []);
}
