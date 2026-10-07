"use client";

// Section 7 add-on: the EXPLORATORY L1 turnover-penalty frontier, pre-computed by
// voldrag.exploratory_turnover and exported by voldrag.export_web. No live backend needed.
// The twin axes were requested; both series are labelled on their own axis and in the legend.

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PERIOD_LABEL, fmt, performance, turnoverReg, type PeriodId } from "@/lib/data";
import { turnoverFacts } from "@/lib/derived";
import { Figure, Footnote, Toggle, axisTick, gridProps } from "./kit";

const fmtTc = (v: number) => (v === 0 ? "0" : v.toLocaleString("ko-KR", { maximumSignificantDigits: 2 }));

export default function TurnoverRegularizationChart() {
  const [period, setPeriod] = useState<PeriodId>("primary");
  const f = turnoverFacts(period);
  const data = f.rows.map((r) => ({ x: fmtTc(r.lambda_tc), turnover: r.turnover_pct, sharpe: f.s(r) }));
  const mvo = performance.performance[period][String(f.base)].mvo.sharpe;
  const gridLabels = turnoverReg.first_grid.map(fmtTc);
  const summary = `${PERIOD_LABEL[period]} 제안 모델, L1 회전율 페널티 λ_tc별 연간 회전율과 ${f.base}bp 순 샤프: ${f.rows
    .map((r) => `λ_tc ${fmtTc(r.lambda_tc)} 회전율 ${fmt(r.turnover_pct, 0)}% 샤프 ${fmt(f.s(r))}`).join("; ")}.`;
  return (
    <Figure
      title="L1 회전율 페널티 λ_tc: 회전율과 순 샤프"
      caption={<><span className="chip chip-explore">탐색적 · 사전등록 아님 (§8)</span> {PERIOD_LABEL[period]} · 제안 모델(세이프가드 포함) · 비용 {f.base}bp · λ<sub>tc</sub> = 0이 사전등록 결과</>}
      summary={summary}
      footnote={<Footnote sources={[turnoverReg.source]} extra={<>min ½w′Σw − μ′w + λ<sub>tc</sub>‖w − w<sub>t−1</sub>‖₁, 제약은 사전등록과 동일 · 음영 = 처음 검토한 격자</>} />}
    >
      <div className="controls">
        <Toggle label="평가 기간" options={[{ id: "primary" as PeriodId, label: "1차 (2017–)" }, { id: "secondary" as PeriodId, label: "2차 (2015–)" }]} value={period} onChange={setPeriod} />
      </div>
      <div className="legend" aria-hidden="true">
        <span className="btn" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}>
          <svg width="20" height="12"><rect x="2" y="1" width="16" height="10" fill="var(--s-proposed)" opacity="0.28" /></svg>연간 회전율 (왼쪽 축)
        </span>
        <span className="btn" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}>
          <svg width="34" height="14"><line x1="1" y1="7" x2="33" y2="7" stroke="var(--s-proposed)" strokeWidth={3} /><circle cx="17" cy="7" r="4" fill="var(--s-proposed)" /></svg>{f.base}bp 순 샤프 (오른쪽 축)
        </span>
        <span className="btn" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}>
          <svg width="34" height="14"><line x1="1" y1="7" x2="33" y2="7" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="5 4" /></svg>MVO 순 샤프 {fmt(mvo)}
        </span>
      </div>
      <div style={{ height: "min(46vh, 420px)", minHeight: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 16, right: 8, bottom: 20, left: 8 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <ReferenceArea yAxisId="to" x1={gridLabels[0]} x2={gridLabels[gridLabels.length - 1]} fill="var(--surface-2)" fillOpacity={0.9} />
            <XAxis dataKey="x" tick={axisTick} stroke="var(--rule)"
              label={{ value: "λ_tc (연율 목적함수 단위)", position: "insideBottom", offset: -12, fill: "var(--ink-2)", fontSize: 13 }} />
            <YAxis yAxisId="to" domain={[0, "auto"]} tick={axisTick} stroke="var(--rule)" width={64} tickFormatter={(v: number) => `${fmt(v, 0)}%`} />
            <YAxis yAxisId="sh" orientation="right" domain={["auto", "auto"]} tick={axisTick} stroke="var(--rule)" width={48} tickFormatter={(v: number) => fmt(v, 2)} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[number];
              return <div className="tooltip"><div className="t-date">λ_tc = {String(label)}</div>
                <div className="t-row"><span>연간 회전율</span><span>{fmt(d.turnover, 0)}%</span></div>
                <div className="t-row"><span>{f.base}bp 순 샤프</span><span>{fmt(d.sharpe)}</span></div></div>;
            }} />
            <Bar yAxisId="to" dataKey="turnover" fill="var(--s-proposed)" fillOpacity={0.28} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <ReferenceLine yAxisId="sh" y={mvo} stroke="var(--ink-3)" strokeDasharray="5 4" />
            <Line yAxisId="sh" dataKey="sharpe" stroke="var(--s-proposed)" strokeWidth={3} dot={{ r: 5, fill: "var(--s-proposed)", stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="table">
        <summary>표로 보기</summary>
        <table>
          <thead><tr><th>λ<sub>tc</sub></th><th>연간 회전율</th>{turnoverReg.costs_bp.map((c) => <th key={c}>CAGR {c}bp</th>)}{turnoverReg.costs_bp.map((c) => <th key={c}>샤프 {c}bp</th>)}</tr></thead>
          <tbody>
            {f.rows.map((r) => (
              <tr key={r.lambda_tc}><td className="num">{fmtTc(r.lambda_tc)}</td><td className="num">{fmt(r.turnover_pct, 0)}%</td>
                {turnoverReg.costs_bp.map((c) => <td key={c} className="num">{fmt(r[`cagr_${c}bp`])}%</td>)}
                {turnoverReg.costs_bp.map((c) => <td key={c} className="num">{fmt(r[`sharpe_${c}bp`])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </details>
    </Figure>
  );
}
