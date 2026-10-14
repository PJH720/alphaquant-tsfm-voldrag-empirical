// §3.4 "제출본 vs 실데이터" (server-rendered). Left: the submission's simulation parameters, gray and
// labelled. Right: the pre-registered real-data run, primary period at the base cost. "왜 다른가"
// derives the Sharpe-definition gap and the cost-sensitivity gap from the same JSON with data-expr.

import { LBL, method, performance, submission } from "@/lib/data";
import Num, { Txt } from "./Num";

export default function VsPanel() {
  const base = performance.base_cost_bp;
  const [c0, cMax] = [Math.min(...performance.costs_bp), Math.max(...performance.costs_bp)];
  const S = "submission_simulation.strategies.proposed";
  const R = (c: number, m: string) => `performance.performance.primary.${c}.proposed.${m}`;
  const cs = submission.illustrative_scenario.cost_sensitivity;
  const ci = (c: number) => cs.findIndex((r) => r.cost_bp === c);
  const C = (c: number, m: string) => `submission_simulation.illustrative_scenario.cost_sensitivity.${ci(c)}.proposed.${m}`;
  const subCosts = performance.costs_bp.filter((c) => c !== c0 && ci(c) >= 0);
  const rf = "method.RF";
  return (
    <div className="stack">
      <div className="vs">
        <div className="vs-col vs-sim">
          <span className="chip chip-sim">{LBL.submission}</span>
          <dl className="stat-list">
            <dt>CAGR (analytic)</dt><dd><Num src={`${S}.analytic.cagr_pct`} kind="pct" /></dd>
            <dt>샤프 (analytic)</dt><dd><Num src={`${S}.analytic.sharpe`} /></dd>
            <dt>σ (파라미터)</dt><dd><Num src={`${S}.parameters.sigma_pct`} kind="pct" /></dd>
            <dt>MDD (파라미터)</dt><dd><Num src={`${S}.parameters.mdd_pct`} kind="pct" /></dd>
            {subCosts.map((c) => (
              <div key={c} className="dl-row"><dt>{c}bp 예시 시나리오 CAGR / 샤프</dt><dd><Num src={C(c, "cagr_pct")} kind="pct" /> / <Num src={C(c, "sharpe")} /></dd></div>
            ))}
          </dl>
        </div>
        <div className="vs-col vs-real">
          <span className="chip chip-real">실데이터 · 1차 평가 (2017–, 완전 표본 외) · <Num src="performance.base_cost_bp" kind="int" />bp</span>
          <dl className="stat-list">
            <dt>CAGR</dt><dd><Num src={R(base, "cagr_pct")} kind="pct" /></dd>
            <dt>샤프</dt><dd><Num src={R(base, "sharpe")} /></dd>
            <dt>σ</dt><dd><Num src={R(base, "sigma_pct")} kind="pct" /></dd>
            <dt>MDD</dt><dd><Num src={R(base, "mdd_pct")} kind="pct" /></dd>
            {subCosts.map((c) => (
              <div key={c} className="dl-row"><dt>{c}bp CAGR / 샤프</dt><dd><Num src={R(c, "cagr_pct")} kind="pct" /> / <Num src={R(c, "sharpe")} /></dd></div>
            ))}
          </dl>
        </div>
      </div>

      <details className="why">
        <summary>왜 다른가</summary>
        <ol>
          <li>
            <b>샤프의 분자.</b> 제출본 샤프는 CAGR을 분자로 썼다: (CAGR − r<sub>f</sub>)/σ ={" "}
            <Num expr={`sharpe(${S}.analytic.cagr_pct,${rf},${S}.parameters.sigma_pct)`} />. 사전등록 정의(산술평균 분자)로 같은 파라미터를 계산하면{" "}
            (μ − r<sub>f</sub>)/σ = <Num expr={`sharpe(${S}.parameters.mu_arith_pct,${rf},${S}.parameters.sigma_pct)`} />다 (r<sub>f</sub> = <Num expr={`mul(${rf},100)`} kind="pct" d={0} />).
            어느 쪽이든 실데이터 1차 <Num src={R(base, "sharpe")} />와는 차이가 크다.
          </li>
          <li>
            <b>제출본이 스스로 밝힌 한계</b> (<code>submission_simulation.json · metadata.known_caveats</code>, 원문 그대로):
            <ul className="caveats">{submission.metadata.known_caveats.map((c, i) => <li key={c} lang="en"><Txt src={`submission_simulation.metadata.known_caveats.${i}`} /></li>)}</ul>
          </li>
          <li>
            <b>거래비용 민감도.</b> 실데이터에서는 <Num src="performance.costs_bp.0" kind="int" />bp → {cMax}bp 사이에 제안 모델 CAGR이{" "}
            <Num expr={`sub(${R(c0, "cagr_pct")},${R(cMax, "cagr_pct")})`} kind="pp" /> 떨어진다. 제출본 예시 시나리오는 같은 범위에서{" "}
            <Num expr={`sub(${C(c0, "cagr_pct")},${C(cMax, "cagr_pct")})`} kind="pp" /> 하락만 가정했다. 실데이터의 연 회전율은{" "}
            <Num src={R(base, "turnover_annual_pct")} kind="pct" d={0} />다.
          </li>
        </ol>
        <p className="footnote">r<sub>f</sub> = <code>method.json · RF</code> ({method.source.file} @ <code>{method.source.commit}</code>). 제출본 수치는 시뮬레이션 파라미터이며 실데이터 결과가 아니다.</p>
      </details>
    </div>
  );
}
