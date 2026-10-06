// Single PWA registrar + install-prompt store. Call initPwa() once from the root (useEffect).
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function refusedContext() {
  const h = location.hostname;
  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  return (
    !import.meta.env.PROD ||
    framed ||
    h.startsWith("id-preview--") ||
    h.startsWith("preview--") ||
    h === "lovableproject.com" ||
    h.endsWith(".lovableproject.com") ||
    h === "lovableproject-dev.com" ||
    h.endsWith(".lovableproject-dev.com") ||
    h === "beta.lovable.dev" ||
    h.endsWith(".beta.lovable.dev") ||
    new URLSearchParams(location.search).get("sw") === "off"
  );
}

async function unregisterAppSw() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs.filter((r) => r.active?.scriptURL.endsWith("/sw.js")).map((r) => r.unregister()),
  );
}

function promptUpdate(reg: ServiceWorkerRegistration) {
  toast("Nova versão disponível", {
    id: "pwa-update",
    duration: Infinity,
    action: {
      label: "Atualizar",
      onClick: () => {
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloaded) return; // one controlled reload, never a loop
          reloaded = true;
          location.reload();
        });
        reg.waiting?.postMessage({ type: "SKIP_WAITING" });
      },
    },
  });
}

let started = false;
export function initPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  installed = isStandalone();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", (e) => {
    installed = e.matches;
    emit();
  });

  if (!("serviceWorker" in navigator)) return;
  if (refusedContext()) {
    void unregisterAppSw();
    return;
  }
  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((reg) => {
      const watch = (sw: ServiceWorker | null) =>
        sw?.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) promptUpdate(reg);
        });
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg);
      reg.addEventListener("updatefound", () => watch(reg.installing));
      // Check on resume, at most every 30 min — no aggressive polling.
      let last = Date.now();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || Date.now() - last < 30 * 60_000) return;
        last = Date.now();
        void reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

export async function promptInstall() {
  if (!deferred) return;
  const e = deferred;
  deferred = null;
  emit();
  await e.prompt();
  await e.userChoice.catch(() => null);
}

type InstallState = "installed" | "available" | "manual";
let snapshot: InstallState = "manual";
function getState(): InstallState {
  const next: InstallState = installed ? "installed" : deferred ? "available" : "manual";
  snapshot = next;
  return snapshot;
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState,
    () => "manual",
  );
}
