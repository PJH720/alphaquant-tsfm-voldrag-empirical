"""End-to-end run: data -> targets -> backtests -> metrics -> results/.  `python -m voldrag.run`"""

from __future__ import annotations

import json
import time
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from voldrag import backtest as B
from voldrag import config as C
from voldrag import models as M
from voldrag.data import MarketData, load_market_data

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

LABELS = {
    "6040": "Traditional 60/40",
    "ew": "Equal weight (1/N)",
    "mvo": "MVO (max Sharpe, 252d)",
    "ito_hist": "Itô-Kelly QP, historical moments",
    "ito_tsfm": "Itô-Kelly QP + Chronos moments",
    "proposed": "Proposed: Itô-Kelly + Chronos + NDE safeguard",
}
# Companion repo PJH720/alphaquant-tsfm-voldrag, data/backtest_results.json
# (table_4_1_strategy_performance, cost_sensitivity). These are SIMULATION PARAMETERS
# of the submitted paper, shown only for comparison.
PAPER = {
    "6040": {"cagr_pct": 7.85, "sigma_pct": 11.45, "sharpe": 0.51, "mdd_pct": -24.78, "theo_drag_pct": 0.66, "turnover_annual_pct": 24.15},
    "ew": {"cagr_pct": 8.42, "sigma_pct": 12.86, "sharpe": 0.50, "mdd_pct": -26.15, "theo_drag_pct": 0.83, "turnover_annual_pct": 18.3},
    "mvo": {"cagr_pct": 9.14, "sigma_pct": 13.28, "sharpe": 0.54, "mdd_pct": -28.65, "theo_drag_pct": 0.88, "turnover_annual_pct": 112.4},
    "proposed": {"cagr_pct": 14.82, "sigma_pct": 7.63, "sharpe": 1.68, "mdd_pct": -8.34, "theo_drag_pct": 0.29, "turnover_annual_pct": 46.8},
}
PAPER_PROPOSED_BY_COST = {0: (14.82, 1.68), 10: (14.63, 1.65), 20: (14.44, 1.63)}
PAPER_2020 = "safeguard trigger 2020-02-26, ~85% cash, MDD -4.12% (paper narrative)"


def _formations(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    return pd.DatetimeIndex([index[index < start][-1] for start, _ in C.PERIODS.values()])


def build_targets(md: MarketData) -> tuple[dict[str, B.Targets], pd.DataFrame, dict]:
    idx = md.returns.index
    first = min(C.PERIODS[p][0] for p in C.PERIODS)
    lookback_start = idx[idx < first][-15]  # a few weeks before the earliest formation
    weekly = B.last_trading_day(idx, "W")
    monthly = B.last_trading_day(idx, "M")
    weekly = weekly[weekly >= lookback_start].union(_formations(idx))
    monthly = monthly[monthly >= lookback_start].union(_formations(idx))

    w6040 = np.zeros(len(C.ASSETS))
    w6040[C.ASSETS.index("SP500")], w6040[C.ASSETS.index("KTB10Y")] = 0.6, 0.4
    targets = {
        "6040": B.fixed_targets(monthly, w6040),
        "ew": B.fixed_targets(monthly, np.full(len(C.ASSETS), 1 / len(C.ASSETS))),
    }
    t0 = time.time()
    targets["mvo"] = B.mvo_targets(md.returns, weekly)
    targets["ito_hist"] = B.ito_targets(md.returns, weekly)
    print(f"  historical targets: {time.time() - t0:.0f}s")
    t0 = time.time()
    chronos = M.ChronosMoments()
    targets["ito_tsfm"] = B.ito_targets(md.returns, weekly, chronos=chronos)
    chronos.save()
    targets["proposed"] = targets["ito_tsfm"]
    print(f"  Chronos targets: {time.time() - t0:.0f}s")

    guard = M.Safeguard(md.state)
    signals = guard.signals(md.state)
    diagnostics = {
        "n_weekly_decisions": len(weekly),
        "solver_status": {k: dict(Counter(t.status.values())) for k, t in targets.items()},
        "autoencoder_warmup_mse": guard.warmup_loss,
    }
    return targets, signals, diagnostics


def run_backtests(md: MarketData, targets: dict[str, B.Targets], beta: pd.Series):
    perf, runs = {}, {}
    for period, (start, end) in C.PERIODS.items():
        perf[period], runs[period] = {}, {}
        for cost in C.COSTS_BP:
            perf[period][cost], runs[period][cost] = {}, {}
            for name, tgt in targets.items():
                run = B.simulate(md.returns, tgt, start, end, cost,
                                 beta=beta if name == "proposed" else None)
                formation = md.returns.index[md.returns.index < start][-1]
                perf[period][cost][name] = B.performance(run.net_returns, run.turnover, formation)
                runs[period][cost][name] = run
    return perf, runs


def episodes(runs: dict, beta: pd.Series) -> dict:
    out = {}
    base = runs["primary"][C.BASE_COST_BP]
    for name, (start, end) in C.EPISODES.items():
        ep = {}
        for strat, run in base.items():
            r = run.net_returns.loc[start:end]
            wealth = (1 + r).cumprod()
            ep[strat] = {
                "return_pct": 100 * (wealth.iloc[-1] - 1),
                "mdd_pct": 100 * (wealth / np.maximum.accumulate(np.maximum(wealth, 1.0)) - 1).min(),
            }
        b = beta.loc[start:end]
        active = b[b > 0]
        ep["proposed_safeguard"] = {
            "days_beta_positive": int(len(active)),
            "first_trigger": str(active.index[0].date()) if len(active) else None,
            "max_beta": float(b.max()),
            "mean_cash_weight_pct": 100 * float(base["proposed"].weights.loc[start:end, "CASH"].mean()),
        }
        out[name] = ep
    return out


def _round(obj):
    if isinstance(obj, dict):
        return {str(k): _round(v) for k, v in obj.items()}
    if isinstance(obj, (float, np.floating)):
        return None if np.isnan(obj) else round(float(obj), 4)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    return obj


def write_outputs(md, perf, runs, boot, eps, signals, diagnostics, asset_stats) -> None:
    RESULTS.mkdir(exist_ok=True)
    for period in C.PERIODS:
        daily = pd.DataFrame({k: v.net_returns for k, v in runs[period][C.BASE_COST_BP].items()})
        daily.to_csv(RESULTS / f"daily_returns_{period}_{C.BASE_COST_BP}bp.csv", float_format="%.8f")
    signals.to_csv(RESULTS / "safeguard_signals.csv", float_format="%.6f")
    for period in C.PERIODS:
        runs[period][C.BASE_COST_BP]["proposed"].weights.to_csv(
            RESULTS / f"weights_{period}_{C.BASE_COST_BP}bp.csv", float_format="%.8f")
    payload = {
        "performance": perf, "bootstrap_proposed_vs_mvo": boot, "episodes": eps,
        "asset_statistics_secondary": asset_stats.to_dict(orient="index"),
        "diagnostics": diagnostics, "paper_simulation_parameters": PAPER,
    }
    (RESULTS / "results.json").write_text(json.dumps(_round(payload), indent=2, ensure_ascii=False))
    (RESULTS / "REPORT.md").write_text(render_report(perf, boot, eps, diagnostics, asset_stats))
    (ROOT / "DATA.md").write_text(render_data(md))


def _row(cells) -> str:
    return "| " + " | ".join(cells) + " |"


def _df_table(df: pd.DataFrame, digits: int = 3) -> list[str]:
    lines = [_row(["", *df.columns]), _row(["---"] + ["---:"] * len(df.columns))]
    for idx, row in df.iterrows():
        lines.append(_row([str(idx), *[f"{v:.{digits}f}" for v in row.astype(float)]]))
    return lines


def render_report(perf, boot, eps, diagnostics, asset_stats) -> str:
    lines = ["# Results: real-data reproduction", "",
             "Generated by `python -m voldrag.run`. Every number below is computed from market data "
             "under PREREGISTRATION.md. The paper's figures are simulation parameters, shown for comparison only.", ""]
    for period, (start, end) in C.PERIODS.items():
        note = " (safeguard in-sample 2015–2016)" if period == "secondary" else " (fully out-of-sample)"
        lines += [f"## {period.title()} period {start} → {end}{note}, {C.BASE_COST_BP}bp", "",
                  _row(["Strategy", "CAGR %", "σ %", "Sharpe", "Sortino", "MDD %", "Calmar",
                        "CVaR95 d %", "Turnover %/y", "Emp. drag %", "½σ² %"]),
                  _row(["---"] + ["---:"] * 10)]
        for k, p in perf[period][C.BASE_COST_BP].items():
            lines.append(_row([LABELS[k]] + [f"{p[m]:.2f}" for m in (
                "cagr_pct", "sigma_pct", "sharpe", "sortino", "mdd_pct", "calmar",
                "cvar95_daily_pct", "turnover_annual_pct", "emp_drag_pct", "theo_drag_pct")]))
        lines.append("")

    lines += ["## Paper (simulation parameters) vs reproduced: secondary period, 10bp", "",
              _row(["Strategy", "CAGR paper", "CAGR real", "σ paper", "σ real", "Sharpe paper",
                    "Sharpe real", "MDD paper", "MDD real"]), _row(["---"] + ["---:"] * 8)]
    for k, p in PAPER.items():
        r = perf["secondary"][C.BASE_COST_BP][k]
        lines.append(_row([LABELS[k], f"{p['cagr_pct']:.2f}", f"{r['cagr_pct']:.2f}", f"{p['sigma_pct']:.2f}",
                           f"{r['sigma_pct']:.2f}", f"{p['sharpe']:.2f}", f"{r['sharpe']:.2f}",
                           f"{p['mdd_pct']:.2f}", f"{r['mdd_pct']:.2f}"]))
    lines += ["", "## Transaction-cost sensitivity: proposed model", "",
              _row(["Cost", "Period", "CAGR real", "Sharpe real", "CAGR paper", "Sharpe paper"]),
              _row(["---"] * 2 + ["---:"] * 4)]
    for period in C.PERIODS:
        for cost in C.COSTS_BP:
            r = perf[period][cost]["proposed"]
            pc, ps = PAPER_PROPOSED_BY_COST[cost]
            lines.append(_row([f"{cost}bp", period, f"{r['cagr_pct']:.2f}", f"{r['sharpe']:.2f}", f"{pc:.2f}", f"{ps:.2f}"]))
    lines += ["", "## Significance: Sharpe(proposed) − Sharpe(MVO), circular block bootstrap", "",
              _row(["Period", "Δ Sharpe", "95% CI", "p-value", "Block", "B"]), _row(["---"] + ["---:"] * 5)]
    for period, b in boot.items():
        lines.append(_row([period, f"{b['sharpe_diff']:.3f}", f"[{b['ci95'][0]:.3f}, {b['ci95'][1]:.3f}]",
                           f"{b['p_value']:.4f}", str(b["block"]), str(b["n_boot"])]))
    lines += ["", "## Crisis episodes (primary run, 10bp)", ""]
    for name, ep in eps.items():
        sg = ep["proposed_safeguard"]
        lines += [f"### {name}", "", _row(["Strategy", "Return %", "MDD %"]), _row(["---", "---:", "---:"])]
        lines += [_row([LABELS[k], f"{v['return_pct']:.2f}", f"{v['mdd_pct']:.2f}"])
                  for k, v in ep.items() if k in LABELS]
        lines += ["", f"Safeguard: β>0 on {sg['days_beta_positive']} days, first trigger "
                  f"{sg['first_trigger']}, max β {sg['max_beta']:.2f}, mean cash weight "
                  f"{sg['mean_cash_weight_pct']:.1f}%."]
        if name == "2020_pandemic":
            lines.append(f"Paper narrative for comparison: {PAPER_2020}.")
        lines.append("")
    lines += ["## Asset statistics (secondary period)", "", *_df_table(asset_stats), "",
              "## Diagnostics", "", "```json", json.dumps(_round(diagnostics), indent=2), "```", ""]
    return "\n".join(lines)


def render_data(md: MarketData) -> str:
    lines = ["# Data", "", "Generated by `python -m voldrag.run`. Raw vendor files are not committed; "
             "`data/manifest.json` records their SHA-256.", "",
             f"- Return sample: {md.returns.index[0].date()} → {md.returns.index[-1].date()}, "
             f"{len(md.returns)} KRX trading days", "",
             "## Deviations from the paper's universe", ""]
    lines += [f"- {d}" for d in md.deviations]
    lines += ["", "## Source coverage", "", _row(["Source", "Diagnostics"]), _row(["---", "---"])]
    lines += [_row([k, ", ".join(f"{a}={b}" for a, b in v.items())]) for k, v in md.coverage.items()]
    lines += ["", "`adjustment_steps` counts days where adjusted/close changes (distributions captured). "
              "`max_staleness_days` is the largest calendar gap between a KRX date and the US/FX "
              "observation used for it.", ""]
    return "\n".join(lines)


def main() -> None:
    t0 = time.time()
    print("Loading data ...")
    md = load_market_data()
    print("Building targets ...")
    targets, signals, diagnostics = build_targets(md)
    beta = signals["beta"].fillna(0.0)
    print("Backtesting ...")
    perf, runs = run_backtests(md, targets, beta)
    boot = {p: B.block_bootstrap_sharpe_diff(runs[p][C.BASE_COST_BP]["proposed"].net_returns,
                                              runs[p][C.BASE_COST_BP]["mvo"].net_returns)
            for p in C.PERIODS}
    eps = episodes(runs, beta)
    start, end = C.PERIODS["secondary"]
    asset_stats = B.asset_statistics(md.returns.loc[start:end])
    write_outputs(md, perf, runs, boot, eps, signals, diagnostics, asset_stats)
    print(f"Done in {time.time() - t0:.0f}s -> {RESULTS / 'REPORT.md'}")


if __name__ == "__main__":
    main()
