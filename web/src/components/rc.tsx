"use client";

// Recharts drawing components. This module is only reached through next/dynamic (./lazy), so Recharts
// and the weekly curves stay out of the first-load bundle. Text and numbers live in the callers,
// which are prerendered; hover tooltips here are the only numbers drawn on the client.

import { useMemo, type ReactNode } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, LineChart,
  ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { crisis, drag, performance, submission, turnoverReg, SUB_KEY } from "@/lib/data";
import { curves } from "@/lib/curves";
import { KO, STRATEGIES, decimals, fmt, pct, shortDate, type PeriodId, type StrategyId } from "@/lib/format";
import { MarkerShape, STYLE } from "./kit";

const axisTick = { fill: "var(--ink-3)", fontSize: 12 };
const gridProps = { stroke: "var(--grid)", strokeDasharray: "0" } as const;
const Box = ({ children }: { children: ReactNode }) => <ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer>;

type TipEntry = { dataKey?: unknown; value?: unknown };
function SeriesTooltip({ active, payload, label, valueFmt, colorOverride }: { active?: boolean; payload?: TipEntry[]; label?: unknown; valueFmt: (v: number) => string; colorOverride?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => typeof p.value === "number" && STRATEGIES.includes(p.dataKey as StrategyId));
  rows.sort((a, b) => (b.value as number) - (a.value as number));
  return (
    <div className="tooltip">
      <div className="t-date">{String(label)}</div>
      {rows.map((p) => {
        const id = p.dataKey as StrategyId;
        return (
          <div className="t-row" key={id}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" aria-hidden="true"><MarkerShape shape={STYLE[id].shape === "none" ? "circle" : STYLE[id].shape} x={6} y={6} color={colorOverride ?? STYLE[id].color} size={9} /></svg>
              {KO[id]}
            </span>
            <span>{valueFmt(p.value as number)}</span>
          </div>
        );
      })}
    </div>
  );
}

function sparseDot(id: StrategyId, every: number, offset: number, colorOverride?: string) {
  const SparseDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index = 0 } = props;
    if (cx == null || cy == null || STYLE[id].shape === "none" || (index + offset) % every !== 0) return <g key={`${id}-${index}`} />;
    return <g key={`${id}-${index}`}><MarkerShape shape={STYLE[id].shape} x={cx} y={cy} color={colorOverride ?? STYLE[id].color} /></g>;
  };
  return SparseDot;
}

function yearTicks(dates: string[]) {
  const out: string[] = [];
  let last = "";
  for (const d of dates) {
    const y = d.slice(0, 4);
    if (y !== last) { out.push(d); last = y; }
  }
  return out.slice(1);
}

// ------------------------------------------------------------------ cumulative wealth
const SIM_IDS: StrategyId[] = ["proposed", "6040", "mvo", "ew"];

export function CurvesDraw({ period, isSim, log, visible }: { period: PeriodId; isSim: boolean; log: boolean; visible: Record<string, boolean> }) {
  const c = curves[period];
  const t0 = new Date(c.rows[0].date).getTime();
  const rows = useMemo(() => isSim
    ? c.rows.map((r) => {
        const yrs = (new Date(r.date).getTime() - t0) / (365.25 * 864e5);
        const out: Record<string, number | string> = { date: r.date };
        for (const s of SIM_IDS) out[s] = (1 + submission.strategies[SUB_KEY[s]!].analytic.cagr_pct / 100) ** yrs;
        return out;
      })
    : c.rows, [isSim, c, t0]);
  const ids = isSim ? SIM_IDS : STRATEGIES;
  const ticks = useMemo(() => yearTicks(c.rows.map((r) => r.date)), [c]);
  const every = Math.max(1, Math.round(rows.length / 10));
  const color = (id: StrategyId) => (isSim ? "var(--sim)" : STYLE[id].color);
  return (
    <Box>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => `'${d.slice(2, 4)}`} tick={axisTick} stroke="var(--rule)" />
        <YAxis scale={log ? "log" : "linear"} domain={log ? ["auto", "auto"] : [0, "auto"]} allowDataOverflow={log}
          tick={axisTick} stroke="var(--rule)" width={44} tickFormatter={(v: number) => `${fmt(v, 1)}×`} />
        <Tooltip content={<SeriesTooltip valueFmt={(v) => `${fmt(v, 3)}×`} colorOverride={isSim ? "var(--sim)" : undefined} />} />
        {ids.map((id, i) => visible[id] && (
          <Line key={id} dataKey={id} type="linear" stroke={color(id)} strokeWidth={STYLE[id].width}
            strokeDasharray={STYLE[id].dash} dot={sparseDot(id, every, i * 2, isSim ? "var(--sim)" : undefined)} activeDot={{ r: 5 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </Box>
  );
}

// ------------------------------------------------------------------ drag scatter
export function DragScatterDraw({ period }: { period: PeriodId }) {
  const pts = STRATEGIES.map((s) => ({ id: s, x: drag.drag[period][s].theo_drag_pct, y: drag.drag[period][s].emp_drag_pct, sigma: drag.drag[period][s].sigma_pct }));
  const vals = pts.flatMap((p) => [p.x, p.y]);
  const lo = Math.floor(Math.min(...vals) * 20) / 20 - 0.05;
  const hi = Math.ceil(Math.max(...vals) * 20) / 20 + 0.05;
  return (
    <Box>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 4 }}>
        <CartesianGrid {...gridProps} />
        <XAxis type="number" dataKey="x" domain={[lo, hi]} tick={axisTick} stroke="var(--rule)" tickFormatter={(v: number) => fmt(v, 2)}
          label={{ value: "이론 항력 ½σ² (%)", position: "insideBottom", offset: -14, fill: "var(--ink-2)", fontSize: 12 }} />
        <YAxis type="number" dataKey="y" domain={[lo, hi]} tick={axisTick} stroke="var(--rule)" width={48} tickFormatter={(v: number) => fmt(v, 2)}
          label={{ value: "실측 항력 (%)", angle: -90, position: "insideLeft", fill: "var(--ink-2)", fontSize: 12 }} />
        <ZAxis range={[160, 160]} />
        <ReferenceLine segment={[{ x: lo, y: lo }, { x: hi, y: hi }]} stroke="var(--ink-3)" strokeDasharray="5 4" ifOverflow="hidden"
          label={{ value: "45° (실측 = 이론)", position: "insideTopLeft", fill: "var(--ink-3)", fontSize: 12 }} />
        <Tooltip cursor={false} content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0].payload as (typeof pts)[number];
          return <div className="tooltip"><div className="t-date">{KO[p.id]}</div>
            <div className="t-row"><span>실측 항력</span><span>{pct(p.y)}</span></div>
            <div className="t-row"><span>½σ²</span><span>{pct(p.x)}</span></div>
            <div className="t-row"><span>σ</span><span>{pct(p.sigma)}</span></div></div>;
        }} />
        <Scatter data={pts} isAnimationActive={false}
          shape={(props: unknown) => {
            const { cx, cy, payload } = props as { cx: number; cy: number; payload: (typeof pts)[number] };
            const shape = STYLE[payload.id].shape === "none" ? "circle" : STYLE[payload.id].shape;
            return <MarkerShape shape={shape} x={cx} y={cy} color={STYLE[payload.id].color} size={payload.id === "proposed" ? 14 : 12} />;
          }} />
      </ScatterChart>
    </Box>
  );
}

// ------------------------------------------------------------------ ergodicity (submission Monte Carlo)
export function ErgodicityDraw() {
  const mc = submission.monte_carlo;
  const rows = (["6040", "ew", "mvo", "proposed"] as StrategyId[]).map((id) => {
    const k = SUB_KEY[id]!;
    return { id, name: KO[id], mean: mc.strategies[k].wealth_10y.mean, median: mc.strategies[k].wealth_10y.median };
  });
  return (
    <Box>
      <BarChart data={rows} margin={{ top: 22, right: 8, bottom: 4, left: 0 }} barGap={3}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="name" tick={{ ...axisTick, fontSize: 11 }} stroke="var(--rule)" interval={0} />
        <YAxis tick={axisTick} stroke="var(--rule)" width={40} />
        <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload, label }) => active && payload?.length ? (
          <div className="tooltip"><div className="t-date">{String(label)}</div>
            <div className="t-row"><span>평균</span><span>{fmt(payload[0].value as number, 2)}</span></div>
            <div className="t-row"><span>중앙값</span><span>{fmt(payload[1].value as number, 2)}</span></div></div>) : null} />
        <Bar dataKey="mean" name="평균" fill="var(--sim)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey="mean" position="top" formatter={(v: unknown) => fmt(Number(v), 0)} fill="var(--ink-2)" fontSize={11} />
        </Bar>
        <Bar dataKey="median" name="중앙값" fill="var(--sim-bg)" stroke="var(--sim)" strokeWidth={1.5} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey="median" position="top" formatter={(v: unknown) => fmt(Number(v), 0)} fill="var(--ink-2)" fontSize={11} />
        </Bar>
      </BarChart>
    </Box>
  );
}

// ------------------------------------------------------------------ 2020 crisis
function nearestRowDate(target: string) {
  return crisis.rows.find((r) => r.date >= target)?.date ?? crisis.rows[crisis.rows.length - 1].date;
}
const crisisRows = () => crisis.rows.map((r) => ({ ...r, beta_pct: r.beta * 100, cash_pct: r.cash_weight * 100 }));
const monthTicks = (rows: { date: string }[]) => rows.filter((r, i) => i === 0 || r.date.slice(5, 7) !== rows[i - 1].date.slice(5, 7)).map((r) => r.date);

function crisisRefLines(withLabels: boolean, yAxisId?: string) {
  const sg = crisis.episode.proposed_safeguard;
  const firstReal = sg.first_trigger ? nearestRowDate(sg.first_trigger) : null;
  const subDate = nearestRowDate(crisis.submission_narrative.trigger_date);
  return [
    firstReal && (
      <ReferenceLine key="real" x={firstReal} yAxisId={yAxisId} stroke="var(--ok)" strokeWidth={2.5} ifOverflow="extendDomain"
        label={withLabels ? { value: `실데이터 첫 발동 ${shortDate(sg.first_trigger!)}`, position: "insideTopLeft", fill: "var(--ok-ink)", fontSize: 12, fontWeight: 600 } : undefined} />
    ),
    <ReferenceLine key="sub" x={subDate} yAxisId={yAxisId} stroke="var(--sim)" strokeWidth={2} strokeDasharray="6 5" ifOverflow="extendDomain"
      label={withLabels ? { value: `제출본 예시 ${shortDate(crisis.submission_narrative.trigger_date)}`, position: "insideBottomRight", fill: "var(--sim-ink)", fontSize: 12 } : undefined} />,
  ];
}

export function CrisisWealthDraw({ visible }: { visible: Record<string, boolean> }) {
  const rows = crisisRows();
  const ticks = monthTicks(rows);
  const every = Math.max(1, Math.round(rows.length / 8));
  return (
    <Box>
      <LineChart data={rows} syncId="crisis" margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => `${Number(d.slice(5, 7))}월`} tick={axisTick} stroke="var(--rule)" />
        <YAxis domain={["auto", "auto"]} tick={axisTick} stroke="var(--rule)" width={44} tickFormatter={(v: number) => fmt(v, 2)} />
        <Tooltip content={<SeriesTooltip valueFmt={(v) => `${fmt(v, 3)}×`} />} />
        {crisisRefLines(true)}
        {STRATEGIES.map((id, i) => visible[id] && (
          <Line key={id} dataKey={id} stroke={STYLE[id].color} strokeWidth={STYLE[id].width} strokeDasharray={STYLE[id].dash}
            dot={sparseDot(id, every, i * 2)} activeDot={{ r: 5 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </Box>
  );
}

export function CrisisSignalDraw({ logScore }: { logScore: boolean }) {
  const rows = crisisRows();
  const ticks = monthTicks(rows);
  return (
    <Box>
      <ComposedChart data={rows} syncId="crisis" margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => `${Number(d.slice(5, 7))}월`} tick={axisTick} stroke="var(--rule)" />
        <YAxis yAxisId="score" scale={logScore ? "log" : "linear"} domain={logScore ? ["auto", "auto"] : [0, "auto"]} allowDataOverflow={logScore} tick={axisTick} stroke="var(--rule)" width={44} tickFormatter={(v: number) => fmt(v, v < 10 ? 1 : 0)} />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} ticks={[0, 50, 100]} tick={axisTick} stroke="var(--rule)" width={40} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const r = payload[0].payload as ReturnType<typeof crisisRows>[number];
          return (
            <div className="tooltip"><div className="t-date">{String(label)}</div>
              <div className="t-row"><span>이상치 점수 S</span><span>{fmt(r.score, 3)}</span></div>
              <div className="t-row"><span>동적 임계치 τ</span><span>{fmt(r.tau, 3)}</span></div>
              <div className="t-row"><span>리스크 버퍼 β</span><span>{fmt(r.beta_pct, 1)}%</span></div>
              <div className="t-row"><span>현금 비중</span><span>{fmt(r.cash_pct, 1)}%</span></div></div>
          );
        }} />
        {crisisRefLines(false, "pct")}
        <Area yAxisId="pct" dataKey="beta_pct" type="stepAfter" stroke="var(--ok)" strokeWidth={1.5} fill="var(--ok)" fillOpacity={0.18} isAnimationActive={false} />
        <Line yAxisId="pct" dataKey="cash_pct" stroke="var(--s-proposed)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
        <Line yAxisId="score" dataKey="score" stroke="var(--s-ito_tsfm)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line yAxisId="score" dataKey="tau" stroke="var(--fail)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </Box>
  );
}

// ------------------------------------------------------------------ costs
export function CostBarsDraw({ period, metric }: { period: PeriodId; metric: "cagr" | "sharpe" }) {
  const ex = performance.exploratory_costs;
  const costs = [...new Set([...performance.costs_bp, ...ex.costs_bp])].sort((a, b) => a - b);
  const subRows = submission.illustrative_scenario.cost_sensitivity;
  const rows = costs.map((c) => {
    const exploratory = !performance.costs_bp.includes(c);
    const r = (exploratory ? ex.performance : performance.performance)[period][String(c)].proposed;
    const s = subRows.find((x) => x.cost_bp === c)?.proposed;
    return { cost: exploratory ? `${c}bp*` : `${c}bp`, exploratory, real_cagr: r.cagr_pct, real_sharpe: r.sharpe, sub_cagr: s?.cagr_pct ?? null, sub_sharpe: s?.sharpe ?? null };
  });
  const unit = metric === "cagr" ? "%" : "";
  return (
    <Box>
      <BarChart data={rows} margin={{ top: 22, right: 4, bottom: 4, left: 0 }} barGap={3}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="cost" tick={axisTick} stroke="var(--rule)" />
        <YAxis tick={axisTick} stroke="var(--rule)" width={34} />
        <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload, label }) => active && payload?.length ? (
          <div className="tooltip"><div className="t-date">{String(label)}</div>
            {payload.map((p) => <div className="t-row" key={String(p.dataKey)}><span>{String(p.dataKey).startsWith("sub") ? "제출본(시뮬레이션 파라미터)" : (p.payload as { exploratory: boolean }).exploratory ? "실데이터 (탐색적)" : "실데이터"}</span><span>{fmt(Number(p.value))}{unit}</span></div>)}</div>) : null} />
        <Bar dataKey={`sub_${metric}`} fill="var(--sim)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <defs>
          <pattern id={`hatch-${metric}`} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="var(--real-bg)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--real)" strokeWidth="3" />
          </pattern>
        </defs>
        <Bar dataKey={`real_${metric}`} fill="var(--real)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {rows.map((r) => <Cell key={r.cost} fill={r.exploratory ? `url(#hatch-${metric})` : "var(--real)"} stroke="var(--real)" strokeWidth={r.exploratory ? 1.5 : 0} />)}
        </Bar>
      </BarChart>
    </Box>
  );
}

export function TurnoverBarsDraw({ period, cost }: { period: PeriodId; cost: number }) {
  const turnover = STRATEGIES.map((s) => ({ id: s, name: KO[s], v: performance.performance[period][String(cost)][s].turnover_annual_pct }));
  return (
    <Box>
      <BarChart data={turnover} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} horizontal={false} />
        <XAxis type="number" tick={axisTick} stroke="var(--rule)" tickFormatter={(v: number) => fmt(v, 0)} />
        <YAxis type="category" dataKey="name" tick={{ ...axisTick, fontSize: 11 }} stroke="var(--rule)" width={118} />
        <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload }) => active && payload?.length ? (
          <div className="tooltip"><div className="t-row"><span>{String(payload[0].payload.name)}</span><span>{fmt(Number(payload[0].value), 1)}%/년</span></div></div>) : null} />
        <Bar dataKey="v" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {turnover.map((t) => <Cell key={t.id} fill={STYLE[t.id].color} />)}
        </Bar>
      </BarChart>
    </Box>
  );
}

// ------------------------------------------------------------------ λ_tc frontier (exploratory)
const fmtTc = (v: number) => fmt(v, decimals(v));

/** Turnover (bars) and net Sharpe (line) over the λ_tc grid, as two stacked panels with their own axes. */
export function TurnoverRegDraw({ period, cost, metric }: { period: PeriodId; cost: number; metric: "turnover" | "sharpe" }) {
  const rows = turnoverReg.frontier[period].proposed;
  const data = rows.map((r) => ({ x: fmtTc(r.lambda_tc), turnover: r.turnover_pct, sharpe: r[`sharpe_${cost}bp`] }));
  const g = turnoverReg.first_grid.map(fmtTc);
  return (
    <Box>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 18, left: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <ReferenceArea x1={g[0]} x2={g[g.length - 1]} fill="var(--surface-2)" fillOpacity={0.9} />
        <XAxis dataKey="x" tick={{ ...axisTick, fontSize: 10 }} stroke="var(--rule)" interval={0} angle={-35} textAnchor="end" height={36} />
        {metric === "turnover"
          ? <YAxis domain={[0, "auto"]} tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => `${fmt(v, 0)}%`} />
          : <YAxis domain={["auto", "auto"]} tick={axisTick} stroke="var(--rule)" width={40} tickFormatter={(v: number) => fmt(v, 2)} />}
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const d = payload[0].payload as (typeof data)[number];
          return <div className="tooltip"><div className="t-date">λ_tc = {String(label)}</div>
            <div className="t-row"><span>연간 회전율</span><span>{fmt(d.turnover, 0)}%</span></div>
            <div className="t-row"><span>{cost}bp 순 샤프</span><span>{fmt(d.sharpe)}</span></div></div>;
        }} />
        {metric === "turnover"
          ? <Bar dataKey="turnover" fill="var(--s-proposed)" fillOpacity={0.35} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          : <Line dataKey="sharpe" stroke="var(--s-proposed)" strokeWidth={3} dot={{ r: 4, fill: "var(--s-proposed)", stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />}
      </ComposedChart>
    </Box>
  );
}

// ------------------------------------------------------------------ live lab (presenter)
type Row = Record<string, number | string | undefined>;
const LIVE_LABEL: Record<string, string> = {
  proposed: "제안 모델 · 현재 설정", proposed_prereg: "제안 모델 · 사전등록 설정",
  "6040": KO["6040"], mvo: KO.mvo, ew: KO.ew,
  cash_weight: "현금 비중 · 현재 설정", cash_weight_prereg: "현금 비중 · 사전등록 설정",
  turnover_1y_pct: "회전율 · 현재 설정", turnover_1y_pct_prereg: "회전율 · 사전등록 설정",
};
function Tip({ active, payload, label, unit, digits = 3 }: { active?: boolean; payload?: TipEntry[]; label?: unknown; unit: string; digits?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <div className="t-date">{String(label)}</div>
      {payload.filter((p) => typeof p.value === "number").map((p) => (
        <div className="t-row" key={String(p.dataKey)}><span>{LIVE_LABEL[String(p.dataKey)] ?? String(p.dataKey)}</span><span>{fmt(p.value as number, digits)}{unit}</span></div>
      ))}
    </div>
  );
}

export function LiveWealthDraw({ rows, showRef, period }: { rows?: Row[]; showRef: boolean; period?: PeriodId }) {
  const data = useMemo(() => rows ?? curves[period ?? "primary"].rows.map((r) => ({ date: r.date, proposed: r.proposed, "6040": r["6040"], mvo: r.mvo, ew: r.ew })) as Row[], [rows, period]);
  const ticks = useMemo(() => yearTicks(data.map((r) => String(r.date))), [data]);
  return (
    <Box>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => `'${d.slice(2, 4)}`} tick={axisTick} stroke="var(--rule)" />
        <YAxis domain={[0, "auto"]} tick={axisTick} stroke="var(--rule)" width={44} tickFormatter={(v: number) => `${fmt(v, 1)}×`} />
        <Tooltip content={<Tip unit="×" />} />
        {(["6040", "mvo", "ew"] as StrategyId[]).map((id) => (
          <Line key={id} dataKey={id} stroke={STYLE[id].color} strokeWidth={STYLE[id].width} strokeDasharray={STYLE[id].dash} dot={false} isAnimationActive={false} />
        ))}
        {showRef && <Line dataKey="proposed_prereg" stroke="var(--s-proposed)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
        <Line dataKey="proposed" stroke="var(--s-proposed)" strokeWidth={STYLE.proposed.width} dot={false} isAnimationActive={false} />
      </LineChart>
    </Box>
  );
}

export function LiveSeriesDraw({ rows, keys, unit, digits, domain }: { rows: Row[]; keys: { key: string; dashed?: boolean; area?: boolean }[]; unit: string; digits: number; domain?: [number, number] }) {
  const ticks = useMemo(() => yearTicks(rows.map((r) => String(r.date))), [rows]);
  return (
    <Box>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => `'${d.slice(2, 4)}`} tick={axisTick} stroke="var(--rule)" />
        <YAxis domain={domain ?? [0, "auto"]} tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => `${fmt(v, 0)}${unit}`} />
        <Tooltip content={<Tip unit={unit} digits={digits} />} />
        {keys.map((k) => k.area
          ? <Area key={k.key} dataKey={k.key} stroke="var(--s-proposed)" strokeWidth={1.5} fill="var(--s-proposed)" fillOpacity={0.18} isAnimationActive={false} />
          : <Line key={k.key} dataKey={k.key} stroke="var(--s-proposed)" strokeWidth={k.dashed ? 1.5 : 2.5} strokeDasharray={k.dashed ? "6 4" : undefined} dot={false} isAnimationActive={false} />)}
      </ComposedChart>
    </Box>
  );
}

export function SweepDraw({ data, unit, at, preregCosts }: { data: { cost: number; proposed: number; proposed_prereg?: number }[]; unit: string; at?: number; preregCosts: number[] }) {
  const PreregDot = ({ cx, cy, payload }: { cx?: number; cy?: number; payload?: { cost: number } }) =>
    cx == null || cy == null || !payload || !preregCosts.includes(payload.cost) ? <g /> : <circle cx={cx} cy={cy} r={5} fill="var(--s-proposed)" stroke="var(--surface)" strokeWidth={2} />;
  return (
    <Box>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="cost" type="number" domain={["dataMin", "dataMax"]} tick={axisTick} stroke="var(--rule)" tickFormatter={(v: number) => `${v}bp`} />
        <YAxis domain={["auto", "auto"]} tick={axisTick} stroke="var(--rule)" width={44} tickFormatter={(v: number) => fmt(v, unit ? 1 : 2)} />
        <Tooltip content={<Tip unit={unit} digits={2} />} labelFormatter={(v) => `${v}bp`} />
        {at !== undefined && <ReferenceLine x={at} stroke="var(--ink-3)" strokeDasharray="4 3" />}
        {data.some((d) => d.proposed_prereg !== undefined) && <Line dataKey="proposed_prereg" stroke="var(--s-proposed)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
        <Line dataKey="proposed" stroke="var(--s-proposed)" strokeWidth={3} dot={PreregDot} isAnimationActive={false} />
      </LineChart>
    </Box>
  );
}

export function FanDraw({ fan }: { fan: { step: string; band: [number, number]; q10: number; q50: number; q90: number }[] }) {
  return (
    <Box>
      <ComposedChart data={fan} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="step" tick={axisTick} stroke="var(--rule)" />
        <YAxis domain={["auto", "auto"]} tick={axisTick} stroke="var(--rule)" width={48} tickFormatter={(v: number) => `${fmt(v, 1)}%`} />
        <ReferenceLine y={0} stroke="var(--ink-3)" />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const d = payload[0].payload as (typeof fan)[number];
          return <div className="tooltip"><div className="t-date">{String(label)}</div>
            <div className="t-row"><span>90% 분위</span><span>{fmt(d.q90)}%</span></div>
            <div className="t-row"><span>중앙값</span><span>{fmt(d.q50)}%</span></div>
            <div className="t-row"><span>10% 분위</span><span>{fmt(d.q10)}%</span></div></div>;
        }} />
        <Area dataKey="band" stroke="none" fill="var(--s-proposed)" fillOpacity={0.18} isAnimationActive={false} />
        <Line dataKey="q50" stroke="var(--s-proposed)" strokeWidth={3} dot={{ r: 4, fill: "var(--s-proposed)", stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
      </ComposedChart>
    </Box>
  );
}
