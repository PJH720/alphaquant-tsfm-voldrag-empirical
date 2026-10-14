// §3.1 Hero (server): the Itô identity, the drag calculator and the takeaway. Every result number is
// a <Num> from assets_drag.json, drag.json or performance.json; the calculator gets plain plot points
// and server-rendered readouts, so it ships no data to the browser.

import { ASSETS, ASSET_KO, KO, STRATEGIES, assetsDrag, drag, performance, type AssetId } from "@/lib/data";
import HeroCalc, { type Pt } from "./HeroCalc";
import Num from "./Num";

const A = (a: AssetId, k: string) => `assets_drag.assets.${a}.${k}`;
const realised = (a: AssetId) => `sub(${A(a, "mu_arith_pct")},${A(a, "mu_geom_log_pct")})`;
const assetGap = (a: AssetId) => `sub(${realised(a)},${A(a, "theo_drag_pct")})`;
const D = (s: string, k: string) => `drag.drag.primary.${s}.${k}`;

export default function Hero() {
  const st = assetsDrag.assets;
  const assets: Pt[] = ASSETS.map((a) => ({ id: a, label: ASSET_KO[a], sigma: st[a].sigma_pct, emp: st[a].mu_arith_pct - st[a].mu_geom_log_pct }));
  const strats: Pt[] = STRATEGIES.map((s) => ({ id: s, label: KO[s], sigma: drag.drag.primary[s].sigma_pct, emp: drag.drag.primary[s].emp_drag_pct }));
  const readouts = Object.fromEntries(ASSETS.map((a) => [a, (
    <span key={a}>
      <b>{ASSET_KO[a]}</b> σ <Num src={A(a, "sigma_pct")} kind="pct" /> · 실측 μ − g <Num expr={realised(a)} kind="pct" /> · ½σ² <Num src={A(a, "theo_drag_pct")} kind="pct" /> · 차이 <Num expr={assetGap(a)} d={3} kind="spp" />
    </span>
  )]));
  const nObs = [...new Set(ASSETS.map((a) => st[a].n_obs))];
  const gaps = ASSETS.map((a) => Math.abs(st[a].mu_arith_pct - st[a].mu_geom_log_pct - st[a].theo_drag_pct));
  const worstAsset = ASSETS[gaps.indexOf(Math.max(...gaps))];
  const sGaps = STRATEGIES.map((s) => Math.abs(drag.drag.primary[s].emp_drag_pct - drag.drag.primary[s].theo_drag_pct));
  const worstStrat = STRATEGIES[sGaps.indexOf(Math.max(...sGaps))];
  const base = performance.base_cost_bp;
  const caption = (
    <p className="cap">
      자산 통계: 2차 기간 {assetsDrag.window.start.slice(0, 7)}~{assetsDrag.window.end.slice(0, 7)}, n = {nObs.length === 1 ? <Num src={A(ASSETS[0], "n_obs")} kind="int" /> : "자산별 상이"}일 ·
      자산 최대 |실측 − ½σ²| = <Num expr={`absmax(${ASSETS.map(assetGap).join(",")})`} d={3} kind="pp" /> ({ASSET_KO[worstAsset]}) ·
      전략(1차, <Num src="drag.cost_bp" kind="int" />bp) 최대 = <Num expr={`absmax(${STRATEGIES.map((s) => `sub(${D(s, "emp_drag_pct")},${D(s, "theo_drag_pct")})`).join(",")})`} d={4} kind="pp" /> ({KO[worstStrat]})
    </p>
  );
  return (
    <div className="hero">
      <div className="hero-formula" aria-label="기하 성장률 g는 산술 평균 μ에서 변동성 항력 ½σ²를 뺀 값">
        <span className="f">g = μ − ½σ²</span>
        <span className="f-note">기하 성장률 = 산술 평균 − 변동성 항력</span>
      </div>

      <HeroCalc assets={assets} strats={strats} readouts={readouts} caption={caption} />

      <p className="takeaway">
        <b>항등식은 실데이터에서 성립한다 — 그러나 제안 모델이 항력을 벤치마크보다 의미 있게 줄이지는 못했다.</b>{" "}
        1차 · <Num src="performance.base_cost_bp" kind="int" />bp 실측 항력: 제안 모델 <Num src={`performance.performance.primary.${base}.proposed.emp_drag_pct`} kind="pct" />,
        {" "}{KO["6040"]} <Num src={`performance.performance.primary.${base}.6040.emp_drag_pct`} kind="pct" />{" "}
        (차이 <Num expr={`sub(performance.performance.primary.${base}.proposed.emp_drag_pct,performance.performance.primary.${base}.6040.emp_drag_pct)`} d={3} kind="spp" />).
      </p>

      <nav className="cta" aria-label="바로가기">
        <a href="#crisis">2020 위기 →</a>
        <a href="#costs">거래비용 →</a>
        <a href="#lambda">λ<sub>tc</sub> →</a>
        <a href="#provenance">재현성 →</a>
      </nav>
    </div>
  );
}
