"""FastAPI server for the demo site's live lab.  `uv run --group live uvicorn voldrag.api.server:app`

EXPLORATORY (PREREGISTRATION.md §8). Endpoints return strategy-level results and model outputs
only: no prices, no per-asset realized returns (Yahoo redistribution terms).
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Literal

import numpy as np
import pandas as pd
import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field, field_validator

from voldrag import config as C
from voldrag.api.engine import (
    BENCHMARKS,
    LAMBDA_GRID,
    PREREGISTERED,
    TURNOVER_PENALTY_GRID,
    LiveEngine,
)

COST_RANGE = (0.0, 30.0)
K_RANGE = (0.5, 2.5)
FLOOR_RANGE = (0.0, 0.5)
HORIZON_RANGE = (1, 20)
SWEEP_COSTS = np.arange(COST_RANGE[0], COST_RANGE[1] + 1.0)
DTYPE = {"float32": torch.float32, "float16": torch.float16}[os.environ.get("VOLDRAG_LIVE_DTYPE", "float32")]
ASSET_ALIASES = {"069500.KS": "KOSPI200", "229200.KS": "KOSDAQ150", "148070.KS": "KTB10Y",
                 "SPY": "SP500", "QQQ": "NASDAQ100", "GLD": "GOLD", "SHV": "CASH"}
RATE_LIMIT = {"/api/simulate": (40, 10.0), "/api/infer_tsfm": (12, 10.0)}  # requests per seconds, per client

state: dict = {}
gpu_lock = threading.Lock()
latency: dict[str, deque] = defaultdict(lambda: deque(maxlen=200))
hits: dict[tuple[str, str], deque] = defaultdict(deque)
STARTED = time.time()


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["engine"] = LiveEngine()
    if torch.cuda.is_available():  # load Chronos and warm up CUDA kernels before the first request
        _forecast("SP500", state["engine"].returns.index[-1], C.HORIZON)
    yield


app = FastAPI(title="voldrag live lab", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=2000)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"], max_age=600)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    rule = RATE_LIMIT.get(request.url.path)
    if rule and request.method == "POST":
        client = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
        q, now = hits[(client, request.url.path)], time.monotonic()
        while q and now - q[0] > rule[1]:
            q.popleft()
        if len(q) >= rule[0]:
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "rate limited"}, status_code=429)
        q.append(now)
    return await call_next(request)


def _r(x: float, d: int = 4) -> float | None:
    return None if x is None or not np.isfinite(x) else round(float(x), d)


# --------------------------------------------------------------------------- health
def _gpu() -> dict:
    if not torch.cuda.is_available():
        return {"available": False, "device": "cpu"}
    props = torch.cuda.get_device_properties(0)
    free, total = torch.cuda.mem_get_info(0)
    return {
        "available": True, "device": "cuda", "name": torch.cuda.get_device_name(0),
        "cuda_version": torch.version.cuda, "torch_version": torch.__version__,
        "compute_capability": f"{props.major}.{props.minor}",
        "vram_total_mb": round(total / 2**20), "vram_used_device_mb": round((total - free) / 2**20),
        "vram_allocated_process_mb": round(torch.cuda.memory_allocated(0) / 2**20),
        "vram_reserved_process_mb": round(torch.cuda.memory_reserved(0) / 2**20),
    }


@app.get("/api/health")
def health() -> dict:
    eng: LiveEngine | None = state.get("engine")
    idx = eng.returns.index if eng else None
    return {
        "status": "ok" if eng else "starting",
        "server_time": datetime.now(UTC).isoformat(),
        "gpu": _gpu(),
        "chronos": {"model": C.CHRONOS_MODEL, "dtype": str(DTYPE).replace("torch.", ""),
                    "loaded": bool(eng and eng._chronos is not None)},
        "self_check": eng.self_check_result if eng else None,
        "label": "EXPLORATORY: not pre-registered (PREREGISTRATION.md §8)",
        "preregistered": PREREGISTERED,
        "ranges": {"cost_bp": COST_RANGE, "k_tau": K_RANGE, "cash_floor": FLOOR_RANGE,
                   "lambda_param": LAMBDA_GRID, "lambda_tc": [min(TURNOVER_PENALTY_GRID), max(TURNOVER_PENALTY_GRID)],
                   "horizon": HORIZON_RANGE},
        "grids": {"lambda_tc": TURNOVER_PENALTY_GRID},
        "default_lambda_tc": PREREGISTERED["lambda_tc"],
        "defaults": {"horizon": C.HORIZON},
        "safeguard_spec": {"tau_window": C.TAU_WINDOW, "tau_q": C.TAU_Q, "kappa": C.KAPPA},
        "periods": {p: {"start": s, "end": e} for p, (s, e) in C.PERIODS.items()},
        "assets": C.ASSETS,
        "infer_dates": ({"first": str(idx[C.W_ITO - 1].date()), "last": str(idx[-1].date())} if eng else None),
    }


@app.get("/api/telemetry")
def telemetry() -> dict:
    lat = {k: {"n": len(v), "last_ms": _r(v[-1], 2), "median_ms": _r(float(np.median(v)), 2),
               "p95_ms": _r(float(np.percentile(v, 95)), 2)} for k, v in latency.items() if v}
    return {**health(), "uptime_s": round(time.time() - STARTED), "compute_latency": lat}


# --------------------------------------------------------------------------- simulate
class SimRequest(BaseModel):
    period: Literal["primary", "secondary"] = "primary"
    cost_bp: float = Field(PREREGISTERED["cost_bp"], ge=COST_RANGE[0], le=COST_RANGE[1])
    k_tau: float = Field(PREREGISTERED["k_tau"], ge=K_RANGE[0], le=K_RANGE[1])
    cash_floor: float = Field(PREREGISTERED["cash_floor"], ge=FLOOR_RANGE[0], le=FLOOR_RANGE[1])
    lambda_param: float = PREREGISTERED["lambda_param"]
    lambda_tc: float = Field(PREREGISTERED["lambda_tc"], ge=min(TURNOVER_PENALTY_GRID), le=max(TURNOVER_PENALTY_GRID),
                             description="L1 turnover penalty parameter (EXPLORATORY); one of the precomputed grid values")

    @field_validator("lambda_param")
    @classmethod
    def _on_grid(cls, v: float) -> float:
        if v not in LAMBDA_GRID:
            raise ValueError(f"lambda_param must be one of {LAMBDA_GRID}")
        return v

    @field_validator("lambda_tc")
    @classmethod
    def _on_tc_grid(cls, v: float) -> float:
        match = [g for g in TURNOVER_PENALTY_GRID if np.isclose(v, g, rtol=0, atol=1e-9)]
        if not match:
            raise ValueError(f"lambda_tc must be one of {TURNOVER_PENALTY_GRID}")
        return match[0]


METRIC_KEYS = ("cagr_pct", "sharpe", "mdd_pct", "sigma_pct", "turnover_annual_pct", "emp_drag_pct",
               "theo_drag_pct", "sortino", "calmar")


def _summary(m: dict) -> dict:
    return {k: _r(m[k]) for k in METRIC_KEYS}


def _rolling_annual(to: np.ndarray) -> np.ndarray:
    """Turnover over the trailing TRADING_DAYS days in % (shorter windows at the start are scaled to a year)."""
    c = np.cumsum(to)
    n = np.arange(1, len(to) + 1)
    w = C.TRADING_DAYS
    trailing = c - np.concatenate([np.zeros(w), c[:-w]])[: len(c)]
    return 100 * trailing * w / np.minimum(n, w)


@app.post("/api/simulate")
def simulate(req: SimRequest) -> dict:
    t0 = time.perf_counter()
    eng: LiveEngine = state["engine"]
    p = req.period
    params = req.model_dump(exclude={"period"})
    is_prereg = all(np.isclose(params[k], PREREGISTERED[k]) for k in PREREGISTERED)
    g = eng.proposed_gross(p, req.k_tau, req.cash_floor, req.lambda_param, req.lambda_tc)
    g_ref = eng.proposed_gross(p, *(PREREGISTERED[k] for k in ("k_tau", "cash_floor", "lambda_param", "lambda_tc")))
    r = eng.net(g, req.cost_bp)
    r_ref = eng.net(g_ref, req.cost_bp)
    days = eng.periods[p]["days"]
    triggered = eng.beta(req.k_tau, 0.0).reindex(days).fillna(0.0)  # S > k*tau, before the floor
    bench = {b: eng.net(eng.benchmarks[p][b], req.cost_bp) for b in BENCHMARKS}
    curves = eng.weekly(p, last={"proposed": np.cumprod(1 + r), "proposed_prereg": np.cumprod(1 + r_ref),
                                 "turnover_1y_pct": _rolling_annual(g.to), "turnover_1y_pct_prereg": _rolling_annual(g_ref.to),
                                 **{b: np.cumprod(1 + v) for b, v in bench.items()}},
                        mean={"cash_weight": g.cash, "cash_weight_prereg": g_ref.cash})
    out = {
        "period": p, "start": str(days[0].date()), "end": str(days[-1].date()),
        "params": params, "is_preregistered": bool(is_prereg),
        "label": "PRE-REGISTERED settings" if is_prereg and req.cost_bp in C.COSTS_BP else
                 "EXPLORATORY: not pre-registered (PREREGISTRATION.md §8)",
        "proposed": _summary(eng.metrics(p, r, g)),
        "proposed_prereg_same_cost": _summary(eng.metrics(p, r_ref, g_ref)),
        "benchmarks": {b: _summary(eng.metrics(p, bench[b], eng.benchmarks[p][b])) for b in BENCHMARKS},
        "safeguard": {"days_triggered": int((triggered > 0).sum()), "max_beta": _r(max(triggered.max(), req.cash_floor)),
                      "mean_cash_weight_pct": _r(100 * g.cash.mean()), "n_trades": g.n_trades,
                      "n_trades_prereg": g_ref.n_trades},
        "cost_sweep": {"proposed": eng.cost_sweep(p, g, SWEEP_COSTS),
                       "proposed_prereg": eng.cost_sweep(p, g_ref, SWEEP_COSTS)},
        "curves": curves,
        "compute": {"device": "cpu", "engine": "numpy float64 (path-dependent backtest)"},
    }
    ms = (time.perf_counter() - t0) * 1000
    latency["simulate"].append(ms)
    out["compute"]["ms"] = round(ms, 2)
    return out


# --------------------------------------------------------------------------- Chronos inference
class InferRequest(BaseModel):
    date: str
    horizon: int = Field(C.HORIZON, ge=HORIZON_RANGE[0], le=HORIZON_RANGE[1])
    asset: str = "SP500"
    k_tau: float = Field(1.0, ge=K_RANGE[0], le=K_RANGE[1])


def _forecast(asset: str, date: pd.Timestamp, horizon: int) -> tuple[np.ndarray, float]:
    eng: LiveEngine = state["engine"]
    win = eng.returns.loc[:date].iloc[-C.W_ITO:].to_numpy()  # data dated at or before `date` only
    context = torch.tensor(np.log1p(win).T, dtype=torch.float32)
    with gpu_lock:
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        t0 = time.perf_counter()
        q, _ = eng.chronos(DTYPE).predict_quantiles(
            context, prediction_length=horizon, quantile_levels=[C.Q_LOW, C.Q_MID, C.Q_HIGH])
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        ms = (time.perf_counter() - t0) * 1000
    return q.float().cpu().numpy(), ms


@app.post("/api/infer_tsfm")
def infer_tsfm(req: InferRequest) -> dict:
    t0 = time.perf_counter()
    eng: LiveEngine = state["engine"]
    asset = ASSET_ALIASES.get(req.asset.upper(), req.asset.upper())
    if asset not in C.ASSETS:
        raise HTTPException(422, f"asset must be one of {C.ASSETS} or {list(ASSET_ALIASES)}")
    try:
        asked = pd.Timestamp(req.date)
    except ValueError as exc:
        raise HTTPException(422, "date must be YYYY-MM-DD") from exc
    idx = eng.returns.index
    hist = idx[idx <= asked]
    if len(hist) < C.W_ITO:
        raise HTTPException(422, f"date must be on or after {idx[C.W_ITO - 1].date()} (504-day context)")
    d = hist[-1]
    q, gpu_ms = _forecast(asset, d, req.horizon)
    q_pct = 100 * np.expm1(q)  # daily log-return quantiles -> simple %, per step, all assets
    sigma_d = (q[:, :, 2] - q[:, :, 0]) / C.Q_SPREAD_TO_SIGMA
    sigma = sigma_d.mean(axis=1) * np.sqrt(C.TRADING_DAYS)
    mu = q[:, :, 1].mean(axis=1) * C.TRADING_DAYS + 0.5 * sigma ** 2
    a = C.ASSETS.index(asset)

    cached = None
    if d in eng.chronos_cache.index and req.horizon == C.HORIZON:
        row = eng.chronos_cache.loc[d]
        cached = {"mu_annual_pct": _r(100 * row[f"mu_{asset}"]), "sigma_annual_pct": _r(100 * row[f"sigma_{asset}"]),
                  "max_abs_sigma_diff_all_assets": _r(float(np.abs(
                      sigma - row[[f"sigma_{x}" for x in C.ASSETS]].to_numpy(float)).max()), 10)}

    sig = eng.signals.loc[d]
    score, tau = float(sig["score"]), float(sig["tau"])
    beta_prereg = float(eng.beta(1.0, 0.0).loc[d])
    beta_k = float(eng.beta(req.k_tau, 0.0).loc[d])
    if not np.isfinite(tau):
        rec = "tau undefined (first 252 days of the safeguard)"
    elif beta_k > 0:
        rec = f"S > k·tau: move {100 * beta_k:.0f}% to cash"
    else:
        rec = "S <= k·tau: no overlay"
    out = {
        "date_requested": req.date, "date": str(d.date()), "asset": asset, "horizon": req.horizon,
        "quantiles_pct": [{"step": i + 1, "q10": _r(q_pct[a, i, 0]), "q50": _r(q_pct[a, i, 1]),
                           "q90": _r(q_pct[a, i, 2])} for i in range(req.horizon)],
        "implied_annual": {"mu_pct": _r(100 * mu[a]), "sigma_pct": _r(100 * sigma[a])},
        "all_assets_sigma_annual_pct": {x: _r(100 * s) for x, s in zip(C.ASSETS, sigma)},
        "preregistered_cache": cached,
        "safeguard": {"score": _r(score, 6), "tau": _r(tau, 6), "k_tau": req.k_tau,
                      "threshold": _r(req.k_tau * tau, 6) if np.isfinite(tau) else None,
                      "beta_preregistered": _r(beta_prereg), "beta_at_k": _r(beta_k), "recommendation": rec,
                      "source": "autoencoder S_t, tau_t (pre-registered, data up to date)"},
        "compute": {"device": "cuda" if torch.cuda.is_available() else "cpu",
                    "dtype": str(DTYPE).replace("torch.", ""), "model": C.CHRONOS_MODEL,
                    "gpu_ms": round(gpu_ms, 2)},
    }
    ms = (time.perf_counter() - t0) * 1000
    latency["infer_tsfm"].append(ms)
    out["compute"]["ms"] = round(ms, 2)
    return out
