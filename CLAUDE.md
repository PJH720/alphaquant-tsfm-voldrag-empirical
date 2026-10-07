# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This repo reproduces, on real market data, a paper's framework: Itô-lemma volatility-drag control, TSFM (Chronos) moment forecasts, a Kelly/CVaR QP and an autoencoder safeguard. The paper's own figures come from simulation, in the companion repo `PJH720/alphaquant-tsfm-voldrag`. Here the job is to report whatever real data gives, including results worse than the paper's.

## Pre-registration discipline (most important rule)

- **`PREREGISTRATION.md` is frozen.** Never edit it. Its git timestamp is the evidence that the parameters were fixed before any data or results were seen.
- **`src/voldrag/config.py` mirrors the pre-registration.** Never change a parameter to improve results. That includes windows, caps, seeds, thresholds, model choice and cost levels.
- **Log every deviation in `CHANGELOG.md`**, tagged by its timing relative to the first backtest run (pre-results vs. post-results). Point to it from a code comment at the spot where the deviation happens. The amendments so far are all pre-results:
  - `DATA_START` moved to 2012-12-03.
  - HY OAS replaced by FRED `BAA10Y`.
  - KOSDAQ composite `^KQ11` stands in for the KOSDAQ 150 index before 2015-10-01.
  - VKOSPI replaced by KOSPI 200 21-day realized volatility.
- **After the first results run, only code-defect fixes are allowed.** Log each one in `CHANGELOG.md` and regenerate all results.
- **Reporting:**
  - Results go to `results/` and `results/REPORT.md`, with a paper-vs-reproduced column wherever the paper gives a number.
  - No result is omitted.
  - Any analysis not listed in the pre-registration is labelled **exploratory**.
- **Paper section references:** the §/eq. numbers in docstrings (e.g. "eqs. (30)–(31)", "§6") refer to `PREREGISTRATION.md` sections and the paper's equations. Keep these references when writing new code.

## Commands

The project uses uv, with Python 3.12 and the `uv_build` backend. The package is `voldrag`, under `src/`. The default branch is `main`.

```bash
uv sync                                    # install deps (incl. dev group: pytest)
uv run python -m voldrag.run               # full pipeline -> results/ (Chronos on CUDA if available, else CPU)
uv run python -m voldrag.exploratory       # EXPLORATORY 5bp cost row -> results/exploratory_cost_sensitivity.json
uv run python -m voldrag.export_web        # results/ -> web/public/data/*.json (needs gh; refuses dirty results/)
uv run pytest                              # tests
uv run pytest tests/test_pipeline.py::test_name   # single test
scripts/start_live_backend.sh              # live lab: FastAPI (uv sync --group live) + Cloudflare Quick Tunnel
cd web && pnpm i && pnpm build             # demo site (Next.js static export -> web/out); see web/AGENTS.md
uv run python scripts/verify_reproduction.py A/results.json B/results.json   # re-run vs committed record
uv run python scripts/verify_export.py      # results/ == web/public/data, source sha256s
uv run --with playwright python scripts/verify_site_numbers.py --url http://127.0.0.1:4173/  # every <Num> == JSON
uv run --with playwright python scripts/scan_forbidden.py <patterns outside repo> --url …    # forbidden claims
uv run --with playwright python scripts/verify_offline.py --url …                             # site with GPU offline
```

Site rule: every result number renders through `web/src/components/Num.tsx` (`src` = JSON path, or `expr`
from `web/src/lib/expr.ts`); never type a result into TSX. Other digits must match `scripts/number_allowlist.txt`.

`load_market_data()` downloads from Yahoo (yfinance) and the FRED public CSV endpoint on the first call. It caches each source as parquet in `data/raw/`, which is gitignored because vendor data is not redistributed. It then rewrites `data/manifest.json` with the sha256, row count and date range of each cached file. The manifest is committed, so a diff in it means the upstream data changed.

## Architecture

**`config.py`**
- Every pre-registered constant: periods, the asset order in `ASSETS` (with `CASH_IDX`), windows, QP/CVaR settings, Chronos settings, safeguard settings, costs and bootstrap.
- Import it as `from voldrag import config as C`.

**`data.py`** (data layer)
- `load_market_data()` returns a frozen `MarketData` holding:
  - `prices` and `returns`: KRW total return, on the KRX calendar.
  - `state`: the 12-dim safeguard state vector z_t.
  - `coverage` and `deviations`: diagnostics.
- Key invariants:
  - **Calendar** = KRX trading days, taken from `069500.KS`.
  - **No look-ahead across time zones.** US prices, USD/KRW and the FRED macro series close after KRX. The value used on KRX date *t* is the last observation dated strictly before *t* (`align_strictly_before`). Any new US/FRED input must go through this function.
  - **US assets are converted to KRW:** `adj_close(USD) × DEXKOUS`, both lagged.
  - **KOSDAQ150 is chain-linked on returns:** `^KQ11` up to 2015-10-01, then `229200.KS`.
  - **Gaps:** forward-fill is capped at `FFILL_LIMIT=5`. Only the leading rows without a prior US/FX observation are trimmed. Any other NaN raises an error and must not be silently filled.

**`models.py`**: Ledoit-Wolf + Higham moments, `ChronosMoments` (forecasts cached by decision date in `data/cache/`), the Itô-Kelly QP with a Rockafellar–Uryasev CVaR bound at the equal-weight CVaR (cvxpy + CLARABEL), max-Sharpe MVO, and the autoencoder `Safeguard` (trained on the warm-up only, then frozen) with `beta_from_score`.

**`backtest.py`**: rebalancing schedules, strategy targets, `simulate()` and metrics. Weights are decided at the close of *t*, earn returns from *t+1* and drift between trades. Costs are charged on every trade. Also holds the block-bootstrap Sharpe test.

**`run.py`**: the orchestrator. `build_targets()` → backtests over both periods and all pre-registered costs → `results/` (results.json, REPORT.md, daily returns, weights, safeguard signals) and `DATA.md`.

**Post-results, outside the pre-registered pipeline** (each must stay labelled as such):
- `exploratory.py`: non-pre-registered cost levels. It checks its pre-registered rows against `results.json`.
- `export_web.py`: strategy-level JSON for `web/`. Never export raw prices or per-asset returns.
- `api/` (`engine.py`, `server.py`): the live what-if lab, which is exploratory. `LiveEngine.self_check()` must reproduce `results.json` at pre-registered settings. Backtests run in float64 on the CPU; only Chronos runs on the GPU.
