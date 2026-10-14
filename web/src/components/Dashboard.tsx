"use client";

import { useState } from "react";
import { KO, LBL, PERIOD_LABEL, SUB_KEY, performance, provenance, submission, type PeriodId, type StrategyId } from "@/lib/data";
import { DRAG_TOLERANCE_PP } from "@/lib/derived";
import Num, { type NumKind } from "./Num";
import { PERIOD_OPTIONS, Toggle } from "./kit";
import { ModeTabs, useMode } from "./Mode";

const DASH_STRATEGIES: StrategyId[] = ["proposed", "6040", "mvo", "ew"];

function Chip({ ok, okText = "확인됨", failText = "재현 안 됨" }: { ok: boolean; okText?: string; failText?: string }) {
  return ok
    ? <span className="chip chip-ok"><span aria-hidden="true">✓</span>{okText}</span>
    : <span className="chip chip-fail"><span aria-hidden="true">✕</span>{failText}</span>;
}

type Metric = { title: string; sim: string; real: string; kind: NumKind; unit: "%" | ""; nature: [string, string]; verdict: boolean };

export default function Dashboard() {
  const { mode } = useMode();
  const [id, setId] = useState<StrategyId>("proposed");
  const [period, setPeriod] = useState<PeriodId>("primary");
  const isSim = mode === "simulation";
  const base = performance.base_cost_bp;
  const sk = SUB_KEY[id]!;
  const S = `submission_simulation.strategies.${sk}`;
  const R = `performance.performance.${period}.${base}.${id}`;
  const metrics: Metric[] = [
    { title: "CAGR", sim: `${S}.analytic.cagr_pct`, real: `${R}.cagr_pct`, kind: "pct", unit: "%", nature: ["해석적 계산 μ − ½σ²", "연복리 성장률"], verdict: true },
    { title: "샤프 비율", sim: `${S}.analytic.sharpe`, real: `${R}.sharpe`, kind: "num", unit: "", nature: ["해석적 계산 (CAGR 분자)", "(산술평균 − r_f)/σ"], verdict: true },
    { title: "최대 낙폭 MDD", sim: `${S}.parameters.mdd_pct`, real: `${R}.mdd_pct`, kind: "pct", unit: "%", nature: ["입력 파라미터", "일별 순자산 기준"], verdict: true },
    { title: "연변동성 σ", sim: `${S}.parameters.sigma_pct`, real: `${R}.sigma_pct`, kind: "pct", unit: "%", nature: ["입력 파라미터", "일별 수익률 연율화"], verdict: false },
  ];
  const val = (p: string) => p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], { submission_simulation: submission, performance }) as number;
  const real = performance.performance[period][String(base)][id];
  const dragGap = Math.abs(real.emp_drag_pct - real.theo_drag_pct);
  const valueCls = isSim ? "sim" : "real";
  const badge = isSim
    ? <span className="chip chip-sim">{LBL.submission}</span>
    : <span className="chip chip-real">사전등록 실데이터 · {period === "primary" ? "1차" : "2차"}</span>;

  return (
    <div className="stack">
      <ModeTabs />
      <div className="controls">
        <Toggle label="대시보드 전략" options={DASH_STRATEGIES.map((s) => ({ id: s, label: KO[s] }))} value={id} onChange={setId} />
        {!isSim && <Toggle label="대시보드 기간" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />}
      </div>
      <p className="cap">
        {isSim
          ? <><span className="chip chip-sim">{LBL.submission}</span> {submission.metadata.nature} · 표본 {submission.metadata.sample.start} → {submission.metadata.sample.end} · <code>{provenance.submission.repo}</code> @ <code>{provenance.submission.commit.slice(0, 7)}</code></>
          : <>{PERIOD_LABEL[period]} · {performance.periods[period].start} → {performance.periods[period].end} · 비용 <Num src="performance.base_cost_bp" kind="int" />bp · <code>{performance.source.file}</code> @ <code>{performance.source.commit}</code></>}
      </p>
      <div className="cards cards-5">
        {metrics.map((m) => {
          const [mine, other] = isSim ? [m.sim, m.real] : [m.real, m.sim];
          return (
            <article className={`card card-${valueCls}`} key={m.title}>
              <div className="card-head"><h3>{m.title}</h3>{!isSim && m.verdict && <Chip ok={val(m.real) >= val(m.sim)} />}</div>
              {badge}
              <div className={`big ${valueCls}`}><Num src={mine} kind={m.kind} /></div>
              <div className="delta">
                {isSim ? `실데이터 ${period === "primary" ? "1차" : "2차"}` : LBL.submission} <Num src={other} kind={m.kind} />
                {" "}<span className="note">(차이 <Num expr={`sub(${mine},${other})`} kind={m.unit ? "spp" : "signed"} />)</span>
                <div className="note">{m.nature[isSim ? 0 : 1]}</div>
              </div>
            </article>
          );
        })}
        <article className={`card card-${valueCls}`}>
          <div className="card-head">
            <h3>변동성 항력</h3>
            {!isSim && <Chip ok={dragGap <= DRAG_TOLERANCE_PP} />}
          </div>
          {badge}
          <div className="drag-pair">
            <div><div className="k">½σ²</div><div className={`v ${valueCls}`}><Num src={isSim ? `${S}.analytic.theo_drag_pct` : `${R}.theo_drag_pct`} kind="pct" /></div></div>
            <div><div className="k">실측 μ − g</div><div className={`v ${valueCls}`}>{isSim ? "—" : <Num src={`${R}.emp_drag_pct`} kind="pct" />}</div></div>
          </div>
          <div className="delta">
            {isSim
              ? <span className="note">시뮬레이션에는 실측치가 없다 (정의상 μ − g = ½σ²)</span>
              : <>차이 <Num expr={`abs(sub(${R}.emp_drag_pct,${R}.theo_drag_pct))`} d={3} kind="pp" /> <span className="note">· 제출본 ½σ² <Num src={`${S}.analytic.theo_drag_pct`} kind="pct" /></span></>}
          </div>
        </article>
      </div>
    </div>
  );
}
