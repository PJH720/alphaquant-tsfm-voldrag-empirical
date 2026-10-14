#!/usr/bin/env python3
"""generate_backup_slide27_chart.py

Backup Slide 27 chart: L1 turnover-penalty grid (EXPLORATORY).

Every plotted number is read from the empirical results files; nothing is
hard-coded, and the script exits with an error if either file is missing.

  - results/exploratory_turnover_regularization.json : full lambda_tc grid
    (0 ... 0.5). Not pre-registered (PREREGISTRATION.md §8): the grid was chosen
    after the results were seen. lambda_tc = 0 reproduces results/results.json.
  - results/results.json : pre-registered run (benchmark Sharpe ratios and
    per-strategy annual turnover).

Series: primary period (2017-01-02 -> 2026-08-31, fully out-of-sample),
10bp cost, strategy `proposed` (Itô-Kelly + Chronos + NDE safeguard), with
`ito_tsfm` (same QP, no safeguard) used to separate QP turnover from
safeguard turnover.

Outputs (16:9, 300 DPI):
  - backup_slide27_turnover_frontier.png       (light theme)
  - backup_slide27_turnover_frontier_dark.png  (dark theme)
"""

import argparse
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import FuncFormatter, MaxNLocator

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
DEFAULT_ICLOUD_DIR = Path(
    "/Users/pj/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault_Inbox/261007) 경제 학술 회의 제출 기한/발표자료"
)
EMPIRICAL_RESULTS_DIR = Path("/Users/pj/dev/alphaquant-tsfm-voldrag-empirical/results")
MAIN_REPO_RESULTS_DIR = Path("/Users/pj/dev/alphaquant-tsfm-voldrag/results")
FRONTIER_CANDIDATES = (
    Path("results/exploratory_turnover_regularization.json"),
    EMPIRICAL_RESULTS_DIR / "exploratory_turnover_regularization.json",
)
RESULTS_CANDIDATES = (
    Path("results/results.json"),
    EMPIRICAL_RESULTS_DIR / "results.json",
)
LIGHT_FILENAME = "backup_slide27_turnover_frontier.png"
DARK_FILENAME = "backup_slide27_turnover_frontier_dark.png"

# ---------------------------------------------------------------------------
# Which slice of the results is plotted
# ---------------------------------------------------------------------------
PERIOD = "primary"
COST_BP = "10"
STRATEGY = "proposed"
QP_ONLY_STRATEGY = "ito_tsfm"
BENCHMARKS = (("mvo", "MVO"), ("ew", "Equal weight"), ("6040", "60/40"))
BENCHMARK_LINESTYLES = (":", "-.", "--")
TURNOVER_STRATEGIES = (
    ("6040", "60/40"),
    ("ew", "Equal weight"),
    ("ito_hist", "Itô-Kelly QP\n(historical μ)"),
    ("mvo", "MVO"),
    ("ito_tsfm", "Itô-Kelly QP\n(Chronos μ)"),
    ("proposed", "Proposed\n(+ NDE safeguard)"),
)
HIGHLIGHTED_STRATEGIES = frozenset({"ito_tsfm", "proposed"})
MATCH_TOLERANCE = 1e-9

THEMES = {
    "light": {
        "fig_bg": "#ffffff",
        "ax_bg": "#f8fafc",
        "text": "#0f172a",
        "text_muted": "#475569",
        "grid": "#e2e8f0",
        "spine": "#cbd5e1",
        "sharpe": "#1e3a8a",
        "turnover": "#dc2626",
        "bench": "#64748b",
        "bar_muted": "#94a3b8",
        "marker_edge": "#ffffff",
        "highlight": "#059669",
        "box_bg": "#fff7ed",
        "box_edge": "#ea580c",
        "badge_bg": "#f1f5f9",
    },
    "dark": {
        "fig_bg": "#0b0f19",
        "ax_bg": "#111827",
        "text": "#f8fafc",
        "text_muted": "#94a3b8",
        "grid": "#1f2937",
        "spine": "#374151",
        "sharpe": "#38bdf8",
        "turnover": "#f87171",
        "bench": "#94a3b8",
        "bar_muted": "#475569",
        "marker_edge": "#0b0f19",
        "highlight": "#10b981",
        "box_bg": "#2a1a0e",
        "box_edge": "#fb923c",
        "badge_bg": "#1e293b",
    },
}


@dataclass(frozen=True)
class Frontier:
    lambdas: np.ndarray
    turnover_pct: np.ndarray
    sharpe: np.ndarray


# ---------------------------------------------------------------------------
# Data loading (fail closed: no fallback data)
# ---------------------------------------------------------------------------
def resolve_input(explicit: Path | None, candidates: tuple[Path, ...], label: str) -> Path:
    paths = (explicit,) if explicit else candidates
    for path in paths:
        if path.exists():
            return path
    tried = ", ".join(str(p) for p in paths)
    raise SystemExit(f"[ERROR] {label} not found (tried: {tried}). Refusing to plot without data.")


def read_json(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"[ERROR] Cannot read {path}: {exc}") from exc


def load_frontier(data: dict, path: Path, strategy: str) -> Frontier:
    rows = []
    for lam in data.get("lambdas", []):
        try:
            node = data["results"][str(lam)][PERIOD][COST_BP][strategy]
        except KeyError as exc:
            raise SystemExit(
                f"[ERROR] {path}: missing results[{lam}][{PERIOD}][{COST_BP}][{strategy}] ({exc})"
            ) from exc
        rows.append((float(lam), float(node["turnover_annual_pct"]), float(node["sharpe"])))

    rows.sort()
    if len(rows) < 2 or rows[0][0] != 0.0:
        raise SystemExit(f"[ERROR] {path}: need lambda_tc = 0 plus at least one penalised point.")
    lambdas, turnover, sharpe = (np.array(col) for col in zip(*rows))
    return Frontier(lambdas=lambdas, turnover_pct=turnover, sharpe=sharpe)


def load_performance(path: Path) -> dict:
    data = read_json(path)
    required = {key for key, _ in BENCHMARKS} | {key for key, _ in TURNOVER_STRATEGIES}
    try:
        perf = data["performance"][PERIOD][COST_BP]
        missing = [
            key for key in sorted(required)
            if "sharpe" not in perf[key] or "turnover_annual_pct" not in perf[key]
        ]
    except KeyError as exc:
        raise SystemExit(f"[ERROR] {path}: missing performance[{PERIOD}][{COST_BP}] entry ({exc})") from exc
    if missing:
        raise SystemExit(f"[ERROR] {path}: sharpe/turnover missing for {missing}")
    return perf


def check_baseline(frontier: Frontier, perf: dict) -> None:
    """lambda_tc = 0 must reproduce the pre-registered run exactly."""
    expected = perf[STRATEGY]
    sharpe_ok = abs(frontier.sharpe[0] - expected["sharpe"]) < MATCH_TOLERANCE
    turnover_ok = abs(frontier.turnover_pct[0] - expected["turnover_annual_pct"]) < MATCH_TOLERANCE
    if not (sharpe_ok and turnover_ok):
        raise SystemExit(
            "[ERROR] lambda_tc = 0 does not match results.json "
            f"(sharpe {frontier.sharpe[0]} vs {expected['sharpe']}, "
            f"turnover {frontier.turnover_pct[0]} vs {expected['turnover_annual_pct']})."
        )
    print("[CHECK] lambda_tc = 0 matches the pre-registered results.json.")


# ---------------------------------------------------------------------------
# Plotting
# ---------------------------------------------------------------------------
def setup_typography() -> None:
    plt.rcParams["font.family"] = ["Apple SD Gothic Neo", "Helvetica Neue", "Arial", "sans-serif"]
    plt.rcParams["axes.unicode_minus"] = False


def style_axis(ax, c: dict) -> None:
    ax.set_facecolor(c["ax_bg"])
    ax.spines["top"].set_visible(False)
    for side in ("left", "bottom", "right"):
        ax.spines[side].set_color(c["spine"])
        ax.spines[side].set_linewidth(1.2)


def plot_frontier(ax1, frontier: Frontier, perf: dict, c: dict) -> list:
    """Grid points are evenly spaced (the lambda grid is not uniform)."""
    x = np.arange(len(frontier.lambdas))
    ax2 = ax1.twinx()
    style_axis(ax2, c)
    ax1.set_zorder(ax2.get_zorder() + 1)
    ax1.patch.set_visible(False)

    line_sharpe, = ax1.plot(
        x, frontier.sharpe, color=c["sharpe"], linewidth=3.0, marker="o", markersize=9,
        markeredgecolor=c["marker_edge"], markeredgewidth=2.0,
        label="Proposed: net Sharpe, 10bp [left axis]",
    )
    best = int(np.argmax(frontier.sharpe))
    for i, (xi, value) in enumerate(zip(x, frontier.sharpe)):
        ax1.annotate(f"{value:.2f}", (xi, value), xytext=(0, 18 if i == best else 11),
                     textcoords="offset points", ha="center", fontsize=9.5, fontweight="bold",
                     color=c["sharpe"])
    line_turnover, = ax2.plot(
        x, frontier.turnover_pct, color=c["turnover"], linewidth=2.6, linestyle="--", marker="s",
        markersize=8, markeredgecolor=c["marker_edge"], markeredgewidth=1.8,
        label="Proposed: annual turnover % [right axis]",
    )
    bench_lines = [
        ax1.axhline(
            perf[key]["sharpe"], color=c["bench"], linestyle=style, linewidth=1.6, alpha=0.9,
            label=f"{name} net Sharpe, 10bp = {perf[key]['sharpe']:.2f}",
        )
        for (key, name), style in zip(BENCHMARKS, BENCHMARK_LINESTYLES)
    ]

    ax1.scatter([x[best]], [frontier.sharpe[best]], s=420, facecolors="none",
                edgecolors=c["highlight"], linewidths=2.6, zorder=6)

    sharpe_values = [*frontier.sharpe, *(perf[key]["sharpe"] for key, _ in BENCHMARKS)]
    ax1.set_ylim(min(sharpe_values) - 0.30, max(sharpe_values) + 0.12)
    ax2.set_ylim(0, frontier.turnover_pct.max() * 1.15)
    ax1.set_xlim(-0.5, len(x) - 0.5)
    ax1.set_xticks(x, [f"{lam:g}" for lam in frontier.lambdas])

    ax1.set_xlabel("L1 turnover penalty λ_tc (tested grid points, not to scale)", fontsize=12,
                   fontweight="bold", color=c["text"], labelpad=10)
    ax1.set_ylabel("Net Sharpe ratio (10bp costs)", fontsize=12, fontweight="bold",
                   color=c["sharpe"], labelpad=10)
    ax2.set_ylabel("Annual turnover (%)", fontsize=12, fontweight="bold", color=c["turnover"], labelpad=12)
    ax1.tick_params(axis="y", labelcolor=c["sharpe"], labelsize=11)
    ax1.tick_params(axis="x", labelcolor=c["text"], labelsize=10.5)
    ax2.tick_params(axis="y", labelcolor=c["turnover"], labelsize=11)
    ax2.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{int(v):,}%"))
    ax1.grid(True, linestyle=":", alpha=0.7, color=c["grid"])
    return [line_sharpe, line_turnover, *bench_lines]


def add_summary_box(ax, frontier: Frontier, qp_only: Frontier, c: dict) -> None:
    best = int(np.argmax(frontier.sharpe))
    to_0, sh_0 = frontier.turnover_pct[0], frontier.sharpe[0]
    to_b, sh_b = frontier.turnover_pct[best], frontier.sharpe[best]
    steps = np.diff(frontier.sharpe)
    shape = "non-monotone in λ" if (steps > 0).any() and (steps < 0).any() else "monotone in λ"
    text = (
        f"Best grid point (picked after the fact): λ = {frontier.lambdas[best]:g}\n"
        f"• Turnover {to_0:,.0f}% → {to_b:,.0f}% ({100 * (to_b / to_0 - 1):+.1f}%), "
        f"net Sharpe {sh_0:.3f} → {sh_b:.3f} ({sh_b - sh_0:+.3f})\n"
        f"• Sharpe is {shape} (λ = {frontier.lambdas[-1]:g}: {frontier.sharpe[-1]:.3f}) "
        "→ needs a pre-registered test\n"
        f"• At λ = {frontier.lambdas[-1]:g}: QP alone {qp_only.turnover_pct[-1]:,.0f}% vs "
        f"with safeguard {frontier.turnover_pct[-1]:,.0f}% → residual is safeguard trading"
    )
    ax.text(
        0.015, 0.03, text, transform=ax.transAxes, ha="left", va="bottom", fontsize=9.8,
        fontweight="bold", color=c["text"], zorder=10, linespacing=1.45,
        bbox={"boxstyle": "round,pad=0.55,rounding_size=0.3", "facecolor": c["box_bg"],
              "edgecolor": c["box_edge"], "linewidth": 1.8, "alpha": 0.97},
    )


def plot_turnover_bars(ax, perf: dict, c: dict) -> None:
    style_axis(ax, c)
    labels = [label for _, label in TURNOVER_STRATEGIES]
    values = np.array([perf[key]["turnover_annual_pct"] for key, _ in TURNOVER_STRATEGIES])
    colors = [c["turnover"] if key in HIGHLIGHTED_STRATEGIES else c["bar_muted"] for key, _ in TURNOVER_STRATEGIES]
    y = np.arange(len(values))

    ax.barh(y, values, color=colors, height=0.62)
    ax.set_yticks(y, labels)
    ax.invert_yaxis()
    for yi, value in zip(y, values):
        ax.text(value + values.max() * 0.02, yi, f"{value:,.0f}%", va="center", fontsize=10,
                fontweight="bold", color=c["text"])
    ax.set_xlim(0, values.max() * 1.32)
    ax.xaxis.set_major_locator(MaxNLocator(nbins=4))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{int(v):,}%"))
    ax.tick_params(axis="both", labelcolor=c["text"], labelsize=10)
    ax.grid(True, axis="x", linestyle=":", alpha=0.7, color=c["grid"])
    ax.set_title("Where the turnover comes from (λ_tc = 0)\n(pre-registered run, primary period, 10bp)",
                 fontsize=11.5, fontweight="bold", color=c["text"], loc="left", pad=10)

    ratio = perf["ito_tsfm"]["turnover_annual_pct"] / perf["ito_hist"]["turnover_annual_pct"]
    ax.text(0.0, -0.13, f"Same QP, Chronos μ vs historical μ: {ratio:.1f}× the turnover",
            transform=ax.transAxes, fontsize=10, fontweight="bold", color=c["turnover"])


def add_headers(fig, c: dict) -> None:
    fig.text(0.06, 0.965, "L1 Turnover Penalty Grid — EXPLORATORY (not pre-registered)",
             fontsize=16.5, fontweight="bold", color=c["text"], ha="left", va="top")
    fig.text(
        0.06, 0.915,
        r"$\min_w \frac{1}{2} w' \Sigma w - \mu' w + \lambda_{\mathrm{tc}} \|w - w_{t-1}\|_1$"
        "   s.t.  1'w = 1,  0 ≤ w ≤ 0.40,  CVaR95(w) ≤ CVaR95(EW)",
        fontsize=11.5, color=c["text_muted"], ha="left", va="top",
    )
    fig.text(
        0.96, 0.965, "2026 연합 경제 학술제 본선 [Backup Slide 27]  |  서강대학교 경제학과 AlphaQuant",
        fontsize=10, fontweight="bold", color=c["text_muted"], ha="right", va="top",
        bbox={"boxstyle": "square,pad=0.35", "facecolor": c["badge_bg"], "edgecolor": c["spine"],
              "linewidth": 1.0},
    )
    fig.text(
        0.06, 0.012,
        "* EXPLORATORY (PREREGISTRATION.md §8): the λ_tc grid was chosen after results were seen. "
        "λ_tc = 0 is the pre-registered model and reproduces results/results.json.\n"
        "  Primary period 2017-01-02 → 2026-08-31 (fully out-of-sample), 10bp cost. "
        "Sources: results/exploratory_turnover_regularization.json, results/results.json.",
        fontsize=8.5, color=c["text_muted"], ha="left", va="bottom",
    )


def render(frontier: Frontier, qp_only: Frontier, perf: dict, theme: str, output_path: Path) -> None:
    setup_typography()
    c = THEMES[theme]
    fig = plt.figure(figsize=(15.5, 8.72), dpi=300)
    fig.patch.set_facecolor(c["fig_bg"])
    grid = fig.add_gridspec(1, 2, width_ratios=(2.3, 1.0), wspace=0.42,
                            left=0.06, right=0.96, top=0.85, bottom=0.21)
    ax_frontier = fig.add_subplot(grid[0, 0])
    ax_bars = fig.add_subplot(grid[0, 1])
    style_axis(ax_frontier, c)

    handles = plot_frontier(ax_frontier, frontier, perf, c)
    add_summary_box(ax_frontier, frontier, qp_only, c)
    plot_turnover_bars(ax_bars, perf, c)
    add_headers(fig, c)

    legend = ax_frontier.legend(
        handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.11), ncol=3, fontsize=9.5,
        frameon=True, facecolor=c["ax_bg"], edgecolor=c["spine"], framealpha=0.95,
    )
    for text in legend.get_texts():
        text.set_color(c["text"])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=300, facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close(fig)
    print(f"[SUCCESS] Saved {theme} chart to {output_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the Backup Slide 27 turnover-penalty chart")
    parser.add_argument("--json", type=Path, default=None, help="Path to exploratory_turnover_regularization.json")
    parser.add_argument("--results", type=Path, default=None, help="Path to results/results.json")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_ICLOUD_DIR,
                        help="Folder for the generated charts")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    frontier_path = resolve_input(args.json, FRONTIER_CANDIDATES, "Frontier JSON")
    results_path = resolve_input(args.results, RESULTS_CANDIDATES, "results.json")
    print(f"[INFO] Frontier data: {frontier_path}")
    print(f"[INFO] Benchmarks:    {results_path}")

    grid_data = read_json(frontier_path)
    frontier = load_frontier(grid_data, frontier_path, STRATEGY)
    qp_only = load_frontier(grid_data, frontier_path, QP_ONLY_STRATEGY)
    perf = load_performance(results_path)
    check_baseline(frontier, perf)
    print(f"[DATA] Lambdas: {frontier.lambdas.tolist()}")
    print(f"[DATA] Turnover % ({STRATEGY}): {frontier.turnover_pct.tolist()}")
    print(f"[DATA] Net Sharpe {COST_BP}bp ({STRATEGY}): {frontier.sharpe.tolist()}")
    print(f"[DATA] Turnover % ({QP_ONLY_STRATEGY}): {qp_only.turnover_pct.tolist()}")
    print(f"[DATA] Benchmarks: { {key: perf[key]['sharpe'] for key, _ in BENCHMARKS} }")

    target_dir = args.output_dir
    if target_dir == DEFAULT_ICLOUD_DIR and not target_dir.exists():
        target_dir = Path("results")  # iCloud folder not mounted (e.g. on the Ubuntu server)
    outputs = (("light", target_dir / LIGHT_FILENAME), ("dark", target_dir / DARK_FILENAME))
    for theme, path in outputs:
        render(frontier, qp_only, perf, theme, path)

    if MAIN_REPO_RESULTS_DIR.exists():
        for _, path in outputs:
            shutil.copy2(path, MAIN_REPO_RESULTS_DIR / path.name)
        print(f"[SUCCESS] Mirrored charts into {MAIN_REPO_RESULTS_DIR}")


if __name__ == "__main__":
    main()
