"use client";

import type { ReactNode } from "react";
import { KO, type Source, type StrategyId } from "@/lib/data";

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
export function SeriesGlyph({ id }: { id: StrategyId }) {
  const s = STYLE[id];
  return (
    <svg width="34" height="14" aria-hidden="true">
      <line x1="1" y1="7" x2="33" y2="7" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} />
      <MarkerShape shape={s.shape} x={17} y={7} color={s.color} size={8} />
    </svg>
  );
}

export function LegendToggle({ ids, visible, onToggle }: { ids: StrategyId[]; visible: Record<string, boolean>; onToggle: (id: StrategyId) => void }) {
  return (
    <div className="legend" role="group" aria-label="전략 표시 켜기·끄기">
      {ids.map((id) => (
        <button key={id} type="button" aria-pressed={visible[id]} onClick={() => onToggle(id)}>
          <SeriesGlyph id={id} />
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

export function Figure({ title, caption, summary, children, footnote }: {
  title: string; caption?: ReactNode; summary: string; children: ReactNode; footnote: ReactNode;
}) {
  return (
    <figure className="figure" style={{ margin: 0 }}>
      <h3>{title}</h3>
      {caption && <p className="cap">{caption}</p>}
      <div role="img" aria-label={summary} className="chart">
        {children}
      </div>
      <p className="sr-only">{summary}</p>
      {footnote}
    </figure>
  );
}

export function Toggle<T extends string>({ options, value, onChange, label }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: "0.3rem" }}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const axisTick = { fill: "var(--ink-3)", fontSize: 13 };
export const gridProps = { stroke: "var(--grid)", strokeDasharray: "0" } as const;
