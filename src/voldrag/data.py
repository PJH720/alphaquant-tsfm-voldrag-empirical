"""Market data acquisition, calendar alignment and caching (PREREGISTRATION.md §2, §6).

Calendar: KRX trading days (dates of 069500.KS). US closes and the USD/KRW fix are
observed after the KRX close, so the value used on KRX date t is the last observation
on a calendar date strictly before t (see `align_strictly_before`).
"""

from __future__ import annotations

import hashlib
import io
import json
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from voldrag import config as C

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
MANIFEST = ROOT / "data" / "manifest.json"

KR_TICKERS = {"KOSPI200": "069500.KS", "KTB10Y": "148070.KS"}
US_TICKERS = {"SP500": "SPY", "NASDAQ100": "QQQ", "GOLD": "GLD", "CASH": "SHV"}
KOSDAQ150_ETF = "229200.KS"
KOSDAQ150_PRE_LISTING_PROXY = "^KQ11"  # KOSDAQ composite; KOSDAQ 150 index is behind KRX login
KOSDAQ150_ETF_FIRST_DAY = pd.Timestamp("2015-10-01")
# HY OAS (BAMLH0A0HYM2) is only served from 2023-10 on FRED (ICE licensing); Moody's Baa-10Y
# spread is the long-history credit-spread substitute (CHANGELOG.md, pre-results amendment).
FRED_SERIES = {"USDKRW": "DEXKOUS", "VIX": "VIXCLS", "T10Y2Y": "T10Y2Y", "CREDIT_SPREAD": "BAA10Y"}


@dataclass(frozen=True)
class MarketData:
    prices: pd.DataFrame       # KRW total-return price index per asset, KRX calendar
    returns: pd.DataFrame      # daily simple returns
    state: pd.DataFrame        # 12-dim macro-financial state vector z_t
    coverage: dict             # per-source coverage / staleness diagnostics
    deviations: list[str]      # deviations from the paper's universe


def _cache_path(name: str) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    return RAW_DIR / f"{name.replace('^', 'IDX_')}.parquet"


def fetch_yahoo(ticker: str) -> pd.DataFrame:
    """Daily close and adjusted close (dividends/splits) from Yahoo Finance, cached."""
    path = _cache_path(ticker)
    if path.exists():
        return pd.read_parquet(path)
    import yfinance as yf

    raw = yf.download(ticker, start=C.FETCH_START, end=C.FETCH_END,
                      auto_adjust=False, actions=False, progress=False)
    if raw.empty:
        raise RuntimeError(f"Yahoo returned no data for {ticker}")
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)
    out = pd.DataFrame({"close": raw["Close"], "adj_close": raw["Adj Close"]}).dropna()
    out.index = pd.to_datetime(out.index).tz_localize(None)
    out.index.name = "date"
    out.to_parquet(path)
    return out


def fetch_fred(series_id: str) -> pd.Series:
    """FRED series via the public CSV endpoint, cached. Missing values ('.') dropped."""
    path = _cache_path(f"FRED_{series_id}")
    if path.exists():
        return pd.read_parquet(path)["value"]
    url = (f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
           f"&cosd={C.FETCH_START}&coed={C.FETCH_END}")
    with urllib.request.urlopen(url, timeout=60) as resp:
        df = pd.read_csv(io.BytesIO(resp.read()))
    df.columns = ["date", "value"]
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna().set_index("date")
    if df.empty:
        raise RuntimeError(f"FRED returned no data for {series_id}")
    df.to_parquet(path)
    return df["value"]


def align_strictly_before(series: pd.Series, calendar: pd.DatetimeIndex) -> tuple[pd.Series, pd.Series]:
    """Value on calendar date t = last observation dated strictly before t.

    Returns (aligned values, source date used) so staleness can be audited.
    """
    s = series.dropna().sort_index()
    shifted_index = s.index + pd.Timedelta(days=1)
    values = pd.Series(s.to_numpy(), index=shifted_index).reindex(calendar, method="ffill")
    source = pd.Series(s.index.to_numpy(), index=shifted_index).reindex(calendar, method="ffill")
    return values, source


def _realized_vol(returns: pd.Series | pd.DataFrame) -> pd.Series | pd.DataFrame:
    return np.sqrt(C.TRADING_DAYS * (returns ** 2).rolling(C.RV_WINDOW).mean())


def _adjustment_steps(df: pd.DataFrame) -> int:
    """Number of days where adj_close/close changes: evidence that distributions are captured."""
    ratio = (df["adj_close"] / df["close"]).round(10)
    return int((ratio.pct_change().abs() > 1e-6).sum())


def _source_coverage(df: pd.DataFrame) -> dict:
    return {
        "first": str(df.index[0].date()),
        "last": str(df.index[-1].date()),
        "rows": int(len(df)),
        "adjustment_steps": _adjustment_steps(df) if "adj_close" in df else None,
    }


def build_calendar() -> pd.DatetimeIndex:
    kospi = fetch_yahoo(KR_TICKERS["KOSPI200"])
    cal = kospi.index[(kospi.index >= C.DATA_START) & (kospi.index <= C.DATA_END)]
    return pd.DatetimeIndex(cal, name="date")


def _kosdaq150_returns(calendar: pd.DatetimeIndex) -> pd.Series:
    """Composite-index returns up to and including the ETF's first day, ETF returns after."""
    proxy = fetch_yahoo(KOSDAQ150_PRE_LISTING_PROXY)["adj_close"]
    etf = fetch_yahoo(KOSDAQ150_ETF)["adj_close"]
    r_proxy = proxy.reindex(calendar).ffill(limit=C.FFILL_LIMIT).pct_change()
    r_etf = etf.reindex(calendar).ffill(limit=C.FFILL_LIMIT).pct_change()
    return r_proxy.where(calendar <= KOSDAQ150_ETF_FIRST_DAY, r_etf)


def load_market_data() -> MarketData:
    calendar = build_calendar()
    coverage: dict = {}
    returns = pd.DataFrame(index=calendar, columns=C.ASSETS, dtype=float)

    for asset, ticker in KR_TICKERS.items():
        df = fetch_yahoo(ticker)
        coverage[ticker] = _source_coverage(df)
        returns[asset] = df["adj_close"].reindex(calendar).ffill(limit=C.FFILL_LIMIT).pct_change()

    returns["KOSDAQ150"] = _kosdaq150_returns(calendar)
    for ticker in (KOSDAQ150_ETF, KOSDAQ150_PRE_LISTING_PROXY):
        coverage[ticker] = _source_coverage(fetch_yahoo(ticker))

    fx, fx_src = align_strictly_before(fetch_fred(FRED_SERIES["USDKRW"]), calendar)
    coverage["FRED:DEXKOUS"] = {"max_staleness_days": int((calendar - pd.DatetimeIndex(fx_src)).days.max())}
    for asset, ticker in US_TICKERS.items():
        df = fetch_yahoo(ticker)
        usd, src = align_strictly_before(df["adj_close"], calendar)
        coverage[ticker] = _source_coverage(df) | {
            "max_staleness_days": int((calendar - pd.DatetimeIndex(src)).days.max())}
        returns[asset] = (usd * fx).pct_change()

    # Leading rows lack a strictly-earlier US/FX observation; trim only the leading edge.
    first_complete = returns.notna().all(axis=1).idxmax()
    returns = returns.loc[first_complete:]
    if returns.isna().any().any():
        bad = returns.isna().sum()
        raise RuntimeError(f"Missing returns after alignment:\n{bad[bad > 0]}")
    prices = 100.0 * (1.0 + returns).cumprod()

    state = _state_vector(returns, fx, calendar, coverage)
    deviations = [
        "KOSDAQ 150: KOSDAQ composite (^KQ11, price index) used before 2015-10-01; "
        "229200.KS adjusted close from 2015-10-02 (KOSDAQ 150 index history requires KRX login).",
        "S&P 500 / NASDAQ 100 / Gold / Cash: SPY / QQQ / GLD / SHV adjusted close x USD/KRW "
        "(FRED DEXKOUS), lagged to the last observation strictly before each KRX date.",
        "VKOSPI unavailable (KRX login): replaced by KOSPI 200 21-day realized volatility "
        "(pre-registered fallback, PREREGISTRATION.md §6).",
        "US HY OAS (BAMLH0A0HYM2) unavailable before 2023-10 on FRED: replaced by Moody's "
        "Baa corporate minus 10Y Treasury spread (BAA10Y).",
        "PatchTST not reproduced (not a pretrained zero-shot model).",
    ]
    _write_manifest()
    return MarketData(prices, returns, state, coverage, deviations)


def _state_vector(returns: pd.DataFrame, fx: pd.Series, calendar: pd.DatetimeIndex,
                  coverage: dict) -> pd.DataFrame:
    rv = _realized_vol(returns).add_prefix("RV_")
    state = rv.copy()
    for name in ("VIX", "T10Y2Y", "CREDIT_SPREAD"):
        values, src = align_strictly_before(fetch_fred(FRED_SERIES[name]), calendar)
        coverage[f"FRED:{FRED_SERIES[name]}"] = {
            "max_staleness_days": int((calendar - pd.DatetimeIndex(src)).days.max())}
        state[name] = values.reindex(returns.index)
    state["VKOSPI_FALLBACK_RV_KOSPI200"] = rv["RV_KOSPI200"]
    state["RV_USDKRW"] = _realized_vol(fx.pct_change()).reindex(returns.index)
    return state


def _write_manifest() -> None:
    entries = {}
    for path in sorted(RAW_DIR.glob("*.parquet")):
        df = pd.read_parquet(path)
        entries[path.name] = {
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "rows": int(len(df)),
            "first": str(df.index[0].date()),
            "last": str(df.index[-1].date()),
        }
    MANIFEST.write_text(json.dumps(entries, indent=2), encoding="utf-8")
