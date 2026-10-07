import { STRATEGIES, drag, turnoverReg, type PeriodId } from "./data";

/** Display criterion for marking the drag identity "confirmed"; it is shown next to the result. */
export const DRAG_TOLERANCE_PP = 0.05;

export function dragStats() {
  let maxGap = 0;
  for (const p of ["primary", "secondary"] as PeriodId[])
    for (const s of STRATEGIES) maxGap = Math.max(maxGap, Math.abs(drag.drag[p][s].emp_drag_pct - drag.drag[p][s].theo_drag_pct));
  return { maxGap, confirmed: maxGap <= DRAG_TOLERANCE_PP };
}

/** "높다"/"낮다"/"같다" comparison word for a vs b at the displayed precision. */
export function cmpWord(a: number, b: number, digits = 2, [hi, lo, eq] = ["높", "낮", "같"]) {
  const r = (v: number) => Math.round(v * 10 ** digits);
  return r(a) > r(b) ? hi : r(a) < r(b) ? lo : eq;
}

/** Key points of the exploratory turnover-penalty frontier, for text that must come from data. */
export function turnoverFacts(period: PeriodId) {
  const base = turnoverReg.base_cost_bp;
  const rows = turnoverReg.frontier[period].proposed;
  const qpOnly = turnoverReg.frontier[period].ito_tsfm;
  const s = (r: (typeof rows)[number]) => r[`sharpe_${base}bp`];
  const r0 = rows.find((r) => r.lambda_tc === 0)!;
  const gridMax = Math.max(...turnoverReg.first_grid);
  const rG = rows.find((r) => r.lambda_tc === gridMax)!;
  const best = rows.reduce((a, b) => (s(b) > s(a) ? b : a));
  const last = rows[rows.length - 1];
  const floor = Math.min(...rows.map((r) => r.turnover_pct));
  const qpBest = qpOnly.find((r) => r.lambda_tc === best.lambda_tc)!;
  return { base, rows, r0, rG, gridMax, best, last, floor, qpBest, s };
}
