import { STRATEGIES, drag, type PeriodId } from "./data";

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
