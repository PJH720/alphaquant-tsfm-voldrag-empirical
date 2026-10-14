"""Slide figure for the EXPLORATORY L1 turnover penalty; the computation is voldrag.exploratory_turnover.

    uv run python scripts/turnover_regularization.py [--lambdas ...] [--tag extended]

Re-runs voldrag.exploratory_turnover (which asserts lambda_tc = 0 reproduces results/results.json)
and writes, in results/: exploratory_turnover_penalty[_TAG].json, exploratory_turnover_regularization[_TAG].md
and backup_slide27_turnover_regularization[_TAG].png (300 dpi, twin axes: net Sharpe at 10bp, annual turnover).
Not pre-registered (PREREGISTRATION.md §8): lambda_tc was chosen after the results were seen.
"""

from __future__ import annotations

import argparse
import json
import time

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from voldrag import config as C
from voldrag import exploratory_turnover as TO
from voldrag.run import RESULTS, _round

LAMBDAS = TO.LAMBDAS_TC
STRATEGIES = TO.STRATEGIES


def frontier(results: dict, period: str, name: str) -> pd.DataFrame:
    base_to = results[0.0][period][0][name]["turnover_annual_pct"]
    rows = []
    for lam, p in results.items():
        q = {cost: p[period][cost][name] for cost in C.COSTS_BP}
        rows.append({
            "lambda_tc": lam,
            "turnover_pct": q[0]["turnover_annual_pct"],
            "turnover_change_pct": 100 * (q[0]["turnover_annual_pct"] / base_to - 1),
            "gross_cagr_pct": q[0]["cagr_pct"], "gross_sharpe": q[0]["sharpe"],
            "net10_cagr_pct": q[10]["cagr_pct"], "net10_sharpe": q[10]["sharpe"],
            "net20_cagr_pct": q[20]["cagr_pct"], "net20_sharpe": q[20]["sharpe"],
            "mdd10_pct": q[10]["mdd_pct"],
        })
    return pd.DataFrame(rows)


def markdown(df: pd.DataFrame) -> str:
    head = ("| λ_tc | Turnover %/y | Δ vs λ=0 | Gross CAGR % | Gross Sharpe | Net CAGR % (10bp) | "
            "Net Sharpe (10bp) | Net CAGR % (20bp) | Net Sharpe (20bp) |")
    lines = [head, "|" + "---:|" * 9]
    for r in df.itertuples():
        tag = " (pre-registered)" if r.lambda_tc == 0 else ""
        lines.append(f"| {r.lambda_tc:.4f}{tag} | {r.turnover_pct:,.1f} | {r.turnover_change_pct:+.1f}% | "
                     f"{r.gross_cagr_pct:.2f} | {r.gross_sharpe:.3f} | {r.net10_cagr_pct:.2f} | {r.net10_sharpe:.3f} | "
                     f"{r.net20_cagr_pct:.2f} | {r.net20_sharpe:.3f} |")
    return "\n".join(lines)


def plot(df: pd.DataFrame, refs: dict[str, float], period: str, path) -> None:
    navy, gray, ink = "#1d2f5c", "#b9b8b0", "#4a4c52"
    x = np.arange(len(df))
    fig, ax = plt.subplots(figsize=(10, 6.2))
    ax2 = ax.twinx()
    ax.set_zorder(ax2.get_zorder() + 1)
    ax.patch.set_visible(False)
    bars = ax2.bar(x, df["turnover_pct"], width=0.55, color=gray, label="Annual turnover (right)")
    for xi, v in zip(x, df["turnover_pct"]):
        ax2.annotate(f"{v:,.0f}%", (xi, 0), xytext=(0, 4), textcoords="offset points", ha="center", va="bottom",
                     fontsize=9, color=ink)
    line, = ax.plot(x, df["net10_sharpe"], color=navy, lw=2.5, marker="o", ms=8, label="Net Sharpe, 10bp (left)")
    for xi, v in zip(x, df["net10_sharpe"]):
        ax.annotate(f"{v:.2f}", (xi, v), xytext=(0, 10), textcoords="offset points", ha="center", fontsize=10,
                    color=navy, fontweight="bold", bbox={"boxstyle": "round,pad=0.15", "fc": "white", "ec": "none", "alpha": 0.85})
    handles = [line, bars]
    for (name, val), ls in zip(refs.items(), ("--", ":")):
        handles.append(ax.axhline(val, color=ink, lw=1.2, ls=ls, label=f"{name} net Sharpe 10bp = {val:.2f}"))
    ax.set_xticks(x, [f"{v:g}" for v in df["lambda_tc"]])
    ax.set_xlabel("L1 turnover penalty λ_tc (annualized objective units)")
    ax.set_ylabel("Net Sharpe ratio (10bp costs)", color=navy)
    ax2.set_ylabel("Annual turnover (%)", color=ink)
    lo = min(df["net10_sharpe"].min(), *refs.values())
    hi = max(df["net10_sharpe"].max(), *refs.values())
    ax.set_ylim(lo - 0.15 * (hi - lo + 0.1), hi + 0.25 * (hi - lo + 0.1))
    ax2.set_ylim(0, df["turnover_pct"].max() * 1.18)
    ax.grid(axis="y", color="#e6e4dd")
    start, end = C.PERIODS[period]
    ax.set_title(f"Turnover regularization of the proposed model, {start[:4]}–{end[:4]} ({period} period)\n"
                 "EXPLORATORY, post-results: λ_tc is not pre-registered; λ_tc = 0 reproduces results.json",
                 fontsize=11, loc="left")
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.13), ncol=2, fontsize=9, frameon=False)
    for spine in ("top",):
        ax.spines[spine].set_visible(False)
        ax2.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=300)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser(description="Slide figure for the exploratory L1 turnover penalty")
    ap.add_argument("--lambdas", type=float, nargs="+", default=list(LAMBDAS))
    ap.add_argument("--plot-period", choices=list(C.PERIODS), default="primary")
    ap.add_argument("--tag", default="", help="suffix for output files, e.g. 'extended'")
    args = ap.parse_args()
    sfx = f"_{args.tag}" if args.tag else ""

    t0 = time.time()
    payload = TO.run(args.lambdas)  # asserts lambda_tc = 0 reproduces results.json
    (RESULTS / f"exploratory_turnover_penalty{sfx}.json").write_text(
        json.dumps(_round(payload), indent=2, ensure_ascii=False), encoding="utf-8")
    results = payload["results"]

    committed = json.loads((RESULTS / "results.json").read_text(encoding="utf-8"))["performance"]
    tables = {(period, name): frontier(results, period, name) for period in C.PERIODS for name in STRATEGIES}
    p = args.plot_period
    refs = {"MVO": committed[p]["10"]["mvo"]["sharpe"], "60/40": committed[p]["10"]["6040"]["sharpe"]}
    png = RESULTS / f"backup_slide27_turnover_regularization{sfx}.png"
    plot(tables[(p, "proposed")], refs, p, png)

    md_lines = [
        "# Turnover regularization (EXPLORATORY)", "",
        f"{TO.LABEL}. Not pre-registered (PREREGISTRATION.md §8); λ_tc was chosen after the results were seen.",
        ("Generated by `scripts/turnover_regularization.py` from `voldrag.exploratory_turnover`. "
         "λ_tc = 0 is the pre-registered model and is checked against `results/results.json`."),
        "",
    ]
    for (period, name), df in tables.items():
        start, end = C.PERIODS[period]
        md_lines += [f"## {name}, {period} period {start} → {end}", "", markdown(df), ""]
    (RESULTS / f"exploratory_turnover_regularization{sfx}.md").write_text("\n".join(md_lines), encoding="utf-8")
    print(f"\n## proposed, {p} period\n\n{markdown(tables[(p, 'proposed')])}\n")
    print(f"Wrote {png.name}, exploratory_turnover_regularization{sfx}.md, exploratory_turnover_penalty{sfx}.json "
          f"in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
