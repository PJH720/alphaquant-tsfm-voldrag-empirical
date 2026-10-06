"use client";

import { useState } from "react";
import { KO, PERIOD_LABEL, SUB_KEY, fmt, performance, provenance, signed, submission, type PeriodId, type StrategyId } from "@/lib/data";
import { DRAG_TOLERANCE_PP } from "@/lib/derived";
import { Toggle } from "./kit";
import { ModeTabs, useMode } from "./Mode";

const DASH_STRATEGIES: StrategyId[] = ["proposed", "6040", "mvo", "ew"];

type Kpi = { cagr: number; sharpe: number; mdd: number; sigma: number; theo: number; emp: number | null };

function simKpi(id: StrategyId): Kpi {
  const s = submission.strategies[SUB_KEY[id]!];
  return { cagr: s.analytic.cagr_pct, sharpe: s.analytic.sharpe, mdd: s.parameters.mdd_pct, sigma: s.parameters.sigma_pct, theo: s.analytic.theo_drag_pct, emp: null };
}

function realKpi(id: StrategyId, period: PeriodId): Kpi {
  const p = performance.performance[period][String(performance.base_cost_bp)][id];
  return { cagr: p.cagr_pct, sharpe: p.sharpe, mdd: p.mdd_pct, sigma: p.sigma_pct, theo: p.theo_drag_pct, emp: p.emp_drag_pct };
}

function Chip({ ok, okText = "확인됨", failText = "재현 안 됨" }: { ok: boolean; okText?: string; failText?: string }) {
  return ok
    ? <span className="chip chip-ok"><span aria-hidden="true">✓</span>{okText}</span>
    : <span className="chip chip-fail"><span aria-hidden="true">✕</span>{failText}</span>;
}

export default function Dashboard() {
  const { mode } = useMode();
  const [id, setId] = useState<StrategyId>("proposed");
  const [period, setPeriod] = useState<PeriodId>("secondary");
  const sim = simKpi(id);
  const real = realKpi(id, period);
  const isSim = mode === "simulation";
  const k = isSim ? sim : real;
  const other = isSim ? real : sim;
  const otherName = isSim ? `실데이터 ${period === "secondary" ? "2차" : "1차"}` : "제출본";
  const valueCls = isSim ? "sim" : "real";
  const badge = isSim
    ? <span className="chip chip-sim">시뮬레이션 파라미터</span>
    : <span className="chip chip-real">사전등록 실데이터</span>;

  // In empirical mode each card says whether the submission's figure was reproduced (higher is better for all three; MDD is negative).
  const verdict = (realV: number, simV: number) => (isSim ? null : <Chip ok={realV >= simV} />);
  const cards: { title: string; v: number; o: number; unit: string; nature: string; verdict: React.ReactNode }[] = [
    { title: `CAGR (${performance.base_cost_bp}bp)`, v: k.cagr, o: other.cagr, unit: "%", nature: isSim ? "해석적 계산 μ − ½σ²" : "연복리 성장률", verdict: verdict(real.cagr, sim.cagr) },
    { title: "샤프 비율", v: k.sharpe, o: other.sharpe, unit: "", nature: isSim ? "해석적 계산" : "식 (33b), r_f 2%", verdict: verdict(real.sharpe, sim.sharpe) },
    { title: "최대 낙폭 MDD", v: k.mdd, o: other.mdd, unit: "%", nature: isSim ? "입력 파라미터" : "일별 순자산 기준", verdict: verdict(real.mdd, sim.mdd) },
    { title: "연변동성 σ", v: k.sigma, o: other.sigma, unit: "%", nature: isSim ? "입력 파라미터" : "일별 수익률 연율화", verdict: null },
  ];
  const dragGap = real.emp === null ? null : Math.abs(real.emp - real.theo);

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <ModeTabs />
      <div className="controls">
        <Toggle label="전략" options={DASH_STRATEGIES.map((s) => ({ id: s, label: KO[s] }))} value={id} onChange={setId} />
        {!isSim && (
          <>
            <span className="sep" />
            <Toggle label="평가 기간" options={[{ id: "secondary" as PeriodId, label: "2차 (2015–, 제출본과 같은 표본)" }, { id: "primary" as PeriodId, label: "1차 (2017–, 완전 표본 외)" }]} value={period} onChange={setPeriod} />
          </>
        )}
      </div>
      <p className="cap" style={{ margin: 0 }}>
        {isSim
          ? <>제출본 수치: {submission.metadata.nature} · 표본 {submission.metadata.sample.start} → {submission.metadata.sample.end} · <code>{provenance.submission.repo}</code> @ <code>{provenance.submission.commit.slice(0, 7)}</code></>
          : <>{PERIOD_LABEL[period]} · {performance.periods[period].start} → {performance.periods[period].end} · 비용 {performance.base_cost_bp}bp · <code>{performance.source.file}</code> @ <code>{performance.source.commit}</code>{period === "secondary" && " · 세이프가드는 2015–16년 표본 내"}</>}
      </p>
      <div className="cards cards-5">
        {cards.map((c) => (
          <article className={`card card-${valueCls}`} key={c.title} aria-label={`${c.title} ${fmt(c.v)}${c.unit}, 비교 ${otherName} ${fmt(c.o)}${c.unit}`}>
            <div className="card-head"><h3>{c.title}</h3>{c.verdict}</div>
            {badge}
            <div className={`big ${valueCls} num`}>{fmt(c.v)}{c.unit}</div>
            <div className="delta num">
              {otherName} {fmt(c.o)}{c.unit} <span className="note">(차이 {signed(c.v - c.o)}{c.unit ? "%p" : ""})</span>
              <div className="note">{c.nature}</div>
            </div>
          </article>
        ))}
        <article className={`card card-${valueCls}`} aria-label={isSim ? `변동성 항력 이론값 ${fmt(sim.theo)}%, 시뮬레이션에는 실측치 없음` : `변동성 항력 이론값 ${fmt(real.theo)}%, 실측 ${fmt(real.emp ?? 0)}%`}>
          <div className="card-head">
            <h3>변동성 항력</h3>
            {!isSim && dragGap !== null && <Chip ok={dragGap <= DRAG_TOLERANCE_PP} />}
          </div>
          {badge}
          <div className="drag-pair">
            <div><div className="k">½σ²</div><div className={`v ${valueCls} num`}>{fmt(k.theo)}%</div></div>
            <div><div className="k">실측 μ − g</div><div className={`v ${valueCls} num`}>{k.emp === null ? "—" : `${fmt(k.emp)}%`}</div></div>
          </div>
          <div className="delta num">
            {isSim
              ? <span className="note">시뮬레이션에는 실측치가 없다 (정의상 μ − g = ½σ²)</span>
              : <>차이 {fmt(dragGap ?? 0, 3)}%p <span className="note">· 확인 기준 {fmt(DRAG_TOLERANCE_PP)}%p · 제출본 ½σ² {fmt(sim.theo)}%</span></>}
          </div>
        </article>
      </div>
    </div>
  );
}
