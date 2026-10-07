"""Export committed results/ to JSON for the demo site (web/public/data/).  `python -m voldrag.export_web`

Reads only strategy-level outputs in results/. No raw prices and no per-asset daily returns
are exported (vendor data is not redistributed). Nothing is recomputed except cumulative
wealth from the committed daily strategy returns.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd

from voldrag import config as C
from voldrag import exploratory_turnover as TO
from voldrag.run import LABELS

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
OUT = ROOT / "web" / "public" / "data"
STRATEGIES = list(LABELS)
SUBMISSION_REPO = "PJH720/alphaquant-tsfm-voldrag"
SUBMISSION_PATH = "web_export/submission_simulation.json"
CRISIS_2020 = ("2020-01-02", "2020-06-30")
FIRST_COMMITS = {  # provenance anchors: (role, how to find the commit)
    "preregistration": ("PREREGISTRATION.md", "first"),
    "data": ("src/voldrag/data.py", "first"),
    "code": ("930abbd", "rev"),
    "results": ("results/results.json", "first"),
}


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True,
                          text=True).stdout.strip()


def _commit_info(rev: str) -> dict:
    sha, short, date, subject = _git("log", "-1", "--format=%H%x1f%h%x1f%cI%x1f%s", rev).split("\x1f")
    return {"sha": sha, "short": short, "date": date, "subject": subject}


def _file_commit(path: str, first: bool = False) -> dict:
    log = _git("log", "--format=%H", "--", path).splitlines()
    if not log:
        raise RuntimeError(f"{path} is not committed; commit it before exporting")
    return _commit_info(log[-1] if first else log[0])


def _source(path: Path) -> dict:
    rel = str(path.relative_to(ROOT))
    if _git("status", "--porcelain", "--", rel):
        raise RuntimeError(f"{rel} has uncommitted changes; the site must use committed results")
    return {"file": rel, "commit": _file_commit(rel)["short"],
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def _write(name: str, payload: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(_clean(payload), ensure_ascii=False, indent=1), encoding="utf-8")


def _clean(obj):
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (float, np.floating)):
        return None if np.isnan(obj) else round(float(obj), 6)
    if isinstance(obj, np.integer):
        return int(obj)
    return obj


def _daily(period: str) -> tuple[pd.DataFrame, dict]:
    path = RESULTS / f"daily_returns_{period}_{C.BASE_COST_BP}bp.csv"
    return pd.read_csv(path, index_col=0, parse_dates=True), _source(path)


def export_performance(results: dict, src: dict) -> None:
    _write("performance.json", {
        "labels": LABELS,
        "periods": {k: {"start": s, "end": e} for k, (s, e) in C.PERIODS.items()},
        "costs_bp": list(C.COSTS_BP),
        "base_cost_bp": C.BASE_COST_BP,
        "performance": results["performance"],
        "bootstrap": results["bootstrap_proposed_vs_mvo"],
        "episodes": results["episodes"],
        "episode_windows": {k: {"start": s, "end": e} for k, (s, e) in C.EPISODES.items()},
        "source": src,
        "exploratory_costs": _exploratory_costs(),
    })


def _exploratory_costs() -> dict:
    path = RESULTS / "exploratory_cost_sensitivity.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"label": data["label"], "costs_bp": data["exploratory_costs_bp"],
            "performance": {p: {c: v for c, v in costs.items() if int(c) in data["exploratory_costs_bp"]}
                            for p, costs in data["performance"].items()},
            "source": _source(path)}


def export_turnover_regularization() -> None:
    """EXPLORATORY L1 turnover penalty frontier (voldrag.exploratory_turnover), strategy-level only."""
    path = RESULTS / "exploratory_turnover_regularization.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    frontier = {}
    for period in C.PERIODS:
        frontier[period] = {}
        for name in data["strategies"]:
            rows = []
            for lam in data["lambdas"]:
                by_cost = data["results"][str(lam)][period]
                rows.append({"lambda_tc": lam,
                             "turnover_pct": by_cost[str(C.BASE_COST_BP)][name]["turnover_annual_pct"],
                             **{f"cagr_{c}bp": by_cost[str(c)][name]["cagr_pct"] for c in C.COSTS_BP},
                             **{f"sharpe_{c}bp": by_cost[str(c)][name]["sharpe"] for c in C.COSTS_BP},
                             **{f"mdd_{c}bp": by_cost[str(c)][name]["mdd_pct"] for c in C.COSTS_BP}})
            frontier[period][name] = rows
    _write("exploratory_turnover_regularization.json", {
        "label": data["label"], "note": data["note"], "formulation": data["formulation"],
        "lambdas": data["lambdas"], "first_grid": [x for x in TO.LAMBDAS_TC if x in data["lambdas"]],
        "costs_bp": list(C.COSTS_BP), "base_cost_bp": C.BASE_COST_BP,
        "strategies": data["strategies"], "frontier": frontier, "source": _source(path),
    })


def export_curves() -> None:
    for period in C.PERIODS:
        daily, src = _daily(period)
        wealth = (1.0 + daily).cumprod()
        weekly = wealth.resample("W-FRI").last().dropna(how="all")
        if weekly.index[-1] != wealth.index[-1]:  # keep the exact final value
            weekly.loc[wealth.index[-1]] = wealth.iloc[-1]
        start = wealth.index[0] - pd.Timedelta(days=1)
        rows = [{"date": str(start.date()), **{s: 1.0 for s in STRATEGIES}}]
        rows += [{"date": str(d.date()), **row.to_dict()} for d, row in weekly.iterrows()]
        _write(f"curves_{period}.json", {
            "period": period, "start": C.PERIODS[period][0], "end": C.PERIODS[period][1],
            "resample": "weekly (last trading day of each week), wealth starts at 1.0",
            "cost_bp": C.BASE_COST_BP, "strategies": STRATEGIES, "rows": rows, "source": src,
        })


def _paper_2020_narrative() -> dict:
    """The submission's 2020 narrative (trigger date, cash share, MDD) as printed in REPORT.md."""
    report = RESULTS / "REPORT.md"
    m = re.search(r"Paper narrative for comparison: safeguard trigger (\d{4}-\d{2}-\d{2}), "
                  r"~(\d+)% cash, MDD (-?[\d.]+)%", report.read_text(encoding="utf-8"))
    if m is None:
        raise RuntimeError("2020 paper narrative not found in results/REPORT.md")
    return {"trigger_date": m.group(1), "cash_pct": float(m.group(2)), "mdd_pct": float(m.group(3)),
            "nature": "illustrative_scenario", "source": _source(report)}


def export_crisis_2020(results: dict, results_src: dict) -> None:
    start, end = CRISIS_2020
    daily, daily_src = _daily("primary")
    window = daily.loc[start:end]
    wealth = (1.0 + window).cumprod()
    sig_path = RESULTS / "safeguard_signals.csv"
    signals = pd.read_csv(sig_path, index_col=0, parse_dates=True).loc[start:end]
    w_path = RESULTS / f"weights_primary_{C.BASE_COST_BP}bp.csv"
    cash = pd.read_csv(w_path, index_col=0, parse_dates=True).loc[start:end, "CASH"]
    rows = []
    for d in wealth.index:
        rows.append({"date": str(d.date()), **wealth.loc[d].to_dict(),
                     "beta": signals.at[d, "beta"], "score": signals.at[d, "score"],
                     "tau": signals.at[d, "tau"], "cash_weight": cash.get(d, np.nan)})
    ep = results["episodes"]["2020_pandemic"]
    _write("crisis_2020.json", {
        "window": {"start": start, "end": end}, "cost_bp": C.BASE_COST_BP,
        "strategies": STRATEGIES, "rows": rows,
        "episode": ep, "episode_window": dict(zip(("start", "end"), C.EPISODES["2020_pandemic"])),
        "submission_narrative": _paper_2020_narrative(),
        "sources": {"daily_returns": daily_src, "safeguard_signals": _source(sig_path),
                    "weights": _source(w_path), "episodes": results_src},
        "weights_note": "All results/ files, weights included, come from the Linux/CUDA run "
                        "(results/cross_platform_ubuntu_cuda.md: minor differences from the first run, within tolerance).",
    })


def export_drag(results: dict, src: dict) -> None:
    perf = results["performance"]
    out = {p: {s: {m: perf[p][str(C.BASE_COST_BP)][s][m] for m in ("emp_drag_pct", "theo_drag_pct", "sigma_pct")}
               for s in STRATEGIES} for p in C.PERIODS}
    _write("drag.json", {"cost_bp": C.BASE_COST_BP, "drag": out, "source": src})


def export_assets_drag(results: dict, src: dict) -> None:
    """Annual summary statistics per asset for the drag calculator. No prices, no daily returns."""
    keys = ("n_obs", "mu_arith_pct", "mu_geom_log_pct", "sigma_pct", "theo_drag_pct")
    stats = results["asset_statistics_secondary"]
    _write("assets_drag.json", {
        "period": "secondary",
        "window": dict(zip(("start", "end"), C.PERIODS["secondary"])),
        "definition": "emp_drag = mu_arith − mu_geom_log; theo = ½σ²",
        "assets": {a: {k: stats[a][k] for k in keys} for a in C.ASSETS},
        "source": src,
    })


def export_method() -> None:
    """Pre-registered method constants shown as text on the site, read from config.py."""
    cfg = ROOT / "src" / "voldrag" / "config.py"
    names = ("RF", "W_CAP", "ALPHA", "W_ITO", "HORIZON", "CHRONOS_MODEL", "TAU_Q", "TAU_WINDOW",
             "BASE_COST_BP", "COSTS_BP", "BOOT_B", "BOOT_BLOCK", "SEED")
    _write("method.json", {
        **{n: getattr(C, n) for n in names},
        "rebalancing": "weekly + safeguard trades",
        "notes": {"W_ITO": "rolling window = number of CVaR scenarios"},
        "source": _source(cfg),
    })


def _changelog_amendments() -> list[dict]:
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    section = text.split("## Pre-results amendments", 1)[1].split("\n## ", 1)[0]
    out = []
    for block in re.split(r"\n(?=\d+\. \*\*)", section.strip())[1:]:
        lines = block.splitlines()
        m = re.match(r"\d+\. \*\*(.+?)\*\*(.*)", lines[0])
        bullets = [ln.strip()[2:] for ln in lines[1:] if ln.strip().startswith("- ")]
        out.append({"title": m.group(1).strip(), "summary": m.group(2).strip(" .:"), "details": bullets})
    return out


def _data_reference_tests() -> dict:
    proc = subprocess.run(["uv", "run", "pytest", "-q", "-p", "no:cacheprovider",
                           "tests/test_data_reference.py"], cwd=ROOT, capture_output=True, text=True,
                          check=False)
    summary = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else proc.stderr.strip()
    passed = int(m.group(1)) if (m := re.search(r"(\d+) passed", summary)) else 0
    failed = int(m.group(1)) if (m := re.search(r"(\d+) failed", summary)) else 0
    return {"command": "uv run pytest tests/test_data_reference.py", "passed": passed,
            "failed": failed, "total": passed + failed, "summary": summary,
            "ran_at": pd.Timestamp.now(tz="Asia/Seoul").isoformat(timespec="seconds")}


def fetch_submission() -> dict:
    """Download the submission bundle from the presentation repo via `gh api`."""
    meta = json.loads(subprocess.run(
        ["gh", "api", f"repos/{SUBMISSION_REPO}/contents/{SUBMISSION_PATH}"],
        check=True, capture_output=True, text=True).stdout)
    commits = json.loads(subprocess.run(
        ["gh", "api", f"repos/{SUBMISSION_REPO}/commits?path={SUBMISSION_PATH}&per_page=1"],
        check=True, capture_output=True, text=True).stdout)
    if not commits:
        raise RuntimeError("submission export not found: run the export in the presentation repo first")
    raw = base64.b64decode(meta["content"])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "submission_simulation.json").write_bytes(raw)
    return {"repo": SUBMISSION_REPO, "path": SUBMISSION_PATH, "commit": commits[0]["sha"],
            "commit_date": commits[0]["commit"]["committer"]["date"],
            "sha256": hashlib.sha256(raw).hexdigest()}


def export_provenance(submission: dict) -> None:
    anchors = {}
    for role, (ref, how) in FIRST_COMMITS.items():
        anchors[role] = _commit_info(ref) if how == "rev" else _file_commit(ref, first=True)
    anchors["weights_export"] = _file_commit(f"results/weights_primary_{C.BASE_COST_BP}bp.csv", first=True)
    _write("provenance.json", {
        "repo": "PJH720/alphaquant-tsfm-voldrag-empirical",
        "submission_repo": SUBMISSION_REPO,
        "timeline": anchors,
        "head": _commit_info("HEAD"),
        "amendments": _changelog_amendments(),
        "data_reference_tests": _data_reference_tests(),
        "submission": submission,
        "run_command": "uv sync && uv run python -m voldrag.run",
        "reproduction_report": "results/cross_platform_ubuntu_cuda.md",
    })


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-fetch", action="store_true",
                    help="reuse web/public/data/submission_simulation.json and its recorded provenance")
    args = ap.parse_args()
    results_path = RESULTS / "results.json"
    results, src = json.loads(results_path.read_text(encoding="utf-8")), _source(results_path)
    if args.skip_fetch:
        submission = json.loads((OUT / "provenance.json").read_text(encoding="utf-8"))["submission"]
    else:
        submission = fetch_submission()
    export_performance(results, src)
    export_curves()
    export_crisis_2020(results, src)
    export_drag(results, src)
    export_assets_drag(results, src)
    export_method()
    export_turnover_regularization()
    export_provenance(submission)
    print(f"Wrote {sorted(p.name for p in OUT.glob('*.json'))} -> {OUT}")


if __name__ == "__main__":
    main()
