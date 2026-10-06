# Changelog: amendments to the pre-registration

`PREREGISTRATION.md` is never edited after its commit. Every deviation is logged here with its timing relative to the first backtest run.

## Pre-results amendments (2026-10-07, before any backtest was run)

These were found while fetching data. At that point only coverage, row counts and missing-value counts had been inspected. No returns statistics, model output or strategy result had been looked at.

1. **Data start 2013-01-02 → 2012-12-03** (`config.DATA_START`).
   - §3 says the data start is chosen "so the W=504 windows exist at 2015-01". From 2013-01-02 there are only ~492 KRX trading days before 2015-01-02, which contradicts that stated intent.
   - With the earliest fetched date (2012-12-03), 508 return rows precede 2015-01-02. The first two rows are dropped because no US/FX observation strictly precedes them.
2. **US HY OAS → Moody's Baa−10Y spread** (state-vector feature 11).
   - FRED now serves `BAMLH0A0HYM2` only from 2023-10-09 (ICE licensing). That leaves the warm-up and most of the sample empty.
   - Replaced by FRED `BAA10Y`, the long-history credit-spread series on FRED (2012-12-03 onward). It is lagged strictly before each KRX date like the other US series.
3. **KOSDAQ 150 index before 2015-10-01 → KOSDAQ composite (`^KQ11`)**.
   - §2 planned the KOSDAQ 150 index from pykrx. KRX index endpoints now require a login: pykrx and FinanceDataReader both fail with `LOGOUT`/`KeyError`.
   - The composite is the closest freely available series. It is a price index, so dividends are omitted only for 2012-12 to 2015-10.
4. **VKOSPI**: unavailable for the same KRX-login reason. Replaced by KOSPI 200 21-day realized volatility, exactly as pre-registered in §6. Listed here for completeness.

## Code-level notes (no parameter change)

- Leading rows without a strictly-earlier US/FX observation are trimmed (`data.load_market_data`). Missing values anywhere else still raise an error.
- 2026-10-07, post-results code change (no parameter change): `ChronosMoments._pipeline()` runs Chronos on CUDA when available, otherwise on the CPU. dtype stays float32.

## First results run

- 2026-10-07 02:05 KST: first full run of `python -m voldrag.run` on code commit `930abbd`. No parameter or code changes after this run. Extreme 2026 KOSPI moves (e.g. +24% on 2026-07-31) were checked across 069500.KS, 102110.KS and ^KS11 and kept as genuine market data.

## Post-results additions (no parameter or result change)

- 2026-10-07: `tests/test_data_reference.py` checks downloaded data against published values: SPY/QQQ/GLD calendar-year total returns 2016-2024 (±0.3%p), KOSPI year-end closes 2019-2024 (±0.01), VIX 2020-03-16 and USD/KRW 2020-03-19 (FRED), and that distributions are reflected in adjusted prices. All 34 checks pass on the data used for the first run. Data after 2024 is not covered.

## Cross-platform reproduction run

- 2026-10-07 ≈ 02:20 KST: independent re-run on Ubuntu 24.04.5 + NVIDIA RTX 2060 SUPER (CUDA 13.0, torch 2.14.1+cu130), code commit `f180e94`. It started from empty data, Chronos and model-weight caches. No parameter change.
  - Verdict: **minor differences, within tolerance**. The largest gaps are |Δ CAGR| 0.0006 %p, |Δ Sharpe| 0.0001, |Δ turnover| 0.03 %p/y and |Δ p| 0.0003. Safeguard trigger dates are identical.
  - Cause: mostly Yahoo `Adj Close` rounding noise of about 1e-6 between requests. It affects only the six distribution-paying tickers; FRED, GLD and ^KQ11 are byte-identical. The Chronos device effect (CUDA vs CPU, about 1e-6 in μ̂ and σ̂) is roughly 10× smaller.
  - The committed `results/`, `DATA.md` and `data/manifest.json` remain those of the first results run. Full comparison: `results/cross_platform_ubuntu_cuda.md`.
