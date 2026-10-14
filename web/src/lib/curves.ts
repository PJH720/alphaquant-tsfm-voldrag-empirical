// Weekly wealth curves (the largest data files). Imported only by lazily loaded chart modules.
import curvesPrimaryJson from "../../public/data/curves_primary.json";
import curvesSecondaryJson from "../../public/data/curves_secondary.json";
import type { Curves } from "./data";
import type { PeriodId } from "./format";

export const curves: Record<PeriodId, Curves> = {
  primary: curvesPrimaryJson as unknown as Curves,
  secondary: curvesSecondaryJson as unknown as Curves,
};
