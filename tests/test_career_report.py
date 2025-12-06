import math

import app.career as career
from app import create_app


def test_career_report_survives_extreme_losses(monkeypatch, tmp_path):
    tmp_sessions = tmp_path / "career_sessions.json"
    tmp_ranking = tmp_path / "career_ranking.json"
    tmp_sessions.write_text('{"sessions": {}}', encoding="utf-8")
    tmp_ranking.write_text('{"entries": []}', encoding="utf-8")
    monkeypatch.setattr(career, "DATA_DIR", tmp_path)
    monkeypatch.setattr(career, "SESSIONS_FILE", tmp_sessions)
    monkeypatch.setattr(career, "RANKING_FILE", tmp_ranking)
    career._adj_close_series.cache_clear()

    def fake_validate(universe, start, end):
        normalized = [str(t).strip().upper() for t in universe if str(t).strip()]
        return normalized, []

    def fake_returns(alloc, start, end):
        return {item["ticker"]: -1.2 for item in alloc}

    def fake_series_map(tickers, start, end):
        series = [[start.isoformat(), 100.0], [end.isoformat(), 105.0]]
        return {ticker: list(series) for ticker in tickers}

    monkeypatch.setattr(career, "_validate_universe", fake_validate)
    monkeypatch.setattr(career, "_returns_by_ticker", fake_returns)
    monkeypatch.setattr(career, "_build_normalized_series_map", fake_series_map)
    monkeypatch.setattr(
        career, "_apply_active_events", lambda *args, **kwargs: (0.0, {}, [], [])
    )
    monkeypatch.setattr(career, "_draw_events_for_turn", lambda *args, **kwargs: [])

    app = create_app()
    client = app.test_client()

    payload = {
        "player": "Tester",
        "difficulty": "experto",
        "universe": ["AAA"],
        "capital": 10000,
        "period_mode": "manual",
        "period_start": "2020-01-01",
        "period_end": "2021-01-05",
    }
    res = client.post("/api/career/session", json=payload)
    assert res.status_code == 200
    session_id = res.get_json()["session_id"]

    while True:
        session_resp = client.get(f"/api/career/session/{session_id}")
        assert session_resp.status_code == 200
        session_data = session_resp.get_json()["session"]
        pending = next(
            (t for t in session_data.get("turns", []) if t.get("status") == "pending"),
            None,
        )
        if not pending:
            break
        turn_payload = {
            "session_id": session_id,
            "turn_n": pending["n"],
            "alloc": [{"ticker": "AAA", "weight": 1.0}],
            "use_dca": False,
        }
        close_res = client.post("/api/career/turn", json=turn_payload)
        assert close_res.status_code == 200

    report_res = client.get(
        f"/api/career/report/{session_id}?bench=%5EGSPC&include_series=true"
    )
    assert report_res.status_code == 200
    data = report_res.get_json()
    assert data["portfolio_equity"]["series"]
    assert data["benchmark"]["series"]
    metrics = data["portfolio_equity"]["metrics"]
    assert math.isfinite(metrics["CAGR"])
    assert math.isfinite(metrics["total_return"])


def test_career_report_handles_missing_history(monkeypatch, tmp_path):
    tmp_sessions = tmp_path / "career_sessions.json"
    tmp_ranking = tmp_path / "career_ranking.json"
    tmp_sessions.write_text('{"sessions": {}}', encoding="utf-8")
    tmp_ranking.write_text('{"entries": []}', encoding="utf-8")
    monkeypatch.setattr(career, "DATA_DIR", tmp_path)
    monkeypatch.setattr(career, "SESSIONS_FILE", tmp_sessions)
    monkeypatch.setattr(career, "RANKING_FILE", tmp_ranking)
    career._adj_close_series.cache_clear()

    def fail_map(tickers, start, end):
        raise career.NoHistoricalDataError(tickers)

    monkeypatch.setattr(career, "_build_normalized_series_map", fail_map)

    app = create_app()
    client = app.test_client()

    payload = {
        "player": "Tester",
        "difficulty": "intermedio",
        "capital": 10000,
        "period_mode": "manual",
        "period_start": "2016-01-01",
        "period_end": "2018-12-31",
    }
    res = client.post("/api/career/session", json=payload)
    assert res.status_code == 200
    session_id = res.get_json()["session_id"]

    report_res = client.get(
        f"/api/career/report/{session_id}?bench=%5EGSPC&include_series=true"
    )
    assert report_res.status_code == 400
    data = report_res.get_json()
    assert "error" in data
