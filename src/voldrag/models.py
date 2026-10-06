"""Moment estimation, portfolio optimizers and the NDE autoencoder safeguard.

PREREGISTRATION.md §4 (QP, MVO, Higham), §5 (Chronos moments), §6 (safeguard).
Every function here consumes only data dated at or before the decision date.
"""

from __future__ import annotations

from pathlib import Path

import cvxpy as cp
import numpy as np
import pandas as pd
import torch
from sklearn.covariance import LedoitWolf

from voldrag import config as C

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "data" / "cache"
SOLVER_OK = ("optimal", "optimal_inaccurate")


# --------------------------------------------------------------------------- moments
def nearest_correlation(a: np.ndarray, tol: float = C.HIGHAM_TOL,
                        max_iter: int = C.HIGHAM_MAX_ITER) -> np.ndarray:
    """Higham (2002) nearest correlation matrix via alternating projections with Dykstra."""
    y = (a + a.T) / 2.0
    ds = np.zeros_like(y)
    for _ in range(max_iter):
        r = y - ds
        vals, vecs = np.linalg.eigh(r)
        x = (vecs * np.clip(vals, 0.0, None)) @ vecs.T
        ds = x - r
        y_next = x.copy()
        np.fill_diagonal(y_next, 1.0)
        converged = np.linalg.norm(y_next - y, "fro") <= tol * max(np.linalg.norm(y_next, "fro"), 1.0)
        y = y_next
        if converged:
            break
    return (y + y.T) / 2.0


def _split_cov(cov: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    d = np.sqrt(np.diag(cov))
    return cov / np.outer(d, d), d


def historical_moments(window: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Annualized mean, Ledoit-Wolf + Higham covariance, and the correlation matrix."""
    mu = window.mean(axis=0) * C.TRADING_DAYS
    corr, d = _split_cov(LedoitWolf().fit(window).covariance_)
    corr = nearest_correlation(corr)
    cov = corr * np.outer(d, d) * C.TRADING_DAYS
    return mu, cov, corr


def sample_moments(window: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return window.mean(axis=0) * C.TRADING_DAYS, np.cov(window, rowvar=False) * C.TRADING_DAYS


class ChronosMoments:
    """Zero-shot Chronos-Bolt forecasts of next-week log returns -> annualized moments.

    Forecasts are cached by decision date; the cache depends only on data and model.
    """

    def __init__(self) -> None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.cache_path = CACHE_DIR / f"chronos_{C.CHRONOS_MODEL.split('/')[-1]}.parquet"
        self.cache = pd.read_parquet(self.cache_path) if self.cache_path.exists() else pd.DataFrame()
        self._pipe = None

    def _pipeline(self):
        if self._pipe is None:
            from chronos import BaseChronosPipeline

            device = "cuda" if torch.cuda.is_available() else "cpu"
            self._pipe = BaseChronosPipeline.from_pretrained(
                C.CHRONOS_MODEL, device_map=device, torch_dtype=torch.float32)
        return self._pipe

    def moments(self, date: pd.Timestamp, simple_window: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if date in self.cache.index:
            row = self.cache.loc[date]
            return (row[[f"mu_{a}" for a in C.ASSETS]].to_numpy(float),
                    row[[f"sigma_{a}" for a in C.ASSETS]].to_numpy(float))
        context = torch.tensor(np.log1p(simple_window).T, dtype=torch.float32)
        q, _ = self._pipeline().predict_quantiles(
            context, prediction_length=C.HORIZON, quantile_levels=[C.Q_LOW, C.Q_MID, C.Q_HIGH])
        q = q.detach().cpu().numpy()
        mu_log_d = q[:, :, 1].mean(axis=1)
        sigma_d = ((q[:, :, 2] - q[:, :, 0]) / C.Q_SPREAD_TO_SIGMA).mean(axis=1)
        sigma = sigma_d * np.sqrt(C.TRADING_DAYS)
        mu = mu_log_d * C.TRADING_DAYS + 0.5 * sigma ** 2
        row = {**{f"mu_{a}": m for a, m in zip(C.ASSETS, mu)},
               **{f"sigma_{a}": s for a, s in zip(C.ASSETS, sigma)}}
        self.cache = pd.concat([self.cache, pd.DataFrame([row], index=[date])])
        return mu, sigma

    def save(self) -> None:
        self.cache.sort_index().to_parquet(self.cache_path)


# --------------------------------------------------------------------------- optimizers
def cvar(losses: np.ndarray, alpha: float = C.ALPHA) -> float:
    """Exact Rockafellar-Uryasev CVaR: min_z z + E[(L - z)+]/(1 - alpha), z over sample points."""
    k = len(losses)
    excess = np.maximum(losses[None, :] - losses[:, None], 0.0).sum(axis=1)
    return float(np.min(losses + excess / ((1.0 - alpha) * k)))


def _clean(w: np.ndarray) -> np.ndarray:
    w = np.clip(w, 0.0, None)
    return w / w.sum()


def ito_kelly_qp(mu: np.ndarray, cov: np.ndarray, scenarios: np.ndarray,
                 cap: float = C.W_CAP, alpha: float = C.ALPHA) -> tuple[np.ndarray, str]:
    """Eqs. (30)-(31): min 1/2 w'Sw - mu'w s.t. budget, 0<=w<=cap, CVaR_alpha <= CVaR(EW)."""
    n, k = len(mu), len(scenarios)
    ew = np.full(n, 1.0 / n)
    gamma = cvar(-scenarios @ ew, alpha)
    w, z, u = cp.Variable(n), cp.Variable(), cp.Variable(k, nonneg=True)
    constraints = [
        cp.sum(w) == 1, w >= 0, w <= cap,
        u >= -scenarios @ w - z,
        z + cp.sum(u) / ((1.0 - alpha) * k) <= gamma,
    ]
    objective = cp.Minimize(0.5 * cp.quad_form(w, cp.psd_wrap((cov + cov.T) / 2)) - mu @ w)
    problem = cp.Problem(objective, constraints)
    try:
        problem.solve(solver=cp.CLARABEL)
    except cp.SolverError:
        return ew, "solver_error->ew"
    if problem.status not in SOLVER_OK or w.value is None:
        return ew, f"{problem.status}->ew"
    return _clean(w.value), problem.status


def mvo_max_sharpe(mu: np.ndarray, cov: np.ndarray, cap: float = C.W_CAP,
                   rf: float = C.RF) -> tuple[np.ndarray, str]:
    """Long-only max-Sharpe with cap; minimum variance if no asset has positive excess mean."""
    n = len(mu)
    excess = mu - rf
    psd = cp.psd_wrap((cov + cov.T) / 2)
    if np.all(excess <= 0):
        w = cp.Variable(n)
        problem = cp.Problem(cp.Minimize(cp.quad_form(w, psd)), [cp.sum(w) == 1, w >= 0, w <= cap])
        label = "min_variance"
    else:
        y = cp.Variable(n, nonneg=True)
        problem = cp.Problem(cp.Minimize(cp.quad_form(y, psd)), [excess @ y == 1, y <= cap * cp.sum(y)])
        w, label = y, "max_sharpe"
    try:
        problem.solve(solver=cp.CLARABEL)
    except cp.SolverError:
        return np.full(n, 1.0 / n), "solver_error->ew"
    if problem.status not in SOLVER_OK or w.value is None:
        return np.full(n, 1.0 / n), f"{problem.status}->ew"
    return _clean(w.value), label


# --------------------------------------------------------------------------- safeguard
class Autoencoder(torch.nn.Module):
    """12 -> 8 -> 4 -> 8 -> 12, sigmoid hidden activations, linear output (§6)."""

    def __init__(self, dim: int) -> None:
        super().__init__()
        h1, h2 = C.AE_HIDDEN
        self.encoder = torch.nn.Sequential(
            torch.nn.Linear(dim, h1), torch.nn.Sigmoid(), torch.nn.Linear(h1, h2), torch.nn.Sigmoid())
        self.decoder = torch.nn.Sequential(
            torch.nn.Linear(h2, h1), torch.nn.Sigmoid(), torch.nn.Linear(h1, dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.decoder(self.encoder(x))


class Safeguard:
    """NDE-style safeguard: autoencoder trained on the warm-up only, then frozen."""

    def __init__(self, state: pd.DataFrame) -> None:
        warm = state.loc[C.WARMUP[0]:C.WARMUP[1]].dropna()
        self.mean = warm.mean().to_numpy()
        self.std = warm.std(ddof=0).replace(0.0, 1.0).to_numpy()
        torch.manual_seed(C.SEED)
        self.model = Autoencoder(state.shape[1])
        x = torch.tensor((warm.to_numpy() - self.mean) / self.std, dtype=torch.float32)
        optimizer = torch.optim.Adam(self.model.parameters(), lr=C.AE_LR)
        for _ in range(C.AE_EPOCHS):
            optimizer.zero_grad()
            loss = torch.mean((self.model(x) - x) ** 2)
            loss.backward()
            optimizer.step()
        self.warmup_loss = float(loss.detach())
        self.model.eval()
        for p in self.model.parameters():
            p.requires_grad_(False)

    def reconstruction_error(self, state: pd.DataFrame) -> pd.Series:
        valid = state.dropna()
        x = torch.tensor((valid.to_numpy() - self.mean) / self.std, dtype=torch.float32)
        with torch.no_grad():
            err = torch.mean((self.model(x) - x) ** 2, dim=1).numpy()
        return pd.Series(err, index=valid.index, name="recon_error")

    def signals(self, state: pd.DataFrame) -> pd.DataFrame:
        """S_t (eq. 27), tau_t (prior 252-day 95th pct of S) and beta_t (eq. 28)."""
        err = self.reconstruction_error(state)
        score = err.ewm(alpha=1.0 - C.SMOOTH, adjust=False).mean()  # S_t = .8 S_{t-1} + .2 L_t
        tau = score.shift(1).rolling(C.TAU_WINDOW, min_periods=C.TAU_WINDOW).quantile(C.TAU_Q)
        beta = beta_from_score(score, tau)
        out = pd.DataFrame({"recon_error": err, "score": score, "tau": tau, "beta": beta})
        return out.reindex(state.index)


def beta_from_score(score: pd.Series, tau: pd.Series) -> pd.Series:
    """Eq. (28): 0 below threshold; min(1, 2*(1-e^-x)/(1+e^-x)), x = kappa (S - tau)/tau above."""
    x = C.KAPPA * (score - tau) / tau
    above = 2.0 * (1.0 - np.exp(-x)) / (1.0 + np.exp(-x))
    beta = np.where(score > tau, np.minimum(1.0, above), 0.0)
    return pd.Series(np.where(tau.isna(), 0.0, beta), index=score.index, name="beta")
