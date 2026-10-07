"use client";

// §3.5 EXPLORATORY L1 turnover penalty: a discrete slider over the pre-computed λ_tc grid
// (voldrag.exploratory_turnover → results/exploratory_turnover_regularization.json → export_web).
// Static: no backend call. Cost and period follow the §3.3 selection.

import { useState } from "react";
import { LBL, PERIOD_LABEL, decimals, turnoverReg } from "@/lib/data";
import Num from "./Num";
import { Figure, Footnote, LazyChart, useSel } from "./kit";
import { TurnoverRegDraw } from "./lazy";

export default function LambdaSection() {
  const { cost, period } = useSel();
  const [idx, setIdx] = useState(0);
  const lams = turnoverReg.lambdas;
  const rows = turnoverReg.frontier[period].proposed;
  const F = `exploratory_turnover_regularization.frontier.${period}`;
  const sh = (i: number) => rows[i][`sharpe_${cost}bp`];
  const best = rows.reduce((b, _, i) => (sh(i) > sh(b) ? i : b), 0);
  const last = rows.length - 1;
  const floorIdx = rows.reduce((b, r, i) => (r.turnover_pct < rows[b].turnover_pct ? i : b), 0);
  const gMax = turnoverReg.first_grid.length - 1;
  const lam = (i: number) => <Num src={`exploratory_turnover_regularization.lambdas.${i}`} d={decimals(lams[i])} />;
  const cell = (i: number, m: string, kind: "pct" | "num" = "num", d = 2, who = "proposed") => <Num src={`${F}.${who}.${i}.${m}`} kind={kind} d={d} />;
  return (
    <div className="stack">
      <div className="banner-explore" role="note">
        <b>{LBL.exploratory}</b>
        <span>λ<sub>tc</sub> = 0 이 사전등록 결과이며 results.json과 같다. 그 밖의 격자점은 결과를 본 뒤 추가한 탐색적 분석이다.</span>
      </div>

      <div className="lam-panel">
        <label className="slider">
          <span className="lbl">
            <span>L1 회전율 페널티 λ<sub>tc</sub></span>
            <output data-grid-value>{lam(idx)}</output>
          </span>
          <input type="range" min={0} max={lams.length - 1} step={1} value={idx} data-grid="lambda_tc"
            onChange={(e) => setIdx(Number(e.target.value))} aria-valuetext={`λ_tc ${lams[idx]}`} />
        </label>
        <ol className="lam-ticks" aria-hidden="true">
          {lams.map((v, i) => <li key={v} className={`${i <= gMax ? "first" : ""}${i === idx ? " on" : ""}`}>{lam(i)}</li>)}
        </ol>
        <p className="cap">음영 = 처음 검토한 격자 (λ<sub>tc</sub> ≤ {lam(gMax)}) · {PERIOD_LABEL[period]} · 비용 <Num src={`exploratory_turnover_regularization.costs_bp.${turnoverReg.costs_bp.indexOf(cost)}`} kind="int" />bp (위 비용 선택을 따름)</p>
        <div className="chips-row">
          {idx === 0 && <span className="chip chip-real"><span>사전등록 (λ<sub>tc</sub> = 0)</span></span>}
          {idx === best && <span className="chip chip-explore">사후 선택(post hoc) — 결과를 본 뒤 고른 격자점 · 유의성 검정 없음</span>}
          {idx !== 0 && idx !== best && <span className="chip chip-explore">탐색적 격자점</span>}
        </div>
        <div className="cards cards-4" aria-live="polite">
          <article className="card card-explore"><div className="card-head"><h3>연 회전율</h3></div><div className="big">{cell(idx, "turnover_pct", "pct", 0)}</div><div className="note">λ<sub>tc</sub> = 0: {cell(0, "turnover_pct", "pct", 0)}</div></article>
          <article className="card card-explore"><div className="card-head"><h3>CAGR</h3></div><div className="big">{cell(idx, `cagr_${cost}bp`, "pct")}</div><div className="note">λ<sub>tc</sub> = 0: {cell(0, `cagr_${cost}bp`, "pct")}</div></article>
          <article className="card card-explore"><div className="card-head"><h3>샤프</h3></div><div className="big">{cell(idx, `sharpe_${cost}bp`)}</div><div className="note">λ<sub>tc</sub> = 0: {cell(0, `sharpe_${cost}bp`)}</div></article>
          <article className="card card-explore"><div className="card-head"><h3>MDD</h3></div><div className="big">{cell(idx, `mdd_${cost}bp`, "pct")}</div><div className="note">λ<sub>tc</sub> = 0: {cell(0, `mdd_${cost}bp`, "pct")}</div></article>
        </div>
      </div>

      <div className="callout callout-explore">
        <p>
          처음 검토한 약한 페널티(λ<sub>tc</sub> ≤ {lam(gMax)})로는 회전율이 {cell(0, "turnover_pct", "pct", 0)} → {cell(gMax, "turnover_pct", "pct", 0)}{" "}
          (<Num expr={`pctchg(${F}.proposed.0.turnover_pct,${F}.proposed.${gMax}.turnover_pct)`} kind="spct" d={1} />)만 바뀌고 샤프도 {cell(0, `sharpe_${cost}bp`)} → {cell(gMax, `sharpe_${cost}bp`)}다.
        </p>
        <p>
          이 비용에서 샤프가 가장 높은 격자점은 λ<sub>tc</sub> = {lam(best)}({cell(best, `sharpe_${cost}bp`)}, 회전율 {cell(best, "turnover_pct", "pct", 0)})이지만,
          <b> 사후 선택(post hoc) — 결과를 본 뒤 고른 격자점 · 유의성 검정 없음</b>.
          {sh(last) < sh(best) && <> 페널티를 더 키운 λ<sub>tc</sub> = {lam(last)}에서는 샤프가 {cell(last, `sharpe_${cost}bp`)}로 다시 낮아져 관계가 단조롭지 않다.</>}
        </p>
        <p>
          세이프가드가 없는 같은 QP는 λ<sub>tc</sub> = {lam(last)}에서 회전율이 {cell(last, "turnover_pct", "pct", 0, "ito_tsfm")}까지 내려가지만,
          제안 모델은 약 {cell(floorIdx, "turnover_pct", "pct", 0)} 아래로 내려가지 않는다. 그 차이는 세이프가드 현금 오버레이 거래다.
        </p>
      </div>

      <Figure
        title="λ_tc 격자: 회전율과 순 샤프"
        caption={<><span className="chip chip-explore">{LBL.exploratory}</span> 제안 모델(세이프가드 포함) · 음영 = 처음 검토한 격자</>}
        footnote={<Footnote sources={[turnoverReg.source]} extra={<>min ½w′Σw − μ′w + λ<sub>tc</sub>‖w − w<sub>t−1</sub>‖₁ · 다른 제약은 사전등록과 동일</>} />}
      >
        <div className="two-up">
          <div><div className="cap">연 회전율 (%)</div><LazyChart height={190} label="λ_tc별 연 회전율 막대">{() => <TurnoverRegDraw period={period} cost={cost} metric="turnover" />}</LazyChart></div>
          <div><div className="cap">순 샤프</div><LazyChart height={190} label="λ_tc별 순 샤프 선">{() => <TurnoverRegDraw period={period} cost={cost} metric="sharpe" />}</LazyChart></div>
        </div>
        <details className="table">
          <summary>표로 보기</summary>
          <div className="tscroll">
            <table>
              <thead><tr><th>λ<sub>tc</sub></th><th>회전율</th><th>CAGR</th><th>샤프</th><th>MDD</th><th>QP만 회전율</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.lambda_tc} className={i === best ? "row-hl" : undefined}>
                    <td>{lam(i)}</td><td>{cell(i, "turnover_pct", "pct", 0)}</td><td>{cell(i, `cagr_${cost}bp`, "pct")}</td>
                    <td>{cell(i, `sharpe_${cost}bp`)}</td><td>{cell(i, `mdd_${cost}bp`, "pct")}</td><td>{cell(i, "turnover_pct", "pct", 0, "ito_tsfm")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Figure>
    </div>
  );
}
