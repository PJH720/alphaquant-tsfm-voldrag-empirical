"""Live lab API: response cache, grid validation and the bounded GPU wait (EXPLORATORY module).

Uses FastAPI's TestClient without the lifespan (no LiveEngine, no Chronos): the simulate computation
is replaced by a stub, and a tiny stub engine stands in for /api/infer_tsfm.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from voldrag import config as C
from voldrag.api import server


@pytest.fixture()
def client(monkeypatch):
    calls = []

    def fake_simulate(req):
        calls.append(req)
        return {"period": req.period, "params": req.model_dump(exclude={"period"}), "label": server.LABEL_LIVE,
                "proposed": {"cagr_pct": 1.0 + len(calls)}, "compute": {"device": "cpu", "engine": "stub"}}

    monkeypatch.setattr(server, "_simulate", fake_simulate)
    monkeypatch.setattr(server, "sim_cache", server.LRU(512))
    monkeypatch.setattr(server, "infer_cache", server.LRU(1024))
    server.hits.clear()
    c = TestClient(server.app)  # no `with`: the lifespan (LiveEngine) does not run
    c.calls = calls
    return c


def test_same_params_hit_the_cache_with_identical_body(client):
    body = {"period": "primary", "cost_bp": 12.04, "k_tau": 1.0, "cash_floor": 0.0, "lambda_param": 1.0, "lambda_tc": 0.002}
    a = client.post("/api/simulate", json=body).json()
    b = client.post("/api/simulate", json={**body, "cost_bp": 12.0}).json()  # same key after snapping to 0.1bp
    assert len(client.calls) == 1
    assert a["compute"]["cached"] is False and b["compute"]["cached"] is True
    strip = lambda r: {**r, "compute": {k: v for k, v in r["compute"].items() if k not in ("cached", "ms")}}
    assert strip(a) == strip(b)
    assert server.sim_cache.stats()["hits"] == 1


def test_off_grid_lambda_tc_is_rejected(client):
    r = client.post("/api/simulate", json={"period": "primary", "lambda_tc": 0.003})
    assert r.status_code == 422
    assert not client.calls


class _StubChronos:
    def predict_quantiles(self, context, prediction_length, quantile_levels):  # pragma: no cover - not reached
        raise AssertionError("GPU must not run while the lock is held")


class _StubEngine:
    def __init__(self):
        idx = pd.bdate_range("2018-01-01", periods=C.W_ITO + 20)
        rng = np.random.default_rng(0)
        self.returns = pd.DataFrame(rng.normal(0, 0.01, (len(idx), len(C.ASSETS))), index=idx, columns=C.ASSETS)
        self.chronos_cache = pd.DataFrame()
        self.signals = pd.DataFrame({"score": 1.0, "tau": 2.0}, index=idx)
        self.self_check_result = {"ok": True}

    def chronos(self, _dtype):
        return _StubChronos()

    def beta(self, _k, _floor):
        return pd.Series(0.0, index=self.returns.index)


def test_busy_gpu_lock_returns_503(client, monkeypatch):
    monkeypatch.setitem(server.state, "engine", _StubEngine())
    monkeypatch.setattr(server, "GPU_WAIT_S", 0.2)
    date = str(server.state["engine"].returns.index[-1].date())
    assert server.gpu_lock.acquire(timeout=1)
    try:
        r = client.post("/api/infer_tsfm", json={"date": date, "asset": "SP500"})
    finally:
        server.gpu_lock.release()
    assert r.status_code == 503
    assert server.gpu_lock.acquire(timeout=1)  # released by the handler's finally path
    server.gpu_lock.release()


def test_labels_follow_rule_5():
    assert server.LABEL_LIVE_EN == "live / exploratory, not the pre-registered result"
    assert server.LABEL_LIVE == "실시간 · 탐색적 — 사전등록 결과 아님"
    assert server.LABEL_PREREG == "사전등록 설정 · results.json과 일치 (self-check ok)"
