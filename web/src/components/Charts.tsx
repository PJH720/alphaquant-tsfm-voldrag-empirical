"use client";

import { useMemo, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import {
  KO, PERIOD_LABEL, STRATEGIES, SUB_KEY, crisis, curves, drag, fmt, pct, performance, provenance, shortDate, signed,
  submission, type PeriodId, type StrategyId,
} from "@/lib/data";
import { dragStats } from "@/lib/derived";
import { Figure, Footnote, LegendToggle, MarkerShape, STYLE, Toggle, axisTick, gridProps } from "./kit";

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "primary", label: "1차 (2017–)" },
  { id: "secondary", label: "2차 (2015–)" },
];

function useVisible() {
  const [visible, setVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(STRATEGIES.map((s) => [s, true])));
  const toggle = (id: StrategyId) => setVisible((v) => ({ ...v, [id]: !v[id] }));
  return { visible, toggle };
}

type TipEntry = { dataKey?: unknown; value?: unknown };
function SeriesTooltip({ active, payload, label, valueFmt }: { active?: boolean; payload?: TipEntry[]; label?: unknown; valueFmt: (v: number) => string }) {
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
              <svg width="12" height="12" aria-hidden="true"><MarkerShape shape={STYLE[id].shape === "none" ? "circle" : STYLE[id].shape} x={6} y={6} color={STYLE[id].color} size={9} /></svg>
              {KO[id]}
            </span>
            <span>{valueFmt(p.value as number)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Sparse markers so dashed lines stay identifiable without cluttering. */
function sparseDot(id: StrategyId, every: number, offset: number) {
  const SparseDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index = 0 } = props;
    if (cx == null || cy == null || STYLE[id].shape === "none" || (index + offset) % every !== 0) return <g key={`${id}-${index}`} />;
    return <g key={`${id}-${index}`}><MarkerShape shape={STYLE[id].shape} x={cx} y={cy} color={STYLE[id].color} /></g>;
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

// ------------------------------------------------------------------ 3. cumulative wealth
export function CurvesChart() {
  const [period, setPeriod] = useState<PeriodId>("primary");
  const [log, setLog] = useState(false);
  const { visible, toggle } = useVisible();
  const c = curves[period];
  const last = c.rows[c.rows.length - 1];
  const ranked = [...STRATEGIES].sort((a, b) => last[b] - last[a]);
  const summary = `${PERIOD_LABEL[period]} ${c.start}부터 ${c.end}까지, 비용 ${c.cost_bp}bp 기준 누적자산. 최종 자산은 ${ranked
    .map((s) => `${KO[s]} ${fmt(last[s], 2)}배`).join(", ")}.`;
  const ticks = useMemo(() => yearTicks(c.rows.map((r) => r.date)), [c]);
  const every = Math.max(1, Math.round(c.rows.length / 10));

  return (
    <Figure
      title="누적자산 곡선 (초기 자산 = 1)"
      caption={`${PERIOD_LABEL[period]} · ${c.start} → ${c.end} · 거래비용 ${c.cost_bp}bp 차감 후, 주간 표본`}
      summary={summary}
      footnote={<Footnote sources={[c.source]} extra={<>주간 리샘플은 <code>voldrag.export_web</code></>} />}
    >
      <div className="controls">
        <Toggle label="평가 기간" options={PERIODS} value={period} onChange={setPeriod} />
        <span className="sep" />
        <button type="button" aria-pressed={log} onClick={() => setLog((v) => !v)}>로그 스케일</button>
      </div>
      <LegendToggle ids={STRATEGIES} visible={visible} onToggle={toggle} />
      <div style={{ height: "min(52vh, 520px)", minHeight: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={c.rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => d.slice(0, 4)} tick={axisTick} stroke="var(--rule)" />
            <YAxis
              scale={log ? "log" : "linear"} domain={log ? ["auto", "auto"] : [0, "auto"]} allowDataOverflow={log}
              tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => `${fmt(v, 1)}×`}
            />
            <Tooltip content={<SeriesTooltip valueFmt={(v) => `${fmt(v, 3)}×`} />} />
            {STRATEGIES.map((id, i) => visible[id] && (
              <Line
                key={id} dataKey={id} type="linear" stroke={STYLE[id].color} strokeWidth={STYLE[id].width}
                strokeDasharray={STYLE[id].dash} dot={sparseDot(id, every, i * 2)} activeDot={{ r: 5 }} isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="table">
        <summary>표로 보기: 최종 자산</summary>
        <table>
          <thead><tr><th>전략</th><th>최종 자산 (배)</th><th>CAGR</th><th>샤프</th><th>MDD</th></tr></thead>
          <tbody>
            {STRATEGIES.map((s) => {
              const p = performance.performance[period][String(c.cost_bp)][s];
              return <tr key={s}><td>{KO[s]}</td><td className="num">{fmt(last[s], 3)}</td><td className="num">{pct(p.cagr_pct)}</td><td className="num">{fmt(p.sharpe)}</td><td className="num">{pct(p.mdd_pct)}</td></tr>;
            })}
          </tbody>
        </table>
      </details>
    </Figure>
  );
}

// ------------------------------------------------------------------ 4. volatility drag
export function DragScatter() {
  const [period, setPeriod] = useState<PeriodId>("primary");
  const pts = STRATEGIES.map((s) => ({ id: s, x: drag.drag[period][s].theo_drag_pct, y: drag.drag[period][s].emp_drag_pct, sigma: drag.drag[period][s].sigma_pct }));
  const vals = pts.flatMap((p) => [p.x, p.y]);
  const lo = Math.floor(Math.min(...vals) * 20) / 20 - 0.05;
  const hi = Math.ceil(Math.max(...vals) * 20) / 20 + 0.05;
  const { maxGap } = dragStats();
  const summary = `${PERIOD_LABEL[period]} 전략별 실측 변동성 항력(산술평균 − 기하성장률)과 이론값 ½σ². ${pts
    .map((p) => `${KO[p.id]} 실측 ${fmt(p.y)}%, 이론 ${fmt(p.x)}%`).join("; ")}. 두 기간 전체에서 최대 차이 ${fmt(maxGap, 3)}%p.`;
  return (
    <Figure
      title="실측 항력 vs ½σ²"
      caption={`점이 45° 기준선 위에 놓이면 이토 항등식 μ − g = ½σ²가 실데이터에서 성립한다 · 비용 ${drag.cost_bp}bp`}
      summary={summary}
      footnote={<Footnote sources={[drag.source]} />}
    >
      <div className="controls"><Toggle label="평가 기간" options={PERIODS} value={period} onChange={setPeriod} /></div>
      <div style={{ height: "min(46vh, 440px)", minHeight: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 20, bottom: 24, left: 4 }}>
            <CartesianGrid {...gridProps} />
            <XAxis type="number" dataKey="x" domain={[lo, hi]} tick={axisTick} stroke="var(--rule)" tickFormatter={(v: number) => fmt(v, 2)}
              label={{ value: "이론 항력 ½σ² (%)", position: "insideBottom", offset: -14, fill: "var(--ink-2)", fontSize: 13 }} />
            <YAxis type="number" dataKey="y" domain={[lo, hi]} tick={axisTick} stroke="var(--rule)" width={56} tickFormatter={(v: number) => fmt(v, 2)}
              label={{ value: "실측 항력 (%)", angle: -90, position: "insideLeft", fill: "var(--ink-2)", fontSize: 13 }} />
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
        </ResponsiveContainer>
      </div>
      <div className="legend" aria-hidden="true">
        {STRATEGIES.map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.78rem", marginRight: 8 }}>
            <svg width="14" height="14"><MarkerShape shape={STYLE[s].shape === "none" ? "circle" : STYLE[s].shape} x={7} y={7} color={STYLE[s].color} size={10} /></svg>{KO[s]}
          </span>
        ))}
      </div>
      <details className="table">
        <summary>표로 보기</summary>
        <table>
          <thead><tr><th>전략</th><th>σ</th><th>½σ²</th><th>실측 항력</th><th>차이</th></tr></thead>
          <tbody>{pts.map((p) => <tr key={p.id}><td>{KO[p.id]}</td><td className="num">{pct(p.sigma)}</td><td className="num">{pct(p.x)}</td><td className="num">{pct(p.y)}</td><td className="num">{signed(p.y - p.x, 3)}%p</td></tr>)}</tbody>
        </table>
      </details>
    </Figure>
  );
}

export function ErgodicityBars() {
  const mc = submission.monte_carlo;
  const keys = (["6040", "ew", "mvo", "proposed"] as StrategyId[]).map((s) => ({ id: s, key: SUB_KEY[s]! }));
  const rows = keys.map(({ id, key }) => ({ id, name: KO[id], mean: mc.strategies[key].wealth_10y.mean, median: mc.strategies[key].wealth_10y.median }));
  const unit = mc.strategies.proposed.wealth_10y.unit;
  const summary = `제출본 몬테카를로(${fmt(mc.n_paths, 0)}개 경로) 10년 후 자산의 평균과 중앙값. ${rows
    .map((r) => `${r.name} 평균 ${fmt(r.mean, 1)}, 중앙값 ${fmt(r.median, 1)}`).join("; ")}. 모든 전략에서 평균이 중앙값보다 크다.`;
  return (
    <Figure
      title="10년 자산: 평균 vs 중앙값"
      caption={<><span className="chip chip-sim">시뮬레이션</span> 제출본 GBM 몬테카를로 · {fmt(mc.n_paths, 0)}개 경로 · 단위 {unit}</>}
      summary={summary}
      footnote={<Footnote sources={[{ file: `${submission_source.repo}:${submission_source.path}`, commit: submission_source.commit.slice(0, 7), sha256: "" }]} />}
    >
      <div style={{ height: "min(40vh, 380px)", minHeight: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 22, right: 8, bottom: 4, left: 0 }} barGap={3}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="name" tick={{ ...axisTick, fontSize: 12 }} stroke="var(--rule)" interval={0} />
            <YAxis tick={axisTick} stroke="var(--rule)" width={44} />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload, label }) => active && payload?.length ? (
              <div className="tooltip"><div className="t-date">{String(label)}</div>
                <div className="t-row"><span>평균</span><span>{fmt(payload[0].value as number, 2)}</span></div>
                <div className="t-row"><span>중앙값</span><span>{fmt(payload[1].value as number, 2)}</span></div></div>) : null} />
            <Bar dataKey="mean" name="평균" fill="var(--sim)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="mean" position="top" formatter={(v: unknown) => fmt(Number(v), 0)} fill="var(--ink-2)" fontSize={12} />
            </Bar>
            <Bar dataKey="median" name="중앙값" fill="var(--sim-bg)" stroke="var(--sim)" strokeWidth={1.5} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="median" position="top" formatter={(v: unknown) => fmt(Number(v), 0)} fill="var(--ink-2)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="legend" aria-hidden="true" style={{ fontSize: "0.78rem", gap: "1rem" }}>
        <span><svg width="14" height="12"><rect width="14" height="12" rx="2" fill="var(--sim)" /></svg> 평균 (앙상블)</span>
        <span><svg width="14" height="12"><rect x="0.75" y="0.75" width="12.5" height="10.5" rx="2" fill="var(--sim-bg)" stroke="var(--sim)" strokeWidth="1.5" /></svg> 중앙값 (전형적 경로)</span>
      </div>
    </Figure>
  );
}

const submission_source = provenance.submission;

// ------------------------------------------------------------------ 5. 2020 crisis
function nearestRowDate(target: string) {
  return crisis.rows.find((r) => r.date >= target)?.date ?? crisis.rows[crisis.rows.length - 1].date;
}

export function CrisisCharts() {
  const { visible, toggle } = useVisible();
  const sg = crisis.episode.proposed_safeguard;
  const firstReal = sg.first_trigger ? nearestRowDate(sg.first_trigger) : null;
  const subDate = nearestRowDate(crisis.submission_narrative.trigger_date);
  const rows = crisis.rows.map((r) => ({ ...r, beta_pct: r.beta * 100, cash_pct: r.cash_weight * 100 }));
  const last = rows[rows.length - 1];
  const ticks = rows.filter((r, i) => i === 0 || r.date.slice(5, 7) !== rows[i - 1].date.slice(5, 7)).map((r) => r.date);
  const every = Math.max(1, Math.round(rows.length / 8));
  const refLines = (withLabels: boolean) => [
    firstReal && (
      <ReferenceLine key="real" x={firstReal} stroke="var(--ok)" strokeWidth={2.5} ifOverflow="extendDomain"
        label={withLabels ? { value: `실데이터 첫 발동 ${shortDate(sg.first_trigger!)}`, position: "insideTopLeft", fill: "var(--ok-ink)", fontSize: 13, fontWeight: 600 } : undefined} />
    ),
    <ReferenceLine key="sub" x={subDate} stroke="var(--sim)" strokeWidth={2} strokeDasharray="6 5" ifOverflow="extendDomain"
      label={withLabels ? { value: `제출본 예시 시나리오 ${shortDate(crisis.submission_narrative.trigger_date)}`, position: "insideBottomRight", fill: "var(--sim-ink)", fontSize: 13 } : undefined} />,
  ];
  const summaryTop = `${crisis.window.start}부터 ${crisis.window.end}까지 전략별 누적자산(비용 ${crisis.cost_bp}bp). 기간 말 ${STRATEGIES
    .map((s) => `${KO[s]} ${fmt(last[s], 3)}배`).join(", ")}. 실데이터 세이프가드 첫 발동 ${sg.first_trigger}, 제출본 예시 시나리오의 발동일 ${crisis.submission_narrative.trigger_date}.`;
  const summaryBottom = `제안 모델의 세이프가드 β와 현금 비중(%). 에피소드 기간 β>0인 날 ${sg.days_beta_positive}일, 최대 β ${fmt(sg.max_beta)}, 평균 현금 비중 ${fmt(sg.mean_cash_weight_pct, 1)}%.`;

  return (
    <div style={{ display: "grid", gap: "0.8rem" }}>
      <Figure
        title="2020년 상반기 누적자산 (1월 2일 = 1)"
        caption={`${crisis.window.start} → ${crisis.window.end} · 1차 평가 실행 · 비용 ${crisis.cost_bp}bp`}
        summary={summaryTop}
        footnote={<Footnote sources={[crisis.sources.daily_returns, crisis.sources.episodes]} extra={<>제출본 날짜: <code>{crisis.submission_narrative.source.file}</code> @ <code>{crisis.submission_narrative.source.commit}</code></>} />}
      >
        <LegendToggle ids={STRATEGIES} visible={visible} onToggle={toggle} />
        <div style={{ height: "min(34vh, 340px)", minHeight: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} syncId="crisis" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} vertical={false} />
              <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => `${Number(d.slice(5, 7))}월`} tick={axisTick} stroke="var(--rule)" />
              <YAxis domain={["auto", "auto"]} tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => fmt(v, 2)} />
              <Tooltip content={<SeriesTooltip valueFmt={(v) => `${fmt(v, 3)}×`} />} />
              {refLines(true)}
              {STRATEGIES.map((id, i) => visible[id] && (
                <Line key={id} dataKey={id} stroke={STYLE[id].color} strokeWidth={STYLE[id].width} strokeDasharray={STYLE[id].dash}
                  dot={sparseDot(id, every, i * 2)} activeDot={{ r: 5 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Figure>
      <Figure
        title="세이프가드 β와 제안 모델 현금 비중 (%)"
        caption="같은 시간축 · β는 이상 점수 S가 임계값 τ를 넘을 때만 0보다 크다 · 두 값 모두 0–100% 척도"
        summary={summaryBottom}
        footnote={<Footnote sources={[crisis.sources.safeguard_signals, crisis.sources.weights]} extra="비중 파일은 Linux/CUDA 재현 실행 산출물 (허용 오차 내)" />}
      >
        <div style={{ height: "min(22vh, 220px)", minHeight: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} syncId="crisis" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} vertical={false} />
              <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => `${Number(d.slice(5, 7))}월`} tick={axisTick} stroke="var(--rule)" />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                <div className="tooltip"><div className="t-date">{String(label)}</div>
                  <div className="t-row"><span>세이프가드 β</span><span>{fmt(Number(payload.find((p) => p.dataKey === "beta_pct")?.value ?? 0), 1)}%</span></div>
                  <div className="t-row"><span>현금 비중</span><span>{fmt(Number(payload.find((p) => p.dataKey === "cash_pct")?.value ?? 0), 1)}%</span></div></div>) : null} />
              {refLines(false)}
              <Area dataKey="beta_pct" type="stepAfter" stroke="var(--ok)" strokeWidth={1.5} fill="var(--ok)" fillOpacity={0.18} isAnimationActive={false} name="β" />
              <Line dataKey="cash_pct" stroke="var(--s-proposed)" strokeWidth={2.5} dot={false} isAnimationActive={false} name="현금 비중" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="legend" aria-hidden="true" style={{ fontSize: "0.78rem", gap: "1.2rem" }}>
          <span><svg width="24" height="12"><rect width="24" height="12" fill="var(--ok)" fillOpacity="0.25" stroke="var(--ok)" /></svg> 세이프가드 β (면적)</span>
          <span><svg width="24" height="12"><line x1="0" y1="6" x2="24" y2="6" stroke="var(--s-proposed)" strokeWidth="2.5" /></svg> 제안 모델 현금 비중 (선)</span>
          <span><svg width="24" height="12"><line x1="12" y1="0" x2="12" y2="12" stroke="var(--ok)" strokeWidth="2.5" /></svg> 실데이터 첫 발동</span>
          <span><svg width="24" height="12"><line x1="12" y1="0" x2="12" y2="12" stroke="var(--sim)" strokeWidth="2" strokeDasharray="3 2" /></svg> 제출본 예시 시나리오</span>
        </div>
      </Figure>
    </div>
  );
}

// ------------------------------------------------------------------ 6. costs
export function CostCharts() {
  const [period, setPeriod] = useState<PeriodId>("primary");
  const costs = performance.costs_bp;
  const subRows = submission.illustrative_scenario.cost_sensitivity;
  const rows = costs.map((c) => {
    const r = performance.performance[period][String(c)].proposed;
    const s = subRows.find((x) => x.cost_bp === c)?.proposed;
    return { cost: `${c}bp`, real_cagr: r.cagr_pct, real_sharpe: r.sharpe, sub_cagr: s?.cagr_pct ?? null, sub_sharpe: s?.sharpe ?? null };
  });
  const base = String(performance.base_cost_bp);
  const turnover = STRATEGIES.map((s) => ({ id: s, name: KO[s], v: performance.performance[period][base][s].turnover_annual_pct }));
  const summaryA = `제안 모델의 비용별 CAGR과 샤프(${PERIOD_LABEL[period]}). ${rows.map((r) => `${r.cost}: 실데이터 CAGR ${fmt(r.real_cagr)}%, 샤프 ${fmt(r.real_sharpe)}; 제출본 CAGR ${r.sub_cagr == null ? "없음" : fmt(r.sub_cagr) + "%"}`).join("; ")}.`;
  const summaryB = `비용 ${base}bp 기준 전략별 연간 회전율: ${turnover.map((t) => `${t.name} ${fmt(t.v, 0)}%`).join(", ")}.`;
  const metricBars = (key: "cagr" | "sharpe", unit: string) => (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 22, right: 8, bottom: 4, left: 0 }} barGap={3}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="cost" tick={axisTick} stroke="var(--rule)" />
        <YAxis tick={axisTick} stroke="var(--rule)" width={40} />
        <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload, label }) => active && payload?.length ? (
          <div className="tooltip"><div className="t-date">{String(label)}</div>
            {payload.map((p) => <div className="t-row" key={String(p.dataKey)}><span>{String(p.dataKey).startsWith("sub") ? "제출본 (시뮬레이션)" : "실데이터"}</span><span>{fmt(Number(p.value))}{unit}</span></div>)}</div>) : null} />
        <Bar dataKey={`sub_${key}`} fill="var(--sim)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey={`sub_${key}`} position="top" formatter={(v: unknown) => fmt(Number(v))} fill="var(--sim-ink)" fontSize={12} />
        </Bar>
        <Bar dataKey={`real_${key}`} fill="var(--real)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey={`real_${key}`} position="top" formatter={(v: unknown) => fmt(Number(v))} fill="var(--ink)" fontSize={12} fontWeight={600} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
  return (
    <div style={{ display: "grid", gap: "0.8rem" }}>
      <Figure
        title="제안 모델: 거래비용별 CAGR(%)과 샤프"
        caption={<>회색 = 제출본 비용 민감도 표 (<span className="chip chip-sim">예시 시나리오</span>, {submission.metadata.sample.start}–{submission.metadata.sample.end}) · 남색 = 실데이터 · {PERIOD_LABEL[period]}</>}
        summary={summaryA}
        footnote={<Footnote sources={[performance.source, { file: `${provenance.submission.repo}:${provenance.submission.path}`, commit: provenance.submission.commit.slice(0, 7), sha256: "" }]} />}
      >
        <div className="controls"><Toggle label="평가 기간" options={PERIODS} value={period} onChange={setPeriod} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem" }}>
          <div><div className="cap" style={{ fontSize: "0.85rem" }}>CAGR (%)</div><div style={{ height: "min(26vh, 250px)", minHeight: 190 }}>{metricBars("cagr", "%")}</div></div>
          <div><div className="cap" style={{ fontSize: "0.85rem" }}>샤프 비율</div><div style={{ height: "min(26vh, 250px)", minHeight: 190 }}>{metricBars("sharpe", "")}</div></div>
        </div>
        <div className="legend" aria-hidden="true" style={{ fontSize: "0.78rem", gap: "1.2rem" }}>
          <span><svg width="14" height="12"><rect width="14" height="12" rx="2" fill="var(--sim)" /></svg> 제출본 (시뮬레이션)</span>
          <span><svg width="14" height="12"><rect width="14" height="12" rx="2" fill="var(--real)" /></svg> 실데이터</span>
        </div>
      </Figure>
      <Figure
        title={`연간 회전율 (%/년, 비용 ${base}bp)`}
        caption={`${PERIOD_LABEL[period]} · 100%는 1년에 포트폴리오를 한 번 전부 교체하는 거래량`}
        summary={summaryB}
        footnote={<Footnote sources={[performance.source]} />}
      >
        <div style={{ height: "min(26vh, 250px)", minHeight: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={turnover} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 8 }}>
              <CartesianGrid {...gridProps} horizontal={false} />
              <XAxis type="number" tick={axisTick} stroke="var(--rule)" tickFormatter={(v: number) => fmt(v, 0)} />
              <YAxis type="category" dataKey="name" tick={{ ...axisTick, fontSize: 12 }} stroke="var(--rule)" width={150} />
              <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload }) => active && payload?.length ? (
                <div className="tooltip"><div className="t-row"><span>{String(payload[0].payload.name)}</span><span>{fmt(Number(payload[0].value), 1)}%/년</span></div></div>) : null} />
              <Bar dataKey="v" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {turnover.map((t) => <Cell key={t.id} fill={STYLE[t.id].color} />)}
                <LabelList dataKey="v" position="right" formatter={(v: unknown) => `${fmt(Number(v), 0)}%`} fill="var(--ink-2)" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Figure>
    </div>
  );
}

// ------------------------------------------------------------------ 7. significance (forest plot, plain SVG)
export function SignificancePlot() {
  const periods: PeriodId[] = ["primary", "secondary"];
  const b = performance.bootstrap;
  const all = periods.flatMap((p) => [b[p].ci95[0], b[p].ci95[1]]);
  const span = Math.max(...all.map(Math.abs)) * 1.15;
  const W = 900, H = 230, L = 210, R = 40, top = 30, rowH = 80;
  const x = (v: number) => L + ((v + span) / (2 * span)) * (W - L - R);
  const ticks = [-span, -span / 2, 0, span / 2, span].map((v) => Math.round(v * 10) / 10);
  const summary = periods.map((p) => `${PERIOD_LABEL[p]}: 샤프 차이 ${signed(b[p].sharpe_diff, 3)}, 95% 신뢰구간 [${fmt(b[p].ci95[0], 3)}, ${fmt(b[p].ci95[1], 3)}], p = ${fmt(b[p].p_value, 4)}`).join(". ");
  return (
    <Figure
      title="샤프(제안 모델) − 샤프(MVO)"
      caption={`원형 블록 부트스트랩 · 블록 ${b.primary.block} · 반복 ${fmt(b.primary.n_boot, 0)}회 · 비용 ${performance.base_cost_bp}bp · 0을 포함하면 유의한 차이 없음`}
      summary={summary}
      footnote={<Footnote sources={[performance.source]} />}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: "34vh", display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 10} y2={H - 30} stroke={t === 0 ? "var(--ink-3)" : "var(--grid)"} strokeWidth={t === 0 ? 2 : 1} strokeDasharray={t === 0 ? "5 4" : undefined} />
            <text x={x(t)} y={H - 10} textAnchor="middle" fontSize="14" fill="var(--ink-3)">{signed(t, 1)}</text>
          </g>
        ))}
        <text x={x(0)} y={top - 14} textAnchor="middle" fontSize="13" fill="var(--ink-3)">차이 없음 (0)</text>
        {periods.map((p, i) => {
          const y = top + 20 + i * rowH;
          const r = b[p];
          return (
            <g key={p}>
              <text x={L - 14} y={y + 5} textAnchor="end" fontSize="16" fill="var(--ink)" fontWeight={600}>{p === "primary" ? "1차 (2017–)" : "2차 (2015–)"}</text>
              <line x1={x(r.ci95[0])} x2={x(r.ci95[1])} y1={y} y2={y} stroke="var(--real)" strokeWidth={3} />
              <line x1={x(r.ci95[0])} x2={x(r.ci95[0])} y1={y - 9} y2={y + 9} stroke="var(--real)" strokeWidth={3} />
              <line x1={x(r.ci95[1])} x2={x(r.ci95[1])} y1={y - 9} y2={y + 9} stroke="var(--real)" strokeWidth={3} />
              <rect x={x(r.sharpe_diff) - 8} y={y - 8} width={16} height={16} fill="var(--real)" stroke="var(--surface)" strokeWidth={2} />
              <text x={x(r.sharpe_diff)} y={y + 30} textAnchor="middle" fontSize="14" fill="var(--ink-2)">
                {signed(r.sharpe_diff, 3)} · p = {fmt(r.p_value, 4)}
              </text>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}
