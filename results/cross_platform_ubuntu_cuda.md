# Independent reproduction: Ubuntu + CUDA vs the first results run

This is an independent re-run of `python -m voldrag.run` on a second machine. It started from an empty `data/raw/` and `data/cache/` and an empty Hugging Face model cache, so all market data and the Chronos weights were downloaded fresh.
- **Code:** commit `f180e94`. The pipeline code is `e280280` plus the CUDA device selection logged in `CHANGELOG.md`; no parameter change. (The run was made before rebasing onto `fe418e9`, which adds only tests and docs.)
- **Committed outputs:** the files in `results/`, `DATA.md` and `data/manifest.json` are still the first results run. Only this comparison is new.

**Verdict: minor differences, within tolerance.**
- No number in `results/REPORT.md` differs except in its last printed digit:
  - turnover by ≤ 0.03 %p/y;
  - bootstrap p-value by ≤ 0.0003;
  - Jarque–Bera statistic by ≤ 0.07.
- All conclusions are unchanged.
- The residual comes mainly from Yahoo Finance's dividend-adjusted prices, which differ by about 1e-6 between fetches. The compute device contributes about an order of magnitude less.

## Environment

| | This run |
| --- | --- |
| Machine | Intel Xeon E5-2697 v3 + NVIDIA GeForce RTX 2060 SUPER (8 GB, sm_75) |
| OS | Ubuntu 24.04.5 LTS, kernel 7.0.0-31-generic |
| Chronos device | `cuda:0`, float32 (logged from the loaded pipeline's parameters) |
| Driver / this run | NVIDIA driver 580.178.04, CUDA 13.0 (torch build `cu130`), cuDNN 9.24 |
| Python / torch | Python 3.12.3, torch 2.14.1+cu130 |
| Key packages | yfinance 1.7.0, pandas 3.0.6, pyarrow 25.0.1, cvxpy 1.9.3, clarabel 0.11.1 |
| Data fetched | 2026-10-07 ≈ 02:20 KST |
| Wall time | 101 s (including data and weight downloads; Chronos inference 55 s) |

The autoencoder safeguard trains on the CPU (x86-64).

## 1. Data: `data/manifest.json`

| File | rows / first / last | sha256 |
| --- | --- | --- |
| FRED_BAA10Y, FRED_DEXKOUS, FRED_T10Y2Y, FRED_VIXCLS | identical | identical |
| GLD, IDX_KQ11 (^KQ11) | identical | identical |
| 069500.KS, 148070.KS, 229200.KS, SPY, QQQ, SHV | identical | **different** |

The six files that differ are exactly the Yahoo series that pay distributions. GLD and ^KQ11 have no distributions (`adjustment_steps=0`), and their files are byte-identical. Every FRED series is also byte-identical. So the difference cannot come from how parquet files are written on each platform.

To check whether this is a one-off revision or ordinary noise, I re-downloaded the Yahoo series a few minutes after this run. I compared them with this run's cache:

| Ticker | max \|Δ adj_close\| / adj_close | max \|Δ daily return\| | days with \|Δ return\| > 1e-9 |
| --- | ---: | ---: | ---: |
| 069500.KS | 7.3e-07 | 1.3e-06 | 2768 |
| 148070.KS | 3.8e-07 | 5.8e-07 | 1828 |
| 229200.KS | 4.5e-07 | 6.7e-07 | 1424 |
| SPY | 8.1e-07 | 1.2e-06 | 2916 |
| QQQ | 1.0e-06 | 1.4e-06 | 2914 |
| SHV | 8.8e-07 | 1.3e-06 | 2145 |
| GLD, ^KQ11 | 0 | 0 | 0 |

This is not a revision of the data. Yahoo's `Adj Close` for distribution-paying tickers carries about 1e-6 relative rounding noise that changes from request to request. Unadjusted series do not. The only visible effect in `DATA.md` is that QQQ's `adjustment_steps` count goes from 56 to 57: one adjustment-ratio step crossed the counter's 1e-6 detection threshold. Row counts, date ranges, the calendar (3338 KRX days, 2012-12-05 → 2026-08-31) and the staleness figures are all identical.

The freshly downloaded data passes all 34 reference checks in `tests/test_data_reference.py`, and all 45 tests pass on this machine.

The raw files of the first run are not committed (vendor data is not redistributed), so its exact input values cannot be compared directly. The comparison above sets the size of the noise.

## 2. Results: `results/results.json`

The largest absolute difference (this run − first run) over all 2 periods × 3 cost levels × 6 strategies:

| Metric | max \|Δ\| | Where |
| --- | ---: | --- |
| CAGR % | 0.0006 | `ito_tsfm`, secondary, 10bp |
| Sharpe | 0.0001 | Chronos strategies |
| MDD % | 0.0001 | several |
| Turnover %/y | 0.0315 | `ito_tsfm` / `proposed`, primary (on ≈ 2,656–2,804) |

Among the benchmarks, `6040` and `ew` have Δ = 0 in CAGR, Sharpe and turnover in every cell; `mvo` and `ito_hist` differ only in turnover (by up to 0.009 %p/y). Solver status counts are identical (`mvo` max_sharpe 613; QP optimal 611 per Itô strategy). The autoencoder warm-up MSE is identical (0.667).

### Bootstrap, Sharpe(proposed) − Sharpe(MVO)

| Period | Δ Sharpe first run | Δ Sharpe this run | p first run | p this run |
| --- | ---: | ---: | ---: | ---: |
| primary | -0.0128 | -0.0129 | 0.9584 | 0.9583 |
| secondary | -0.0501 | -0.0501 | 0.8147 | 0.8144 |

### Crisis episodes (primary, 10bp)

| Episode | | First run | This run |
| --- | --- | --- | --- |
| 2020_pandemic | first trigger / days β>0 / max β | 2020-02-03 / 54 / 1.00 | 2020-02-03 / 54 / 1.00 |
| | mean cash weight | 69.435% | 69.434% |
| | `proposed` return / MDD | 2.3086% / -4.6539% | 2.3087% / -4.6538% |
| | `6040` / `mvo` MDD | -19.1837% / -10.6415% | -19.1837% / -10.6415% |
| 2022_tightening | first trigger / days β>0 / max β | 2022-02-08 / 79 / 1.00 | 2022-02-08 / 79 / 1.00 |
| | mean cash weight | 46.5618% | 46.5618% |
| | `proposed` return / MDD | -7.4569% / -9.5350% | -7.4569% / -9.5352% |

The other strategies' episode returns and MDDs agree to within 0.0004 %p.

### Daily series

- Daily net returns, 10bp: the max |Δ| is 6e-7 for `6040`, 3e-7 for `ew` and 1.0e-5 for `proposed` (1.2e-5 in the secondary period).
- `safeguard_signals.csv`: the max |Δ| of the reconstruction error is 1.4e-3, and of β is 8.7e-5. No trigger date changes.

## 3. Attribution: data vs device

The Chronos cache (`data/cache/*.parquet`) is gitignored, so the first run's μ̂ and σ̂ are not available for a direct comparison. Instead I measured the device effect on identical data:

| Comparison (same data, all 611 decision dates × 7 assets) | max \|Δμ̂\| | median \|Δμ̂\| | max \|Δσ̂\| | identical cells |
| --- | ---: | ---: | ---: | ---: |
| CUDA run vs a fresh CUDA re-run | 0 | 0 | 0 | 8554 / 8554 |
| CUDA vs CPU | 2.2e-06 | 5.2e-08 | 2.4e-07 | 2120 / 8554 |

Typical magnitudes are |μ̂| ≈ 0.15 and σ̂ ≈ 0.12 (annualized). CUDA inference is bit-for-bit deterministic. Changing the device moves the moments by about 1e-6 relative.

Next I re-ran the full backtest on the same data with the CPU Chronos cache in place of the CUDA one:

| Effect on metrics | max \|Δ CAGR %\| | max \|Δ Sharpe\| | max \|Δ MDD %\| | max \|Δ turnover %/y\| | bootstrap p |
| --- | ---: | ---: | ---: | ---: | --- |
| Device only (CUDA → CPU Chronos, same data) | 0.0001 | 0 | 0 | 0.0039 | unchanged (0.9583) |
| Observed (first run → this CUDA run) | 0.0006 | 0.0001 | 0.0001 | 0.0315 | 0.9584 → 0.9583 |

- **Data effect.** The strategies with no Chronos input (`6040`, `ew`, `mvo`, `ito_hist`) also move: in their daily returns, in turnover, and in the asset statistics such as JB. This can only come from the different Yahoo inputs, and it is the same size as the request-to-request Yahoo noise measured in §1.
- **Device effect.** It explains roughly a tenth of the turnover and CAGR residual in the Chronos strategies. This assumes that the first run's device differs from CUDA by the same order as the measured CPU-vs-CUDA difference.
- **Safeguard.** The 1.4e-3 differences in reconstruction error come from the state vector, which is built from the slightly different returns, and possibly from CPU floating-point differences in training. The warm-up MSE and every trigger date are identical.

## Verdict

**Minor differences, within tolerance.** The tolerance below is set from the size of Yahoo's adjusted-price noise (§1). It was chosen after the comparison was run, so it is not pre-registered:
- |Δ CAGR|, |Δ MDD| ≤ 0.01 %p;
- |Δ Sharpe| ≤ 0.001;
- |Δ turnover| ≤ 0.1 %p/y;
- |Δ p-value| ≤ 0.001;
- identical safeguard trigger dates.

Every comparison is well inside these limits. The findings in `results/REPORT.md` and the README reproduce unchanged on Ubuntu + CUDA.

A future re-run cannot be byte-exact without the original raw files: Yahoo's `Adj Close` is not bit-stable even across requests minutes apart.

## Full comparison table

| Period | Cost | Strategy | CAGR % first run | CAGR % this run | Δ | Sharpe first run | Sharpe this run | Δ | MDD % first run | MDD % this run | Δ | Turnover %/y first run | Turnover %/y this run | Δ |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | 0bp | `6040` | 10.4082 | 10.4082 | +0.0000 | 0.7752 | 0.7752 | +0.0000 | -19.1800 | -19.1799 | +0.0001 | 20.7237 | 20.7237 | +0.0000 |
| primary | 0bp | `ew` | 12.9816 | 12.9816 | +0.0000 | 0.9805 | 0.9805 | +0.0000 | -17.5011 | -17.5011 | +0.0000 | 39.2254 | 39.2254 | +0.0000 |
| primary | 0bp | `mvo` | 13.8493 | 13.8493 | +0.0000 | 0.9839 | 0.9839 | +0.0000 | -14.8751 | -14.8751 | +0.0000 | 835.0180 | 835.0167 | -0.0013 |
| primary | 0bp | `ito_hist` | 13.4567 | 13.4567 | +0.0000 | 0.9304 | 0.9304 | +0.0000 | -19.1745 | -19.1746 | -0.0001 | 660.2183 | 660.2094 | -0.0089 |
| primary | 0bp | `ito_tsfm` | 17.0518 | 17.0514 | -0.0004 | 1.2133 | 1.2132 | -0.0001 | -19.9878 | -19.9878 | +0.0000 | 2656.0403 | 2656.0718 | +0.0315 |
| primary | 0bp | `proposed` | 15.1099 | 15.1096 | -0.0003 | 1.1556 | 1.1556 | +0.0000 | -19.3058 | -19.3058 | +0.0000 | 2804.3802 | 2804.4116 | +0.0314 |
| primary | 10bp | `6040` | 10.3739 | 10.3739 | +0.0000 | 0.7723 | 0.7723 | +0.0000 | -19.1837 | -19.1837 | +0.0000 | 20.7237 | 20.7237 | +0.0000 |
| primary | 10bp | `ew` | 12.9256 | 12.9256 | +0.0000 | 0.9760 | 0.9760 | +0.0000 | -17.5051 | -17.5051 | +0.0000 | 39.2254 | 39.2254 | +0.0000 |
| primary | 10bp | `mvo` | 12.8906 | 12.8906 | +0.0000 | 0.9130 | 0.9130 | +0.0000 | -15.1704 | -15.1703 | +0.0001 | 835.0180 | 835.0167 | -0.0013 |
| primary | 10bp | `ito_hist` | 12.6977 | 12.6977 | +0.0000 | 0.8757 | 0.8757 | +0.0000 | -19.2384 | -19.2385 | -0.0001 | 660.2183 | 660.2094 | -0.0089 |
| primary | 10bp | `ito_tsfm` | 13.9717 | 13.9713 | -0.0004 | 0.9903 | 0.9903 | +0.0000 | -20.0610 | -20.0610 | +0.0000 | 2656.0403 | 2656.0718 | +0.0315 |
| primary | 10bp | `proposed` | 11.9146 | 11.9142 | -0.0004 | 0.9002 | 0.9002 | +0.0000 | -19.6722 | -19.6722 | +0.0000 | 2804.3802 | 2804.4116 | +0.0314 |
| primary | 20bp | `6040` | 10.3395 | 10.3395 | +0.0000 | 0.7695 | 0.7695 | +0.0000 | -19.1875 | -19.1875 | +0.0000 | 20.7237 | 20.7237 | +0.0000 |
| primary | 20bp | `ew` | 12.8696 | 12.8696 | +0.0000 | 0.9715 | 0.9715 | +0.0000 | -17.5090 | -17.5090 | +0.0000 | 39.2254 | 39.2254 | +0.0000 |
| primary | 20bp | `mvo` | 11.9396 | 11.9396 | +0.0000 | 0.8421 | 0.8421 | +0.0000 | -16.2070 | -16.2070 | +0.0000 | 835.0180 | 835.0167 | -0.0013 |
| primary | 20bp | `ito_hist` | 11.9435 | 11.9436 | +0.0001 | 0.8209 | 0.8209 | +0.0000 | -19.3023 | -19.3023 | +0.0000 | 660.2183 | 660.2094 | -0.0089 |
| primary | 20bp | `ito_tsfm` | 10.9705 | 10.9700 | -0.0005 | 0.7670 | 0.7669 | -0.0001 | -20.1341 | -20.1341 | +0.0000 | 2656.0403 | 2656.0718 | +0.0315 |
| primary | 20bp | `proposed` | 8.8058 | 8.8055 | -0.0003 | 0.6446 | 0.6446 | +0.0000 | -20.0371 | -20.0371 | +0.0000 | 2804.3802 | 2804.4116 | +0.0314 |
| secondary | 0bp | `6040` | 10.1174 | 10.1174 | +0.0000 | 0.7701 | 0.7701 | +0.0000 | -19.1800 | -19.1799 | +0.0001 | 21.2963 | 21.2963 | +0.0000 |
| secondary | 0bp | `ew` | 12.0092 | 12.0092 | +0.0000 | 0.9412 | 0.9412 | +0.0000 | -17.5011 | -17.5011 | +0.0000 | 38.1958 | 38.1958 | +0.0000 |
| secondary | 0bp | `mvo` | 12.1967 | 12.1967 | +0.0000 | 0.9090 | 0.9090 | +0.0000 | -14.8751 | -14.8751 | +0.0000 | 829.7567 | 829.7572 | +0.0005 |
| secondary | 0bp | `ito_hist` | 12.0124 | 12.0125 | +0.0001 | 0.8671 | 0.8671 | +0.0000 | -19.1745 | -19.1746 | -0.0001 | 613.9553 | 613.9472 | -0.0081 |
| secondary | 0bp | `ito_tsfm` | 14.7741 | 14.7736 | -0.0005 | 1.1026 | 1.1026 | +0.0000 | -19.9878 | -19.9878 | +0.0000 | 2597.1771 | 2597.1686 | -0.0085 |
| secondary | 0bp | `proposed` | 13.1728 | 13.1723 | -0.0005 | 1.0472 | 1.0471 | -0.0001 | -19.3058 | -19.3058 | +0.0000 | 2749.5413 | 2749.5324 | -0.0089 |
| secondary | 10bp | `6040` | 10.0844 | 10.0844 | +0.0000 | 0.7673 | 0.7673 | +0.0000 | -19.1837 | -19.1837 | +0.0000 | 21.2963 | 21.2963 | +0.0000 |
| secondary | 10bp | `ew` | 11.9568 | 11.9568 | +0.0000 | 0.9367 | 0.9367 | +0.0000 | -17.5051 | -17.5051 | +0.0000 | 38.1958 | 38.1958 | +0.0000 |
| secondary | 10bp | `mvo` | 11.2596 | 11.2596 | +0.0000 | 0.8342 | 0.8342 | +0.0000 | -15.1704 | -15.1703 | +0.0001 | 829.7567 | 829.7572 | +0.0005 |
| secondary | 10bp | `ito_hist` | 11.3164 | 11.3164 | +0.0000 | 0.8132 | 0.8132 | +0.0000 | -19.2384 | -19.2385 | -0.0001 | 613.9553 | 613.9472 | -0.0081 |
| secondary | 10bp | `ito_tsfm` | 11.8215 | 11.8209 | -0.0006 | 0.8722 | 0.8721 | -0.0001 | -20.0610 | -20.0610 | +0.0000 | 2597.1771 | 2597.1686 | -0.0085 |
| secondary | 10bp | `proposed` | 10.0933 | 10.0928 | -0.0005 | 0.7841 | 0.7840 | -0.0001 | -19.6722 | -19.6722 | +0.0000 | 2749.5413 | 2749.5324 | -0.0089 |
| secondary | 20bp | `6040` | 10.0514 | 10.0514 | +0.0000 | 0.7645 | 0.7645 | +0.0000 | -19.1875 | -19.1875 | +0.0000 | 21.2963 | 21.2963 | +0.0000 |
| secondary | 20bp | `ew` | 11.9044 | 11.9044 | +0.0000 | 0.9323 | 0.9323 | +0.0000 | -17.5090 | -17.5090 | +0.0000 | 38.1958 | 38.1958 | +0.0000 |
| secondary | 20bp | `mvo` | 10.3300 | 10.3300 | +0.0000 | 0.7593 | 0.7593 | +0.0000 | -16.2070 | -16.2070 | +0.0000 | 829.7567 | 829.7572 | +0.0005 |
| secondary | 20bp | `ito_hist` | 10.6245 | 10.6245 | +0.0000 | 0.7593 | 0.7593 | +0.0000 | -19.3023 | -19.3023 | +0.0000 | 613.9553 | 613.9472 | -0.0081 |
| secondary | 20bp | `ito_tsfm` | 8.9427 | 8.9422 | -0.0005 | 0.6415 | 0.6415 | +0.0000 | -20.1341 | -20.1341 | +0.0000 | 2597.1771 | 2597.1686 | -0.0085 |
| secondary | 20bp | `proposed` | 7.0956 | 7.0951 | -0.0005 | 0.5211 | 0.5211 | +0.0000 | -20.0371 | -20.0371 | +0.0000 | 2749.5413 | 2749.5324 | -0.0089 |
