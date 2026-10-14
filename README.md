# AlphaQuant: Real-Market Empirical Reproduction Pipeline
### Itô × TSFM Volatility-Drag Framework Companion

[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-45%20Passed-success)](tests/)
[![Paper Repo](https://img.shields.io/badge/Paper_Repo-PJH720%2Falphaquant--tsfm--voldrag-blue?logo=github)](https://github.com/PJH720/alphaquant-tsfm-voldrag)
[![Live Demo](https://img.shields.io/badge/Vercel_Demo-alphaquant--voldrag--demo-black?logo=vercel)](https://alphaquant-voldrag-demo.vercel.app)

---

## 📌 Overview

This repository is the official **empirical reproduction companion** to [`PJH720/alphaquant-tsfm-voldrag`](https://github.com/PJH720/alphaquant-tsfm-voldrag). 

While the companion repository presents the research paper, mathematical proofs, and simulation-based analysis submitted to the **2026 연합 경제 학술제 (Sogang Univ. · Sungkyunkwan Univ. · Ewha Womans Univ.)**, this repository rebuilds the entire quantitative framework using **actual real-world market prices and macroeconomic time series**, reporting the empirical results completely unedited with pre-registered integrity.

| Dimension | Paper Repo (Theory & Simulation) | Empirical Repo (Real-Data Reproduction) |
|---|---|---|
| **Repository** | [`PJH720/alphaquant-tsfm-voldrag`](https://github.com/PJH720/alphaquant-tsfm-voldrag) | [`PJH720/alphaquant-tsfm-voldrag-empirical`](https://github.com/PJH720/alphaquant-tsfm-voldrag-empirical) |
| **Figures** | Analytic formulation & GBM Monte Carlo | Real market prices (KRX, US ETF, FX) & FRED macro series |
| **Models** | Mathematical formulation | Chronos-Bolt zero-shot moments, Itô-Kelly CVaR QP, NDE Autoencoder |
| **Protocol** | Theoretical framework | Hyperparameters pre-registered prior to data ingestion; results reported as-is |
| **Artifacts** | Paper manuscript, research slides, citation | Reproducible pipeline, test suite, and interactive Next.js web application |

---

## 🔗 Key Links & Deliverables

- 📊 **Live Interactive Dashboard**: [alphaquant-voldrag-demo.vercel.app](https://alphaquant-voldrag-demo.vercel.app)
- 📑 **Companion Paper Repository**: [PJH720/alphaquant-tsfm-voldrag](https://github.com/PJH720/alphaquant-tsfm-voldrag)
- 🎯 **Presentation Slide Deck (PDF)**: [Google Drive Slide Deck](https://drive.google.com/file/d/1WZzcCbN3eu82t1ncEctKWJ_VqR8GhlLW/view?usp=sharing)
- 📄 **Research Paper Manuscript (PDF)**: [Google Drive Paper Manuscript](https://drive.google.com/file/d/19fN7rLw76XGthML_M3ARB8wZMfzs_1w9/view?usp=sharing)

---

## 🛡️ Research Integrity & Pre-registration

To eliminate look-ahead bias and p-hacking, this project adheres to strict open-science protocols:

1. **Pre-registration ([`PREREGISTRATION.md`](PREREGISTRATION.md))**: Committed prior to downloading market data or running backtest pipelines. All model hyperparameters were locked in advance.
2. **Transparent Amendment Tracking ([`CHANGELOG.md`](CHANGELOG.md))**: Every operational modification made before running the first backtest is documented with full rationale:
   - Data start date alignment (`2012-12-03` to secure full 504-day rolling windows),
   - `BAA10Y` substitute for discontinued FRED high-yield spreads (`BAMLH0A0HYM2`),
   - KOSDAQ composite (`^KQ11`) proxy prior to ETF listing,
   - VKOSPI proxy via realized 21-day volatility.
3. **No Look-Ahead Guarantee Across Time Zones**: US market closes and FX fixes occur after KRX close. All US assets and FX rates used on KRX trade date $t$ strictly precede $t$.
4. **Data Verification Suite ([`DATA.md`](DATA.md))**: All ingested market data is validated against published benchmark indices (KOSPI year-end closes, ETF annual returns, FRED stress events). Lightweight verified Parquet datasets (~776 KB) and Chronos-Bolt forecast caches (~92 KB) are committed in `data/` for instant zero-dependency offline reproduction; SHA-256 integrity digests are maintained in [`data/manifest.json`](data/manifest.json).

---

## ⚙️ Architecture & Pipeline

```
src/voldrag/
├── data.py          KRX calendar synchronization; 069500/148070/229200(.KS), SPY/QQQ/GLD/SHV × USD/KRW,
│                    FRED macro series (strict t-1 lag for international/FX observations)
├── models.py        Ledoit-Wolf covariance shrinkage + Higham nearest correlation projection
│                    Chronos-Bolt zero-shot quantile forecasts → μ̂, σ̂
│                    Itô-Kelly QP: min ½w'Σw − μ'w s.t. CVaR95 ≤ CVaR95(1/N), 0 ≤ w ≤ 0.40
│                    MVO baseline & 12→8→4→8→12 NDE autoencoder tail safeguard (frozen post warm-up)
├── backtest.py      Weekly/monthly execution schedules, price-drift tracking, transaction cost models,
│                    performance attribution, stationary block-bootstrap Sharpe test
├── run.py           End-to-end reproduction runner → results/REPORT.md, results.json, DATA.md
├── export_web.py    Exports JSON telemetry to web/public/data/ for static and live web visualization
└── api/             FastAPI server for real-time exploratory parameter simulation
```

### Evaluated Strategies
- **Benchmarks**: $60/40$ traditional balanced, Equal-Weight ($1/N$), Mean-Variance Optimization (MVO).
- **Ablations**: `ito_hist` (Itô-Kelly with historical sample moments), `ito_tsfm` (Itô-Kelly with Chronos-Bolt moments, no safeguard).
- **Proposed Model**: Itô-Kelly + Chronos-Bolt TSFM + NDE Autoencoder Tail Risk Safeguard.

### Evaluation Periods
- **Primary Period**: `2017-01-02` → `2026-08-31` (Strictly out-of-sample across all components including the safeguard).
- **Secondary Period**: `2015-01-02` → `2026-08-31` (Matches the paper's original span; safeguard in-sample during 2015–2016).

---

## 🚀 Quickstart & Reproduction

### Prerequisites
- Python 3.11+ and [`uv`](https://docs.astral.sh/uv/) package manager
- Node.js 20+ and [`pnpm`](https://pnpm.io/) (for web dashboard)

```bash
# 1. Clone repository
git clone https://github.com/PJH720/alphaquant-tsfm-voldrag-empirical.git
cd alphaquant-tsfm-voldrag-empirical

# 2. Synchronize Python environment
uv sync

# 3. Run regression and data integrity tests (45 tests)
uv run pytest

# 4. Execute full empirical reproduction run
# Downloads and caches market series; generates results/REPORT.md and results/results.json
uv run python -m voldrag.run
```

Detailed reproduction report: [`results/REPORT.md`](results/REPORT.md).

---

## 💻 Web Dashboard (`web/`)

A production-ready Next.js web application built with TypeScript and Recharts, deployed live at [alphaquant-voldrag-demo.vercel.app](https://alphaquant-voldrag-demo.vercel.app).

All numbers displayed on the dashboard are read directly from `web/public/data/*.json`, which are exported from the committed `results/` without exposing raw tick or price series.

```bash
# Export results to web JSON format
uv run python -m voldrag.export_web

# Run local web dashboard
cd web
pnpm install
pnpm build
pnpm start
```

### Exploratory Live Simulation Lab (`src/voldrag/api/`)
Section 3 of the web platform features a live interactive laboratory powered by a local FastAPI backend and Cloudflare Quick Tunnel. It allows real-time exploration of transaction costs ($0 \sim 30\text{bp}$), safeguard threshold multipliers ($k$), cash overlay floors ($\beta$), and risk-aversion parameters ($\lambda, \lambda_{\text{tc}}$).

```bash
# Launch live backend and tunnel
scripts/start_live_backend.sh
```

---

## 📊 Key Empirical Findings

All figures below reflect the **primary out-of-sample period (2017–2026)** with standard $10\text{bp}$ transaction costs unless noted. Full metrics are in [`results/REPORT.md`](results/REPORT.md).

1. **Reproduction Gap with Simulation Parameters**:
   - The proposed model achieves **CAGR 11.91%, Sharpe 0.90, MDD −19.67%** on real market series (vs. 14.82% / 1.68 / −8.34% under stylized simulation assumptions).
   - Relative to classical MVO (Sharpe 0.91), the Sharpe difference is $-0.013$ ($p = 0.96$ via stationary block bootstrap), demonstrating no statistically significant risk-adjusted outperformance under high friction.
2. **Empirical Validation of the Itô Volatility-Drag Identity**:
   - The mathematical relationship $\mu_{\text{arith}} - g \approx \frac{1}{2}\sigma^2$ holds rigorously across all empirical asset and strategy return trajectories (within $0.01\%p$). While the theoretical identity is sound, the proposed model does not reduce portfolio-level volatility drag relative to standard benchmarks.
3. **Transaction Cost Drag as Primary Friction**:
   - Weekly re-optimization driven by foundation model quantile updates generates annual turnover of $\sim 2,800\%$.
   - At $0\text{bp}$ costs, the model yields CAGR 15.11% and Sharpe 1.16; at $10\text{bp}$ this degrades to 11.91% / 0.90, and at $20\text{bp}$ to 8.81% / 0.64.
4. **Tail Safeguard Effectiveness During Market Crises**:
   - **2020 COVID-19 Shock**: The safeguard triggered early on `2020-02-03`, increasing cash allocation to an average of $69\%$. The maximum drawdown was constrained to **$-4.65\%$** (vs. $-19.18\%$ for $60/40$ and $-10.64\%$ for MVO).
   - **2022 Monetary Tightening**: Episode return was $-7.46\%$ (vs. $-11.90\%$ for $60/40$).
   - Across the entire sample, however, repeated protective cash overlays induce a cash drag that moderates net CAGR.

---

## 📜 Citation

If you reference this empirical pipeline or benchmark findings, please cite as:

```bibtex
@software{park_kang_2026_alphaquant_empirical,
  author    = {JaeHyun Park and Myeongseo Kang},
  title     = {AlphaQuant: Real-Market Data Reproduction and Empirical Evaluation Pipeline for Itô × TSFM Volatility-Drag Portfolio Framework},
  year      = {2026},
  publisher = {GitHub},
  journal   = {2026 연합 경제 학술제},
  url       = {https://github.com/PJH720/alphaquant-tsfm-voldrag-empirical}
}
```

---

## 📄 License

This software and reproduction pipeline are distributed under the [MIT License](LICENSE).
Historical market datasets bundled in `data/` are aggregated research proxies provided for non-commercial scholarly reproduction purposes.
