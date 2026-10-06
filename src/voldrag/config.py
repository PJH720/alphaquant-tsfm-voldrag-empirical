"""Pre-registered parameters (PREREGISTRATION.md). Do not tune after results are seen."""

SEED = 20261007

# Periods (§3). DATA_START amended 2013-01-02 -> 2012-12-03, see CHANGELOG.md (pre-results).
FETCH_START = "2012-12-01"
FETCH_END = "2026-09-05"  # yfinance end is exclusive
DATA_START = "2012-12-03"
DATA_END = "2026-08-31"
WARMUP = ("2015-01-02", "2016-12-30")
PERIODS = {
    "primary": ("2017-01-02", "2026-08-31"),
    "secondary": ("2015-01-02", "2026-08-31"),
}

ASSETS = ["KOSPI200", "KOSDAQ150", "KTB10Y", "SP500", "NASDAQ100", "GOLD", "CASH"]
CASH_IDX = ASSETS.index("CASH")
FFILL_LIMIT = 5

# Strategies (§4)
W_ITO = 504          # rolling window for Itô-Kelly moments and CVaR scenarios
W_MVO = 252          # MVO sample window
W_CAP = 0.40         # single-asset cap
ALPHA = 0.95         # CVaR level
RF = 0.02            # annual risk-free rate
TRADING_DAYS = 252
HIGHAM_TOL = 1e-10
HIGHAM_MAX_ITER = 1000

# TSFM (§5)
CHRONOS_MODEL = "amazon/chronos-bolt-small"
HORIZON = 5
Q_LOW, Q_MID, Q_HIGH = 0.1, 0.5, 0.9
Q_SPREAD_TO_SIGMA = 2.5631  # (q0.9 - q0.1) of N(0,1)

# Safeguard (§6)
AE_HIDDEN = (8, 4)
AE_LR = 1e-3
AE_EPOCHS = 500
SMOOTH = 0.8
TAU_WINDOW = 252
TAU_Q = 0.95
KAPPA = 4.0
BETA_TRADE_THRESHOLD = 0.05
RV_WINDOW = 21

# Costs & inference (§7)
COSTS_BP = (0, 10, 20)
BASE_COST_BP = 10
BOOT_B = 10_000
BOOT_BLOCK = 10
EPISODES = {
    "2020_pandemic": ("2020-02-01", "2020-04-30"),
    "2022_tightening": ("2022-01-01", "2022-12-31"),
}
