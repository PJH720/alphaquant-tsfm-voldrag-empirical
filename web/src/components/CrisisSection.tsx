// §3.2 2020 crisis timeline (server-rendered: no client JS). Daily β and cash weight are drawn as an
// inline SVG strip; every number in text is a <Num> reading crisis_2020.json or performance.json.

import { KO, LBL, crisis, dateKo, performance, type StrategyId } from "@/lib/data";
import Num from "./Num";
import { Footnote } from "./kit";

const ORDER: StrategyId[] = ["proposed", "mvo", "ew", "6040", "ito_hist", "ito_tsfm"];

function Strip() {
  const rows = crisis.rows;
  const W = 600, H = 120, pad = 4;
  const x = (i: number) => pad + (i / (rows.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - v * (H - 2 * pad);
  const line = (k: "beta" | "cash_weight") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join("");
  const win = crisis.episode_window;
  const i0 = rows.findIndex((r) => r.date >= win.start);
  const i1 = rows.findLastIndex((r) => r.date <= win.end);
  const trig = crisis.episode.proposed_safeguard.first_trigger;
  const it = trig ? rows.findIndex((r) => r.date >= trig) : -1;
  const months = rows.map((r, i) => ({ i, m: r.date.slice(5, 7) })).filter((r, k, a) => k === 0 || r.m !== a[k - 1].m);
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="img" aria-label="2020년 상반기 일별 β와 현금 비중" className="strip">
      <rect x={x(i0)} y={0} width={x(i1) - x(i0)} height={H} fill="var(--surface-2)" />
      {[0, 0.5, 1].map((v) => <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--grid)" />)}
      <path d={`${line("beta")}L${x(rows.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill="var(--ok)" fillOpacity={0.2} stroke="none" />
      <path d={line("beta")} fill="none" stroke="var(--ok)" strokeWidth={1.5} />
      <path d={line("cash_weight")} fill="none" stroke="var(--s-proposed)" strokeWidth={2.5} />
      {it >= 0 && <line x1={x(it)} x2={x(it)} y1={0} y2={H} stroke="var(--ok)" strokeWidth={2.5} />}
      {months.map(({ i, m }) => <text key={m} x={x(i) + 2} y={H + 14} fontSize={12} fill="var(--ink-3)">{Number(m)}월</text>)}
    </svg>
  );
}

export default function CrisisSection() {
  const ep = crisis.episode;
  const E = "crisis_2020.episode";
  const sorted = [...ORDER].sort((a, b) => ep[b].mdd_pct - ep[a].mdd_pct);
  const worst = Math.min(...ORDER.map((s) => ep[s].mdd_pct));
  const t = "performance.episodes.2022_tightening";
  const e22 = performance.episodes["2022_tightening"];
  const sn = crisis.submission_narrative;
  return (
    <div className="stack">
      <ol className="ctl" aria-label="2020 위기 타임라인">
        <li><span className="when">{dateKo(crisis.episode_window.start)}</span><b>에피소드 구간 시작</b><span className="note">사전등록 구간 {crisis.episode_window.start} → {crisis.episode_window.end}</span></li>
        <li className="hl"><span className="when">{ep.proposed_safeguard.first_trigger ? dateKo(ep.proposed_safeguard.first_trigger) : "—"}</span><b>세이프가드 첫 발동</b><span className="note">재구성 오차 S가 임계치 τ를 넘은 첫날</span></li>
        <li><span className="when">구간 중</span><b>β &gt; 0인 날 <Num src={`${E}.proposed_safeguard.days_beta_positive`} kind="int" />일</b>
          <span className="note">최대 β <Num src={`${E}.proposed_safeguard.max_beta`} /> (1 = 전액 현금) · 평균 현금 비중 <Num src={`${E}.proposed_safeguard.mean_cash_weight_pct`} kind="pct" d={1} /></span></li>
        <li><span className="when">{dateKo(crisis.episode_window.end)}</span><b>구간 종료</b><span className="note">제안 모델 구간 수익률 <Num src={`${E}.proposed.return_pct`} kind="pct" /> · MDD <Num src={`${E}.proposed.mdd_pct`} kind="pct" /></span></li>
      </ol>

      <figure className="figure">
        <h3>일별 β와 현금 비중</h3>
        <p className="cap">{crisis.window.start} → {crisis.window.end} · 음영 = 사전등록 에피소드 구간 · 세로선 = 첫 발동</p>
        <Strip />
        <div className="legend" aria-hidden="true">
          <span className="legend-item"><svg width="24" height="12"><rect width="24" height="12" fill="var(--ok)" fillOpacity="0.25" stroke="var(--ok)" /></svg> β</span>
          <span className="legend-item"><svg width="24" height="12"><line x1="0" y1="6" x2="24" y2="6" stroke="var(--s-proposed)" strokeWidth="2.5" /></svg> 제안 모델 현금 비중</span>
        </div>
        <Footnote sources={[crisis.sources.safeguard_signals, crisis.sources.weights]} />
      </figure>

      <div className="grid-2">
        <figure className="figure">
          <h3>에피소드 MDD (1차, <Num src="crisis_2020.cost_bp" kind="int" />bp)</h3>
          <p className="cap">MDD가 작은 순서 · 오른쪽 = 구간 수익률</p>
          <ul className="hbars">
            {sorted.map((s) => (
              <li key={s} className={s === "proposed" ? "hl" : undefined}>
                <span className="name">{KO[s]}</span>
                <span className="bar"><span style={{ width: `${(100 * ep[s].mdd_pct) / worst}%` }} /></span>
                <span className="val"><Num src={`${E}.${s}.mdd_pct`} kind="pct" /></span>
                <span className="ret"><Num src={`${E}.${s}.return_pct`} kind="spct" /></span>
              </li>
            ))}
          </ul>
          <Footnote sources={[crisis.sources.episodes]} />
        </figure>

        <div className="stack">
          <div className="card card-sim">
            <span className="chip chip-sim">{LBL.submission}</span>
            <p className="note-sim">
              {LBL.submission} 예시 시나리오: {dateKo(sn.trigger_date)} 발동 · 현금 약 <Num src="crisis_2020.submission_narrative.cash_pct" kind="pct" d={0} /> · MDD <Num src="crisis_2020.submission_narrative.mdd_pct" kind="pct" />.
              실데이터 결과가 아니라 비교용으로만 적는다.
            </p>
          </div>
          <article className="card card-real">
            <div className="card-head"><h3>2022 긴축기</h3>{e22.proposed.return_pct < e22.mvo.return_pct && <span className="chip chip-fail">MVO보다 더 잃음</span>}</div>
            <p className="cap">
              {performance.episode_windows["2022_tightening"].start} → {performance.episode_windows["2022_tightening"].end} · 첫 발동 {e22.proposed_safeguard.first_trigger ? dateKo(e22.proposed_safeguard.first_trigger) : "—"} ·
              β &gt; 0 <Num src={`${t}.proposed_safeguard.days_beta_positive`} kind="int" />일 · 평균 현금 <Num src={`${t}.proposed_safeguard.mean_cash_weight_pct`} kind="pct" d={1} />
            </p>
            <div className="tscroll">
              <table className="plain">
                <thead><tr><th>전략</th><th>수익률</th><th>MDD</th></tr></thead>
                <tbody>{(["proposed", "mvo", "6040", "ew"] as StrategyId[]).map((s) => (
                  <tr key={s} className={s === "proposed" ? "row-hl" : undefined}><td>{KO[s]}</td><td><Num src={`${t}.${s}.return_pct`} kind="pct" /></td><td><Num src={`${t}.${s}.mdd_pct`} kind="pct" /></td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="note">
              {e22.proposed.return_pct < e22.mvo.return_pct
                ? <>2022년에는 세이프가드가 켜졌는데도 제안 모델이 MVO보다 <Num expr={`sub(${t}.mvo.return_pct,${t}.proposed.return_pct)`} kind="pp" />를 더 잃었다.{e22.proposed.return_pct > e22["6040"].return_pct && e22.proposed.return_pct > e22.ew.return_pct && " 60/40·동일가중보다는 덜 잃었다."}</>
                : <>2022년 제안 모델 수익률은 MVO 이상이었다.</>}
            </p>
          </article>
        </div>
      </div>
    </div>
  );
}
