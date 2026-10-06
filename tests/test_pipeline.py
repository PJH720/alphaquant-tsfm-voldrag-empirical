"""Correctness tests on synthetic data: timing (no look-ahead), constraints and formulas."""

import numpy as np
import pandas as pd
import pytest
import torch

from voldrag import backtest as B
from voldrag import config as C
from voldrag import models as M
from voldrag.data import align_strictly_before

N_ASSETS = len(C.ASSETS)


@pytest.fixture(scope="module")
def returns() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    idx = pd.bdate_range("2012-12-03", periods=1100, name="date")
    data = rng.normal(0.0003, 0.01, size=(len(idx), N_ASSETS))
    return pd.DataFrame(data, index=idx, columns=C.ASSETS)


def _perturb_after(df: pd.DataFrame, date: pd.Timestamp) -> pd.DataFrame:
    out = df.copy()
    future = out.index > date
    out.loc[future] = out.loc[future] * -3.0 + 0.02
    return out


def test_align_strictly_before_never_uses_same_day():
    s = pd.Series([1.0, 2.0, 3.0], index=pd.to_datetime(["2020-01-01", "2020-01-02", "2020-01-03"]))
    cal = pd.to_datetime(["2020-01-02", "2020-01-03", "2020-01-06"])
    values, source = align_strictly_before(s, pd.DatetimeIndex(cal))
    assert values.tolist() == [1.0, 2.0, 3.0]
    assert all(pd.DatetimeIndex(source) < cal)


def test_nearest_correlation_is_valid():
    rng = np.random.default_rng(1)
    a = rng.uniform(-1, 1, (N_ASSETS, N_ASSETS))
    a = (a + a.T) / 2
    np.fill_diagonal(a, 1.0)
    x = M.nearest_correlation(a)
    assert np.allclose(np.diag(x), 1.0)
    assert np.linalg.eigvalsh(x).min() > -1e-8
    valid = np.corrcoef(rng.normal(size=(200, N_ASSETS)), rowvar=False)
    assert np.allclose(M.nearest_correlation(valid), valid, atol=1e-8)


def test_cvar_equals_tail_mean_when_tail_count_is_integer():
    losses = np.arange(100, dtype=float)
    assert M.cvar(losses, 0.95) == pytest.approx(np.mean(losses[-5:]))


def test_ito_qp_respects_constraints(returns):
    win = returns.iloc[-C.W_ITO:].to_numpy()
    mu, cov, _ = M.historical_moments(win)
    w, status = M.ito_kelly_qp(mu, cov, win)
    assert status in M.SOLVER_OK
    assert w.sum() == pytest.approx(1.0)
    assert (w >= -1e-9).all() and (w <= C.W_CAP + 1e-6).all()
    ew = np.full(N_ASSETS, 1 / N_ASSETS)
    assert M.cvar(-win @ w) <= M.cvar(-win @ ew) + 1e-6


def test_mvo_respects_constraints(returns):
    mu, cov = M.sample_moments(returns.iloc[-C.W_MVO:].to_numpy())
    w, _ = M.mvo_max_sharpe(mu, cov)
    assert w.sum() == pytest.approx(1.0)
    assert (w <= C.W_CAP + 1e-6).all()


def test_targets_do_not_use_future_returns(returns):
    dates = B.last_trading_day(returns.index, "W")[-6:]
    cut = dates[2]
    before = (B.ito_targets(returns, dates), B.mvo_targets(returns, dates))
    shocked = _perturb_after(returns, cut)
    after = (B.ito_targets(shocked, dates), B.mvo_targets(shocked, dates))
    for t0, t1 in zip(before, after):
        for d in dates[dates <= cut]:
            np.testing.assert_allclose(t0.weights[d], t1.weights[d], atol=1e-10)


def test_simulation_does_not_use_future_returns(returns):
    dates = B.last_trading_day(returns.index, "W")
    targets = B.ito_targets(returns, dates[dates >= returns.index[C.W_ITO]][:20])
    start, end = str(returns.index[C.W_ITO + 10].date()), str(returns.index[-1].date())
    beta = pd.Series(np.linspace(0, 1, len(returns)), index=returns.index)
    run0 = B.simulate(returns, targets, start, end, 10, beta=beta)
    cut = run0.net_returns.index[40]
    run1 = B.simulate(_perturb_after(returns, cut), targets, start, end, 10, beta=beta)
    pd.testing.assert_series_equal(run0.net_returns.loc[:cut], run1.net_returns.loc[:cut])


def test_costs_reduce_returns_by_turnover(returns):
    dates = B.last_trading_day(returns.index, "M")
    targets = B.fixed_targets(dates, np.full(N_ASSETS, 1 / N_ASSETS))
    start, end = str(returns.index[300].date()), str(returns.index[-1].date())
    gross = B.simulate(returns, targets, start, end, 0)
    net = B.simulate(returns, targets, start, end, 10)
    expected = gross.net_returns - 0.001 * gross.turnover
    expected.iloc[0] -= 0.001  # initial formation trade, turnover 1.0
    pd.testing.assert_series_equal(net.net_returns, expected, check_names=False)


def test_safeguard_is_frozen_and_causal():
    rng = np.random.default_rng(2)
    idx = pd.bdate_range("2013-01-01", "2018-12-31")
    state = pd.DataFrame(rng.normal(size=(len(idx), 12)), index=idx)
    guard = M.Safeguard(state)
    params = [p.clone() for p in guard.model.parameters()]
    sig0 = guard.signals(state)
    assert all(not p.requires_grad for p in guard.model.parameters())
    assert all(torch.equal(a, b) for a, b in zip(params, guard.model.parameters()))
    cut = pd.Timestamp("2017-06-30")
    shocked = state.copy()
    shocked.loc[shocked.index > cut] *= 10.0
    sig1 = guard.signals(shocked)
    pd.testing.assert_frame_equal(sig0.loc[:cut], sig1.loc[:cut])


def test_beta_formula():
    score = pd.Series([1.0, 1.1, 2.0, 10.0])
    tau = pd.Series([1.0, 1.0, 1.0, np.nan])
    beta = M.beta_from_score(score, tau)
    assert beta.iloc[0] == 0.0
    x = C.KAPPA * 0.1
    assert beta.iloc[1] == pytest.approx(2 * (1 - np.exp(-x)) / (1 + np.exp(-x)))
    assert beta.iloc[2] == pytest.approx(1.0)
    assert beta.iloc[3] == 0.0


def test_performance_constant_return():
    idx = pd.bdate_range("2020-01-02", periods=253)
    formation = pd.Timestamp("2019-12-31")
    r = pd.Series(0.001, index=idx)
    perf = B.performance(r, pd.Series(0.0, index=idx), formation=formation)
    years = (idx[-1] - formation).days / 365.25
    assert perf["cagr_pct"] == pytest.approx(100 * ((1.001 ** 253) ** (1 / years) - 1), rel=1e-9)
    assert perf["mdd_pct"] == pytest.approx(0.0)
