# AlphaQuant: Itô × TSFM volatility-drag framework, real-data reproduction

This is the companion to [`PJH720/alphaquant-tsfm-voldrag`](https://github.com/PJH720/alphaquant-tsfm-voldrag). That repo holds the paper submitted to the 2026 연합 경제 학술제, whose figures are **simulation parameters**. This repo rebuilds the same framework from **real market data** and reports whatever comes out.

| | Paper repo (presentation) | This repo (reproduction) |
|---|---|---|
| Figures | Simulation parameters + analytic / GBM Monte Carlo | Computed from market prices and macro series |
| Models | Formulation only | Chronos-Bolt zero-shot moments, Itô-Kelly CVaR QP, NDE autoencoder safeguard |
| Rule | Matches the judged manuscript | Hyperparameters pre-registered before any data download; results reported as-is |

## Integrity

1. [`PREREGISTRATION.md`](PREREGISTRATION.md) was committed before any data download or backtest. See its git timestamp.
2. [`CHANGELOG.md`](CHANGELOG.md) logs every amendment and when it happened relative to the first results:
   - data start,
   - the BAA10Y substitute for the high-yield spread (HY OAS),
   - the KOSDAQ pre-listing proxy,
   - the VKOSPI fallback.
3. The pipeline code and the no-look-ahead tests were committed before the first results run.
4. [`DATA.md`](DATA.md) lists every proxy, splice and staleness figure. Raw vendor data is not redistributed; [`data/manifest.json`](data/manifest.json) records SHA-256 hashes of the files used.

## Pipeline

```
data.py      KRX calendar; 069500/148070/229200(.KS), SPY/QQQ/GLD/SHV × USD/KRW, FRED macro
             (US/FX values lagged strictly before each KRX date)
models.py    Ledoit-Wolf + Higham moments · Chronos-Bolt quantile forecasts → μ̂, σ̂
             Itô-Kelly QP: min ½w'Σw − μ'w s.t. CVaR95 ≤ CVaR95(1/N), 0 ≤ w ≤ 0.40
             max-Sharpe MVO · 12→8→4→8→12 autoencoder (warm-up 2015–16, frozen)
backtest.py  weekly/monthly schedules, drift-aware simulation, turnover costs,
             metrics, block-bootstrap Sharpe test
run.py       end-to-end → results/REPORT.md, results/results.json, DATA.md
```

Strategies:
- `6040`, `ew`, `mvo` (benchmarks)
- `ito_hist`, `ito_tsfm` (ablations)
- `proposed` (Itô-Kelly + Chronos + safeguard)

Periods:
- **Primary** 2017-01 → 2026-08, fully out-of-sample.
- **Secondary** 2015-01 → 2026-08, the paper's period, with the safeguard in-sample for 2015–16.

## Run

```bash
uv sync
uv run pytest                    # synthetic-data timing/constraint tests + real-data reference checks (needs network)
uv run python -m voldrag.run     # downloads data (cached in data/raw), ~1–2 min with a CUDA GPU (first run also downloads data and model weights)
```

Results: [`results/REPORT.md`](results/REPORT.md).

## Demo site (`web/`)

Live: **https://alphaquant-voldrag-demo.vercel.app** (Vercel project `alphaquant-voldrag-demo`).

A static dashboard for the presentation: Next.js static export with Recharts. Every number on it comes from `web/public/data/*.json`, which `voldrag.export_web` generates from the committed `results/` and the submission bundle in the presentation repo. It shows no raw prices and no per-asset daily returns.

Regenerate the data and run the site locally. The built `web/out` works offline; fonts are self-hosted.

```bash
uv run python -m voldrag.export_web          # results/ -> web/public/data/*.json (fetches the submission bundle via gh)
cd web && pnpm i && pnpm build && npx serve out
```

To deploy to Vercel, use the `web/` directory as the project root. `web/vercel.json` sets framework nextjs, pnpm install and `pnpm build`.

```bash
cd web
npx vercel login                 # once
npx vercel link                  # create or link the project (Root Directory: web/)
npx vercel deploy --prod         # same as: pnpm deploy
```

Alternatively, import the GitHub repo in the Vercel dashboard and set Root Directory = `web`, Framework = Next.js.

### Live lab (section 3): real-time backend on the lab workstation

Section 3 of the site talks to a FastAPI server (`src/voldrag/api/`) running on the GPU workstation, exposed through a Cloudflare Quick Tunnel. It is **exploratory** (PREREGISTRATION.md §8): sliders move the transaction cost (0–30bp), a multiplier k on the safeguard threshold τ, a floor on the cash overlay β, the QP risk aversion λ (grid 0.5–4; λ = 1 is eq. 30) and an L1 turnover penalty λ_tc (grid 0–0.5; 0 = pre-registered; see `voldrag.exploratory_turnover`). At the pre-registered settings the server reproduces `results/results.json`; it checks 120 values against that file on every start and the site shows the result. The backtest is path-dependent and runs in float64 NumPy on the CPU (~10–40 ms). Chronos-Bolt runs on CUDA (~35–70 ms per call); in fp32 it matches the pre-registered forecast cache exactly. Only strategy-level results and model outputs leave the server.

```bash
scripts/start_live_backend.sh   # API on 127.0.0.1:8000 + tunnel; prints  <site>/?api=https://<random>.trycloudflare.com#live
```

Open the printed link, or paste the tunnel URL into "백엔드 주소 설정" on the site (remembered per browser). `NEXT_PUBLIC_GPU_API_URL` sets a build-time default. Without a reachable backend, the section shows the pre-computed results and a yellow "정적 모드" badge. The first start takes ~2.5 min to build and cache the 54 (λ, λ_tc) target sets in `data/cache/` (in parallel); later starts take a few seconds. Needs `cloudflared` on PATH and `uv sync --group live`.

## Key findings (first pre-registered run, 2026-10-07)

All figures are for the primary out-of-sample period 2017-01 → 2026-08 with 10bp costs, unless noted. The full tables are in the report.

1. **The paper's headline performance is not reproduced.**
   - The proposed model makes CAGR 11.91%, Sharpe 0.90, MDD −19.67%. The paper's simulation parameters say 14.82% / 1.68 / −8.34%.
   - Against MVO (Sharpe 0.91) the Sharpe difference is −0.013, with a block-bootstrap p-value of 0.96. There is no significant difference.
2. **The Itô volatility-drag identity holds on real data.** Empirical drag (μ_arith − g) matches ½σ² to within 0.01%p for every strategy, e.g. proposed 0.67% vs 0.67%. The paper's theoretical core is consistent with the data. The proposed model does **not**, however, cut drag relative to the benchmarks (60/40: 0.68%).
3. **Transaction costs are the main failure mode.**
   - Chronos-driven weekly re-optimization trades heavily: about 2,800% annual turnover for the proposed model.
   - At 0bp the proposed model makes CAGR 15.11% and Sharpe 1.16. At 10bp that falls to 11.91% / 0.90, and at 20bp to 8.81% / 0.64.
   - The paper's cost-sensitivity figures (14.63%, 14.44%) are not supported.
4. **The safeguard does act in crises.**
   - 2020: first trigger on 2020-02-03 (the paper's narrative said 02-26). Mean cash weight was 69%. The episode MDD was −4.65%, against −19.18% for 60/40 and −10.64% for MVO.
   - 2022: the episode return was −7.46%, against −11.90% for 60/40.
   - Over the full period, though, it lowers CAGR (13.97% → 11.91%) through cash drag and extra trades.
5. **Best risk-adjusted results:** the Itô-Kelly + Chronos ablation (no safeguard; Sharpe 0.99) and equal weight (0.98).

Caveats:
- The "cash" asset is SHV converted to KRW, so it carries FX risk (σ ≈ 9%).
- The safeguard threshold in early 2017 uses 2016 scores, which are in-sample for the autoencoder.
- 2026 contains extreme KOSPI moves, e.g. +24% on 2026-07-31. These were checked across 069500.KS, 102110.KS and ^KS11.
