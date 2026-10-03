import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EXIT_MS = 200;

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
  if (open) renderedChildren.current = children;

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, closeDisabled, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex items-end bg-background/80 transition-opacity duration-200 motion-reduce:transition-none ${visible ? "opacity-100" : "opacity-0"}`}
      onClick={() => !closeDisabled && onClose()}
    >
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`mx-auto w-full max-w-md rounded-t-3xl border border-border bg-card p-5 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${visible ? "translate-y-0" : "translate-y-full"} ${panelClassName}`}
        onClick={(event) => event.stopPropagation()}
      >
        {renderedChildren.current}
      </div>
    </div>,
    document.body,
  );
}