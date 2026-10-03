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
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={`hit pressable shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${value === id ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
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

export function PageHeader({ title, back = "/" }: { title: string; back?: "/" | "/library" }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      {router.history.length > 1 ? (
        <button
          onClick={() => router.history.back()}
          aria-label="Voltar"
          className="pressable -ml-2 flex h-11 w-11 items-center justify-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      ) : (
        <Link
          to={back}
          aria-label="Voltar"
          className="pressable -ml-2 flex h-11 w-11 items-center justify-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <h1 className="text-xl font-semibold">{title}</h1>
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
      <div className="mt-6 grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Sk key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
      <Sk className="mt-7 h-5 w-44" />
      <Sk className="mt-3 h-[88px] rounded-xl" />
      <Sk className="mt-7 h-5 w-36" />
      <div className="mt-3 flex gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Sk key={i} className="aspect-[2/3] w-28 rounded-xl" />
        ))}
      </div>
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
