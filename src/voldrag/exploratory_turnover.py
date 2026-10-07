"""EXPLORATORY analyses, not in PREREGISTRATION.md (§8: labelled exploratory).  `python -m voldrag.exploratory_turnover`

L1 turnover penalty on the Itô-Kelly QP. Post-results: lambda_tc was introduced after the
pre-registered results showed ~2,800% annual turnover, so nothing here replaces those results.

The pre-registered QP (eqs. 30-31) is re-solved on the same weekly decision dates, Chronos moments,
CVaR scenarios and bounds, with one extra term:

    min_w  1/2 w'Sw - mu'w + lambda_tc * ||w - w_prev||_1
    s.t.   sum(w) = 1,  0 <= w <= W_CAP,  CVaR_alpha(w) <= CVaR_alpha(equal weight)

mu and S are annualized. w_prev is the previous decision's solution drifted with realized returns
up to the current decision date, so it uses only data dated at or before the decision. The
safeguard overlay, costs, periods and metrics are unchanged. lambda_tc = 0 is the pre-registered
model; the run checks it against results/results.json before writing anything.
"""

from __future__ import annotations

import argparse
import json

import cvxpy as cp
import numpy as np
import pandas as pd

from voldrag import backtest as B
from voldrag import config as C
from voldrag import models as M
from voldrag.data import load_market_data
from voldrag.run import RESULTS, _round, build_targets

LAMBDAS_TC = (0.0, 0.0005, 0.0010, 0.0020, 0.0050)
STRATEGIES = {"proposed": True, "ito_tsfm": False}  # name -> safeguard overlay applied
LABEL = "EXPLORATORY: L1 Turnover Penalty Regularization"
OUTPUT = RESULTS / "exploratory_turnover_penalty.json"


def ito_kelly_turnover_qp(mu: np.ndarray, cov: np.ndarray, scenarios: np.ndarray, prev_w: np.ndarray | None,
                          lambda_tc: float, cap: float = C.W_CAP, alpha: float = C.ALPHA) -> tuple[np.ndarray, str]:
    """models.ito_kelly_qp plus lambda_tc * ||w - prev_w||_1; the same problem when lambda_tc == 0 or prev_w is None."""
    n, k = len(mu), len(scenarios)
    ew = np.full(n, 1.0 / n)
    gamma = M.cvar(-scenarios @ ew, alpha)
    w, z, u = cp.Variable(n), cp.Variable(), cp.Variable(k, nonneg=True)
    constraints = [
        cp.sum(w) == 1, w >= 0, w <= cap,
        u >= -scenarios @ w - z,
        z + cp.sum(u) / ((1.0 - alpha) * k) <= gamma,
    ]
    psd = cp.psd_wrap((cov + cov.T) / 2)
    objective = 0.5 * cp.quad_form(w, psd) - mu @ w
    if lambda_tc > 0 and prev_w is not None:
        objective = objective + lambda_tc * cp.norm1(w - prev_w)
    problem = cp.Problem(cp.Minimize(objective), constraints)
    try:
        problem.solve(solver=cp.CLARABEL)
    except cp.SolverError:
        return ew, "solver_error->ew"
    if problem.status not in M.SOLVER_OK or w.value is None:
        return ew, f"{problem.status}->ew"
    w_clean = np.clip(w.value, 0.0, None)
    return w_clean / w_clean.sum(), problem.status


def decision_inputs(returns: pd.DataFrame, dates: list[pd.Timestamp]) -> dict:
    """Pre-registered QP inputs per decision date: Chronos mu/sigma, Ledoit-Wolf + Higham correlation, scenarios."""
    chronos = M.ChronosMoments()
    out = {}
    for d in dates:
        win = returns.loc[:d].iloc[-C.W_ITO:].to_numpy()
        _, _, corr = M.historical_moments(win)
        mu, sigma = chronos.moments(d, win)
        out[d] = (mu, corr * np.outer(sigma, sigma), win)
    return out


def turnover_targets(returns: pd.DataFrame, inputs: dict, lambda_tc: float) -> B.Targets:
    """Sequential weekly decisions, each penalized against the previous solution drifted to the decision date."""
    t = B.Targets()
    w_prev, d_prev = None, None
    for d, (mu, cov, win) in inputs.items():
        drifted = None
        if w_prev is not None:
            growth = (1.0 + returns.loc[d_prev:d].iloc[1:]).prod().to_numpy()
            drifted = w_prev * growth / float(w_prev @ growth)
        t.weights[d], t.status[d] = ito_kelly_turnover_qp(mu, cov, win, drifted, lambda_tc)
        w_prev, d_prev = t.weights[d], d
    return t


def evaluate(returns: pd.DataFrame, targets: B.Targets, beta: pd.Series) -> dict:
    """performance[period][cost][strategy] -> backtest.performance dict (same layout as exploratory.py)."""
    out: dict = {}
    for period, (start, end) in C.PERIODS.items():
        formation = returns.index[returns.index < start][-1]
        out[period] = {}
        for cost in C.COSTS_BP:
            out[period][cost] = {}
            for name, overlay in STRATEGIES.items():
                run = B.simulate(returns, targets, start, end, cost, beta=beta if overlay else None)
                out[period][cost][name] = B.performance(run.net_returns, run.turnover, formation)
    return out


def check_baseline(perf: dict) -> None:
    """lambda_tc = 0 must reproduce the committed pre-registered run."""
    committed = json.loads((RESULTS / "results.json").read_text(encoding="utf-8"))["performance"]
    for period, by_cost in perf.items():
        for cost, by_name in by_cost.items():
            for name, p in by_name.items():
                for key in ("cagr_pct", "sharpe", "mdd_pct", "turnover_annual_pct"):
                    ref = committed[period][str(cost)][name][key]
                    if not np.isclose(round(p[key], 4), ref, atol=1e-4):
                        raise RuntimeError(f"basis mismatch {period}/{cost}/{name}/{key}: {p[key]} vs {ref}")


def run(lambdas: list[float]) -> dict:
    lambdas = sorted({0.0, *lambdas})
    md = load_market_data()
    targets, signals, _ = build_targets(md)
    beta = signals["beta"].fillna(0.0)
    inputs = decision_inputs(md.returns, sorted(targets["ito_tsfm"].weights))
    results, status = {}, {}
    for lam in lambdas:
        tgt = turnover_targets(md.returns, inputs, lam)
        results[lam] = evaluate(md.returns, tgt, beta)
        status[lam] = dict(pd.Series(list(tgt.status.values())).value_counts())
        if lam == 0.0:
            check_baseline(results[lam])
        p = results[lam]["primary"][C.BASE_COST_BP]["proposed"]
        print(f"  lambda_tc={lam:g}: proposed primary {C.BASE_COST_BP}bp turnover {p['turnover_annual_pct']:.1f}%/y, "
              f"CAGR {p['cagr_pct']:.2f}%, Sharpe {p['sharpe']:.3f}")
    return {
        "label": LABEL,
        "note": "Not pre-registered (PREREGISTRATION.md §8); lambda_tc chosen after results were seen. "
                "lambda_tc = 0 is the pre-registered model and reproduces results/results.json.",
        "formulation": "min 1/2 w'Sw - mu'w + lambda_tc*||w - w_prev||_1 s.t. sum(w)=1, 0<=w<=W_CAP, "
                       "CVaR_alpha(w) <= CVaR_alpha(EW); w_prev = previous solution drifted to the decision date",
        "lambdas": lambdas,
        "preregistered_costs_bp": list(C.COSTS_BP),
        "strategies": {name: ("with safeguard overlay" if overlay else "QP only") for name, overlay in STRATEGIES.items()},
        "solver_status": status,
        "results": results,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="EXPLORATORY: L1 turnover penalty on the Itô-Kelly QP")
    ap.add_argument("--lambdas", type=float, nargs="+", default=list(LAMBDAS_TC))
    ap.add_argument("--output", default=str(OUTPUT))
    args = ap.parse_args()
    payload = run(args.lambdas)
    path = RESULTS / args.output if "/" not in args.output else type(OUTPUT)(args.output)
    path.write_text(json.dumps(_round(payload), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
