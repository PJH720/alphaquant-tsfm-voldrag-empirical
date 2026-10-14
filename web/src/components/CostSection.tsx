"use client";

// §3.3 cost-sensitivity toggle: 0 / 10 / 20bp (pre-registered grid) × period. Every number is a <Num>
// that reads performance.json; the selection is shared with the λ_tc slider (kit.useSel).

import { KO, LBL, PERIOD_LABEL, performance, type StrategyId } from "@/lib/data";
import Num from "./Num";
import { Figure, Footnote, LazyChart, PERIOD_OPTIONS, Toggle, useSel } from "./kit";
import { CostBarsDraw, TurnoverBarsDraw } from "./lazy";

const BENCH: StrategyId[] = ["6040", "ew", "mvo", "ito_hist", "ito_tsfm"];

export default function CostSection() {
  const { cost, setCost, period, setPeriod } = useSel();
  const P = (s: StrategyId, m: string, c: number | string = cost) => `performance.performance.${period}.${c}.${s}.${m}`;
  const ex = performance.exploratory_costs;
  const [c0, cMax] = [Math.min(...performance.costs_bp), Math.max(...performance.costs_bp)];
  const boot = performance.bootstrap;
  const ci = boot.primary.ci95;
  const notSig = ci[0] <= 0 && ci[1] >= 0;
  const costOptions = performance.costs_bp.map((c) => ({ id: String(c), label: <><Num src={`performance.costs_bp.${performance.costs_bp.indexOf(c)}`} kind="int" /> bp</> }));
  const cards: { t: string; m: string; kind: "pct" | "num"; d?: number }[] = [
    { t: "CAGR", m: "cagr_pct", kind: "pct" },
    { t: "샤프", m: "sharpe", kind: "num" },
    { t: "MDD", m: "mdd_pct", kind: "pct" },
    { t: "σ", m: "sigma_pct", kind: "pct" },
    { t: "연 회전율", m: "turnover_annual_pct", kind: "pct", d: 0 },
  ];
  return (
    <div className="stack">
      <div className="controls sticky-controls">
        <Toggle label="비용" options={costOptions} value={String(cost)} onChange={(v) => setCost(Number(v))} />
        <Toggle label="비용 기간" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      </div>
      <p className="cap">{PERIOD_LABEL[period]} · 거래비용 <Num src={`performance.costs_bp.${performance.costs_bp.indexOf(cost)}`} kind="int" />bp × Σ|Δw| · <span className="chip chip-real">사전등록 비용 격자</span></p>

      <div className="cards cards-5" aria-live="polite">
        {cards.map((c) => (
          <article className="card card-real" key={c.m}>
            <div className="card-head"><h3>{c.t}</h3></div>
            <div className="big real"><Num src={P("proposed", c.m)} kind={c.kind} d={c.d ?? 2} /></div>
            <div className="note">제안 모델</div>
          </article>
        ))}
      </div>

      <div className="sig-strip" role="note">
        <b>유의성 (제안 − MVO, 1차, <Num src="performance.base_cost_bp" kind="int" />bp)</b>
        <span>ΔSharpe <Num src="performance.bootstrap.primary.sharpe_diff" d={3} kind="signed" /></span>
        <span>95% CI [<Num src="performance.bootstrap.primary.ci95.0" d={3} />, <Num src="performance.bootstrap.primary.ci95.1" d={3} />]</span>
        <span>p = <Num src="performance.bootstrap.primary.p_value" d={3} /></span>
        <span className={`chip ${notSig ? "chip-fail" : "chip-ok"}`}>{notSig ? "유의한 차이 없음" : "유의함"}</span>
        <details>
          <summary>2차 기간 값</summary>
          <p>{LBL.secondary}: ΔSharpe <Num src="performance.bootstrap.secondary.sharpe_diff" d={3} kind="signed" />, 95% CI [<Num src="performance.bootstrap.secondary.ci95.0" d={3} />, <Num src="performance.bootstrap.secondary.ci95.1" d={3} />], p = <Num src="performance.bootstrap.secondary.p_value" d={3} /></p>
        </details>
      </div>

      <div className="grid-2">
        <Figure title="같은 비용·기간의 벤치마크" footnote={<Footnote sources={[performance.source]} />}>
          <div className="tscroll">
            <table className="plain">
              <thead><tr><th>전략</th><th>CAGR</th><th>샤프</th><th>MDD</th><th>회전율</th></tr></thead>
              <tbody>
                {(["proposed", ...BENCH] as StrategyId[]).map((s) => (
                  <tr key={s} className={s === "proposed" ? "row-hl" : undefined}>
                    <td>{KO[s]}</td><td><Num src={P(s, "cagr_pct")} kind="pct" /></td><td><Num src={P(s, "sharpe")} /></td>
                    <td><Num src={P(s, "mdd_pct")} kind="pct" /></td><td><Num src={P(s, "turnover_annual_pct")} kind="pct" d={0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="table">
            <summary><span className="chip chip-explore">{LBL.exploratory}</span> {ex.costs_bp.map((c) => `${c}bp`).join(", ")} 행</summary>
            <div className="tscroll">
              <table>
                <thead><tr><th>비용</th><th>CAGR</th><th>샤프</th><th>MDD</th></tr></thead>
                <tbody>{ex.costs_bp.map((c) => (
                  <tr key={c}><td>{c}bp · 제안 모델</td>
                    <td><Num src={`performance.exploratory_costs.performance.${period}.${c}.proposed.cagr_pct`} kind="pct" /></td>
                    <td><Num src={`performance.exploratory_costs.performance.${period}.${c}.proposed.sharpe`} /></td>
                    <td><Num src={`performance.exploratory_costs.performance.${period}.${c}.proposed.mdd_pct`} kind="pct" /></td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </Figure>

        <div className="callout">
          <p><b>회전율 진단.</b> 같은 이토-켈리 QP라도 μ를 Chronos로 바꾸면 연 회전율이{" "}
            <Num src={P("ito_hist", "turnover_annual_pct")} kind="pct" d={0} />(과거 모멘트) →{" "}
            <Num src={P("ito_tsfm", "turnover_annual_pct")} kind="pct" d={0} />(Chronos)로{" "}
            <Num expr={`ratio(${P("ito_tsfm", "turnover_annual_pct")},${P("ito_hist", "turnover_annual_pct")})`} d={1} />배가 된다.
            제안 모델은 여기에 세이프가드 거래를 더해 <Num src={P("proposed", "turnover_annual_pct")} kind="pct" d={0} />다
            (+<Num expr={`sub(${P("proposed", "turnover_annual_pct")},${P("ito_tsfm", "turnover_annual_pct")})`} d={0} kind="pp" />).
          </p>
          <p>
            비용 격자 전체에서 제안 모델 CAGR은 <Num src={P("proposed", "cagr_pct", c0)} kind="pct" /> → <Num src={P("proposed", "cagr_pct", cMax)} kind="pct" />{" "}
            (<Num expr={`sub(${P("proposed", "cagr_pct", cMax)},${P("proposed", "cagr_pct", c0)})`} kind="spp" />), 샤프는 <Num src={P("proposed", "sharpe", c0)} /> → <Num src={P("proposed", "sharpe", cMax)} />로 내려간다.
          </p>
          <p className="counter">
            <b>주원인이지만 전부는 아니다.</b> 같은 비용에서 세이프가드를 뺀 이토-켈리 + Chronos의 CAGR은 <Num src={P("ito_tsfm", "cagr_pct")} kind="pct" />,
            세이프가드를 얹은 제안 모델은 <Num src={P("proposed", "cagr_pct")} kind="pct" />로 전체 기간에서는 세이프가드가{" "}
            <Num expr={`sub(${P("proposed", "cagr_pct")},${P("ito_tsfm", "cagr_pct")})`} kind="spp" /> 비용이었다 (현금 보유와 추가 거래).
            2022년 긴축기에는 제안 모델이 MVO보다 더 잃었다 (<Num src="performance.episodes.2022_tightening.proposed.return_pct" kind="pct" /> vs <Num src="performance.episodes.2022_tightening.mvo.return_pct" kind="pct" />, <a href="#crisis">위기 섹션</a>).
          </p>
        </div>
      </div>

      <div className="grid-2">
        <Figure
          title="비용 민감도: 제안 모델"
          caption={<>회색 = <span className="chip chip-sim">{LBL.submission}</span> 비용 민감도 예시 시나리오 · 남색 = 실데이터 · 빗금 = 탐색적 비용</>}
          footnote={<Footnote sources={[performance.source, ex.source]} />}
        >
          <div className="two-up">
            <div><div className="cap">CAGR (%)</div><LazyChart height={200} label="비용별 제안 모델 CAGR 막대">{() => <CostBarsDraw period={period} metric="cagr" />}</LazyChart></div>
            <div><div className="cap">샤프</div><LazyChart height={200} label="비용별 제안 모델 샤프 막대">{() => <CostBarsDraw period={period} metric="sharpe" />}</LazyChart></div>
          </div>
        </Figure>
        <Figure title="전략별 연간 회전율 (%/년)" caption="100% = 1년에 포트폴리오를 한 번 전부 교체하는 거래량" footnote={<Footnote sources={[performance.source]} />}>
          <LazyChart height={230} label="전략별 연간 회전율 가로 막대">{() => <TurnoverBarsDraw period={period} cost={cost} />}</LazyChart>
        </Figure>
      </div>
    </div>
  );
}
