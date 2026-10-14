"""Hop 1 of the site check: committed results/ == web/public/data (post-results tooling).

    uv run python scripts/verify_export.py

voldrag.export_web copies values (rounded to 6 decimals, which leaves results.json values unchanged),
so every comparison is exact. Also checks every `source` block in the exported files: the recorded
commit must hold the file with the recorded sha256, and the working copy must match it.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
WEB = ROOT / "web" / "public" / "data"
fails: list[str] = []
n_checked = 0


def load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def same(a, b, where: str) -> None:
    """Exact recursive equality; floats compared after the export's 6-decimal rounding."""
    global n_checked
    if isinstance(a, dict) and isinstance(b, dict):
        if set(map(str, a)) != set(map(str, b)):
            fails.append(f"{where}: keys differ {sorted(set(map(str, a)) ^ set(map(str, b)))}")
        for k in a:
            if str(k) in b:
                same(a[k], b[str(k)], f"{where}.{k}")
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            same(x, y, f"{where}[{i}]")
    elif isinstance(a, float) or isinstance(b, float):
        n_checked += 1
        if a is None or b is None or round(float(a), 6) != float(b):
            fails.append(f"{where}: {a} != {b}")
    else:
        n_checked += 1
        if a != b:
            fails.append(f"{where}: {a!r} != {b!r}")


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def check_source(src: dict, where: str) -> None:
    global n_checked
    n_checked += 1
    path, commit, digest = src["file"], src["commit"], src["sha256"]
    blob = subprocess.run(["git", "show", f"{commit}:{path}"], cwd=ROOT, capture_output=True, check=False).stdout
    if blob and sha(blob) != digest:
        fails.append(f"{where}: {path}@{commit} sha256 {sha(blob)[:12]} != recorded {digest[:12]}")
    if sha((ROOT / path).read_bytes()) != digest:
        fails.append(f"{where}: working copy of {path} differs from recorded sha256")
    if subprocess.run(["git", "status", "--porcelain", "--", path], cwd=ROOT, capture_output=True, text=True,
                      check=True).stdout:
        fails.append(f"{where}: {path} has uncommitted changes")


def sources(obj, where: str) -> None:
    if isinstance(obj, dict):
        if {"file", "commit", "sha256"} <= set(obj) and obj.get("sha256"):
            check_source(obj, where)
        for k, v in obj.items():
            sources(v, f"{where}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            sources(v, f"{where}[{i}]")


def main() -> int:
    r = load(RES / "results.json")
    perf, crisis = load(WEB / "performance.json"), load(WEB / "crisis_2020.json")
    same(r["performance"], perf["performance"], "performance")
    same(r["bootstrap_proposed_vs_mvo"], perf["bootstrap"], "bootstrap")
    same(r["episodes"], perf["episodes"], "episodes")
    same(r["episodes"]["2020_pandemic"], crisis["episode"], "crisis_2020.episode")

    ad = load(WEB / "assets_drag.json")
    keys = ("n_obs", "mu_arith_pct", "mu_geom_log_pct", "sigma_pct", "theo_drag_pct")
    same({a: {k: v[k] for k in keys} for a, v in r["asset_statistics_secondary"].items()}, ad["assets"], "assets_drag")

    drag = load(WEB / "drag.json")
    base = str(perf["base_cost_bp"])
    same({p: {s: {m: r["performance"][p][base][s][m] for m in ("emp_drag_pct", "theo_drag_pct", "sigma_pct")}
              for s in v} for p, v in drag["drag"].items()}, drag["drag"], "drag")

    tr, tw = load(RES / "exploratory_turnover_regularization.json"), load(WEB / "exploratory_turnover_regularization.json")
    same(tr["lambdas"], tw["lambdas"], "turnover.lambdas")
    for period, by_name in tw["frontier"].items():
        for name, rows in by_name.items():
            for i, lam in enumerate(tr["lambdas"]):
                res = tr["results"][str(lam)][period]
                row = rows[i]
                same(lam, row["lambda_tc"], f"turnover.{period}.{name}[{i}].lambda_tc")
                same(res[base][name]["turnover_annual_pct"], row["turnover_pct"], f"turnover.{period}.{name}[{i}].turnover")
                for c in tw["costs_bp"]:
                    for m, k in (("cagr_pct", "cagr"), ("sharpe", "sharpe"), ("mdd_pct", "mdd")):
                        same(res[str(c)][name][m], row[f"{k}_{c}bp"], f"turnover.{period}.{name}[{i}].{k}_{c}bp")

    for f in sorted(WEB.glob("*.json")):
        if f.name != "submission_simulation.json":
            sources(load(f), f.stem)
    prov = load(WEB / "provenance.json")
    n_sub = sha((WEB / "submission_simulation.json").read_bytes())
    if n_sub != prov["submission"]["sha256"]:
        fails.append("submission_simulation.json sha256 differs from provenance.submission")

    print(f"checked {n_checked} values and source records")
    if fails:
        print(f"FAIL: {len(fails)}")
        for x in fails[:50]:
            print("  " + x)
        return 1
    print("PASS: results/ == web/public/data; every source sha256 matches its commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
