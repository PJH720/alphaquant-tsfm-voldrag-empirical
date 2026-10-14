# Pre-registration

Committed **before any market data was downloaded or any backtest was run**. The git timestamp of this file is the evidence. Every hyperparameter below is fixed. No search, tuning or re-selection is allowed after results are seen.

Source of each choice: **[P]** = stated in the paper manuscript, **[R]** = not specified in the paper, so fixed here by rule.

## 1. Purpose

Reproduce the framework of 『이토 보조정리와 시계열 파운데이션 모델(TSFM)을 결합한 동적 자산배분 및 변동성 항력 제어 프레임워크』 on **real market data**. The submitted paper's figures are simulation parameters (see the companion repo `PJH720/alphaquant-tsfm-voldrag`). This repo reports what real data gives, **whatever it is**, including results worse than the paper's.

## 2. Universe (7 assets, KRW total return)

| # | Paper asset [P] | Series used here [R] | Why |
|---|---|---|---|
| 1 | KOSPI 200 (069500) | `069500.KS` adjusted close | Listed 2002; same as paper |
| 2 | KOSDAQ 150 (229200) | KOSDAQ 150 index (pykrx) before the ETF listing, then `229200.KS` adjusted close, chain-linked on returns | The ETF was listed in 2015-10, after the paper's start date |
| 3 | 국고채 10년 (148070) | `148070.KS` adjusted close | Listed 2011 |
| 4 | S&P 500 (TIGER) | `SPY` adjusted close × USD/KRW | The TIGER ETF was listed in 2020-08 |
| 5 | 나스닥 100 (TIGER) | `QQQ` adjusted close × USD/KRW | Long history, total return |
| 6 | 금 (KRX 금현물 / GLD) | `GLD` adjusted close × USD/KRW | The paper names GLD as an option |
| 7 | 현금 (SHV / KOFR) | `SHV` adjusted close × USD/KRW | The paper names SHV |

- USD/KRW is FRED `DEXKOUS`.
- **Calendar:** KRX trading days.
- **No look-ahead across time zones:** US closes and the FX fix happen after the KRX close. The US-asset and FX value used on KRX date *t* is the last observation on a calendar date strictly before *t*.
- Missing values: forward-fill ≤ 5 days; longer gaps are reported in `DATA.md`.
- Any deviation found while fetching (missing series, splice dates, actual listing dates) is recorded in `DATA.md`. The universe itself is **not** changed after seeing returns.

## 3. Periods

- **Data start:** 2013-01-02, so the W=504 windows exist at 2015-01. **[R]**
- **Autoencoder warm-up:** 2015-01-02 to 2016-12-30; weights frozen afterward. **[P]**
- **Primary evaluation:** 2017-01-02 to 2026-08-31. Every component, the safeguard included, is out-of-sample here. **[R]**
- **Secondary evaluation:** 2015-01-02 to 2026-08-31, the paper's period **[P]**. The safeguard is in-sample during 2015–2016, which is flagged in every table.

## 4. Strategies

All long-only and fully invested. Weights are decided with information through the close of *t* and earn returns from *t+1*. Between rebalances the weights drift with returns.

| ID | Strategy | Rebalancing | Definition |
|---|---|---|---|
| `6040` | Traditional 60/40 **[P]** | Monthly (last KRX day) **[P]** | 60% S&P 500, 40% 국고채 10년 |
| `ew` | Equal weight **[P]** | Monthly **[R]** | 1/7 each |
| `mvo` | Static Markowitz max-Sharpe **[P]** | Weekly **[R]** | 252-day sample mean and sample covariance **[P]**; 0 ≤ w ≤ 0.40 **[R]**, same cap as proposed; r_f = 2%. If no asset has a positive excess mean → minimum variance. |
| `ito_hist` | Itô-Kelly QP, historical moments (ablation) | Weekly **[P]** | Eqs. (30)–(31) with μ̂ = 504-day mean of simple returns, Σ̂ = Ledoit-Wolf on 504 days + Higham projection |
| `ito_tsfm` | Itô-Kelly QP, TSFM moments (ablation) | Weekly | Same QP; μ̂, σ̂ from Chronos (§5); correlation from the historical Ledoit-Wolf/Higham estimate |
| `proposed` | `ito_tsfm` + NDE autoencoder safeguard **[P]** | Weekly + safeguard trades | §6 |

**QP (eqs. 30–31) [P]:** min ½wᵀΣ̂w − μ̂ᵀw (Kelly λ = 1); 1ᵀw = 1; 0 ≤ wᵢ ≤ 0.40; Rockafellar–Uryasev CVaR₉₅ ≤ γ_target over the K = 504 most recent daily return scenarios. μ̂ and Σ̂ are on the same (annualized) scale.

**γ_target [R]:** the paper does not give a value. It is fixed as the 95% daily CVaR of the equal-weight portfolio on the same 504 scenarios. Equal weight always satisfies every constraint, so the problem is always feasible. Solver: CLARABEL via cvxpy.

**Higham projection [R]:** the nearest correlation matrix (Higham 2002, alternating projections, tol 1e-10, max 1,000 iterations). This fixes the eigenvalue-floor shortcut flagged in the companion repo's ledger (eq. 25).

## 5. TSFM moments [P → R where unspecified]

- Model: `amazon/chronos-bolt-small` [R], zero-shot, no fine-tuning. Chronos does its own instance scaling from the context window only, which serves as the RevIN-style 𝓕ₜ-measurable normalization.
- Input: the last W = 504 daily log returns per asset [P]. Horizon: 5 trading days (one week) [R].
- μ̂ (daily) = mean over the horizon of the predicted median. σ̂ (daily) = mean over the horizon of (q₀.₉ − q₀.₁)/2.5631. Both are annualized ×252 and ×√252 respectively, then converted from log to simple: μ_simple ≈ μ_log + ½σ².
- **PatchTST is not reproduced:** it is not a pretrained zero-shot model, so including it would need training choices the paper does not give.

## 6. NDE autoencoder safeguard [P]

- **State vector z_t (12-dim) [P]:**
  - The 7 assets' 21-day realized volatility, √(252·mean r²).
  - VIX (FRED `VIXCLS`).
  - VKOSPI (pykrx). If unavailable, it is replaced by the 21-day realized volatility of asset 1, recorded in `DATA.md`.
  - US 10Y–2Y (FRED `T10Y2Y`).
  - US HY OAS (FRED `BAMLH0A0HYM2`).
  - USD/KRW 21-day realized volatility.
  - US/FX series use the same strictly-before-*t* lag as §2.
- Standardization: mean and std from the warm-up only, frozen.
- Network: 12 → 8 → 4 → 8 → 12, sigmoid hidden activations [P], linear output [R]. MSE loss, Adam lr 1e-3, 500 epochs full-batch, seed 20261007 [R]. Trained on the warm-up only, then frozen [P].
- **Score:** S_t = 0.8·S_{t−1} + 0.2·L_recon(z_t) [P].
- **Threshold:** τ_t = 95th percentile of {S_u}, u ∈ [t−252, t−1] [P].
- **Buffer:** β_t = 0 if S_t ≤ τ_t; otherwise min(1, 2·tanh-form of eq. (28) with κ = 4.0) [P].
- **Weights:** w*_t = (1−β_t)·w_opt + β_t·e_cash [P].
- Safeguard trades [R]: β is evaluated daily. A trade occurs on a weekly rebalance date, or on any day where |β_t − β_current| > 0.05.

## 7. Costs and metrics

- **Costs:** TC_t = c·Σ|w_t − w_t⁻| on every trade [P]. c = 10bp base; sensitivity at 0 and 20bp [P].
- **CAGR:** (W_T/W_0)^(1/years) − 1 with actual calendar years [R]. This fixes the 11.5-year shortcut.
- **Sharpe:** (annualized arithmetic mean of daily simple returns − 2%) / annualized std. This is eq. (33b) **as written** [P].
- **Sortino:** daily r_f = 2%/252; downside deviation over daily excess returns [R].
- **Also reported:** MDD, Calmar, 95% daily CVaR, annual turnover, empirical drag (μ_arith − g) vs ½σ², 10-year wealth loss, skewness, excess kurtosis, JB and ADF per asset.
- **Significance:** circular block bootstrap of the Sharpe difference (proposed − mvo), block 10 [P], B = 10,000 [P], seed 20261007. Two-sided p-value.
- **Episodes:** 2020-02-01 to 2020-04-30 and 2022-01-01 to 2022-12-31. Per strategy: return and MDD; for `proposed`, the actual dates where β_t > 0.

## 8. Reporting rules

- All results go to `results/` and `results/REPORT.md`, with a paper-vs-reproduced column wherever the paper gives a number.
- **No result is omitted.** A null or negative result is reported as such.
- Bug fixes after the first results run are allowed only for code defects (not parameter changes). Each one is logged in `CHANGELOG.md` with the reason, and all results are regenerated.
- Any analysis not listed here is labelled **exploratory** in the report.
