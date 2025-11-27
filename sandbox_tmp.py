import copy
import sys
import types

import pandas as pd

import app.career as c


def dummy_download(
    ticker,
    start,
    end,
    interval="1d",
    auto_adjust=False,
    actions=True,
    progress=False,
):
    idx = pd.date_range(start=start, end=end, freq="B")
    data = {
        "Adj Close": [100 for _ in idx],
        "Close": [100 for _ in idx],
        "Dividends": [0.0] * len(idx),
    }
    return pd.DataFrame(data, index=idx)


class DummyTicker:
    def __init__(self, t):
        self.fast_info = types.SimpleNamespace(last_price=100.0)


module = types.SimpleNamespace(
    download=dummy_download,
    Ticker=DummyTicker,
    utils=types.SimpleNamespace(),
)
sys.modules["yfinance"] = module
sys.modules["yfinance.utils"] = module.utils

# Build dummy session
session = {
    "session_id": "test",
    "player": "x",
    "difficulty": "intermedio",
    "universe": ["A"],
    "capital_initial": 10000.0,
    "capital_current": 10000.0,
    "period": {"start": "2020-01-01", "end": "2020-12-31"},
    "turns": [
        {"n": 1, "start": "2020-01-01", "end": "2020-12-31", "status": "completed"}
    ],
    "completed_turns": [
        {
            "turn_n": 1,
            "range": {"start": "2020-01-01", "end": "2020-12-31"},
            "alloc": [{"ticker": "A", "weight": 1.0}],
            "turn_return": -1.2,
            "turn_return_market": -1.2,
            "portfolio_value": 0,
        }
    ],
    "seed": 0,
    "created_at": "",
    "closed": True,
    "turns_total": 1,
    "contrib_so_far": 0.0,
    "cum_return": -1.2,
    "events_log": [],
    "active_events": [],
    "sectors_map": {},
    "decisions": [
        {"turn_n": 1, "alloc": [{"ticker": "A", "weight": 1.0}], "use_dca": False}
    ],
}

start_d, end_d, start_iso, end_iso = c._session_analysis_range(copy.deepcopy(session))
try:
    report, _ = c._generate_report_payload(
        copy.deepcopy(session),
        "^GSPC",
        True,
        start_d,
        end_d,
        start_iso,
        end_iso,
    )
    print("OK", report["portfolio_equity"]["metrics"])
except Exception as exc:
    print("ERROR", type(exc), exc)
