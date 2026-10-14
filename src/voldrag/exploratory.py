"""EXPLORATORY analyses, not in PREREGISTRATION.md (§8: labelled exploratory).  `python -m voldrag.exploratory`

Cost sensitivity at 5bp: the pre-registered grid is 0/10/20bp (config.COSTS_BP). The same targets
and simulator are re-run at 5bp only; no parameter in config.py changes. The pre-registered costs
are recomputed as well and checked against results/results.json, so the 5bp row is on the same basis.
"""

from __future__ import annotations

import json

import numpy as np

from voldrag import backtest as B
from voldrag import config as C
from voldrag.data import load_market_data
from voldrag.run import RESULTS, _round, build_targets

EXPLORATORY_COSTS_BP = (5,)


def main() -> None:
    md = load_market_data()
    targets, signals, _ = build_targets(md)
    beta = signals["beta"].fillna(0.0)
    committed = json.loads((RESULTS / "results.json").read_text(encoding="utf-8"))["performance"]
    out: dict = {}
    for period, (start, end) in C.PERIODS.items():
        out[period] = {}
        formation = md.returns.index[md.returns.index < start][-1]
        for cost in sorted(set(C.COSTS_BP) | set(EXPLORATORY_COSTS_BP)):
            out[period][cost] = {}
            for name, tgt in targets.items():
                run = B.simulate(md.returns, tgt, start, end, cost, beta=beta if name == "proposed" else None)
                out[period][cost][name] = B.performance(run.net_returns, run.turnover, formation)
            if cost in C.COSTS_BP:  # basis check against the committed pre-registered run
                for name, perf in out[period][cost].items():
                    ref = committed[period][str(cost)][name]["cagr_pct"]
                    if not np.isclose(round(perf["cagr_pct"], 4), ref, atol=1e-4):
                        raise RuntimeError(f"basis mismatch {period}/{cost}/{name}: {perf['cagr_pct']} vs {ref}")
    payload = {
        "label": "EXPLORATORY: not pre-registered (PREREGISTRATION.md §8)",
        "exploratory_costs_bp": list(EXPLORATORY_COSTS_BP),
        "preregistered_costs_bp": list(C.COSTS_BP),
        "performance": out,
    }
    path = RESULTS / "exploratory_cost_sensitivity.json"
    path.write_text(json.dumps(_round(payload), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
