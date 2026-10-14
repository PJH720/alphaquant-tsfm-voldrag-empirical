"""Reference checks: downloaded data vs publicly reported historical values.

Guards against wrong tickers, broken adjustments or vendor revisions whenever data is
re-downloaded (e.g. on another machine). Reference values are widely published figures
(issuer fact sheets for SPY/QQQ/GLD calendar-year total returns, KRX year-end KOSPI
closes, FRED). They cover 2016-2024 only; later data still needs checking against
official sources (see DATA.md).

Requires network access on a fresh clone (data/raw is gitignored); skipped if offline.
"""

import pandas as pd
import pytest

from voldrag.data import fetch_fred, fetch_yahoo

TOTAL_RETURN_TOLERANCE_PP = 0.3  # dividend-date / rounding differences vs fact sheets

ANNUAL_TOTAL_RETURN_PCT = {
    "SPY": {2016: 12.0, 2017: 21.7, 2018: -4.6, 2019: 31.2, 2020: 18.4,
            2021: 28.7, 2022: -18.2, 2023: 26.2, 2024: 24.9},
    "QQQ": {2019: 39.0, 2020: 48.6, 2021: 27.4, 2022: -32.6, 2023: 54.9, 2024: 25.6},
    "GLD": {2019: 17.9, 2020: 24.8, 2021: -4.2, 2022: -0.8, 2023: 12.7, 2024: 26.7},
}
KOSPI_YEAR_END_CLOSE = {2019: 2197.67, 2020: 2873.47, 2021: 2977.65,
                        2022: 2236.40, 2023: 2655.28, 2024: 2399.49}


def _load(fetch, *args):
    try:
        return fetch(*args)
    except Exception as exc:  # network unavailable or vendor outage
        pytest.skip(f"data source unavailable: {exc}")


def _annual_returns_pct(series: pd.Series) -> pd.Series:
    year_end = series.groupby(series.index.year).last()
    return year_end.pct_change() * 100


@pytest.mark.parametrize(
    ("ticker", "year", "expected"),
    [(t, y, v) for t, years in ANNUAL_TOTAL_RETURN_PCT.items() for y, v in years.items()],
)
def test_us_etf_annual_total_return(ticker, year, expected):
    adj = _load(fetch_yahoo, ticker)["adj_close"]
    actual = _annual_returns_pct(adj)[year]
    assert actual == pytest.approx(expected, abs=TOTAL_RETURN_TOLERANCE_PP)


@pytest.mark.parametrize(("year", "expected"), list(KOSPI_YEAR_END_CLOSE.items()))
def test_kospi_year_end_close(year, expected):
    close = _load(fetch_yahoo, "^KS11")["close"]
    actual = close.groupby(close.index.year).last()[year]
    assert actual == pytest.approx(expected, abs=0.01)


def test_fred_reference_points():
    vix = _load(fetch_fred, "VIXCLS")
    fx = _load(fetch_fred, "DEXKOUS")
    assert vix.loc["2020-03-16"] == pytest.approx(82.69, abs=0.01)  # record VIX close
    assert fx.loc["2020-03-19"] == pytest.approx(1250.86, abs=0.01)


@pytest.mark.parametrize("ticker", ["069500.KS", "148070.KS", "229200.KS", "SPY", "QQQ", "SHV"])
def test_distributions_are_reflected_in_adjusted_prices(ticker):
    df = _load(fetch_yahoo, ticker)
    ratio = (df["adj_close"] / df["close"]).round(10)
    steps = int((ratio.pct_change().abs() > 1e-6).sum())
    assert steps > 0, f"{ticker}: adjusted close never departs from close; dividends missing"
