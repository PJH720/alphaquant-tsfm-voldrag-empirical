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

## First results run

- 2026-10-07 02:05 KST: first full run of `python -m voldrag.run` on code commit `930abbd`. No parameter or code changes after this run. Extreme 2026 KOSPI moves (e.g. +24% on 2026-07-31) were checked across 069500.KS, 102110.KS and ^KS11 and kept as genuine market data.
