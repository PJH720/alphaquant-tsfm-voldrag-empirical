"""Rebalancing schedules, strategy targets, the simulation engine and metrics.

Timing (PREREGISTRATION.md §4): a target decided at the close of t uses returns up to
and including t, and the portfolio earns the return of t+1 onward. Weights drift
between trades. Costs: TC_t = c * sum|w_t - w_t-| on every trade (§7).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.tsa.stattools import adfuller

from voldrag import config as C
from voldrag import models as M

E_CASH = np.eye(len(C.ASSETS))[C.CASH_IDX]


# --------------------------------------------------------------------------- schedules
def last_trading_day(index: pd.DatetimeIndex, freq: str) -> pd.DatetimeIndex:
    """Last trading day of each week ('W') or month ('M') present in the index."""
    keys = index.to_period("W-FRI" if freq == "W" else "M")
    s = pd.Series(index, index=index)
    return pd.DatetimeIndex(s.groupby(keys).max().to_numpy())


# --------------------------------------------------------------------------- targets
@dataclass
class Targets:
    weights: dict[pd.Timestamp, np.ndarray] = field(default_factory=dict)
    status: dict[pd.Timestamp, str] = field(default_factory=dict)


def fixed_targets(dates: pd.DatetimeIndex, w: np.ndarray) -> Targets:
    t = Targets()
    for d in dates:
        t.weights[d], t.status[d] = w, "fixed"
    return t


def _window(returns: pd.DataFrame, date: pd.Timestamp, size: int) -> np.ndarray | None:
    hist = returns.loc[:date]
    return hist.iloc[-size:].to_numpy() if len(hist) >= size else None


def mvo_targets(returns: pd.DataFrame, dates: pd.DatetimeIndex) -> Targets:
    t = Targets()
    for d in dates:
        win = _window(returns, d, C.W_MVO)
        if win is None:
            continue
        mu, cov = M.sample_moments(win)
        t.weights[d], t.status[d] = M.mvo_max_sharpe(mu, cov)
    return t


def ito_targets(returns: pd.DataFrame, dates: pd.DatetimeIndex,
                chronos: M.ChronosMoments | None = None) -> Targets:
    """Itô-Kelly QP. With `chronos`, mu and sigma come from Chronos; correlation stays historical."""
    t = Targets()
    for d in dates:
        win = _window(returns, d, C.W_ITO)
        if win is None:
            continue
        mu, cov, corr = M.historical_moments(win)
        if chronos is not None:
            mu, sigma = chronos.moments(d, win)
            cov = corr * np.outer(sigma, sigma)
        t.weights[d], t.status[d] = M.ito_kelly_qp(mu, cov, scenarios=win)
    return t


# --------------------------------------------------------------------------- engine
@dataclass
class RunResult:
    net_returns: pd.Series
    weights: pd.DataFrame
    turnover: pd.Series
    trade_days: list[pd.Timestamp]


def _latest(targets: Targets, date: pd.Timestamp) -> np.ndarray:
    eligible = [d for d in targets.weights if d <= date]
    if not eligible:
        raise ValueError(f"No target available at or before {date.date()}")
    return targets.weights[max(eligible)]


def simulate(returns: pd.DataFrame, targets: Targets, start: str, end: str, cost_bp: float,
             beta: pd.Series | None = None) -> RunResult:
    """Run one strategy over [start, end]. The initial portfolio is formed at the prior close.

    With `beta`, the safeguard overlay applies: target = (1-beta) w_opt + beta e_cash; it
    trades on scheduled dates or when |beta_t - beta at last trade| > threshold.
    """
    c = cost_bp / 10_000.0
    all_dates = returns.index
    days = all_dates[(all_dates >= start) & (all_dates <= end)]
    formation = all_dates[all_dates < days[0]][-1]
    scheduled = set(targets.weights)

    def overlay(date: pd.Timestamp) -> tuple[np.ndarray, float]:
        base = _latest(targets, date)
        if beta is None:
            return base, 0.0
        b = float(beta.get(date, 0.0))
        return (1.0 - b) * base + b * E_CASH, b

    w, beta_held = overlay(formation)
    net, turnover, weights, trades = [], [], [], [formation]
    initial_cost = c * np.abs(w).sum()
    r_all = returns.loc[days].to_numpy()

    for i, d in enumerate(days):
        r = r_all[i]
        rp = float(w @ r)
        w = w * (1.0 + r) / (1.0 + rp)
        tc, to = 0.0, 0.0
        trade = d in scheduled
        if beta is not None and not trade:
            trade = abs(float(beta.get(d, 0.0)) - beta_held) > C.BETA_TRADE_THRESHOLD
        if trade:
            target, b = overlay(d)
            to = float(np.abs(target - w).sum())
            tc = c * to
            w, beta_held = target, b
            trades.append(d)
        net.append(rp - tc - (initial_cost if i == 0 else 0.0))
        turnover.append(to)
        weights.append(w.copy())

    return RunResult(
        net_returns=pd.Series(net, index=days, name="net_return"),
        weights=pd.DataFrame(weights, index=days, columns=C.ASSETS),
        turnover=pd.Series(turnover, index=days, name="turnover"),
        trade_days=trades,
    )


# --------------------------------------------------------------------------- metrics
def _years(r: pd.Series, formation: pd.Timestamp) -> float:
    return (r.index[-1] - formation).days / 365.25


def performance(r: pd.Series, turnover: pd.Series, formation: pd.Timestamp) -> dict:
    years = _years(r, formation)
    wealth = (1.0 + r).cumprod()
    cagr = wealth.iloc[-1] ** (1.0 / years) - 1.0
    mu = r.mean() * C.TRADING_DAYS
    sigma = r.std(ddof=1) * np.sqrt(C.TRADING_DAYS)
    excess_d = r - C.RF / C.TRADING_DAYS
    downside = np.sqrt(np.mean(np.minimum(excess_d, 0.0) ** 2)) * np.sqrt(C.TRADING_DAYS)
    drawdown = wealth / np.maximum.accumulate(np.maximum(wealth, 1.0)) - 1.0
    mdd = drawdown.min()
    tail = np.sort(r.to_numpy())[: max(1, int(np.floor(0.05 * len(r))))]
    g_log = np.log1p(r).mean() * C.TRADING_DAYS
    return {
        "years": round(years, 3),
        "cagr_pct": 100 * cagr,
        "mu_arith_pct": 100 * mu,
        "sigma_pct": 100 * sigma,
        "sharpe": (mu - C.RF) / sigma,
        "sortino": excess_d.mean() * C.TRADING_DAYS / downside if downside > 0 else np.nan,
        "mdd_pct": 100 * mdd,
        "calmar": cagr / abs(mdd) if mdd < 0 else np.nan,
        "cvar95_daily_pct": 100 * tail.mean(),
        "turnover_annual_pct": 100 * turnover.sum() / years,
        "emp_drag_pct": 100 * (mu - g_log),
        "theo_drag_pct": 100 * 0.5 * sigma ** 2,
        "wealth_loss_10y": 100 * (1 + cagr) ** 10 - 100 * (1 + mu) ** 10,
    }


def asset_statistics(returns: pd.DataFrame) -> pd.DataFrame:
    rows = {}
    for col in returns:
        r = returns[col]
        n = len(r)
        skew, kurt = stats.skew(r), stats.kurtosis(r)  # excess kurtosis
        mu = r.mean() * C.TRADING_DAYS
        sigma = r.std(ddof=1) * np.sqrt(C.TRADING_DAYS)
        rows[col] = {
            "n_obs": n,
            "mu_arith_pct": 100 * mu,
            "mu_geom_log_pct": 100 * np.log1p(r).mean() * C.TRADING_DAYS,
            "sigma_pct": 100 * sigma,
            "theo_drag_pct": 100 * 0.5 * sigma ** 2,
            "skewness": skew,
            "excess_kurtosis": kurt,
            "jb_stat": n / 6.0 * (skew ** 2 + kurt ** 2 / 4.0),
            "adf_stat": adfuller(r, regression="ct", autolag="AIC")[0],
        }
    return pd.DataFrame(rows).T


def block_bootstrap_sharpe_diff(a: pd.Series, b: pd.Series, block: int = C.BOOT_BLOCK,
                                n_boot: int = C.BOOT_B, seed: int = C.SEED) -> dict:
    """Paired circular block bootstrap of Sharpe(a) - Sharpe(b); two-sided centered p-value."""
    x = np.column_stack([a.to_numpy(), b.to_numpy()])
    n = len(x)

    def sharpe(cols: np.ndarray) -> np.ndarray:
        mu = cols.mean(axis=-2) * C.TRADING_DAYS
        sd = cols.std(axis=-2, ddof=1) * np.sqrt(C.TRADING_DAYS)
        return (mu - C.RF) / sd

    observed = float(np.subtract(*sharpe(x)))
    rng = np.random.default_rng(seed)
    n_blocks = int(np.ceil(n / block))
    diffs = np.empty(n_boot)
    for chunk in range(0, n_boot, 500):
        m = min(500, n_boot - chunk)
        starts = rng.integers(0, n, size=(m, n_blocks))
        idx = ((starts[:, :, None] + np.arange(block)) % n).reshape(m, -1)[:, :n]
        s = sharpe(x[idx])
        diffs[chunk:chunk + m] = s[:, 0] - s[:, 1]
    p = float(np.mean(np.abs(diffs - observed) >= abs(observed)))
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return {"sharpe_diff": observed, "p_value": p, "ci95": [float(lo), float(hi)],
            "block": block, "n_boot": n_boot}
