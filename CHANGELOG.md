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
- 2026-10-07: `run.py` also writes `results/weights_{primary,secondary}_10bp.csv`: the proposed model's daily weights, cash included (β is in `safeguard_signals.csv`). This is an output-only addition; the calculation is unchanged.
- 2026-10-07: **`results/`, `DATA.md` and `data/manifest.json` regenerated** by the Linux/CUDA run, so that the weights and every other output come from one run. No parameter or calculation change. The differences from the first run (`d3d3447`) are within tolerance: |Δ CAGR| ≤ 0.0006 %p, |Δ Sharpe| ≤ 0.0001, identical safeguard trigger dates (`results/cross_platform_ubuntu_cuda.md`). The first run's files remain in git history at `d3d3447`.
- 2026-10-07: **EXPLORATORY** `src/voldrag/exploratory.py` adds a 5bp cost level (`results/exploratory_cost_sensitivity.json`). It is not in the pre-registered grid (0/10/20bp) and is labelled exploratory wherever it is shown. `config.COSTS_BP` is unchanged; the script recomputes the 0/10/20bp rows and checks them against `results/results.json`.
- 2026-10-07: `src/voldrag/export_web.py` exports the committed `results/` to `web/public/data/*.json` for the demo site. It also writes the submission bundle from the presentation repo and a provenance record. Only strategy-level outputs are exported: no raw prices and no per-asset daily returns.
- 2026-10-07: EXPLORATORY live lab (`src/voldrag/api/`, `scripts/start_live_backend.sh`, site section 3). What-if knobs that are not pre-registered: cost 0–30bp, safeguard threshold multiplier k (τ → kτ), cash-overlay floor, QP risk aversion λ ∈ {0.5, 1, 2, 3, 4} (λ = 1 is eq. 30; λ ≠ 1 re-solves the same QP with λΣ). No parameter in config.py changes, and every live result at non-default settings is labelled exploratory. The server checks itself against `results/results.json` on start (120 values; max daily-return difference vs `backtest.simulate` 6.6e-16).
- 2026-10-07: EXPLORATORY, post-results: L1 turnover penalty λ_tc·‖w − w_prev‖₁ added to the Itô-Kelly QP (`src/voldrag/exploratory_turnover.py`, figure via `scripts/turnover_regularization.py`). Everything else is unchanged: dates, Chronos moments, CVaR bound, cap, safeguard, costs. λ_tc was introduced after the pre-registered run showed ~2,800% annual turnover, so it is not a replacement result. λ_tc = 0 reproduces `results/results.json`. Primary period, proposed model, 10bp: λ_tc up to 0.005 leaves turnover at 2,464–2,804% and net Sharpe at about 0.90. On the extended grid, λ_tc = 0.2 gives 509% turnover and net Sharpe 1.15, but the frontier is not monotone (λ_tc = 0.5 gives 0.91) and the safeguard overlay alone keeps turnover near 500%. Outputs: `results/exploratory_turnover_penalty[_extended].json`, `exploratory_turnover_regularization[_extended].md`, `backup_slide27_turnover_regularization[_extended].png`.
- 2026-10-07: The live lab gains a 5th exploratory knob, λ_tc, with grid 0, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5. The penalized QP moved to `models.ito_kelly_turnover_qp`; at λ_tc = 0 it calls `ito_kelly_qp`, which is unchanged. The engine precomputes every (λ, λ_tc) pair. At λ_tc = 0 it still passes the `results.json` self-check, and at every λ_tc value it matches `results/exploratory_turnover_penalty_extended.json`. The grid goes past 0.005 because values up to 0.005 barely change turnover on this data.
- 2026-10-07: Site section 7 adds a static EXPLORATORY card for the L1 turnover penalty. The full grid λ_tc 0–0.5 is in `results/exploratory_turnover_regularization.json` and is exported by `export_web` to `web/public/data/`. Every number in its callout is read from that file. It says that λ_tc ≤ 0.005 barely changes turnover or net Sharpe, and that λ_tc = 0.2 is a post-hoc best on a non-monotone frontier.

## Cross-platform reproduction run

- 2026-10-07 ≈ 02:20 KST: independent re-run on Ubuntu 24.04.5 + NVIDIA RTX 2060 SUPER (CUDA 13.0, torch 2.14.1+cu130), code commit `f180e94`. It started from empty data, Chronos and model-weight caches. No parameter change.
  - Verdict: **minor differences, within tolerance**. The largest gaps are |Δ CAGR| 0.0006 %p, |Δ Sharpe| 0.0001, |Δ turnover| 0.03 %p/y and |Δ p| 0.0003. Safeguard trigger dates are identical.
  - Cause: mostly Yahoo `Adj Close` rounding noise of about 1e-6 between requests. It affects only the six distribution-paying tickers; FRED, GLD and ^KQ11 are byte-identical. The Chronos device effect (CUDA vs CPU, about 1e-6 in μ̂ and σ̂) is roughly 10× smaller.
  - `results/`, `DATA.md` and `data/manifest.json` were later regenerated from this run (see Post-results additions). Full comparison with the first run: `results/cross_platform_ubuntu_cuda.md`.
