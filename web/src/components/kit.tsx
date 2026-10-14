"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { KO, type PeriodId, type StrategyId } from "@/lib/format";
import type { Source } from "@/lib/data";

type Shape = "circle" | "square" | "triangle" | "diamond" | "cross" | "none";

// Identity never relies on color alone: every strategy also has its own dash pattern and marker.
export const STYLE: Record<StrategyId, { color: string; dash: string; width: number; shape: Shape }> = {
  "6040": { color: "var(--s-6040)", dash: "7 4", width: 2, shape: "circle" },
  ew: { color: "var(--s-ew)", dash: "2 3", width: 2, shape: "square" },
  mvo: { color: "var(--s-mvo)", dash: "10 3 2 3", width: 2, shape: "triangle" },
  ito_hist: { color: "var(--s-ito_hist)", dash: "4 2", width: 2, shape: "diamond" },
  ito_tsfm: { color: "var(--s-ito_tsfm)", dash: "", width: 2, shape: "cross" },
  proposed: { color: "var(--s-proposed)", dash: "", width: 3.5, shape: "none" },
};

export function MarkerShape({ shape, x, y, color, size = 9 }: { shape: Shape; x: number; y: number; color: string; size?: number }) {
  const r = size / 2;
  const ring = { stroke: "var(--surface)", strokeWidth: 1.5 };
  switch (shape) {
    case "circle":
      return <circle cx={x} cy={y} r={r} fill={color} {...ring} />;
    case "square":
      return <rect x={x - r} y={y - r} width={size} height={size} fill={color} {...ring} />;
    case "triangle":
      return <path d={`M${x},${y - r - 1} L${x + r + 1},${y + r} L${x - r - 1},${y + r} Z`} fill={color} {...ring} />;
    case "diamond":
      return <path d={`M${x},${y - r - 1} L${x + r + 1},${y} L${x},${y + r + 1} L${x - r - 1},${y} Z`} fill={color} {...ring} />;
    case "cross":
      return (
        <g stroke={color} strokeWidth={2.5} strokeLinecap="round">
          <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} />
          <line x1={x - r} y1={y + r} x2={x + r} y2={y - r} />
        </g>
      );
    default:
      return null;
  }
}

/** Legend glyph: a short line in the series' dash with its marker. */
export function SeriesGlyph({ id, color }: { id: StrategyId; color?: string }) {
  const s = STYLE[id];
  return (
    <svg width="34" height="14" aria-hidden="true">
      <line x1="1" y1="7" x2="33" y2="7" stroke={color ?? s.color} strokeWidth={s.width} strokeDasharray={s.dash} />
      <MarkerShape shape={s.shape} x={17} y={7} color={color ?? s.color} size={8} />
    </svg>
  );
}

export function LegendToggle({ ids, visible, onToggle, color }: { ids: StrategyId[]; visible: Record<string, boolean>; onToggle: (id: StrategyId) => void; color?: (id: StrategyId) => string }) {
  return (
    <div className="legend" role="group" aria-label="전략 표시 켜기·끄기">
      {ids.map((id) => (
        <button key={id} type="button" aria-pressed={visible[id]} onClick={() => onToggle(id)}>
          <SeriesGlyph id={id} color={color?.(id)} />
          {KO[id]}
        </button>
      ))}
    </div>
  );
}

export function Footnote({ sources, extra }: { sources: Source[]; extra?: ReactNode }) {
  const uniq = sources.filter((s, i) => sources.findIndex((t) => t.file === s.file) === i);
  return (
    <p className="footnote">
      출처:{" "}
      {uniq.map((s, i) => (
        <span key={s.file}>
          {i > 0 && " · "}
          <code>{s.file}</code> @ <code>{s.commit}</code>
        </span>
      ))}
      {extra && <> · {extra}</>}
    </p>
  );
}

export function Figure({ title, caption, children, footnote, className }: {
  title: ReactNode; caption?: ReactNode; children: ReactNode; footnote?: ReactNode; className?: string;
}) {
  return (
    <figure className={`figure${className ? ` ${className}` : ""}`}>
      <h3>{title}</h3>
      {caption && <p className="cap">{caption}</p>}
      {children}
      {footnote}
    </figure>
  );
}

export function Toggle<T extends string>({ options, value, onChange, label }: {
  options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="seg">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} data-toggle={label} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const PERIOD_OPTIONS: { id: PeriodId; label: string }[] = [
  { id: "primary", label: "1차 (2017–)" },
  { id: "secondary", label: "2차 (2015–)" },
];

/**
 * Chart drawing area that mounts its (lazily imported) chart only when it nears the viewport.
 * The box keeps its height before and after, so nothing shifts. Numbers never live in here.
 */
export function LazyChart({ height, label, children, minHeight }: { height: string | number; minHeight?: number; label: string; children: () => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); }
    }, { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} role="img" aria-label={label} className="chart-area" style={{ height, minHeight }}>
      {on ? children() : <div className="chart-ph" aria-hidden="true" />}
    </div>
  );
}

// ---------- shared selection: cost level and period (cost toggle §3.3 drives the λ_tc slider §3.5) ----------
type Sel = { cost: number; setCost: (c: number) => void; period: PeriodId; setPeriod: (p: PeriodId) => void };
const SelCtx = createContext<Sel | null>(null);

export function SelectionProvider({ children, baseCost }: { children: ReactNode; baseCost: number }) {
  const [cost, setCost] = useState(baseCost);
  const [period, setPeriod] = useState<PeriodId>("primary");
  return <SelCtx.Provider value={{ cost, setCost, period, setPeriod }}>{children}</SelCtx.Provider>;
}

export function useSel(): Sel {
  const s = useContext(SelCtx);
  if (!s) throw new Error("SelectionProvider missing");
  return s;
}
