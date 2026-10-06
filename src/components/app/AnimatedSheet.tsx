import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayHistory, useScrollLock } from "@/lib/overlay";

const EXIT_MS = 200;
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AnimatedSheet({
  open,
  onClose,
  children,
  role = "dialog",
  labelledBy,
  closeDisabled = false,
  panelClassName = "",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  role?: "dialog" | "alertdialog";
  labelledBy?: string;
  closeDisabled?: boolean;
  panelClassName?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const renderedChildren = useRef(children);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  if (open) renderedChildren.current = children;

  const closeRef = useRef(() => {});
  closeRef.current = () => {
    if (!closeDisabled) onClose();
  };
  // Back closes the sheet first; while closing is disabled, Back re-closes nothing.
  useOverlayHistory(open, () => {
    if (closeDisabled) return;
    onClose();
  }, closeDisabled);
  useScrollLock(mounted);

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      const frame = requestAnimationFrame(() => {
        setVisible(true);
        const first =
          panel.current?.querySelector<HTMLElement>("[data-autofocus]") ??
          panel.current?.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? panel.current)?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => {
      setMounted(false);
      opener.current?.focus?.({ preventScroll: true });
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
       if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[200] flex items-end bg-background/55 transition-opacity duration-200 motion-reduce:transition-none ${visible ? "opacity-100" : "opacity-0"}`}
      onClick={() => closeRef.current()}
    >
      <div
        ref={panel}
        data-overlay-panel
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`mx-auto w-full max-w-md overscroll-contain rounded-t-3xl border border-border bg-card p-5 outline-none transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${visible ? "translate-y-0" : "translate-y-full"} ${panelClassName}`}
        onClick={(event) => event.stopPropagation()}
      >
        {renderedChildren.current}
      </div>
    </div>,
    document.body,
  );
}
