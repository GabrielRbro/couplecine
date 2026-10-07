import { useRef } from "react";

/** Pointer capture keeps Android drags continuous, including outside the thumb. */
export function TouchSlider({ value, min, max, step, label, onChange, valueText }: { value: number; min: number; max: number; step: number; label: string; valueText?: string; onChange: (value: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const set = (n: number) => onChange(Math.max(min, Math.min(max, min + Math.round((n - min) / step) * step)));
  const move = (x: number) => { const rect = track.current?.getBoundingClientRect(); if (rect?.width) set(min + (x - rect.left) / rect.width * (max - min)); };
  return <div ref={track} role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueText} className="relative flex h-12 w-full touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full select-none"
    onPointerDown={(e) => { e.preventDefault(); e.currentTarget.focus({preventScroll:true}); e.currentTarget.setPointerCapture(e.pointerId); move(e.clientX); }}
    onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e.clientX); }}
    onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { move(e.clientX); e.currentTarget.releasePointerCapture(e.pointerId); } }}
    onPointerCancel={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onKeyDown={(e) => { const delta = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : e.key === "PageUp" ? step * 10 : e.key === "PageDown" ? -step * 10 : 0; if (delta || e.key === "Home" || e.key === "End") { e.preventDefault(); set(e.key === "Home" ? min : e.key === "End" ? max : value + delta); } }}>
    <div className="h-1.5 w-full rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{width:`${(value-min)/(max-min)*100}%`}} /></div>
    <div className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 rounded-full border-2 border-primary bg-foreground shadow-lg" style={{left:`${(value-min)/(max-min)*100}%`}} />
  </div>;
}