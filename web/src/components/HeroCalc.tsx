"use client";

// §3.1 drag calculator (client part). It imports no data: plot points and the per-asset readouts
// (server-rendered <Num> spans) arrive as props from ./Hero, so the first-load bundle carries no JSON.
// ½σ² of the slider value is formula arithmetic on user input, rendered in <output data-input>.

import { useState, type ReactNode } from "react";
import { fmt } from "@/lib/format";

const SIG_MAX = 45;
export type Pt = { id: string; label: string; sigma: number; emp: number };

function Parabola({ sigma, snapped, assets, strats }: { sigma: number; snapped: string | null; assets: Pt[]; strats: Pt[] }) {
  const W = 360, H = 210, L = 34, R = 10, T = 10, B = 26;
  const yMax = (SIG_MAX * SIG_MAX) / 200;
  const x = (s: number) => L + (s / SIG_MAX) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const curve = Array.from({ length: 46 }, (_, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y((i * i) / 200).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="parabola" role="img" aria-label="½σ² 포물선 위의 자산별·전략별 실측 항력">
      {[0, 15, 30, 45].map((s) => <g key={s}><line x1={x(s)} x2={x(s)} y1={T} y2={H - B} stroke="var(--grid)" /><text x={x(s)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--ink-3)">{s}%</text></g>)}
      {[0, 5, 10].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--grid)" /><text x={L - 4} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--ink-3)">{v}%</text></g>)}
      <path d={curve} fill="none" stroke="var(--ink-3)" strokeWidth={2} strokeDasharray="5 4" />
      <line x1={x(sigma)} x2={x(sigma)} y1={T} y2={H - B} stroke="var(--real)" strokeWidth={1.5} strokeOpacity={0.5} />
      <circle cx={x(sigma)} cy={y((sigma * sigma) / 200)} r={6} fill="none" stroke="var(--real)" strokeWidth={2.5} />
      {strats.map((s) => <circle key={s.id} cx={x(s.sigma)} cy={y(s.emp)} r={3.5} fill="var(--real)" />)}
      {assets.map((a) => {
        const on = a.id === snapped;
        return (
          <g key={a.id}>
            <rect x={x(a.sigma) - (on ? 6 : 4.5)} y={y(a.emp) - (on ? 6 : 4.5)} width={on ? 12 : 9} height={on ? 12 : 9}
              fill={on ? "var(--fail)" : "var(--surface)"} stroke={on ? "var(--fail-ink)" : "var(--ink-2)"} strokeWidth={1.5} transform={`rotate(45 ${x(a.sigma)} ${y(a.emp)})`} />
            {on && <text x={x(a.sigma) + 9} y={y(a.emp) - 8} fontSize={12} fill="var(--ink)" fontWeight={600}>{a.label}</text>}
          </g>
        );
      })}
      <text x={W - R} y={T + 12} fontSize={11} textAnchor="end" fill="var(--ink-3)">½σ²</text>
    </svg>
  );
}

export default function HeroCalc({ assets, strats, readouts, caption }: { assets: Pt[]; strats: Pt[]; readouts: Record<string, ReactNode>; caption: ReactNode }) {
  const [snapped, setSnapped] = useState<string | null>(assets[0]?.id ?? null);
  const [free, setFree] = useState<number | null>(null);
  const sigma = free ?? assets.find((a) => a.id === snapped)?.sigma ?? 20;
  return (
    <div className="calc">
      <label className="slider">
        <span className="lbl"><span>변동성 σ (연율)</span><output data-input>{fmt(sigma, 1)}%</output></span>
        <input type="range" min={0} max={SIG_MAX} step={0.5} value={Math.round(sigma * 2) / 2}
          onChange={(e) => { setFree(Number(e.target.value)); setSnapped(null); }} aria-valuetext={`σ ${fmt(sigma, 1)}%`} />
      </label>
      <p className="calc-out">½σ² = <output data-input>{fmt((sigma * sigma) / 200, 2)}%</output> <span className="note">연간 기하 성장률에서 빠지는 몫</span></p>
      <div className="seg seg-wrap" role="group" aria-label="자산 σ 맞추기">
        {assets.map((a) => (
          <button key={a.id} type="button" aria-pressed={snapped === a.id} data-toggle="자산" onClick={() => { setSnapped(a.id); setFree(null); }}>{a.label}</button>
        ))}
      </div>
      {snapped && <p className="calc-snap" aria-live="polite">{readouts[snapped]}</p>}
      <Parabola sigma={sigma} snapped={snapped} assets={assets} strats={strats} />
      <div className="legend" aria-hidden="true">
        <span className="legend-item"><svg width="14" height="14"><rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" fill="var(--surface)" stroke="var(--ink-2)" strokeWidth="1.5" /></svg> 자산 실측 (2차)</span>
        <span className="legend-item"><svg width="14" height="14"><circle cx="7" cy="7" r="4" fill="var(--real)" /></svg> 전략 실측 (1차)</span>
        <span className="legend-item"><svg width="24" height="12"><line x1="0" y1="6" x2="24" y2="6" stroke="var(--ink-3)" strokeWidth="2" strokeDasharray="5 4" /></svg> 이론 ½σ²</span>
      </div>
      {caption}
    </div>
  );
}
