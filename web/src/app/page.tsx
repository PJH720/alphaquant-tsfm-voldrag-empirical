import CrisisSection from "@/components/CrisisSection";
import Hero from "@/components/Hero";
import {
  CostIsland, CrisisChartsIsland, CurvesIsland, DashboardIsland, DragIsland, ErgodicityIsland, LambdaIsland, LiveIsland, SignificanceIsland,
} from "@/components/islands";
import { ModeProvider } from "@/components/Mode";
import Nav from "@/components/Nav";
import Num, { Txt } from "@/components/Num";
import { Suspense } from "react";
import VsPanel from "@/components/VsPanel";
import { SelectionProvider } from "@/components/kit";
import { sectionNumber, type SectionId } from "@/lib/sections";
import { LBL, KO, dateKo, dateTimeKo, decimals, method, performance, provenance, submission, turnoverReg } from "@/lib/data";

const REPO = `https://github.com/${provenance.repo}`;
const SUB_REPO = `https://github.com/${provenance.submission_repo}`;
const PAPER_TITLE = "이토 보조정리와 시계열 파운데이션 모델(TSFM)을 결합한 동적 자산배분 및 변동성 항력 제어 프레임워크";

function Status({ ok, okText = "확인됨", failText = "재현 안 됨" }: { ok: boolean; okText?: string; failText?: string }) {
  return ok
    ? <span className="chip chip-ok"><span aria-hidden="true">✓</span>{okText}</span>
    : <span className="chip chip-fail"><span aria-hidden="true">✕</span>{failText}</span>;
}

function Eyebrow({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const n = sectionNumber(id);
  return <div className="eyebrow"><span className="num" aria-hidden="true">{String(n).padStart(2, "0")}</span><span aria-hidden="true">·</span>{children}</div>;
}

export default function Home() {
  const base = performance.base_cost_bp;
  const boot = performance.bootstrap;
  const notSig = boot.primary.ci95[0] <= 0 && boot.primary.ci95[1] >= 0;
  const ep = performance.episodes["2020_pandemic"];
  const e22 = performance.episodes["2022_tightening"];
  const tests = provenance.data_reference_tests;
  const tl = provenance.timeline;
  const steps = [
    { what: "사전등록", note: "데이터 다운로드 전 · PREREGISTRATION.md", c: tl.preregistration },
    ...(tl.data ? [{ what: "데이터 계층", note: "KRX 달력 정렬 · 결과 이전 수정 사항", c: tl.data }] : []),
    { what: "모델·백테스트·테스트", note: "결과 이전 · no-look-ahead 테스트 포함", c: tl.code },
    { what: "첫 사전등록 실행", note: "results/ 첫 커밋 · 이후 파라미터 변경 없음", c: tl.results },
    { what: "Linux/CUDA 재실행", note: "허용 오차 내 재현 · 비중 CSV 추가 · 계산 불변", c: tl.weights_export },
  ];
  const P = (m: string) => `performance.performance.primary.${base}.proposed.${m}`;

  return (
    <>
      <Nav />
      <header className="banner" role="note" aria-label="연구 윤리 고지">
        <div className="wrap">
          <b>연구 윤리 고지</b>
          <span>
            {LBL.submission} 수치는 실데이터 결과가 아니다 — “{submission.metadata.disclosure_ko}”.
            실데이터 결과는 {dateTimeKo(tl.preregistration.date)}에 커밋한 사전등록(<code>{tl.preregistration.short}</code>)의 파라미터를 바꾸지 않고 산출했고, 나빠도 그대로 보고한다.
          </span>
        </div>
      </header>
      <ModeProvider>
      <SelectionProvider baseCost={base}>
      <main>
        {/* 1. hero: identity + drag calculator */}
        <section id="hero" className="slide cover" aria-labelledby="t-hero">
          <div className="wrap">
            <Eyebrow id="hero">2026 연합 경제 학술제 본선 · 실데이터 재현</Eyebrow>
            <h1 id="t-hero">변동성 항력 μ − g = ½σ², 실데이터로 다시 재다</h1>
            <p className="sub">{PAPER_TITLE}</p>
            <p className="team"><b>팀</b> 박재현 · 강명서</p>
            <Hero />
            <div className="headline" role="note">
              <b>1차 평가 (2017–, 완전 표본 외) · <Num src="performance.base_cost_bp" kind="int" />bp:</b>{" "}
              제안 모델 CAGR <Num src={P("cagr_pct")} kind="pct" /> · 샤프 <Num src={P("sharpe")} /> · MDD <Num src={P("mdd_pct")} kind="pct" />.
              {" "}{LBL.submission} 값(CAGR <Num src="submission_simulation.strategies.proposed.analytic.cagr_pct" kind="pct" /> · 샤프 <Num src="submission_simulation.strategies.proposed.analytic.sharpe" />)은 재현되지 않았다.
            </div>
            <div className="repos">
              <a href={SUB_REPO}>제출본 저장소</a>
              <a href={REPO}>실데이터 재현 저장소</a>
            </div>
            <div className="legend-key" aria-label="색의 의미">
              <span className="chip chip-sim">회색 = {LBL.submission}</span>
              <span className="chip chip-real">남색 = 실데이터</span>
              <span className="chip chip-ok">✓ 확인됨</span>
              <span className="chip chip-fail">✕ 재현 안 됨</span>
              <span className="chip chip-explore">점선 = 탐색적</span>
            </div>
          </div>
        </section>

        {/* 2. dashboard */}
        <Suspense>
        <section id="compare" className="slide" aria-labelledby="t-compare">
          <div className="wrap">
            <Eyebrow id="compare">성과 대시보드</Eyebrow>
            <h2 id="t-compare">제출본과 실데이터를 같은 지표로 본다</h2>
            <p className="lead">기본은 실데이터 1차 평가(2017–, 완전 표본 외)다. 탭으로 {LBL.submission}로 전환할 수 있고, 각 카드는 제출본 값이 재현되었는지 표시한다.</p>
            <DashboardIsland />
          </div>
        </section>
        </Suspense>

        {/* 3. costs */}
        <Suspense>
        <section id="costs" className="slide" aria-labelledby="t-costs">
          <div className="wrap">
            <Eyebrow id="costs">거래비용 <Status ok={false} /></Eyebrow>
            <h2 id="t-costs">재현 실패의 주원인은 거래비용이다</h2>
            <p className="lead">Chronos 예측으로 매주 다시 최적화하고 세이프가드 거래가 더해져 회전율이 매우 높다. 비용 수준을 바꿔 보라.</p>
            <CostIsland />
          </div>
        </section>
        </Suspense>

        {/* 4. λ_tc */}
        <Suspense>
        <section id="lambda" className="slide" aria-labelledby="t-lambda">
          <div className="wrap">
            <Eyebrow id="lambda">탐색적 분석</Eyebrow>
            <h2 id="t-lambda">탐색적 분석: L1 회전율 페널티 λ<sub>tc</sub> 격자 (<Num src="exploratory_turnover_regularization.lambdas.0" d={0} />–<Num src={`exploratory_turnover_regularization.lambdas.${turnoverReg.lambdas.length - 1}`} d={decimals(turnoverReg.lambdas[turnoverReg.lambdas.length - 1])} />)</h2>
            <p className="lead">사전등록 모델에는 회전율 페널티가 없다(λ<sub>tc</sub> = 0). 결과를 본 뒤 목적함수에 L1 페널티를 더해 미리 계산한 격자다. 사전등록 결과를 대체하지 않는다.</p>
            <LambdaIsland />
          </div>
        </section>
        </Suspense>

        {/* 5. crisis */}
        <Suspense>
        <section id="crisis" className="slide" aria-labelledby="t-crisis">
          <div className="wrap">
            <Eyebrow id="crisis">2020 팬데믹 <Status ok={ep.proposed_safeguard.first_trigger !== null && ep.proposed.mdd_pct > ep["6040"].mdd_pct} /></Eyebrow>
            <h2 id="t-crisis">세이프가드는 {ep.proposed_safeguard.first_trigger ? dateKo(ep.proposed_safeguard.first_trigger) : "2020년"}에 켜졌다{e22.proposed.return_pct < e22.mvo.return_pct ? " — 2022년에는 MVO보다 더 잃었다" : ""}</h2>
            <CrisisSection />
            <details className="more">
              <summary>일별 차트 더 보기</summary>
              <CrisisChartsIsland />
            </details>
          </div>
        </section>
        </Suspense>

        {/* 6. curves */}
        <Suspense>
        <section id="curves" className="slide" aria-labelledby="t-curves">
          <div className="wrap">
            <Eyebrow id="curves">누적자산</Eyebrow>
            <h2 id="t-curves">누적자산: 제안 모델 · 60/40 · MVO · 동일가중</h2>
            <p className="lead">
              1차 평가에서 제안 모델 CAGR은 <Num src={P("cagr_pct")} kind="pct" />, {KO.ew} <Num src={`performance.performance.primary.${base}.ew.cagr_pct`} kind="pct" />,
              MVO <Num src={`performance.performance.primary.${base}.mvo.cagr_pct`} kind="pct" />다. 범례를 눌러 전략을 켜고 끈다.
            </p>
            <CurvesIsland />
          </div>
        </section>
        </Suspense>

        {/* 7. drag */}
        <Suspense>
        <section id="drag" className="slide" aria-labelledby="t-drag">
          <div className="wrap">
            <Eyebrow id="drag">변동성 항력 검증 <Status ok /></Eyebrow>
            <h2 id="t-drag">이토 항등식은 성립한다 — 항력 감소는 없었다</h2>
            <p className="lead">
              1차 평가에서 제안 모델의 실측 항력은 <Num src={P("emp_drag_pct")} kind="pct" />로 {KO["6040"]}(<Num src={`performance.performance.primary.${base}.6040.emp_drag_pct`} kind="pct" />)과 거의 같다.
              {" "}{LBL.submission} ½σ²는 <Num src="submission_simulation.strategies.proposed.analytic.theo_drag_pct" kind="pct" />였다.
            </p>
            <div className="grid-2">
              <DragIsland />
              <div className="stack">
                <ErgodicityIsland />
                <p className="prose">
                  <strong>비에르고딕성.</strong> 제출본 몬테카를로에서 제안 모델의 10년 자산 평균은 <Num src="submission_simulation.monte_carlo.strategies.proposed.wealth_10y.mean" d={1} />, 중앙값은 <Num src="submission_simulation.monte_carlo.strategies.proposed.wealth_10y.median" d={1} />이다.
                  한 투자자가 실제로 겪는 전형적 경로는 중앙값, 즉 기하성장률 g = μ − ½σ²를 따른다.
                </p>
              </div>
            </div>
          </div>
        </section>
        </Suspense>

        {/* 8. submission vs real */}
        <Suspense>
        <section id="vs" className="slide" aria-labelledby="t-vs">
          <div className="wrap">
            <Eyebrow id="vs">제출본 vs 실데이터 <Status ok={false} /></Eyebrow>
            <h2 id="t-vs">같은 지표, 다른 출처</h2>
            <VsPanel />
          </div>
        </section>
        </Suspense>

        {/* 9. significance */}
        <Suspense>
        <section id="significance" className="slide" aria-labelledby="t-sig">
          <div className="wrap">
            <Eyebrow id="significance">통계적 유의성 <Status ok={!notSig} okText="유의함" failText="유의한 차이 없음" /></Eyebrow>
            <h2 id="t-sig">제안 모델과 MVO의 샤프 차이는 0과 구별되지 않는다</h2>
            <p className="lead">
              1차: 차이 <Num src="performance.bootstrap.primary.sharpe_diff" d={3} kind="signed" />, 95% CI [<Num src="performance.bootstrap.primary.ci95.0" d={3} />, <Num src="performance.bootstrap.primary.ci95.1" d={3} />], p = <Num src="performance.bootstrap.primary.p_value" d={3} />.
            </p>
            <SignificanceIsland />
          </div>
        </section>
        </Suspense>

        {/* 10. live lab (presenter) */}
        <Suspense>
        <section id="live" className="slide" aria-labelledby="t-live">
          <div className="wrap">
            <Eyebrow id="live">실시간 GPU 실험실 · 발표자용</Eyebrow>
            <h2 id="t-live">발표자 워크스테이션이 연결되면 다시 계산한다</h2>
            <p className="lead">설정을 바꾼 결과는 모두 <b>{LBL.live}</b>이다.</p>
            <LiveIsland />
          </div>
        </section>
        </Suspense>

        {/* 11. provenance */}
        <Suspense>
        <section id="provenance" className="slide" aria-labelledby="t-prov">
          <div className="wrap">
            <Eyebrow id="provenance">재현성 · 신뢰의 근거</Eyebrow>
            <h2 id="t-prov">결과를 보기 전에 규칙을 먼저 고정했다</h2>
            <ol className="timeline" aria-label="사전등록 커밋 타임라인">
              {steps.map((s) => (
                <li key={s.c.sha}>
                  <div className="what">{s.what}</div>
                  <div className="when">{s.note}</div>
                </li>
              ))}
            </ol>
            <div className="grid-2" style={{ marginTop: "1.4rem" }}>
              <div className="stack">
                <h3>다시 돌려 보기</h3>
                <pre className="cmd">{`git clone ${REPO}\nuv sync && uv run python -m voldrag.run\nuv run pytest tests/test_pipeline.py::test_safeguard_is_frozen_and_causal`}</pre>
                <p className="prose">
                  시드 <Num src="method.SEED" kind="plain" /> ·
                  독립 재현 보고서 <a href={`${REPO}/blob/main/${provenance.reproduction_report}`}><code>{provenance.reproduction_report}</code></a>
                </p>
                <div className="kpis">
                  <div className="kpi">
                    <div className="v" style={{ color: tests.failed === 0 ? "var(--ok-ink)" : "var(--fail-ink)" }}><Num src="provenance.data_reference_tests.passed" kind="int" />/<Num src="provenance.data_reference_tests.total" kind="int" /></div>
                    <div className="k">데이터 기준값 테스트 <Status ok={tests.failed === 0 && tests.total > 0} okText="통과" failText="실패 또는 미실행" /></div>
                  </div>
                </div>
                <p className="footnote">내려받은 시세를 공개된 역사적 값(ETF 연간 총수익률, KOSPI 연말 종가, FRED 지표)과 대조한다 · 원시 시세와 자산별 일별 수익률은 재배포하지 않는다.</p>
              </div>
              <div className="stack">
                <h3>방법 요약 (사전등록)</h3>
                <ul className="method">
                  <li>예측: <code>{method.CHRONOS_MODEL}</code> zero-shot 모멘트만 사용 (μ̂, σ̂), 예측 기간 <Num src="method.HORIZON" kind="int" />거래일</li>
                  <li>리밸런싱: 주간 + 세이프가드 거래</li>
                  <li>비용: <Num src="method.BASE_COST_BP" kind="int" />bp × Σ|Δw|, 민감도 <Num src="method.COSTS_BP.0" kind="int" />·<Num src="method.COSTS_BP.2" kind="int" />bp</li>
                  <li>샤프 = (산술평균 − <Num expr="mul(method.RF,100)" kind="pct" d={0} />)/σ</li>
                  <li>모멘트: Ledoit-Wolf + Higham 상관행렬</li>
                  <li>켈리 QP: λ = 1, 종목 상한 <Num src="method.W_CAP" />, CVaR(<Num expr="mul(method.ALPHA,100)" kind="pct" d={0} />) ≤ 동일가중 CVaR, 시나리오 <Num src="method.W_ITO" kind="int" />개</li>
                  <li>세이프가드: 12차원 거시 상태의 NDE 오토인코더, 2015–16 학습 후 동결 · 임계치 τ = 직전 <Num src="method.TAU_WINDOW" kind="int" />일 <Num expr="mul(method.TAU_Q,100)" kind="pct" d={0} /> 분위</li>
                  <li>유의성: 원형 블록 부트스트랩, 블록 <Num src="method.BOOT_BLOCK" kind="int" />, 반복 <Num src="method.BOOT_B" kind="int" />회</li>
                </ul>
                <p className="footnote">출처: <code>{method.source.file}</code> (<code>method.json</code>)</p>
                <h3>CHANGELOG: 결과 이전 데이터 대체</h3>
                <div className="amend">
                  {provenance.amendments.map((a, i) => (
                    <div key={a.title}><b><Txt src={`provenance.amendments.${i}.title`} /></b>{a.details.length ? <Txt src={`provenance.amendments.${i}.details.0`} /> : <Txt src={`provenance.amendments.${i}.summary`} />}</div>
                  ))}
                </div>
              </div>
            </div>
            <p className="footnote" style={{ marginTop: "1.2rem" }}>전략 표기: {Object.values(KO).join(" · ")}</p>
          </div>
        </section>
        </Suspense>
      </main>
      </SelectionProvider>
      </ModeProvider>
    </>
  );
}
