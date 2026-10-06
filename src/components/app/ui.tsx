import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export function FilterPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <>
      {options.map(([id, label]) => (
        <button
          key={id}
          onClick={() => { if (id !== value) onChange(id); }}
          aria-pressed={value === id}
          className={`hit ${value === id ? "" : "pressable"} shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${value === id ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
        >
          {label}
        </button>
      ))}
    </>
  );
}

export function TogglePill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`hit pressable shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${on ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

/** Goes back in history when there's an in-app entry; otherwise falls back to a route. */
export function useBack(fallback: "/" | "/library" = "/") {
  const router = useRouter();
  return () => {
    const idx = (window.history.state as { __TSR_index?: number } | null)?.__TSR_index ?? 0;
    if (idx > 0) router.history.back();
    else router.navigate({ to: fallback, replace: true });
  };
}

export function BackButton({ fallback = "/" }: { fallback?: "/" | "/library" }) {
  const back = useBack(fallback);
  return (
    <button
      onClick={back}
      aria-label="Voltar"
      className="pressable -ml-2 flex h-11 w-11 items-center justify-center rounded-full"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}

export function PageHeader({ title, back = "/" }: { title: string; back?: "/" | "/library" }) {
  return (
    <div className="flex items-center gap-2">
      <BackButton fallback={back} />
      <h1 className="text-xl font-semibold">{title}</h1>
    </div>
  );
}

/** Horizontal filter row with a soft fade that hints it scrolls. */
export function ScrollRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 ${className}`}
      style={{
        maskImage: "linear-gradient(90deg, transparent 0, #000 16px, #000 calc(100% - 28px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(90deg, transparent 0, #000 16px, #000 calc(100% - 28px), transparent 100%)",
      }}
    >
      {children}
      <span aria-hidden className="w-2 shrink-0" />
    </div>
  );
}

export function Sk({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

export function PosterGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Sk className="aspect-[2/3] w-full rounded-xl" />
          <Sk className="mt-2 h-3.5 w-3/4" />
          <Sk className="mt-1.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div className="px-4 pt-6" aria-busy="true" aria-label="Carregando">
      <Sk className="h-4 w-24" />
      <Sk className="mt-2 h-7 w-40" />
      <div className="mt-6 grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Sk key={i} className={i < 2 ? "h-20 rounded-xl" : "h-16 rounded-xl"} />
        ))}
      </div>
      <Sk className="mt-7 h-5 w-44" />
      <Sk className="mt-3 h-32 rounded-xl" />
      <Sk className="mt-7 h-5 w-36" />
      <div className="mt-3 space-y-2"><Sk className="h-16" /><Sk className="h-16" /></div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <Sk className="h-44 w-full rounded-none" />
      <div className="-mt-24 relative flex gap-4 px-4">
        <Sk className="aspect-[2/3] w-28 shrink-0 rounded-xl" />
        <div className="flex-1 self-end space-y-2">
          <Sk className="h-6 w-3/4" />
          <Sk className="h-3 w-1/2" />
          <Sk className="h-3 w-2/3" />
        </div>
      </div>
      <div className="space-y-4 px-4 pt-6">
        <Sk className="h-28 rounded-2xl" />
        <Sk className="h-20 rounded-2xl" />
        <Sk className="h-24" />
      </div>
    </div>
  );
}
