"use client";

// Figure shells: titles, captions, controls and "표로 보기" tables are prerendered with <Num>;
// only the Recharts drawing inside <LazyChart> loads on the client (./lazy → ./rc).

import { useState } from "react";
import { KO, LBL, PERIOD_LABEL, STRATEGIES, SUB_KEY, crisis, drag, performance, provenance, submission, type PeriodId, type StrategyId } from "@/lib/data";
import Num from "./Num";
import { useMode } from "./Mode";
import { Figure, Footnote, LazyChart, LegendToggle, MarkerShape, PERIOD_OPTIONS, STYLE, Toggle } from "./kit";
import { CrisisSignalDraw, CrisisWealthDraw, CurvesDraw, DragScatterDraw, ErgodicityDraw } from "./lazy";

const pp = (period: PeriodId, cost: number | string, s: StrategyId, m: string) => `performance.performance.${period}.${cost}.${s}.${m}`;
const subSrc = { file: `${provenance.submission.repo}:${provenance.submission.path}`, commit: provenance.submission.commit.slice(0, 7), sha256: "" };

// ------------------------------------------------------------------ cumulative wealth
const CORE: StrategyId[] = ["proposed", "6040", "mvo", "ew"];

export function CurvesChart() {
  const { mode } = useMode();
  const isSim = mode === "simulation";
  const [periodSel, setPeriod] = useState<PeriodId>("primary");
  const period: PeriodId = isSim ? "secondary" : periodSel; // the submission's sample = 2nd period
  const [log, setLog] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(STRATEGIES.map((s) => [s, CORE.includes(s)])));
  const ids = isSim ? CORE : STRATEGIES;
  const base = performance.base_cost_bp;
  const per = performance.periods[period];
  return (
    <Figure
      title={isSim ? "제출본: 파라미터가 함의하는 해석적 경로 (초기 자산 = 1)" : "실데이터 누적자산 (초기 자산 = 1)"}
      caption={isSim
        ? <><span className="chip chip-sim">{LBL.submission}</span> W<sub>t</sub> = (1 + CAGR)<sup>t</sup> · 일별 시계열이 없어 실제 경로가 아니다 · 표본 {submission.metadata.sample.start} → {submission.metadata.sample.end}</>
        : <>{PERIOD_LABEL[period]} · {per.start} → {per.end} · 비용 <Num src="performance.base_cost_bp" kind="int" />bp 차감 · 주간 표본</>}
      footnote={isSim ? <Footnote sources={[subSrc]} extra="CAGR(analytic)로 경로 계산" /> : <Footnote sources={[performance.source]} extra={<>주간 리샘플 <code>voldrag.export_web</code></>} />}
    >
      <div className="controls">
        {!isSim && <Toggle label="누적자산 기간" options={PERIOD_OPTIONS} value={periodSel} onChange={setPeriod} />}
        <button type="button" aria-pressed={log} data-toggle="로그 스케일" onClick={() => setLog((v) => !v)}>로그 스케일</button>
      </div>
      <LegendToggle ids={ids} visible={visible} onToggle={(id) => setVisible((v) => ({ ...v, [id]: !v[id] }))} color={isSim ? () => "var(--sim)" : undefined} />
      <LazyChart height="min(52vh, 480px)" minHeight={260} label={`${isSim ? "제출본 해석적 경로" : "실데이터 누적자산"} 차트`}>
        {() => <CurvesDraw period={period} isSim={isSim} log={log} visible={visible} />}
      </LazyChart>
      <details className="table">
        <summary>표로 보기</summary>
        <div className="tscroll">
          <table>
            <thead><tr><th>전략</th><th>CAGR</th><th>샤프</th><th>MDD</th></tr></thead>
            <tbody>
              {ids.map((s) => {
                const k = SUB_KEY[s];
                return isSim && k
                  ? <tr key={s}><td>{KO[s]}</td><td><Num src={`submission_simulation.strategies.${k}.analytic.cagr_pct`} kind="pct" /></td><td><Num src={`submission_simulation.strategies.${k}.analytic.sharpe`} /></td><td><Num src={`submission_simulation.strategies.${k}.parameters.mdd_pct`} kind="pct" /></td></tr>
                  : <tr key={s}><td>{KO[s]}</td><td><Num src={pp(period, base, s, "cagr_pct")} kind="pct" /></td><td><Num src={pp(period, base, s, "sharpe")} /></td><td><Num src={pp(period, base, s, "mdd_pct")} kind="pct" /></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </details>
    </Figure>
  );
}

// ------------------------------------------------------------------ volatility drag
export function DragScatter() {
  const [period, setPeriod] = useState<PeriodId>("primary");
  const d = (s: StrategyId, m: string) => `drag.drag.${period}.${s}.${m}`;
  return (
    <Figure
      title="실측 항력 vs ½σ² (전략)"
      caption={<>점이 45° 기준선 위에 있으면 μ − g = ½σ²가 실데이터에서 성립한다 · 비용 <Num src="drag.cost_bp" kind="int" />bp · {PERIOD_LABEL[period]}</>}
      footnote={<Footnote sources={[drag.source]} />}
    >
      <div className="controls"><Toggle label="항력 기간" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} /></div>
      <LazyChart height="min(46vh, 420px)" minHeight={260} label="전략별 실측 항력과 이론 항력 산점도">
        {() => <DragScatterDraw period={period} />}
      </LazyChart>
      <div className="legend" aria-hidden="true">
        {STRATEGIES.map((s) => (
          <span key={s} className="legend-item">
            <svg width="14" height="14"><MarkerShape shape={STYLE[s].shape === "none" ? "circle" : STYLE[s].shape} x={7} y={7} color={STYLE[s].color} size={10} /></svg>{KO[s]}
          </span>
        ))}
      </div>
      <details className="table">
        <summary>표로 보기</summary>
        <div className="tscroll">
          <table>
            <thead><tr><th>전략</th><th>σ</th><th>½σ²</th><th>실측</th><th>차이</th></tr></thead>
            <tbody>{STRATEGIES.map((s) => (
              <tr key={s}><td>{KO[s]}</td><td><Num src={d(s, "sigma_pct")} kind="pct" /></td><td><Num src={d(s, "theo_drag_pct")} kind="pct" /></td><td><Num src={d(s, "emp_drag_pct")} kind="pct" /></td>
                <td><Num expr={`sub(${d(s, "emp_drag_pct")},${d(s, "theo_drag_pct")})`} d={4} kind="spp" /></td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </Figure>
  );
}

export function ErgodicityBars() {
  const keys = (["6040", "ew", "mvo", "proposed"] as StrategyId[]).map((id) => ({ id, key: SUB_KEY[id]! }));
  return (
    <Figure
      title="10년 자산: 평균 vs 중앙값"
      caption={<><span className="chip chip-sim">{LBL.submission}</span> 제출본 GBM 몬테카를로 · <Num src="submission_simulation.monte_carlo.n_paths" kind="int" />개 경로</>}
      footnote={<Footnote sources={[subSrc]} />}
    >
      <LazyChart height="min(36vh, 320px)" minHeight={220} label="제출본 몬테카를로 10년 자산 평균과 중앙값 막대">
        {() => <ErgodicityDraw />}
      </LazyChart>
      <div className="legend" aria-hidden="true">
        <span className="legend-item"><svg width="14" height="12"><rect width="14" height="12" rx="2" fill="var(--sim)" /></svg> 평균 (앙상블)</span>
        <span className="legend-item"><svg width="14" height="12"><rect x="0.75" y="0.75" width="12.5" height="10.5" rx="2" fill="var(--sim-bg)" stroke="var(--sim)" strokeWidth="1.5" /></svg> 중앙값 (전형적 경로)</span>
      </div>
      <details className="table">
        <summary>표로 보기</summary>
        <div className="tscroll">
          <table>
            <thead><tr><th>전략</th><th>평균</th><th>중앙값</th></tr></thead>
            <tbody>{keys.map(({ id, key }) => (
              <tr key={id}><td>{KO[id]}</td><td><Num src={`submission_simulation.monte_carlo.strategies.${key}.wealth_10y.mean`} d={1} /></td><td><Num src={`submission_simulation.monte_carlo.strategies.${key}.wealth_10y.median`} d={1} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </Figure>
  );
}

// ------------------------------------------------------------------ 2020 crisis charts
export function CrisisCharts() {
  const [visible, setVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(STRATEGIES.map((s) => [s, true])));
  const [logScore, setLogScore] = useState(true);
  return (
    <div className="stack">
      <Figure
        title="2020년 상반기 누적자산 (1월 2일 = 1)"
        caption={<>{crisis.window.start} → {crisis.window.end} · 1차 평가 실행 · 비용 <Num src="crisis_2020.cost_bp" kind="int" />bp</>}
        footnote={<Footnote sources={[crisis.sources.daily_returns, crisis.sources.episodes]} />}
      >
        <LegendToggle ids={STRATEGIES} visible={visible} onToggle={(id) => setVisible((v) => ({ ...v, [id]: !v[id] }))} />
        <LazyChart height="min(34vh, 320px)" minHeight={220} label="2020년 상반기 전략별 누적자산">
          {() => <CrisisWealthDraw visible={visible} />}
        </LazyChart>
      </Figure>
      <Figure
        title="세이프가드 신호: 점수 S · 임계치 τ · β · 현금 비중"
        caption="왼쪽 축 = 재구성 오차 점수 S와 임계치 τ (S > τ일 때만 β > 0) · 오른쪽 축 = β와 현금 비중"
        footnote={<Footnote sources={[crisis.sources.safeguard_signals, crisis.sources.weights]} />}
      >
        <div className="controls">
          <button type="button" aria-pressed={logScore} data-toggle="점수 축 로그" onClick={() => setLogScore((v) => !v)}>점수 축 로그 스케일</button>
        </div>
        <LazyChart height="min(30vh, 280px)" minHeight={220} label="세이프가드 점수, 임계치, β, 현금 비중">
          {() => <CrisisSignalDraw logScore={logScore} />}
        </LazyChart>
        <div className="legend" aria-hidden="true">
          <span className="legend-item"><svg width="24" height="12"><line x1="0" y1="6" x2="24" y2="6" stroke="var(--s-ito_tsfm)" strokeWidth="2" /></svg> 점수 S</span>
          <span className="legend-item"><svg width="24" height="12"><line x1="0" y1="6" x2="24" y2="6" stroke="var(--fail)" strokeWidth="2" strokeDasharray="5 3" /></svg> 임계치 τ</span>
          <span className="legend-item"><svg width="24" height="12"><rect width="24" height="12" fill="var(--ok)" fillOpacity="0.25" stroke="var(--ok)" /></svg> β (면적)</span>
          <span className="legend-item"><svg width="24" height="12"><line x1="0" y1="6" x2="24" y2="6" stroke="var(--s-proposed)" strokeWidth="2.5" /></svg> 현금 비중</span>
          <span className="legend-item"><svg width="24" height="12"><line x1="12" y1="0" x2="12" y2="12" stroke="var(--ok)" strokeWidth="2.5" /></svg> 실데이터 첫 발동</span>
          <span className="legend-item"><svg width="24" height="12"><line x1="12" y1="0" x2="12" y2="12" stroke="var(--sim)" strokeWidth="2" strokeDasharray="3 2" /></svg> 제출본 예시</span>
        </div>
      </Figure>
    </div>
  );
}

// ------------------------------------------------------------------ significance (forest plot, plain SVG)
export function SignificancePlot() {
  const periods: PeriodId[] = ["primary", "secondary"];
  const b = performance.bootstrap;
  const all = periods.flatMap((p) => [b[p].ci95[0], b[p].ci95[1]]);
  const span = Math.max(...all.map(Math.abs)) * 1.15;
  const W = 600, H = 210, L = 110, R = 24, top = 30, rowH = 76;
  const x = (v: number) => L + ((v + span) / (2 * span)) * (W - L - R);
  const ticks = [-span, -span / 2, 0, span / 2, span].map((v) => Math.round(v * 10) / 10);
  return (
    <Figure
      title="샤프(제안 모델) − 샤프(MVO)"
      caption={<>원형 블록 부트스트랩 · 블록 <Num src="performance.bootstrap.primary.block" kind="int" /> · 반복 <Num src="performance.bootstrap.primary.n_boot" kind="int" />회 · 비용 <Num src="performance.base_cost_bp" kind="int" />bp · 구간이 0을 포함하면 유의한 차이 없음</>}
      footnote={<Footnote sources={[performance.source]} />}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="샤프 차이와 95% 신뢰구간 (1차, 2차)" style={{ display: "block", maxHeight: 260 }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 10} y2={H - 30} stroke={t === 0 ? "var(--ink-3)" : "var(--grid)"} strokeWidth={t === 0 ? 2 : 1} strokeDasharray={t === 0 ? "5 4" : undefined} />
            <text x={x(t)} y={H - 10} textAnchor="middle" fontSize="14" fill="var(--ink-3)">{t > 0 ? "+" : t < 0 ? "−" : ""}{Math.abs(t).toFixed(1)}</text>
          </g>
        ))}
        <text x={x(0)} y={top - 14} textAnchor="middle" fontSize="13" fill="var(--ink-3)">차이 없음 (0)</text>
        {periods.map((p, i) => {
          const y = top + 20 + i * rowH;
          const r = b[p];
          return (
            <g key={p}>
              <text x={L - 12} y={y + 5} textAnchor="end" fontSize="15" fill="var(--ink)" fontWeight={600}>{p === "primary" ? "1차 (2017–)" : "2차 (2015–)"}</text>
              <line x1={x(r.ci95[0])} x2={x(r.ci95[1])} y1={y} y2={y} stroke="var(--real)" strokeWidth={3} />
              <line x1={x(r.ci95[0])} x2={x(r.ci95[0])} y1={y - 9} y2={y + 9} stroke="var(--real)" strokeWidth={3} />
              <line x1={x(r.ci95[1])} x2={x(r.ci95[1])} y1={y - 9} y2={y + 9} stroke="var(--real)" strokeWidth={3} />
              <rect x={x(r.sharpe_diff) - 8} y={y - 8} width={16} height={16} fill="var(--real)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      <div className="tscroll">
        <table className="plain">
          <thead><tr><th>기간</th><th>ΔSharpe</th><th>95% CI</th><th>p</th></tr></thead>
          <tbody>{periods.map((p) => (
            <tr key={p}><td>{p === "primary" ? "1차 (2017–)" : "2차 (2015–)"}</td>
              <td><Num src={`performance.bootstrap.${p}.sharpe_diff`} d={3} kind="signed" /></td>
              <td>[<Num src={`performance.bootstrap.${p}.ci95.0`} d={3} />, <Num src={`performance.bootstrap.${p}.ci95.1`} d={3} />]</td>
              <td><Num src={`performance.bootstrap.${p}.p_value`} d={3} /></td></tr>
          ))}</tbody>
        </table>
      </div>
    </Figure>
  );
}
