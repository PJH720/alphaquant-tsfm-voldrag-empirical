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

The project uses uv, with Python 3.12 and the `uv_build` backend. The package is `voldrag`, under `src/`.

```bash
uv sync                                    # install deps (incl. dev group: pytest)
uv run python -c "from voldrag.data import load_market_data; d = load_market_data()"   # fetch/align data
uv run pytest                              # tests (none exist yet)
uv run pytest tests/test_x.py::test_name   # single test
```

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

**Not yet implemented** (spec in `PREREGISTRATION.md` §4–§7):
- Strategies: `6040`, `ew`, `mvo`, `ito_hist`, `ito_tsfm`, `proposed`.
- The Itô-Kelly QP: cvxpy + CLARABEL, a Rockafellar–Uryasev CVaR constraint, and γ_target set to the equal-weight CVaR.
- The Ledoit-Wolf + Higham covariance estimate.
- Chronos-Bolt moment extraction.
- The autoencoder safeguard: trained on the warm-up period only, then frozen. Its standardization stats come from the warm-up only.
- The backtester:
  - Weights are decided at the close of *t* and earn returns from *t+1*, drifting between rebalances.
  - Costs are charged on every trade.
- Metrics and the block-bootstrap significance test.
