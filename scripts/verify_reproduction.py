"""Compare a re-run results.json against the committed one (post-results tooling; CHANGELOG "Post-results additions").

    uv run python scripts/verify_reproduction.py <committed results.json> <rerun results.json>

Walks both JSON trees and compares every leaf. Strings, integers and booleans must be identical
(first_trigger, days_beta_positive, solver status counts, n_weekly_decisions, ...). Floats get an
absolute tolerance by key, taken from the max |Δ| table in results/cross_platform_ubuntu_cuda.md
with headroom. It then checks that every displayed value is unchanged after rounding: CAGR, σ,
Sharpe and MDD to 2 dp for both periods × 0/10/20bp × 6 strategies, and the bootstrap p to 3 dp.
Prints the max |Δ| per key and exits 1 if anything is outside tolerance.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

FLOAT_TOL = {
    "cagr_pct": 0.001, "mu_arith_pct": 0.001, "sigma_pct": 0.001, "mdd_pct": 0.001,
    "emp_drag_pct": 0.001, "theo_drag_pct": 0.001, "return_pct": 0.001, "mu_geom_log_pct": 0.001,
    "wealth_loss_10y": 0.001, "cvar95_daily_pct": 0.001,
    "sharpe": 0.0005, "sortino": 0.0005, "calmar": 0.001, "sharpe_diff": 0.0005, "ci95": 0.005,
    "turnover_annual_pct": 0.05,
    "p_value": 0.001,
    "mean_cash_weight_pct": 0.005,
    "jb_stat": 0.1, "skewness": 0.001, "excess_kurtosis": 0.001, "adf_stat": 0.001,
}
# Floats that are counts or configuration in disguise: must be identical.
EXACT_FLOATS = {"n_obs", "years", "max_beta", "autoencoder_warmup_mse"}
DISPLAY = {"cagr_pct": 2, "sigma_pct": 2, "sharpe": 2, "mdd_pct": 2}
STRATEGIES = ("6040", "ew", "mvo", "ito_hist", "ito_tsfm", "proposed")


def leaf_key(path: tuple) -> str:
    """The tolerance key of a leaf: its last string segment (ci95[i] -> 'ci95')."""
    return next(p for p in reversed(path) if isinstance(p, str))


def walk(a, b, path=()):
    """Yield (path, a_leaf, b_leaf); a missing side is yielded as KeyError."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b), key=str):
            yield from walk(a.get(k, KeyError), b.get(k, KeyError), (*path, k))
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            yield from walk(x, y, (*path, i))
    else:
        yield path, a, b


def fmt_path(path: tuple) -> str:
    return "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in path).lstrip(".")


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    committed = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    rerun = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))

    failures: list[str] = []
    max_delta: dict[str, float] = defaultdict(float)
    n_leaves = 0
    for path, a, b in walk(committed, rerun):
        n_leaves += 1
        where = fmt_path(path)
        if a is KeyError or b is KeyError:
            failures.append(f"structure: {where} present in only one file")
            continue
        if isinstance(a, float) or isinstance(b, float):
            if not isinstance(a, (int, float)) or not isinstance(b, (int, float)) or isinstance(a, bool):
                failures.append(f"type: {where}: {a!r} vs {b!r}")
                continue
            key = leaf_key(path)
            d = abs(float(a) - float(b)) if not (math.isnan(a) and math.isnan(b)) else 0.0
            max_delta[key] = max(max_delta[key], d)
            tol = 0.0 if key in EXACT_FLOATS else FLOAT_TOL.get(key)
            if tol is None:
                failures.append(f"no tolerance defined for float key '{key}' at {where} (Δ={d:.3g})")
            elif d > tol:
                failures.append(f"tolerance: {where}: {a} vs {b} (|Δ|={d:.6g} > {tol})")
        elif a != b or type(a) is not type(b):
            failures.append(f"exact: {where}: {a!r} vs {b!r}")

    # Displayed values: unchanged after rounding.
    n_display = 0
    for period in ("primary", "secondary"):
        for cost in ("0", "10", "20"):
            for s in STRATEGIES:
                for key, d in DISPLAY.items():
                    a = committed["performance"][period][cost][s][key]
                    b = rerun["performance"][period][cost][s][key]
                    n_display += 1
                    if round(a, d) != round(b, d):
                        failures.append(f"display: performance.{period}.{cost}.{s}.{key}: "
                                        f"{a:.{d}f} vs {b:.{d}f}")
        a = committed["bootstrap_proposed_vs_mvo"][period]["p_value"]
        b = rerun["bootstrap_proposed_vs_mvo"][period]["p_value"]
        n_display += 1
        if round(a, 3) != round(b, 3):
            failures.append(f"display: bootstrap_proposed_vs_mvo.{period}.p_value: {a:.3f} vs {b:.3f}")

    print(f"Compared {n_leaves} leaves; {n_display} displayed values (2 dp; bootstrap p 3 dp).")
    print("\nmax |Δ| per float key (tolerance):")
    for key in sorted(max_delta):
        tol = 0.0 if key in EXACT_FLOATS else FLOAT_TOL.get(key)
        flag = "" if tol is not None and max_delta[key] <= tol else "  <-- OUT"
        print(f"  {key:24s} {max_delta[key]:.3g}  (tol {tol}){flag}")
    if failures:
        print(f"\nFAIL: {len(failures)} difference(s) outside tolerance:")
        for f in failures:
            print("  " + f)
        return 1
    print("\nPASS: every leaf within tolerance; every displayed value unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
