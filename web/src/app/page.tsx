import Nav from "@/components/Nav";
import { CostCharts, CrisisCharts, CurvesChart, DragScatter, ErgodicityBars, SignificancePlot } from "@/components/Charts";
import { DRAG_TOLERANCE_PP, cmpWord, dragStats } from "@/lib/derived";
import {
  KO, PERIOD_LABEL, crisis, dateKo, dateTimeKo, fmt, pct, performance, provenance, signed, submission,
  type PeriodId,
} from "@/lib/data";

const REPO = `https://github.com/${provenance.repo}`;
const SUB_REPO = `https://github.com/${provenance.submission_repo}`;
const PAPER_TITLE = "이토 보조정리와 시계열 파운데이션 모델(TSFM)을 결합한 동적 자산배분 및 변동성 항력 제어 프레임워크";

function Status({ ok, okText = "확인됨", failText = "재현 안 됨" }: { ok: boolean; okText?: string; failText?: string }) {
  return ok
    ? <span className="chip chip-ok"><span aria-hidden="true">✓</span>{okText}</span>
    : <span className="chip chip-fail"><span aria-hidden="true">✕</span>{failText}</span>;
}

function Eyebrow({ n, children }: { n: number; children: React.ReactNode }) {
  return <div className="eyebrow"><span className="num">{String(n).padStart(2, "0")}</span><span>·</span>{children}</div>;
}

// ------------------------------------------------------------------ 2. comparison cards
function CompareCards() {
  const period: PeriodId = "secondary"; // same sample as the submission (2015-01 → 2026-08)
  const base = String(performance.base_cost_bp);
  const real = performance.performance[period][base].proposed;
  const realPrimary = performance.performance.primary[base].proposed;
  const sub = submission.strategies.proposed;
  const maxCost = Math.max(...performance.costs_bp);
  const realHi = performance.performance[period][String(maxCost)].proposed;
  const realHiPrimary = performance.performance.primary[String(maxCost)].proposed;
  const subHi = submission.illustrative_scenario.cost_sensitivity.find((r) => r.cost_bp === maxCost)!.proposed;
  const cards = [
    { title: `CAGR (${base}bp)`, sim: sub.analytic.cagr_pct, simNature: "해석적 계산 (μ − ½σ²)", real: real.cagr_pct, primary: realPrimary.cagr_pct, unit: "%", d: 2 },
    { title: `샤프 비율 (${base}bp)`, sim: sub.analytic.sharpe, simNature: "해석적 계산", real: real.sharpe, primary: realPrimary.sharpe, unit: "", d: 2 },
    { title: "최대 낙폭 MDD", sim: sub.parameters.mdd_pct, simNature: "입력 파라미터", real: real.mdd_pct, primary: realPrimary.mdd_pct, unit: "%", d: 2 },
    { title: `CAGR (${maxCost}bp)`, sim: subHi.cagr_pct, simNature: "예시 시나리오", real: realHi.cagr_pct, primary: realHiPrimary.cagr_pct, unit: "%", d: 2 },
  ];
  return (
    <div className="cards">
      {cards.map((c) => {
        const ok = c.real >= c.sim; // higher is better for all four (MDD is negative)
        return (
          <article className="card" key={c.title} aria-label={`${c.title}: 제출본 ${fmt(c.sim, c.d)}${c.unit}, 실데이터 ${fmt(c.real, c.d)}${c.unit}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <h3>{c.title}</h3><Status ok={ok} />
            </div>
            <div className="row">
              <span className="chip chip-sim">시뮬레이션 파라미터</span>
              <span className="big sim num">{fmt(c.sim, c.d)}{c.unit}</span>
              <span className="chip chip-real">사전등록 실데이터</span>
              <span className="big real num">{fmt(c.real, c.d)}{c.unit}</span>
            </div>
            <div className="delta num">
              차이 <b>{signed(c.real - c.sim, c.d)}{c.unit ? "%p" : ""}</b>
              <div className="note">제출본: {c.simNature} · 1차(완전 표본 외) 실데이터 {fmt(c.primary, c.d)}{c.unit}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function Home() {
  const base = String(performance.base_cost_bp);
  const P = performance.performance;
  const prim = P.primary[base];
  const sec = P.secondary[base];
  const sub = submission.strategies.proposed;
  const ds = dragStats();
  const mc = submission.monte_carlo.strategies;
  const ep = crisis.episode;
  const sg = ep.proposed_safeguard;
  const ewin = crisis.episode_window;
  const costs = performance.costs_bp;
  const [c0, cMax] = [Math.min(...costs), Math.max(...costs)];
  const subCost = submission.illustrative_scenario.cost_sensitivity;
  const subC0 = subCost.find((r) => r.cost_bp === c0)!.proposed.cagr_pct;
  const subCMax = subCost.find((r) => r.cost_bp === cMax)!.proposed.cagr_pct;
  const pc = (period: PeriodId, c: number) => P[period][String(c)].proposed;
  const boot = performance.bootstrap;
  const bestBench0 = (["6040", "ew", "mvo"] as const)
    .map((id) => ({ id, sharpe: P.primary[String(c0)][id].sharpe }))
    .reduce((a, b) => (b.sharpe > a.sharpe ? b : a));
  const notSig = (p: PeriodId) => boot[p].ci95[0] <= 0 && boot[p].ci95[1] >= 0;
  const tests = provenance.data_reference_tests;
  const tl = provenance.timeline;
  const steps = [
    { what: "사전등록", c: tl.preregistration, note: "PREREGISTRATION.md · 데이터 다운로드 전" },
    { what: "코드 (결과 이전)", c: tl.code, note: "모델·백테스트·no-look-ahead 테스트" },
    { what: "첫 결과", c: tl.results, note: "results/ 커밋 · 이후 파라미터 변경 없음" },
    { what: "시연용 출력 추가", c: tl.weights_export, note: "비중 CSV · 웹 export (계산 불변)" },
  ];

  return (
    <>
      <Nav />
      <main>
        {/* 1. cover */}
        <section id="cover" className="slide cover" aria-labelledby="t-cover">
          <div className="wrap">
            <Eyebrow n={1}>2026 연합 경제 학술제 본선 · 실데이터 재현</Eyebrow>
            <h1 id="t-cover">{PAPER_TITLE}</h1>
            <p className="sub">
              시뮬레이션 파라미터로 작성한 제출본과, 하이퍼파라미터를 먼저 고정한 뒤 실제 시장 데이터로 다시 돌린 결과를 같은 기준에서 나란히 놓는다.
            </p>
            <p className="team"><b>팀</b> 박재현 · 강명서</p>
            <div className="repos">
              <a href={SUB_REPO}>제출본 저장소 · {provenance.submission_repo}</a>
              <a href={REPO}>실데이터 재현 저장소 · {provenance.repo}</a>
            </div>
            <div className="legend-key" aria-label="색의 의미">
              <span className="chip chip-sim">회색 = 시뮬레이션 제출본</span>
              <span className="chip chip-real">남색 = 실데이터</span>
              <span className="chip chip-ok">✓ 초록 = 확인됨</span>
              <span className="chip chip-fail">✕ 주황 = 재현 안 됨</span>
            </div>
          </div>
        </section>

        {/* 2. comparison */}
        <section id="compare" className="slide" aria-labelledby="t-compare">
          <div className="wrap">
            <Eyebrow n={2}>제출본 vs 실데이터 · 제안 모델</Eyebrow>
            <h2 id="t-compare">헤드라인 성과는 실데이터에서 재현되지 않았다</h2>
            <p className="lead">
              제출본과 같은 표본({submission.metadata.sample.start} → {submission.metadata.sample.end})의 {PERIOD_LABEL.secondary} 결과다.
              제출본 수치는 시장 데이터에서 추정한 값이 아니라 시뮬레이션 입력·해석적 계산이다. 이 기간에는 세이프가드가 2015–16년에 표본 내라는 점도 함께 밝힌다.
            </p>
            <CompareCards />
            <p className="footnote" style={{ marginTop: "1rem" }}>
              출처: <code>{performance.source.file}</code> @ <code>{performance.source.commit}</code> · 제출본 <code>{provenance.submission.repo}:{provenance.submission.path}</code> @ <code>{provenance.submission.commit.slice(0, 7)}</code>
            </p>
          </div>
        </section>

        {/* 3. curves */}
        <section id="curves" className="slide" aria-labelledby="t-curves">
          <div className="wrap">
            <Eyebrow n={3}>누적자산</Eyebrow>
            <h2 id="t-curves">6개 전략의 실데이터 누적자산</h2>
            <p className="lead">
              {PERIOD_LABEL.primary}에서 제안 모델의 CAGR은 {pct(prim.proposed.cagr_pct)}로 동일가중({pct(prim.ew.cagr_pct)})보다 {cmpWord(prim.proposed.cagr_pct, prim.ew.cagr_pct)}고
              MVO({pct(prim.mvo.cagr_pct)})보다 {cmpWord(prim.proposed.cagr_pct, prim.mvo.cagr_pct)}다. 세이프가드를 뺀 Chronos 절제 모델은 {pct(prim.ito_tsfm.cagr_pct)}다. 범례를 눌러 전략을 켜고 끌 수 있다.
            </p>
            <CurvesChart />
          </div>
        </section>

        {/* 4. drag */}
        <section id="drag" className="slide" aria-labelledby="t-drag">
          <div className="wrap">
            <Eyebrow n={4}>변동성 항력 검증 <Status ok={ds.confirmed} /></Eyebrow>
            <h2 id="t-drag">이토 항등식 μ − g = ½σ²는 실데이터에서 성립한다</h2>
            <p className="lead">
              두 기간 6개 전략 모두에서 실측 항력과 ½σ²의 차이는 최대 {fmt(ds.maxGap, 3)}%p다 (확인 기준 {fmt(DRAG_TOLERANCE_PP, 2)}%p 이내).
              다만 {PERIOD_LABEL.primary}에서 제안 모델의 항력은 {pct(prim.proposed.emp_drag_pct)}로 60/40({pct(prim["6040"].emp_drag_pct)})과의 차이가 {fmt(Math.abs(prim.proposed.emp_drag_pct - prim["6040"].emp_drag_pct))}%p다.
              항등식은 맞지만, 제출본이 가정한 항력 {pct(sub.analytic.theo_drag_pct)} 수준의 감소는 나타나지 않는다.
            </p>
            <div className="grid-2">
              <DragScatter />
              <div style={{ display: "grid", gap: "0.8rem" }}>
                <ErgodicityBars />
                <p className="prose">
                  <strong>비에르고딕성.</strong> 제출본 몬테카를로에서 제안 모델의 10년 자산 평균은 {fmt(mc.proposed.wealth_10y.mean, 1)}, 중앙값은 {fmt(mc.proposed.wealth_10y.median, 1)}이다.
                  평균(앙상블)은 운 좋은 소수 경로에 끌려 올라가고, 한 투자자가 실제로 겪는 전형적 경로는 중앙값, 즉 기하성장률 g = μ − ½σ²를 따른다. 그래서 σ를 줄이는 것이 곧 성장률을 지키는 일이다.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. crisis */}
        <section id="crisis" className="slide" aria-labelledby="t-crisis">
          <div className="wrap">
            <Eyebrow n={5}>2020 팬데믹 <Status ok={sg.first_trigger !== null && ep.proposed.mdd_pct > ep["6040"].mdd_pct} /></Eyebrow>
            <h2 id="t-crisis">세이프가드는 실제 위기에서 작동했다</h2>
            <p className="lead">
              실데이터에서 세이프가드는 {sg.first_trigger ? dateKo(sg.first_trigger) : "—"}에 처음 발동했고, 에피소드 구간({ewin.start} → {ewin.end}) 중 {sg.days_beta_positive}일 동안 켜져 평균 현금 비중이 {fmt(sg.mean_cash_weight_pct, 1)}%였다.
              같은 구간 MDD는 제안 모델 {pct(ep.proposed.mdd_pct)}, 60/40 {pct(ep["6040"].mdd_pct)}, MVO {pct(ep.mvo.mdd_pct)}.
              제출본의 {dateKo(crisis.submission_narrative.trigger_date)} 발동·현금 약 {fmt(crisis.submission_narrative.cash_pct, 0)}%·MDD {pct(crisis.submission_narrative.mdd_pct)}는 <span className="chip chip-sim">예시 시나리오</span>로만 병기한다.
            </p>
            <CrisisCharts />
          </div>
        </section>

        {/* 6. costs */}
        <section id="costs" className="slide" aria-labelledby="t-costs">
          <div className="wrap">
            <Eyebrow n={6}>거래비용 <Status ok={false} /></Eyebrow>
            <h2 id="t-costs">재현 실패의 주원인은 거래비용이다</h2>
            <div className="grid-2">
              <CostCharts />
              <div className="callout" style={{ alignSelf: "start" }}>
                <p style={{ margin: 0 }}>
                  Chronos 예측으로 매주 다시 최적화하는 제안 모델은 연간 회전율이 <b>{fmt(prim.proposed.turnover_annual_pct, 0)}%</b>에 이른다
                  (60/40 {fmt(prim["6040"].turnover_annual_pct, 0)}%, MVO {fmt(prim.mvo.turnover_annual_pct, 0)}%).
                  그래서 {PERIOD_LABEL.primary}의 CAGR이 {c0}bp {pct(pc("primary", c0).cagr_pct)} → {cMax}bp {pct(pc("primary", cMax).cagr_pct)}로
                  {" "}<b>{fmt(pc("primary", c0).cagr_pct - pc("primary", cMax).cagr_pct)}%p</b> 떨어지고, 샤프도 {fmt(pc("primary", c0).sharpe)} → {fmt(pc("primary", cMax).sharpe)}가 된다.
                  제출본의 비용 민감도 표는 같은 범위에서 {fmt(subC0 - subCMax)}%p 감소만을 가정했다.
                </p>
                <p style={{ marginBottom: 0 }}>
                  비용을 빼기 전({c0}bp)에는 실데이터 제안 모델의 {PERIOD_LABEL.primary} 샤프가 {fmt(pc("primary", c0).sharpe)}로 벤치마크 중 최고({fmt(bestBench0.sharpe)}, {KO[bestBench0.id]})보다 {cmpWord(pc("primary", c0).sharpe, bestBench0.sharpe)}다.
                  {pc("primary", c0).sharpe > bestBench0.sharpe && <> 예측 신호보다 <b>매매 빈도</b>가 성과를 잠식한다는 뜻이다.</>}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 7. significance */}
        <section id="significance" className="slide" aria-labelledby="t-sig">
          <div className="wrap">
            <Eyebrow n={7}>통계적 유의성 <Status ok={!notSig("primary")} okText="유의함" failText="유의한 차이 없음" /></Eyebrow>
            <h2 id="t-sig">제안 모델과 MVO의 샤프 차이는 0과 구별되지 않는다</h2>
            <p className="lead">
              {PERIOD_LABEL.primary}: 차이 {signed(boot.primary.sharpe_diff, 3)}, 95% 신뢰구간 [{fmt(boot.primary.ci95[0], 3)}, {fmt(boot.primary.ci95[1], 3)}], 양측 p = {fmt(boot.primary.p_value, 4)}.
              {" "}{PERIOD_LABEL.secondary}: 차이 {signed(boot.secondary.sharpe_diff, 3)}, p = {fmt(boot.secondary.p_value, 4)}.
              제출본 샤프 {fmt(sub.analytic.sharpe)}와 실데이터 {fmt(sec.proposed.sharpe)}의 격차 {fmt(sub.analytic.sharpe - sec.proposed.sharpe)}는 2차 신뢰구간 폭 {fmt(boot.secondary.ci95[1] - boot.secondary.ci95[0])}보다 {cmpWord(sub.analytic.sharpe - sec.proposed.sharpe, boot.secondary.ci95[1] - boot.secondary.ci95[0], 2, ["크", "작", "같"])}다.
            </p>
            <SignificancePlot />
          </div>
        </section>

        {/* 8. provenance */}
        <section id="provenance" className="slide" aria-labelledby="t-prov">
          <div className="wrap">
            <Eyebrow n={8}>재현성 · 신뢰의 근거</Eyebrow>
            <h2 id="t-prov">결과를 보기 전에 규칙을 먼저 고정했다</h2>
            <ol className="timeline" aria-label="커밋 타임라인">
              {steps.map((s) => (
                <li key={s.what}>
                  <div className="when num">{dateTimeKo(s.c.date)}</div>
                  <div className="what">{s.what}</div>
                  <div className="sha"><a href={`${REPO}/commit/${s.c.sha}`}><code>{s.c.short}</code></a></div>
                  <div className="when">{s.note}</div>
                </li>
              ))}
            </ol>
            <div className="grid-2" style={{ marginTop: "1.6rem" }}>
              <div>
                <h3 style={{ fontSize: "1.1rem", marginBottom: "0.6rem" }}>CHANGELOG: 결과 이전 데이터 대체 {provenance.amendments.length}건</h3>
                <div className="amend">
                  {provenance.amendments.map((a) => (
                    <div key={a.title}><b>{a.title}</b>{a.details[0] ?? a.summary}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className="kpis">
                  <div className="kpi">
                    <div className="v num" style={{ color: tests.failed === 0 ? "var(--ok-ink)" : "var(--fail-ink)" }}>{tests.passed}/{tests.total}</div>
                    <div className="k">데이터 기준값 테스트 통과 <Status ok={tests.failed === 0} okText="통과" failText="실패 있음" /></div>
                  </div>
                </div>
                <p className="prose" style={{ marginTop: 0 }}>
                  내려받은 시세를 공개된 역사적 값(ETF 연간 총수익률, KOSPI 연말 종가, FRED 지표)과 대조한다. 실행 {dateTimeKo(tests.ran_at)} · <code>{tests.summary}</code>
                </p>
                <pre className="cmd">{`git clone ${REPO}\n${provenance.run_command}\nuv run pytest`}</pre>
                <p className="footnote">
                  독립 재현 보고서 <a href={`${REPO}/blob/master/${provenance.reproduction_report}`}><code>{provenance.reproduction_report}</code></a> · 사이트 데이터 HEAD <code>{provenance.head.short}</code> · 원시 시세와 자산별 일별 수익률은 재배포하지 않는다.
                </p>
              </div>
            </div>
            <p className="footnote" style={{ marginTop: "1.2rem" }}>
              전략 표기: {Object.values(KO).join(" · ")}
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
