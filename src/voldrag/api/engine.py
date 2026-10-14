"""Live what-if engine behind the demo site's interactive lab. EXPLORATORY (PREREGISTRATION.md §8).

The engine reuses the pre-registered pipeline (data, Chronos cache, QP, autoencoder) and lets
five knobs move: transaction cost, a multiplier k on the safeguard threshold tau, a floor on the
cash overlay beta, the risk aversion lambda of the Itô-Kelly QP (lambda = 1 is eq. 30 as
pre-registered) and an L1 turnover penalty lambda_tc (0 = pre-registered). With every knob at its pre-registered value the output must equal
results/results.json; `self_check()` asserts that at startup.

Simulation is float64 NumPy on the CPU: the backtest is a path of ~2,400 dependent days, which a GPU
does not speed up, and fp16 would break the match with results.json. Only Chronos inference runs on
CUDA. Nothing returned here contains prices or per-asset realized returns.
"""

from __future__ import annotations

import hashlib
import json
import multiprocessing as mp
import os
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from voldrag import backtest as B
from voldrag import config as C
from voldrag import exploratory_turnover as TO
from voldrag import models as M
from voldrag.data import MANIFEST, load_market_data
from voldrag.run import RESULTS, build_targets

LAMBDA_GRID = (0.5, 1.0, 2.0, 3.0, 4.0)  # QP risk aversion; 1.0 = pre-registered eq. (30)
# L1 turnover penalty (annualized objective units); 0.0 = pre-registered. Values up to 0.005 barely move
# turnover on this data (results/exploratory_turnover_penalty.json), so the grid extends to 0.5.
TURNOVER_PENALTY_GRID = (0.0, 0.0005, 0.0010, 0.0020, 0.0050, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5)
PREREGISTERED = {"cost_bp": float(C.BASE_COST_BP), "k_tau": 1.0, "cash_floor": 0.0, "lambda_param": 1.0,
                 "lambda_tc": 0.0}
BENCHMARKS = ("6040", "mvo", "ew")
TARGETS_CACHE = M.CACHE_DIR / "live_lambda_targets.npz"
_POOL: dict = {}  # inputs shared with forked worker processes while the cache is built


def _combo_key(c: tuple[float, float]) -> str:
    return f"w_lambda_{c[0]}_tc_{c[1]}"


def _solve_combo(c: tuple[float, float]) -> tuple[tuple[float, float], np.ndarray]:
    t = TO.turnover_targets(_POOL["returns"], _POOL["inputs"], lambda_tc=c[1], risk_aversion=c[0])
    return c, np.array([t.weights[d] for d in _POOL["dates"]])


@dataclass(frozen=True)
class Gross:
    """Cost-free path of one strategy: net return at cost c is rp - c * to (- c * |w0| on day 0)."""
    rp: np.ndarray        # gross portfolio return per day
    to: np.ndarray        # turnover per day (0 on non-trade days)
    w0_abs: float         # sum |w| of the initial portfolio (initial cost base)
    cash: np.ndarray      # end-of-day CASH weight
    n_trades: int


class LiveEngine:
    def __init__(self, log=print) -> None:
        t0 = time.time()
        md = load_market_data()
        self.returns = md.returns
        self.targets, self.qp_targets = self._load_or_build_targets(md, log)
        self.signals = M.Safeguard(md.state).signals(md.state)
        self.periods = {}
        for period, (start, end) in C.PERIODS.items():
            idx = self.returns.index
            days = idx[(idx >= start) & (idx <= end)]
            weeks = days.to_period("W-FRI").to_numpy()
            week_start = np.flatnonzero(np.concatenate([[True], weeks[1:] != weeks[:-1]]))
            self.periods[period] = {
                "days": days, "formation": idx[idx < days[0]][-1],
                "R": self.returns.loc[days].to_numpy(),
                "years": (days[-1] - idx[idx < days[0]][-1]).days / 365.25,
                "week_start": week_start,
                "week_last": np.concatenate([week_start[1:] - 1, [len(days) - 1]]),
                "week_label": [str(d.date()) for d in days[np.concatenate([week_start[1:] - 1, [len(days) - 1]])]],
            }
        self.benchmarks = {p: {b: self._gross(p, self.targets[b], None) for b in BENCHMARKS} for p in C.PERIODS}
        self._chronos = None
        self.chronos_cache = M.ChronosMoments().cache
        self.self_check_result = self.self_check()
        log(f"  engine ready in {time.time() - t0:.1f}s; self-check ok={self.self_check_result['ok']}")

    # ------------------------------------------------------------------ targets
    def _load_or_build_targets(self, md, log) -> tuple[dict[str, B.Targets], dict[tuple[float, float], B.Targets]]:
        """Pre-registered strategy targets plus every (lambda, lambda_tc) QP variant, cached on disk.

        The cache is keyed on the data manifest, the Chronos cache, config.py and both grids;
        self_check() verifies the pre-registered path against results.json on every start.
        lambda != 1 scales the covariance (lambda/2 w'Sw = 1/2 w'(lambda S)w). lambda_tc > 0 adds the
        exploratory L1 turnover penalty against the previous solution drifted to the decision date
        (models.ito_kelly_turnover_qp). (1.0, 0.0) is the pre-registered QP itself.
        """
        chronos = M.ChronosMoments()
        key = hashlib.sha256(MANIFEST.read_bytes() + chronos.cache_path.read_bytes() + Path(C.__file__).read_bytes()
                             + repr((LAMBDA_GRID, TURNOVER_PENALTY_GRID)).encode()).hexdigest()
        names = ("proposed", *BENCHMARKS)
        combos = [(lam, tc) for lam in LAMBDA_GRID for tc in TURNOVER_PENALTY_GRID if (lam, tc) != (1.0, 0.0)]
        if TARGETS_CACHE.exists():
            with np.load(TARGETS_CACHE, allow_pickle=False) as z:
                if str(z["key"]) == key:
                    targets = {n: _targets(z[f"d_{n}"], z[f"w_{n}"]) for n in names}
                    qp = {c: _targets(z["d_proposed"], z[_combo_key(c)]) for c in combos}
                    log(f"  targets loaded from {TARGETS_CACHE.name}")
                    return targets, {(1.0, 0.0): targets["proposed"], **qp}
        t0 = time.time()
        targets, _, _ = build_targets(md)
        dates = sorted(targets["proposed"].weights)
        _POOL.update(returns=md.returns, inputs=TO.decision_inputs(md.returns, dates), dates=dates)
        workers = max(1, min(len(combos), (os.cpu_count() or 2) - 2))
        with ProcessPoolExecutor(workers, mp_context=mp.get_context("fork")) as pool:
            solved = dict(pool.map(_solve_combo, combos))
        _POOL.clear()
        arrays = {"key": np.array(key)}
        for n in names:
            ds = sorted(targets[n].weights)
            arrays[f"d_{n}"] = np.array(ds, dtype="datetime64[ns]")
            arrays[f"w_{n}"] = np.array([targets[n].weights[d] for d in ds])
        for c, w in solved.items():
            arrays[_combo_key(c)] = w
        np.savez(TARGETS_CACHE, **arrays)
        log(f"  targets built in {time.time() - t0:.0f}s ({len(combos)} QP variants on {workers} processes), "
            f"cached to {TARGETS_CACHE.name}")
        qp = {c: _targets(np.array(dates, dtype="datetime64[ns]"), w) for c, w in solved.items()}
        return {n: targets[n] for n in names}, {(1.0, 0.0): targets["proposed"], **qp}

    # ------------------------------------------------------------------ simulation
    def beta(self, k_tau: float, cash_floor: float) -> pd.Series:
        b = M.beta_from_score(self.signals["score"], k_tau * self.signals["tau"]).fillna(0.0)
        return np.maximum(b, cash_floor) if cash_floor > 0 else b

    def _gross(self, period: str, targets: B.Targets, beta: pd.Series | None) -> Gross:
        """Same arithmetic as backtest.simulate, vectorized between trades (verified in self_check)."""
        P = self.periods[period]
        days, R = P["days"], P["R"]
        T, N = R.shape
        tdates = np.array(sorted(targets.weights), dtype="datetime64[ns]")
        tw = np.array([targets.weights[pd.Timestamp(d)] for d in tdates])
        latest = np.searchsorted(tdates, days.to_numpy(), side="right") - 1
        latest_f = int(np.searchsorted(tdates, np.datetime64(P["formation"]), side="right") - 1)
        scheduled = np.isin(days.to_numpy(), tdates)
        b = np.zeros(T) if beta is None else beta.reindex(days).fillna(0.0).to_numpy()
        b_f = 0.0 if beta is None else float(beta.get(P["formation"], 0.0))

        def overlay(base_w: np.ndarray, bb: np.ndarray | float) -> np.ndarray:
            if beta is None:
                return base_w
            bb = np.asarray(bb)[..., None]
            e = np.zeros(N)
            e[C.CASH_IDX] = 1.0
            return (1.0 - bb) * base_w + bb * e

        # Trade days depend on the schedule and beta only, not on returns.
        trade = scheduled.copy()
        if beta is not None:
            held, bl = b_f, b.tolist()
            for j in range(T):
                if trade[j] or abs(bl[j] - held) > C.BETA_TRADE_THRESHOLD:
                    trade[j] = True
                    held = bl[j]
        pos = np.flatnonzero(trade)
        w_form = overlay(tw[latest_f], b_f)
        starts = np.vstack([w_form[None, :], overlay(tw[latest[pos]], b[pos])])
        G = np.cumprod(1.0 + R, axis=0)
        Gpad = np.vstack([np.ones((1, N)), G])
        seg = np.concatenate([[0], np.cumsum(trade)[:-1]])
        seg_g = np.concatenate([[0], pos + 1])
        H = starts[seg] / Gpad[seg_g[seg]] * G
        V = H.sum(axis=1)
        first = np.concatenate([[True], trade[:-1]])
        v_prev = np.where(first, starts[seg].sum(axis=1), np.roll(V, 1))
        rp = V / v_prev - 1.0
        drift = H / V[:, None]
        to = np.zeros(T)
        to[pos] = np.abs(starts[1:] - drift[pos]).sum(axis=1)
        w_end = drift.copy()
        w_end[pos] = starts[1:]
        return Gross(rp=rp, to=to, w0_abs=float(np.abs(w_form).sum()), cash=w_end[:, C.CASH_IDX],
                     n_trades=len(pos))

    def proposed_gross(self, period: str, k_tau: float, cash_floor: float, lambda_param: float,
                       lambda_tc: float = 0.0) -> Gross:
        return _proposed_cached(self, period, round(k_tau, 4), round(cash_floor, 4), float(lambda_param), float(lambda_tc))

    def net(self, g: Gross, cost_bp: float) -> np.ndarray:
        c = cost_bp / 10_000.0
        r = g.rp - c * g.to
        r[0] -= c * g.w0_abs
        return r

    def metrics(self, period: str, r: np.ndarray, g: Gross) -> dict:
        P = self.periods[period]
        s = pd.Series(r, index=P["days"])
        return B.performance(s, pd.Series(g.to, index=P["days"]), P["formation"])

    def cost_sweep(self, period: str, g: Gross, costs: np.ndarray) -> dict:
        """CAGR, Sharpe and MDD at every cost in one matrix pass (same formulas as backtest.performance)."""
        P = self.periods[period]
        c = costs[:, None] / 10_000.0
        r = g.rp[None, :] - c * g.to[None, :]
        r[:, 0] -= c[:, 0] * g.w0_abs
        wealth = np.cumprod(1.0 + r, axis=1)
        cagr = wealth[:, -1] ** (1.0 / P["years"]) - 1.0
        mu = r.mean(axis=1) * C.TRADING_DAYS
        sigma = r.std(axis=1, ddof=1) * np.sqrt(C.TRADING_DAYS)
        dd = wealth / np.maximum.accumulate(np.maximum(wealth, 1.0), axis=1) - 1.0
        return {"cost_bp": costs.tolist(), "cagr_pct": (100 * cagr).tolist(),
                "sharpe": ((mu - C.RF) / sigma).tolist(), "mdd_pct": (100 * dd.min(axis=1)).tolist()}

    def weekly(self, period: str, last: dict[str, np.ndarray], mean: dict[str, np.ndarray]) -> list[dict]:
        """W-FRI weeks: `last` series take the week's last trading day, `mean` series the week's average."""
        P = self.periods[period]
        cols = {k: v[P["week_last"]] for k, v in last.items()}
        n = np.diff(np.append(P["week_start"], len(P["days"])))
        cols |= {k: np.add.reduceat(v, P["week_start"]) / n for k, v in mean.items()}
        rows = [{"date": d, **{k: round(float(cols[k][i]), 5) for k in cols}} for i, d in enumerate(P["week_label"])]
        # Like web/public/data/curves_*.json: weeks labelled by their last trading day, wealth 1.0 at formation.
        return [{"date": str(P["formation"].date()), **{k: 1.0 for k in last}}, *rows]

    # ------------------------------------------------------------------ self check
    def self_check(self) -> dict:
        """At pre-registered settings the engine must reproduce results.json and backtest.simulate."""
        committed = json.loads((RESULTS / "results.json").read_text(encoding="utf-8"))["performance"]
        worst, checked = 0.0, 0
        beta = self.beta(1.0, 0.0)
        for period, (start, end) in C.PERIODS.items():
            g_prop = self.proposed_gross(period, *(PREREGISTERED[k] for k in ("k_tau", "cash_floor", "lambda_param", "lambda_tc")))
            ref = B.simulate(self.returns, self.targets["proposed"], start, end, C.BASE_COST_BP, beta=beta)
            worst = max(worst, float(np.abs(self.net(g_prop, C.BASE_COST_BP) - ref.net_returns.to_numpy()).max()))
            for cost in C.COSTS_BP:
                for name in ("proposed", *BENCHMARKS):
                    g = g_prop if name == "proposed" else self.benchmarks[period][name]
                    m = self.metrics(period, self.net(g, cost), g)
                    for key in ("cagr_pct", "sharpe", "mdd_pct", "sigma_pct", "turnover_annual_pct"):
                        if not np.isclose(round(m[key], 4), committed[period][str(cost)][name][key], atol=1e-4):
                            return {"ok": False, "detail": f"{period}/{cost}/{name}/{key}: {m[key]} vs "
                                                           f"{committed[period][str(cost)][name][key]}"}
                        checked += 1
        return {"ok": worst < 1e-12, "values_checked": checked, "max_abs_daily_diff_vs_simulate": worst,
                "against": "results/results.json and backtest.simulate"}

    # ------------------------------------------------------------------ Chronos
    def chronos(self, dtype: torch.dtype):
        if self._chronos is None:
            from chronos import BaseChronosPipeline

            device = "cuda" if torch.cuda.is_available() else "cpu"
            self._chronos = BaseChronosPipeline.from_pretrained(C.CHRONOS_MODEL, device_map=device, torch_dtype=dtype)
        return self._chronos


def _targets(dates: np.ndarray, weights: np.ndarray) -> B.Targets:
    t = B.Targets()
    for d, w in zip(pd.DatetimeIndex(dates), weights):
        t.weights[d], t.status[d] = w, "cached"
    return t


@lru_cache(maxsize=256)
def _proposed_cached(engine: LiveEngine, period: str, k_tau: float, cash_floor: float, lam: float, tc: float) -> Gross:
    return engine._gross(period, engine.qp_targets[(lam, tc)], engine.beta(k_tau, cash_floor))
