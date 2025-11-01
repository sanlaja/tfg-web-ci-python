from __future__ import annotations

import calendar
import hashlib
import json
import random
import secrets
import csv
import math
from copy import deepcopy
from datetime import date, datetime, timedelta
from io import StringIO
from itertools import combinations
from pathlib import Path
from statistics import StatisticsError, mean
from typing import Any, Iterable

import pandas as pd
from flask import Blueprint, jsonify, make_response, request
from werkzeug.exceptions import BadRequest, NotFound

try:
    from app.routes import (
        _download_history_df,
        _extract_series,
        _series_with_date_index,
        _first_price_on_or_after,
        _last_price_on_or_before,
    )
except Exception:  # pragma: no cover
    import yfinance as yf

    def _download_history_df(  # type: ignore[override]
        ticker: str, start_d: date, end_d: date, include_actions: bool = True
    ) -> pd.DataFrame:
        df = yf.download(
            ticker,
            start=str(start_d),
            end=str(end_d + timedelta(days=1)),
            interval="1d",
            auto_adjust=False,
            actions=include_actions,
            progress=False,
        )
        return df

    def _extract_series(df: pd.DataFrame, column: str, ticker: str) -> pd.Series:  # type: ignore[override]
        if df is None or df.empty or column not in df:
            return pd.Series(dtype=float)
        series = df[column]
        if isinstance(series, pd.DataFrame):
            if ticker in series:
                return series[ticker]
            return series.iloc[:, 0]
        return series

    def _series_with_date_index(series: pd.Series) -> pd.Series:  # type: ignore[override]
        series = series.copy()
        if not series.empty:
            series.index = pd.to_datetime(series.index).date
        return series

    def _first_price_on_or_after(series: pd.Series, target: date) -> float | None:  # type: ignore[override]
        if series.empty:
            return None
        for idx, value in series.sort_index().items():
            if idx >= target and not pd.isna(value):
                return float(value)
        return None

    def _last_price_on_or_before(series: pd.Series, target: date) -> float | None:  # type: ignore[override]
        if series.empty:
            return None
        for idx, value in reversed(list(series.sort_index().items())):
            if idx <= target and not pd.isna(value):
                return float(value)
        return None


career_bp = Blueprint("career", __name__, url_prefix="/api/career")

DATA_DIR = Path(__file__).resolve().parent / "data"
SESSIONS_FILE = DATA_DIR / "career_sessions.json"
RANKING_FILE = DATA_DIR / "career_ranking.json"
BASE_START_DATE = date(2000, 1, 3)
MAX_ASSETS = 10
PORTFOLIO_SCOPE = "portfolio"
SERIES_CACHE: dict[tuple[str, str, str], pd.Series] = {}
CASH_TICKERS = {"CASH", "CASH:USD"}


def _is_cash(ticker: str) -> bool:
    return (ticker or "").strip().upper() in CASH_TICKERS


DIFFICULTY_CONFIG = {
    "principiante": {
        "years": (10, 15),
        "turn_months": 12,
        "shock_probability": 0.12,
        "shock_range": (-0.03, -0.012),
    },
    "intermedio": {
        "years": (3, 7),
        "turn_months": 6,
        "shock_probability": 0.22,
        "shock_range": (-0.045, -0.018),
    },
    "experto": {
        "years": (1, 2),
        "turn_months": 1,
        "shock_probability": 0.35,
        "shock_range": (-0.06, -0.025),
    },
}

EVENTS_CATALOG: list[dict[str, Any]] = [
    {
        "id": "macro_shock_neg",
        "name": "Shock macro (negativo)",
        "scope": "portfolio",
        "impact_range": (-0.08, -0.02),
        "duration_turns_range": (1, 2),
        "prob": {"principiante": 0.10, "intermedio": 0.20, "experto": 0.35},
    },
    {
        "id": "sector_rumor_neg",
        "name": "Rumor sectorial (negativo)",
        "scope": "sector",
        "impact_range": (-0.06, -0.02),
        "duration_turns_range": (1, 2),
        "prob": {"principiante": 0.05, "intermedio": 0.10, "experto": 0.20},
    },
    {
        "id": "ticker_news_pos",
        "name": "Noticia específica (positivo)",
        "scope": "ticker",
        "impact_range": (0.02, 0.06),
        "duration_turns_range": (1, 1),
        "prob": {"principiante": 0.05, "intermedio": 0.10, "experto": 0.15},
    },
]

DEFAULT_SECTOR_GUESSES = {
    "AAPL": "TECH",
    "MSFT": "TECH",
    "GOOGL": "TECH",
    "GOOG": "TECH",
    "AMZN": "CONSUMER",
    "META": "TECH",
    "NVDA": "TECH",
    "TSLA": "AUTO",
    "^GSPC": "INDEX",
}

SECTOR_CACHE: dict[str, str] = {}
MAX_EVENT_IMPACT = 0.5
MIN_EVENT_IMPACT = -0.5
MIN_EVENT_DURATION = 1
MAX_EVENT_DURATION = 6


def _flat_cash_series_from_index(index: Iterable[date]) -> list[list[str, float]]:
    return [[d.isoformat(), 100.0] for d in index]


def _extract_dates_from_series(series_data: list[list[str, float]]) -> list[date]:
    dates: list[date] = []
    for entry in series_data:
        if not entry:
            continue
        try:
            dates.append(date.fromisoformat(entry[0]))
        except (ValueError, TypeError):
            continue
    return dates


def _get_sector(ticker: str) -> str | None:
    ticker_norm = (ticker or "").strip().upper()
    if not ticker_norm:
        return None
    if ticker_norm in SECTOR_CACHE:
        return SECTOR_CACHE[ticker_norm]
    sector = DEFAULT_SECTOR_GUESSES.get(ticker_norm)
    if sector:
        SECTOR_CACHE[ticker_norm] = sector
    return sector


def _resolve_sector(session: dict[str, Any], ticker: str) -> str | None:
    ticker_norm = (ticker or "").strip().upper()
    if not ticker_norm:
        return None
    sectors_map = session.setdefault("sectors_map", {})
    sector = sectors_map.get(ticker_norm)
    if sector:
        return sector
    candidate = _get_sector(ticker_norm)
    if candidate:
        sectors_map[ticker_norm] = candidate
        return candidate
    return None


def _available_sectors(
    session: dict[str, Any], alloc: list[dict[str, Any]]
) -> list[str]:
    sectors: list[str] = []
    seen: set[str] = set()
    for item in alloc:
        ticker = item.get("ticker")
        if not ticker or _is_cash(ticker):
            continue
        sector = _resolve_sector(session, ticker)
        if sector and sector not in seen:
            seen.add(sector)
            sectors.append(sector)
    return sectors


def _random_in_range(range_tuple: tuple[float, float], rng: random.Random) -> float:
    lo, hi = range_tuple
    if lo > hi:
        lo, hi = hi, lo
    return rng.uniform(lo, hi)


def _load_sessions_store() -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SESSIONS_FILE.exists():
        return {"sessions": {}}
    try:
        return json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"sessions": {}}


def _save_sessions_store(store: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_FILE.write_text(json.dumps(store, indent=2), encoding="utf-8")


def _load_ranking_store() -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not RANKING_FILE.exists():
        return {"entries": []}
    try:
        return json.loads(RANKING_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"entries": []}


def _save_ranking_store(store: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RANKING_FILE.write_text(json.dumps(store, indent=2), encoding="utf-8")


def _upsert_ranking_entry(entry: dict[str, Any]) -> None:
    store = _load_ranking_store()
    entries = [
        e
        for e in store.get("entries", [])
        if e.get("session_id") != entry.get("session_id")
    ]
    entries.append(entry)
    store["entries"] = entries
    _save_ranking_store(store)


def _ranking_entries_sorted() -> list[dict[str, Any]]:
    store = _load_ranking_store()
    entries = store.get("entries", [])
    return sorted(entries, key=lambda e: e.get("score", 0.0), reverse=True)


def _persist_session(session: dict[str, Any]) -> None:
    store = _load_sessions_store()
    sessions = store.setdefault("sessions", {})
    sessions[session["session_id"]] = session
    _save_sessions_store(store)


def _get_session(session_id: str) -> dict[str, Any] | None:
    store = _load_sessions_store()
    return deepcopy(store.get("sessions", {}).get(session_id))


def _update_session(session: dict[str, Any]) -> None:
    _persist_session(session)


def _seed_from_player(player: str) -> int:
    today = datetime.utcnow().date().isoformat()
    base = f"{player or 'anon'}_{today}"
    digest = hashlib.sha256(base.encode("utf-8")).hexdigest()[:16]
    return int(digest, 16)


def _add_months(dt: date, months: int) -> date:
    if months == 0:
        return dt
    year = dt.year + (dt.month - 1 + months) // 12
    month = (dt.month - 1 + months) % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _build_turn_schedule(
    start: date, end: date, step_months: int
) -> list[dict[str, Any]]:
    turns: list[dict[str, Any]] = []
    turn_start = start
    idx = 1
    while turn_start <= end:
        next_start = _add_months(turn_start, step_months)
        tentative_end = next_start - timedelta(days=1)
        turn_end = tentative_end if tentative_end <= end else end
        turns.append(
            {
                "n": idx,
                "start": turn_start.isoformat(),
                "end": turn_end.isoformat(),
                "status": "pending",
            }
        )
        if next_start > end:
            break
        turn_start = next_start
        idx += 1
    return turns


def _generate_period(
    config: dict[str, Any], rng: random.Random
) -> tuple[date, date, list[dict[str, Any]]]:
    today = date.today()
    min_years, max_years = config["years"]
    period_years = rng.randint(min_years, max_years)
    total_months = period_years * 12
    latest_start = _add_months(today, -total_months)
    if latest_start < BASE_START_DATE:
        latest_start = BASE_START_DATE
    span_days = max(0, (latest_start - BASE_START_DATE).days)
    offset_days = rng.randint(0, span_days) if span_days else 0
    start_d = BASE_START_DATE + timedelta(days=offset_days)
    end_candidate = _add_months(start_d, total_months) - timedelta(days=1)
    end_d = end_candidate if end_candidate <= today else today
    turns = _build_turn_schedule(start_d, end_d, config["turn_months"])
    if not turns:
        end_d = today
        turns = _build_turn_schedule(start_d, end_d, config["turn_months"])
    return start_d, end_d, turns


def _adj_close_series(ticker: str, start: date, end: date) -> pd.Series:
    cache_key = (ticker, start.isoformat(), end.isoformat())
    if cache_key in SERIES_CACHE:
        return SERIES_CACHE[cache_key]
    df = _download_history_df(
        ticker, start, end, include_actions=False
    )  # REUSE: descarga histÃ³rico diario existente
    series = _extract_series(
        df, "Adj Close", ticker
    )  # REUSE:  reutiliza extractor de columnas
    normalized = _series_with_date_index(series)  # REUSE: normaliza Ã­ndice de fechas
    if normalized.empty:
        SERIES_CACHE[cache_key] = normalized
        return normalized
    filtered = normalized[(normalized.index >= start) & (normalized.index <= end)]
    SERIES_CACHE[cache_key] = filtered
    return filtered


def _fetch_adj_close(ticker: str, start: date, end: date) -> list[list[str, float]]:
    if _is_cash(ticker):
        return []
    series = _adj_close_series(ticker, start, end)
    return [[idx.isoformat(), float(val)] for idx, val in series.sort_index().items()]


def _normalize_base100(series_list: list[list[str, float]]) -> list[list[str, float]]:
    if not series_list:
        return []
    base_price = series_list[0][1]
    if base_price in (None, 0):
        return []
    normalized: list[list[str, float]] = []
    for date_str, price in series_list:
        if price is None:
            continue
        normalized.append([date_str, round((price / base_price) * 100, 4)])
    return normalized


def _business_date_index(start: date, end: date) -> list[date]:
    if end < start:
        return []
    idx = pd.bdate_range(start=start, end=end)
    return [ts.date() for ts in idx]


def _build_normalized_series_map(
    tickers: list[str], start: date, end: date
) -> dict[str, list[list[str, float]]]:
    series_map: dict[str, list[list[str, float]]] = {}
    if not tickers:
        return series_map

    non_cash = [t for t in tickers if not _is_cash(t)]
    cash = [t for t in tickers if _is_cash(t)]
    anchor_dates: list[date] | None = None

    for ticker in non_cash:
        data = _fetch_adj_close(
            ticker, start, end
        )  # REUSE: reutiliza descarga y normalizaciÃ³n del histÃ³rico diario
        if data and anchor_dates is None:
            anchor_dates = _extract_dates_from_series(data)
        series_map[ticker] = _normalize_base100(data)

    if anchor_dates:
        anchor_dates = [d for d in anchor_dates if start <= d <= end]
    if not anchor_dates:
        anchor_dates = _business_date_index(start, end)
    cash_raw = _flat_cash_series_from_index(anchor_dates) if anchor_dates else []
    for ticker in cash:
        series_map[ticker] = _normalize_base100(cash_raw) if cash_raw else []

    for ticker in tickers:
        series_map.setdefault(ticker, [])

    return series_map


def _series_list_to_series(series_list: list[list[str, float]]) -> pd.Series:
    if not series_list:
        return pd.Series(dtype=float)
    records: list[tuple[pd.Timestamp, float]] = []
    for entry in series_list:
        if not entry or entry[1] is None:
            continue
        try:
            ts = pd.to_datetime(entry[0])
            value = float(entry[1])
        except (TypeError, ValueError):
            continue
        records.append((ts, value))
    if not records:
        return pd.Series(dtype=float)
    idx, values = zip(*records)
    return pd.Series(values, index=pd.DatetimeIndex(idx)).sort_index()


def _pd_series_to_list(series: pd.Series) -> list[list[str, float]]:
    if series.empty:
        return []
    return [
        [idx.date().isoformat(), round(float(val), 4)]
        for idx, val in series.sort_index().items()
    ]


def _validate_universe(
    universe: Iterable[str], start: date, end: date
) -> tuple[list[str], list[str]]:
    ok: list[str] = []
    bad: list[str] = []
    for raw in universe:
        ticker = str(raw).strip().upper()
        if not ticker:
            continue
        if _is_cash(ticker):
            ok.append(ticker)
            continue
        try:
            series = _adj_close_series(ticker, start, end)
        except Exception:
            series = pd.Series(dtype=float)
        if series.empty:
            bad.append(ticker)
            continue
        ok.append(ticker)
    return ok, bad


def _returns_by_ticker(
    alloc: list[dict[str, Any]], start: date, end: date
) -> dict[str, float]:
    returns: dict[str, float] = {}
    issues: list[str] = []
    for item in alloc:
        ticker = item["ticker"]
        if _is_cash(ticker):
            returns[ticker] = 0.0
            continue
        series = _adj_close_series(
            ticker, start, end
        )  # REUSE: reutiliza descarga e Ã­ndice homogenizado
        if series.empty:
            issues.append(ticker)
            continue
        start_price = _first_price_on_or_after(
            series, start
        )  # REUSE: precio inicial existente
        end_price = _last_price_on_or_before(
            series, end
        )  # REUSE: precio final existente
        if start_price in (None, 0) or end_price is None:
            issues.append(ticker)
            continue
        returns[ticker] = (end_price / start_price) - 1.0
    if issues:
        tickers_msg = ", ".join(sorted(set(issues)))
        raise BadRequest(f"No hay datos suficientes para los tickers: {tickers_msg}.")
    return returns


def _max_drawdown_from_series(series: pd.Series) -> float:
    if series.empty:
        return 0.0
    running_max = series.cummax()
    drawdowns = series / running_max - 1.0
    return float(drawdowns.min()) if not drawdowns.empty else 0.0


def _compute_metrics_from_base100(
    series: pd.Series,
) -> tuple[dict[str, float], pd.Series]:
    series = series.sort_index()
    if series.empty:
        empty_metrics = {
            "total_return": 0.0,
            "CAGR": 0.0,
            "vol_annual": 0.0,
            "max_drawdown": 0.0,
        }
        return empty_metrics, pd.Series(dtype=float)

    start_val = float(series.iloc[0])
    end_val = float(series.iloc[-1])
    total_return = (end_val / start_val - 1.0) if start_val else 0.0

    span_days = max((series.index[-1] - series.index[0]).days, 0)
    years = span_days / 365.25 if span_days > 0 else 0.0
    if years > 0 and start_val > 0:
        cagr = (end_val / start_val) ** (1 / years) - 1.0
    else:
        cagr = total_return

    monthly = series.resample("M").last()
    monthly_returns = monthly.pct_change().dropna()
    vol_annual = (
        float(monthly_returns.std(ddof=0) * math.sqrt(12))
        if not monthly_returns.empty
        else 0.0
    )
    max_drawdown = _max_drawdown_from_series(series)
    metrics = {
        "total_return": round(total_return, 6),
        "CAGR": round(cagr, 6),
        "vol_annual": round(vol_annual, 6),
        "max_drawdown": round(max_drawdown, 6),
    }
    return metrics, monthly_returns


def _compute_basic_metrics(series: pd.Series) -> dict[str, float]:
    metrics, _ = _compute_metrics_from_base100(series)
    return metrics


def _tracking_summary(
    portfolio_metrics: dict[str, float],
    benchmark_metrics: dict[str, float],
    portfolio_monthly: pd.Series,
    benchmark_monthly: pd.Series,
) -> dict[str, float | None]:
    active_return = portfolio_metrics.get("CAGR", 0.0) - benchmark_metrics.get(
        "CAGR", 0.0
    )
    tracking_error = 0.0
    if not portfolio_monthly.empty and not benchmark_monthly.empty:
        joined = pd.concat([portfolio_monthly, benchmark_monthly], axis=1, join="inner")
        joined.columns = ["portfolio", "benchmark"]
        if not joined.empty:
            diff = joined["portfolio"] - joined["benchmark"]
            if not diff.empty:
                tracking_error = float(diff.std(ddof=0) * math.sqrt(12))
    information_ratio = active_return / tracking_error if tracking_error > 0 else None
    return {
        "active_return": round(active_return, 6),
        "tracking_error": round(tracking_error, 6),
        "information_ratio": (
            round(information_ratio, 6) if information_ratio is not None else None
        ),
    }


def _session_analysis_range(session: dict[str, Any]) -> tuple[date, date, str, str]:
    period = session.get("period") or {}
    start_iso = period.get("start")
    if not start_iso:
        raise BadRequest("La sesiÃ³n no tiene periodo configurado.")
    start_d = date.fromisoformat(start_iso)

    turns = session.get("turns") or []
    if not turns:
        raise BadRequest("La sesiÃ³n no dispone de turnos configurados.")

    completed_turns = session.get("completed_turns") or []
    turn_lookup = {
        turn.get("n"): turn for turn in turns if isinstance(turn.get("n"), int)
    }
    if completed_turns:
        closed_numbers = [
            snapshot.get("turn_n")
            for snapshot in completed_turns
            if isinstance(snapshot, dict) and isinstance(snapshot.get("turn_n"), int)
        ]
        turn_reference = None
        if closed_numbers:
            last_turn_n = max(closed_numbers)
            turn_reference = turn_lookup.get(last_turn_n)
            if turn_reference is None and turn_lookup:
                turn_reference = turn_lookup.get(max(turn_lookup.keys()))
        else:
            turn_reference = None
        if turn_reference is None:
            turn_reference = turns[-1]
    else:
        turn_reference = turns[0]

    end_iso = (
        turn_reference.get("end")
        or period.get("end")
        or turn_reference.get("start")
        or start_iso
    )
    end_d = date.fromisoformat(end_iso)
    if end_d < start_d:
        end_d = start_d
        end_iso = start_iso
    return start_d, end_d, start_iso, end_iso


def _collect_session_universe(session: dict[str, Any]) -> list[str]:
    tickers: set[str] = set()
    for raw in session.get("universe") or []:
        if raw:
            tickers.add(str(raw).strip().upper())
    for decision in session.get("decisions") or []:
        for entry in decision.get("alloc") or []:
            ticker = str(entry.get("ticker", "")).strip().upper()
            if ticker:
                tickers.add(ticker)
    tickers.add("CASH")
    ordered = sorted(tickers)
    return ordered


def _portfolio_equity_series(
    session: dict[str, Any], start: date, end: date
) -> pd.Series:
    equity = 100.0
    points: list[tuple[pd.Timestamp, float]] = []
    points.append((pd.to_datetime(start), equity))
    snapshots = sorted(
        (
            snap
            for snap in session.get("completed_turns") or []
            if isinstance(snap, dict)
        ),
        key=lambda s: s.get("turn_n", 0),
    )
    for snapshot in snapshots:
        turn_return = snapshot.get("turn_return")
        range_info = snapshot.get("range") or {}
        end_iso = range_info.get("end")
        if turn_return is None or end_iso is None:
            continue
        equity *= 1 + float(turn_return)
        points.append((pd.to_datetime(end_iso), equity))
    if not snapshots:
        points.append((pd.to_datetime(end), equity))
    else:
        last_ts = points[-1][0] if points else None
        end_ts = pd.to_datetime(end)
        if last_ts is None or last_ts < end_ts:
            points.append((end_ts, equity))
    unique_points: dict[pd.Timestamp, float] = {}
    for ts, value in points:
        if ts in unique_points:
            unique_points[ts] = value
        else:
            unique_points[ts] = value
    series = pd.Series(
        [unique_points[ts] for ts in sorted(unique_points)],
        index=pd.DatetimeIndex(sorted(unique_points)),
    )
    if not series.empty and series.iloc[0] != 100.0:
        series = series / series.iloc[0] * 100.0
    return series.sort_index()


def _combine_normalized_series(
    tickers: list[str],
    weights: list[float],
    normalized_map: dict[str, list[list[str, float]]],
) -> pd.Series:
    if not tickers or not weights:
        return pd.Series(dtype=float)
    data: dict[str, pd.Series] = {}
    for ticker in tickers:
        series = _series_list_to_series(normalized_map.get(ticker, []))
        if series.empty:
            return pd.Series(dtype=float)
        data[ticker] = series
    df = pd.DataFrame(data)
    df = df[tickers]
    df = df.sort_index()
    df = df.fillna(method="ffill").fillna(method="bfill")
    weights_by_ticker = pd.Series(weights, index=tickers)
    combined = df.mul(weights_by_ticker, axis=1).sum(axis=1)
    if combined.empty:
        return combined
    first_value = combined.iloc[0]
    if first_value != 0:
        combined = combined / first_value * 100.0
    return combined


def _equal_weights(count: int) -> list[float]:
    if count <= 0:
        return []
    weight = round(1.0 / count, 6)
    return [weight for _ in range(count)]


def _clamp(value: float, min_value: float = 0.0, max_value: float = 1.0) -> float:
    return max(min_value, min(value, max_value))


def _turnover_average(session: dict[str, Any]) -> float:
    snapshots = sorted(
        (
            snap
            for snap in session.get("completed_turns") or []
            if isinstance(snap, dict)
        ),
        key=lambda snap: snap.get("turn_n", 0),
    )
    if len(snapshots) < 2:
        return 0.0

    turnovers: list[float] = []
    prev_alloc: dict[str, float] | None = None

    for snapshot in snapshots:
        alloc_list = snapshot.get("alloc") or []
        current_alloc: dict[str, float] = {}
        for entry in alloc_list:
            ticker = str(entry.get("ticker", "")).strip().upper()
            if not ticker:
                continue
            try:
                weight = float(entry.get("weight", 0.0))
            except (TypeError, ValueError):
                weight = 0.0
            current_alloc[ticker] = weight

        if prev_alloc is not None:
            tickers = set(prev_alloc) | set(current_alloc)
            diff = sum(
                abs(current_alloc.get(ticker, 0.0) - prev_alloc.get(ticker, 0.0))
                for ticker in tickers
            )
            turnovers.append(0.5 * diff)
        prev_alloc = current_alloc

    try:
        return float(mean(turnovers)) if turnovers else 0.0
    except StatisticsError:
        return 0.0


def _compute_score_payload(
    portfolio_metrics: dict[str, float],
    tracking: dict[str, float | None],
    turnover_avg: float,
) -> dict[str, Any]:
    cagr_component = _clamp(portfolio_metrics.get("CAGR", 0.0) / 0.20)
    drawdown = portfolio_metrics.get("max_drawdown", 0.0)
    drawdown_abs = abs(drawdown) if drawdown < 0 else drawdown
    dd_component = _clamp((0.50 - min(drawdown_abs, 0.50)) / 0.50)
    tracking_error = tracking.get("tracking_error") or 0.0
    te_component = _clamp((0.30 - min(tracking_error, 0.30)) / 0.30)
    turnover_component = _clamp((0.50 - min(turnover_avg, 0.50)) / 0.50)

    score_0_1 = (
        0.45 * cagr_component
        + 0.25 * dd_component
        + 0.20 * te_component
        + 0.10 * turnover_component
    )
    value = round(score_0_1 * 10, 2)
    stars = max(1, min(10, round(value)))

    notes_parts: list[str] = []
    if cagr_component >= 0.8:
        notes_parts.append("CAGR alto")
    elif cagr_component >= 0.5:
        notes_parts.append("CAGR moderado")
    else:
        notes_parts.append("CAGR bajo")

    if dd_component >= 0.8:
        notes_parts.append("drawdown contenido")
    elif dd_component >= 0.5:
        notes_parts.append("drawdown moderado")
    else:
        notes_parts.append("drawdown elevado")

    if te_component >= 0.7:
        notes_parts.append("tracking estable")
    elif te_component >= 0.4:
        notes_parts.append("tracking medio")
    else:
        notes_parts.append("tracking volÃ¡til")

    if turnover_component >= 0.7:
        notes_parts.append("rotaciÃ³n baja")
    elif turnover_component >= 0.4:
        notes_parts.append("rotaciÃ³n media")
    else:
        notes_parts.append("rotaciÃ³n alta")

    notes = ", ".join(notes_parts) + "; buen balance riesgo/retorno"

    breakdown = {
        "cagr_component": round(cagr_component, 4),
        "dd_component": round(dd_component, 4),
        "te_component": round(te_component, 4),
        "turnover_component": round(turnover_component, 4),
    }

    return {
        "stars": stars,
        "value": value,
        "breakdown": breakdown,
        "notes": notes,
        "score_0_1": score_0_1,
    }


def _compute_data_warnings(
    session: dict[str, Any],
    start_d: date,
    end_d: date,
    normalized_map: dict[str, list[list[str, float]]],
    bench_ticker: str | None = None,
) -> list[str]:
    warnings: set[str] = set()
    expected_days = len(pd.bdate_range(start=start_d, end=end_d))

    all_tickers: set[str] = set(normalized_map.keys())
    if bench_ticker:
        all_tickers.add(bench_ticker)

    rejected_set = {
        str(t).strip().upper()
        for t in session.get("rejected_universe") or []
        if str(t).strip()
    }
    allocated_tickers = {
        str(entry.get("ticker", "")).strip().upper()
        for decision in session.get("decisions") or []
        for entry in decision.get("alloc") or []
        if str(entry.get("ticker", "")).strip()
    }
    for ticker in rejected_set & allocated_tickers:
        warnings.add(f"rejected_in_range:{ticker}")

    for ticker in sorted(all_tickers):
        series_list = normalized_map.get(ticker) or []
        series_pd = _series_list_to_series(series_list)
        if series_pd.empty or len(series_pd) < 2:
            warnings.add(f"short_series:{ticker}")
            continue

        present_days = {idx.normalize() for idx in series_pd.index}
        if expected_days > 0:
            coverage = len(present_days) / expected_days
            if coverage < 0.8:
                warnings.add(f"low_coverage:{ticker}")

        gap_counter = 0
        for bday in pd.bdate_range(start=start_d, end=end_d):
            if bday.normalize() not in present_days:
                gap_counter += 1
                if gap_counter > 10:
                    warnings.add(f"large_gap:{ticker}")
                    break
            else:
                gap_counter = 0

    return sorted(warnings)


def _compute_benchmark_package(
    bench_ticker: str, start_d: date, end_d: date
) -> tuple[pd.Series, dict[str, float], pd.Series]:
    bench_map = _build_normalized_series_map([bench_ticker], start_d, end_d)
    bench_series_pd = _series_list_to_series(bench_map.get(bench_ticker, []))
    if bench_series_pd.empty:
        raise BadRequest("No hay datos disponibles para el benchmark solicitado.")
    bench_metrics, bench_monthly = _compute_metrics_from_base100(bench_series_pd)
    return bench_series_pd, bench_metrics, bench_monthly


def _compute_theoretical_summary(
    session: dict[str, Any], start_d: date, end_d: date, kmax: int = 3
) -> dict[str, Any]:
    universe_candidates = _collect_session_universe(session)
    if not universe_candidates:
        raise BadRequest("El universo de la sesiÃ³n estÃ¡ vacÃ­o.")

    normalized_map = _build_normalized_series_map(universe_candidates, start_d, end_d)

    ticker_metrics: dict[str, dict[str, float]] = {}
    filtered_tickers: list[str] = []
    for ticker in universe_candidates:
        series_pd = _series_list_to_series(normalized_map.get(ticker, []))
        if series_pd.empty:
            continue
        metrics, _ = _compute_metrics_from_base100(series_pd)
        ticker_metrics[ticker] = metrics
        filtered_tickers.append(ticker)

    if not filtered_tickers:
        raise BadRequest("No hay datos suficientes para evaluar el universo.")

    original_count = len(filtered_tickers)
    ranked_by_cagr = sorted(
        filtered_tickers,
        key=lambda tk: ticker_metrics[tk]["CAGR"],
        reverse=True,
    )

    limit = 30
    use_greedy = original_count > limit
    if len(ranked_by_cagr) > limit:
        ranked_by_cagr = ranked_by_cagr[:limit]

    tickers_eval = ranked_by_cagr
    if not tickers_eval:
        raise BadRequest("No hay tickers elegibles tras aplicar filtros.")

    results: dict[str, dict[str, Any]] = {}
    method_map: dict[str, str] = {}

    if len(tickers_eval) >= 1:
        best_ticker = ranked_by_cagr[0]
        series_pd = _series_list_to_series(normalized_map.get(best_ticker, []))
        metrics = ticker_metrics[best_ticker]
        results["k1"] = {
            "tickers": [best_ticker],
            "weights": [1.0],
            "series": _pd_series_to_list(series_pd),
            "metrics": {
                "total_return": metrics["total_return"],
                "CAGR": metrics["CAGR"],
                "max_drawdown": metrics["max_drawdown"],
            },
        }

    def _record_best_combination(label: str, combo_result: dict[str, Any]) -> None:
        payload = combo_result.copy()
        payload.pop("cagr", None)
        results[label] = payload

    if kmax >= 2 and len(tickers_eval) >= 2:
        if use_greedy and "k1" in results:
            base_ticker = results["k1"]["tickers"][0]
            best_combo: dict[str, Any] | None = None
            for candidate in tickers_eval:
                if candidate == base_ticker:
                    continue
                combo = _evaluate_combo_result([base_ticker, candidate], normalized_map)
                if not combo:
                    continue
                if (
                    best_combo is None
                    or combo["cagr"] > best_combo["cagr"]
                    or (
                        combo["cagr"] == best_combo["cagr"]
                        and combo["metrics"]["total_return"]
                        > best_combo["metrics"]["total_return"]
                    )
                ):
                    best_combo = combo
            if best_combo:
                _record_best_combination("k2", best_combo)
                method_map["k2"] = "greedy"
        else:
            best_combo = None
            for combo in combinations(tickers_eval, 2):
                combo_result = _evaluate_combo_result(list(combo), normalized_map)
                if not combo_result:
                    continue
                if (
                    best_combo is None
                    or combo_result["cagr"] > best_combo["cagr"]
                    or (
                        combo_result["cagr"] == best_combo["cagr"]
                        and combo_result["metrics"]["total_return"]
                        > best_combo["metrics"]["total_return"]
                    )
                ):
                    best_combo = combo_result
            if best_combo:
                _record_best_combination("k2", best_combo)
                method_map["k2"] = "bruteforce"

    if kmax >= 3 and len(tickers_eval) >= 3:
        if use_greedy:
            base_combo = results.get("k2")
            if not base_combo and len(tickers_eval) >= 2:
                tentative = tickers_eval[:2]
                base_combo = _evaluate_combo_result(tentative, normalized_map)
                if base_combo:
                    _record_best_combination("k2", base_combo)
                    method_map["k2"] = "greedy"
            best_triple: dict[str, Any] | None = None
            base_tickers = base_combo["tickers"] if base_combo else []
            for candidate in tickers_eval:
                if candidate in base_tickers:
                    continue
                combo_tickers = list(base_tickers) + [candidate]
                if len(combo_tickers) != 3:
                    continue
                combo_result = _evaluate_combo_result(combo_tickers, normalized_map)
                if not combo_result:
                    continue
                if (
                    best_triple is None
                    or combo_result["cagr"] > best_triple["cagr"]
                    or (
                        combo_result["cagr"] == best_triple["cagr"]
                        and combo_result["metrics"]["total_return"]
                        > best_triple["metrics"]["total_return"]
                    )
                ):
                    best_triple = combo_result
            if best_triple:
                _record_best_combination("k3", best_triple)
                method_map["k3"] = "greedy"
        else:
            best_combo = None
            for combo in combinations(tickers_eval, 3):
                combo_result = _evaluate_combo_result(list(combo), normalized_map)
                if not combo_result:
                    continue
                if (
                    best_combo is None
                    or combo_result["cagr"] > best_combo["cagr"]
                    or (
                        combo_result["cagr"] == best_combo["cagr"]
                        and combo_result["metrics"]["total_return"]
                        > best_combo["metrics"]["total_return"]
                    )
                ):
                    best_combo = combo_result
            if best_combo:
                _record_best_combination("k3", best_combo)
                method_map["k3"] = "bruteforce"

    return {
        "top": results,
        "method": method_map,
        "universe": tickers_eval,
        "normalized_map": normalized_map,
        "ticker_metrics": ticker_metrics,
        "use_greedy": use_greedy,
    }


def _generate_report_payload(
    session: dict[str, Any],
    bench_ticker: str,
    include_series: bool,
    start_d: date,
    end_d: date,
    start_iso: str,
    end_iso: str,
    kmax: int = 3,
) -> tuple[dict[str, Any], dict[str, Any]]:
    portfolio_series_pd = _portfolio_equity_series(session, start_d, end_d)
    portfolio_metrics, portfolio_monthly = _compute_metrics_from_base100(
        portfolio_series_pd
    )

    bench_series_pd, bench_metrics, bench_monthly = _compute_benchmark_package(
        bench_ticker, start_d, end_d
    )

    tracking = _tracking_summary(
        portfolio_metrics, bench_metrics, portfolio_monthly, bench_monthly
    )

    try:
        theoretical_summary = _compute_theoretical_summary(
            session, start_d, end_d, kmax
        )
        normalized_map = dict(theoretical_summary["normalized_map"])
        theoretical_top = theoretical_summary["top"]
        method_map = theoretical_summary["method"]
        universe_evaluated = theoretical_summary["universe"]
        theoretical_error: str | None = None
    except BadRequest as exc:
        theoretical_summary = None
        theoretical_top = {}
        method_map = {}
        universe_evaluated = []
        normalized_map = _build_normalized_series_map(
            _collect_session_universe(session), start_d, end_d
        )
        theoretical_error = getattr(exc, "description", str(exc))

    normalized_map_with_bench = dict(normalized_map)
    normalized_map_with_bench[bench_ticker] = _pd_series_to_list(bench_series_pd)

    warnings = _compute_data_warnings(
        session, start_d, end_d, normalized_map_with_bench, bench_ticker
    )
    if theoretical_summary is None and theoretical_error:
        warnings.append(f"theoretical_unavailable:{theoretical_error}")
    warnings = sorted(set(warnings))

    turns_total = int(session.get("turns_total") or session.get("total_turns") or 0)
    if not turns_total:
        turns_total = len(session.get("turns") or [])
    turns_closed = len(session.get("completed_turns") or [])

    capital_initial = float(session.get("capital_initial", 0.0))
    capital_current = float(session.get("capital_current", capital_initial))
    contrib_so_far = float(session.get("contrib_so_far", 0.0))
    invested_so_far = capital_initial + contrib_so_far
    pnl_abs = capital_current - invested_so_far
    pnl_pct = (pnl_abs / invested_so_far) if invested_so_far else 0.0

    turnover_avg = _turnover_average(session)
    score_info = _compute_score_payload(portfolio_metrics, tracking, turnover_avg)
    score_payload = {
        "stars": score_info["stars"],
        "value": score_info["value"],
        "breakdown": score_info["breakdown"],
        "notes": score_info["notes"],
    }

    portfolio_equity_payload: dict[str, Any] = {
        "base": 100.0,
        "metrics": portfolio_metrics,
    }
    benchmark_payload: dict[str, Any] = {
        "ticker": bench_ticker,
        "metrics": bench_metrics,
    }
    if include_series:
        portfolio_equity_payload["series"] = _pd_series_to_list(portfolio_series_pd)
        benchmark_payload["series"] = _pd_series_to_list(bench_series_pd)

    turns_payload: list[dict[str, Any]] = []
    for snapshot in sorted(
        (
            snap
            for snap in session.get("completed_turns") or []
            if isinstance(snap, dict)
        ),
        key=lambda snap: snap.get("turn_n", 0),
    ):
        entry = {
            "n": snapshot.get("turn_n"),
            "range": snapshot.get("range"),
            "alloc": snapshot.get("alloc"),
            "use_dca": snapshot.get("use_dca"),
            "dca_in_turn": snapshot.get("dca_in_turn"),
            "turn_return": snapshot.get("turn_return"),
            "turn_return_market": snapshot.get("turn_return_market"),
            "ret_portfolio_shift": snapshot.get("ret_portfolio_shift"),
            "portfolio_value": snapshot.get("portfolio_value"),
            "events_applied": snapshot.get("events_applied"),
            "events_new": snapshot.get("events_new"),
        }
        if snapshot.get("ret_ticker_shift"):
            entry["ret_ticker_shift"] = snapshot.get("ret_ticker_shift")
        turns_payload.append(entry)

    theoretical_payload: dict[str, Any] = {
        "method": method_map,
    }
    for label in ("k1", "k2", "k3"):
        value = theoretical_top.get(label)
        if value:
            theoretical_payload[label] = value

    meta_payload = {
        "session_id": session.get("session_id"),
        "player": session.get("player"),
        "difficulty": session.get("difficulty"),
        "capital_initial": round(capital_initial, 2),
        "capital_current": round(capital_current, 2),
        "turns_total": turns_total,
        "turns_closed": turns_closed,
        "contrib_so_far": round(contrib_so_far, 2),
        "invested_so_far": round(invested_so_far, 2),
        "pnl_abs": round(pnl_abs, 2),
        "pnl_pct": round(pnl_pct, 6),
    }

    report_payload = {
        "range": {"start": start_iso, "end": end_iso},
        "meta": meta_payload,
        "portfolio_equity": portfolio_equity_payload,
        "benchmark": benchmark_payload,
        "tracking": tracking,
        "turns": turns_payload,
        "theoretical": theoretical_payload,
        "score": score_payload,
        "warnings": warnings,
    }

    context = {
        "portfolio_series_pd": portfolio_series_pd,
        "benchmark_series_pd": bench_series_pd,
        "portfolio_metrics": portfolio_metrics,
        "benchmark_metrics": bench_metrics,
        "tracking": tracking,
        "score_internal": score_info,
        "turnover_avg": turnover_avg,
        "warnings": warnings,
        "universe_evaluated": universe_evaluated,
        "normalized_map": normalized_map_with_bench,
        "theoretical": theoretical_payload,
        "bench_ticker": bench_ticker,
    }

    return report_payload, context


def _build_csv_response(filename: str, rows: list[list[Any]]):
    buffer = StringIO()
    writer = csv.writer(buffer)
    for row in rows:
        writer.writerow(row)
    csv_content = buffer.getvalue()
    response = make_response(csv_content)
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def _ensure_max_assets(
    alloc: list[dict[str, Any]], max_assets: int = MAX_ASSETS
) -> list[dict[str, float]]:
    aggregated: dict[str, float] = {}
    order: list[str] = []
    for entry in alloc or []:
        if not isinstance(entry, dict):
            continue
        ticker = str(entry.get("ticker", "")).strip().upper()
        if not ticker:
            continue
        try:
            weight = float(entry.get("weight", 0))
        except (TypeError, ValueError):
            continue
        if weight <= 0:
            continue
        if ticker not in aggregated:
            aggregated[ticker] = weight
            order.append(ticker)
        else:
            aggregated[ticker] += weight
    if len(aggregated) > max_assets:
        raise BadRequest(
            f"La cartera admite como mÃ¡ximo {max_assets} activos por turno."
        )
    return [
        {"ticker": ticker, "weight": round(aggregated[ticker], 6)} for ticker in order
    ]


def _parse_date(value: str | None, field: str) -> date:
    if not value:
        raise BadRequest(f"El campo '{field}' es obligatorio.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:  # pragma: no cover
        raise BadRequest(f"Fecha invÃ¡lida para '{field}'.") from exc


def _instantiate_event_from_template(
    template: dict[str, Any],
    session: dict[str, Any],
    alloc: list[dict[str, Any]],
    rng: random.Random,
) -> dict[str, Any] | None:
    scope = (template.get("scope") or "").lower()
    impact_range = template.get("impact_range", (0.0, 0.0))
    duration_range = template.get("duration_turns_range", (1, 1))
    impact_value = round(_random_in_range(impact_range, rng), 6)
    duration = rng.randint(
        max(MIN_EVENT_DURATION, int(duration_range[0])),
        min(MAX_EVENT_DURATION, int(duration_range[1])),
    )
    target: str | None = None

    if scope == "portfolio":
        target = None
    elif scope == "sector":
        sectors = _available_sectors(session, alloc)
        if not sectors:
            return None
        target = rng.choice(sectors)
    elif scope == "ticker":
        tickers = [item["ticker"] for item in alloc if not _is_cash(item["ticker"])]
        if not tickers:
            return None
        target = rng.choice(tickers)
    else:
        return None

    if target is not None:
        target = str(target).upper()

    return {
        "id": template.get("id"),
        "name": template.get("name"),
        "scope": template.get("scope"),
        "target": target,
        "impact_pct": impact_value,
        "remaining_turns": int(max(MIN_EVENT_DURATION, duration)),
    }


def _draw_events_for_turn(
    difficulty: str, alloc: list[dict[str, Any]], period_ctx: dict[str, Any]
) -> list[dict[str, Any]]:
    session: dict[str, Any] | None = period_ctx.get("session")
    if not session:
        return []
    rng = period_ctx.get("rng")
    if not isinstance(rng, random.Random):
        seed_hint = period_ctx.get("seed")
        rng = random.Random(seed_hint) if seed_hint is not None else random.Random()
    drawn: list[dict[str, Any]] = []
    for template in EVENTS_CATALOG:
        prob = template.get("prob", {}).get(difficulty, 0.0)
        if prob <= 0:
            continue
        if rng.random() > prob:
            continue
        event = _instantiate_event_from_template(template, session, alloc, rng)
        if event:
            drawn.append(event)
    return drawn


def _apply_active_events(
    session: dict[str, Any],
    alloc: list[dict[str, Any]],
    base_return_by_ticker: dict[str, float],
) -> tuple[float, dict[str, float], list[dict[str, Any]], list[dict[str, Any]]]:
    active_events = session.get("active_events") or []
    ret_portfolio_shift = 0.0
    per_ticker_shift: dict[str, float] = {}
    applied: list[dict[str, Any]] = []
    updated_events: list[dict[str, Any]] = []
    alloc_tickers = {item["ticker"] for item in alloc}

    for event in active_events:
        if not isinstance(event, dict):
            continue
        remaining = int(event.get("remaining_turns", 0))
        if remaining <= 0:
            continue
        impact = float(event.get("impact_pct", 0.0))
        scope = (event.get("scope") or "").lower()
        target = event.get("target")
        affected: list[str] = []

        if scope == "portfolio":
            ret_portfolio_shift += impact
            affected = ["PORTFOLIO"]
        elif scope == "ticker":
            target_ticker = str(target or "").upper()
            if target_ticker and target_ticker in alloc_tickers:
                per_ticker_shift[target_ticker] = (
                    per_ticker_shift.get(target_ticker, 0.0) + impact
                )
                affected = [target_ticker]
        elif scope == "sector":
            target_sector = str(target or "").upper()
            if target_sector:
                for item in alloc:
                    ticker = item["ticker"]
                    if ticker not in base_return_by_ticker:
                        continue
                    sector = _resolve_sector(session, ticker)
                    if sector and sector.upper() == target_sector:
                        per_ticker_shift[ticker] = (
                            per_ticker_shift.get(ticker, 0.0) + impact
                        )
                        affected.append(ticker)

        if affected or scope == "portfolio":
            event_snapshot = {
                "id": event.get("id"),
                "name": event.get("name"),
                "scope": event.get("scope"),
                "target": target,
                "impact_pct": round(impact, 6),
                "remaining_turns": remaining,
            }
            if affected:
                event_snapshot["affected"] = affected
            applied.append(event_snapshot)

        remaining -= 1
        if remaining > 0:
            kept = deepcopy(event)
            kept["remaining_turns"] = remaining
            updated_events.append(kept)

    return ret_portfolio_shift, per_ticker_shift, applied, updated_events


def _reference_alloc_for_session(session: dict[str, Any]) -> list[dict[str, Any]]:
    decisions = session.get("decisions") or []
    if decisions:
        last_alloc = decisions[-1].get("alloc") or []
        if isinstance(last_alloc, list) and last_alloc:
            return _ensure_max_assets(last_alloc, MAX_ASSETS)
    universe = session.get("universe") or []
    alloc = [
        {"ticker": str(ticker).strip().upper(), "weight": 1.0}
        for ticker in universe[:MAX_ASSETS]
        if str(ticker).strip()
    ]
    return _ensure_max_assets(alloc, MAX_ASSETS)


def _build_event_from_payload(
    payload: dict[str, Any], session: dict[str, Any]
) -> dict[str, Any]:
    event_id = payload.get("id")
    template = None
    if event_id:
        template = next(
            (
                candidate
                for candidate in EVENTS_CATALOG
                if candidate.get("id") == event_id
            ),
            None,
        )

    scope_value = payload.get("scope") or (template.get("scope") if template else None)
    if not scope_value:
        raise BadRequest("Debe indicar scope del evento.")
    scope_lower = str(scope_value).lower()

    rng_seed = (
        int(session.get("seed", 0))
        + len(session.get("events_log") or []) * 1543
        + secrets.randbelow(10_000)
    )
    rng = random.Random(rng_seed)

    impact_value = payload.get("impact_pct")
    if impact_value is None:
        if template and template.get("impact_range"):
            impact_value = _random_in_range(template["impact_range"], rng)
        else:
            raise BadRequest("impact_pct es obligatorio para eventos personalizados.")
    try:
        impact_value = float(impact_value)
    except (TypeError, ValueError) as exc:
        raise BadRequest("impact_pct debe ser numÃ©rico.") from exc
    if impact_value < MIN_EVENT_IMPACT or impact_value > MAX_EVENT_IMPACT:
        raise BadRequest("impact_pct fuera de rango permitido [-0.5, 0.5].")

    duration_value = payload.get("duration_turns")
    if duration_value is None:
        if template and template.get("duration_turns_range"):
            lo, hi = template["duration_turns_range"]
            duration_value = rng.randint(int(lo), int(hi))
        else:
            raise BadRequest(
                "duration_turns es obligatorio para eventos personalizados."
            )
    try:
        duration_value = int(duration_value)
    except (TypeError, ValueError) as exc:
        raise BadRequest("duration_turns debe ser un entero.") from exc
    if duration_value < MIN_EVENT_DURATION or duration_value > MAX_EVENT_DURATION:
        raise BadRequest("duration_turns fuera de rango permitido [1, 6].")

    name_value = payload.get("name") or (template.get("name") if template else None)
    target_value = payload.get("target")
    reference_alloc = payload.get("alloc")
    if not isinstance(reference_alloc, list) or not reference_alloc:
        reference_alloc = _reference_alloc_for_session(session)

    if scope_lower == "sector":
        if not target_value:
            sectors = _available_sectors(session, reference_alloc)
            if not sectors:
                raise BadRequest(
                    "No se encontrÃ³ un sector vÃ¡lido para asignar al evento sectorial."
                )
            target_value = rng.choice(sectors)
    elif scope_lower == "ticker":
        if not target_value:
            tickers = [
                item["ticker"]
                for item in reference_alloc
                if not _is_cash(item["ticker"])
            ]
            if not tickers:
                raise BadRequest("No hay tickers disponibles para el evento.")
            target_value = rng.choice(tickers)
    elif scope_lower == "portfolio":
        target_value = None
    else:
        raise BadRequest("scope no reconocido para el evento.")

    target_norm = None
    if target_value is not None:
        target_norm = str(target_value).strip().upper()
        if not target_norm:
            target_norm = None
    event = {
        "id": event_id or f"evt_{secrets.token_hex(4)}",
        "name": name_value or (event_id or "Evento personalizado"),
        "scope": scope_value if template else scope_lower,
        "target": target_norm,
        "impact_pct": round(float(impact_value), 6),
        "remaining_turns": int(duration_value),
    }
    return event


def _calculate_turn_return(
    alloc: list[dict[str, float]], start: date, end: date
) -> float:
    returns = _returns_by_ticker(alloc, start, end)
    return sum(item["weight"] * returns.get(item["ticker"], 0.0) for item in alloc)


def _next_pending_turn(session: dict[str, Any]) -> dict[str, Any] | None:
    for turn in session["turns"]:
        if turn.get("status") == "pending":
            return turn
    return None


def _json_error(message: str, status: int):
    return jsonify({"error": message}), status


def _ensure_session_defaults(session: dict[str, Any]) -> None:
    turns_list = session.get("turns") or []
    turns_total = (
        session.get("turns_total") or session.get("total_turns") or len(turns_list)
    )
    if not turns_total:
        turns_total = len(turns_list) or 1
    session.setdefault("turns_total", turns_total)
    session.setdefault("total_turns", turns_total)
    session.setdefault("contrib_so_far", 0.0)
    if not isinstance(session.get("active_events"), list):
        session["active_events"] = []
    if not isinstance(session.get("events_log"), list):
        session["events_log"] = []
    if not isinstance(session.get("sectors_map"), dict):
        session["sectors_map"] = {}
    session.setdefault("active_events", session.get("active_events"))
    session.setdefault("events_log", session.get("events_log"))
    session.setdefault("sectors_map", session.get("sectors_map"))
    session.setdefault("decisions", [])


def _entered_on_turn_map(session: dict[str, Any]) -> dict[str, int]:
    entered: dict[str, int] = {}
    for decision in session.get("decisions", []):
        if not isinstance(decision, dict):
            continue
        turn_n = decision.get("turn_n")
        if not isinstance(turn_n, int):
            continue
        for entry in decision.get("alloc") or []:
            if not isinstance(entry, dict):
                continue
            ticker = str(entry.get("ticker", "")).strip().upper()
            if not ticker:
                continue
            current = entered.get(ticker)
            if current is None or turn_n < current:
                entered[ticker] = turn_n
    return entered


@career_bp.route("/session", methods=["POST"])
def create_session():
    payload = request.get_json(silent=True) or {}
    player = str(payload.get("player", "")).strip()
    difficulty = str(payload.get("difficulty", "")).strip().lower()
    if difficulty not in DIFFICULTY_CONFIG:
        return _json_error(
            "Dificultad invÃ¡lida. Usa principiante, intermedio o experto.", 400
        )
    universe = payload.get("universe") or []
    capital = payload.get("capital", 50000)
    try:
        capital_value = float(capital)
    except (TypeError, ValueError):
        return _json_error("Capital invÃ¡lido.", 400)
    if capital_value <= 0:
        return _json_error("El capital debe ser mayor que cero.", 400)

    seed_value = payload.get("seed")
    if seed_value is None:
        seed_value = _seed_from_player(player)
    elif isinstance(seed_value, str) and seed_value.isdigit():
        seed_value = int(seed_value)
    elif isinstance(seed_value, int):
        seed_value = seed_value
    else:
        try:
            seed_value = int(seed_value)
        except (TypeError, ValueError):
            seed_value = _seed_from_player(player)

    rng = random.Random(seed_value)
    start_d, end_d, turns = _generate_period(DIFFICULTY_CONFIG[difficulty], rng)
    valid_universe, rejected_universe = _validate_universe(universe, start_d, end_d)

    session_id = _generate_session_id()
    created_at = datetime.utcnow().isoformat()
    session = {
        "session_id": session_id,
        "player": player,
        "difficulty": difficulty,
        "universe": valid_universe,
        "rejected_universe": rejected_universe,
        "capital_initial": capital_value,
        "capital_current": capital_value,
        "period": {"start": start_d.isoformat(), "end": end_d.isoformat()},
        "turns": turns,
        "completed_turns": [],
        "seed": int(seed_value),
        "created_at": created_at,
        "closed": False,
        "total_turns": len(turns),
        "turns_total": len(turns),
        "contrib_so_far": 0.0,
        "cum_return": 0.0,
        "events_log": [],
        "active_events": [],
        "sectors_map": {},
        "decisions": [],
    }
    _persist_session(session)

    next_turn = turns[0] if turns else None
    response_payload = {
        "session_id": session_id,
        "period": session["period"],
        "turns": [next_turn] if next_turn else [],
        "difficulty": difficulty,
        "capital": capital_value,
        "rejected_universe": rejected_universe,
    }
    return jsonify(response_payload), 200


def _generate_session_id() -> str:
    store = _load_sessions_store()
    sessions = store.get("sessions", {})
    while True:
        candidate = f"car_{secrets.token_hex(3)}"
        if candidate not in sessions:
            return candidate


@career_bp.route("/session/<session_id>", methods=["GET"])
def session_status(session_id: str):
    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    return jsonify({"session": session}), 200


@career_bp.route("/turn", methods=["POST"])
def close_turn():
    payload = request.get_json(silent=True) or {}
    session_id = payload.get("session_id")
    turn_n = payload.get("turn_n")
    raw_alloc = payload.get("alloc") or []
    use_dca = bool(payload.get("use_dca", False))

    if not session_id:
        return _json_error("session_id es obligatorio.", 400)
    if not isinstance(turn_n, int):
        return _json_error("turn_n debe ser un entero.", 400)

    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)
    if session.get("closed"):
        return _json_error("La sesiÃ³n ya finalizÃ³.", 400)

    pending_turn = _next_pending_turn(session)
    if not pending_turn:
        session["closed"] = True
        _update_session(session)
        return _json_error("No hay turnos pendientes.", 400)
    if pending_turn["n"] != turn_n:
        return _json_error("turn_n no coincide con el turno pendiente.", 400)

    clean_alloc = _ensure_max_assets(raw_alloc, MAX_ASSETS)
    weight_sum = sum(item["weight"] for item in clean_alloc)
    if weight_sum > 1.0 + 1e-6:
        return _json_error("La suma de pesos no puede superar 1.0.", 400)

    turn_start = date.fromisoformat(pending_turn["start"])
    turn_end = date.fromisoformat(pending_turn["end"])
    period_start = date.fromisoformat(session["period"]["start"])
    period_end = date.fromisoformat(session["period"]["end"])

    known_universe = set(session.get("universe", []))
    candidates = [
        item["ticker"] for item in clean_alloc if item["ticker"] not in known_universe
    ]
    if candidates:
        valid_new, rejected_new = _validate_universe(
            candidates, period_start, period_end
        )
        if rejected_new:
            msg = ", ".join(rejected_new)
            return _json_error(
                f"Tickers no vÃ¡lidos para el periodo del turno: {msg}.", 400
            )
        if valid_new:
            known_universe.update(valid_new)
            session["universe"] = sorted(known_universe)

    base_returns = _returns_by_ticker(clean_alloc, turn_start, turn_end)
    turn_return_market = sum(
        item["weight"] * base_returns.get(item["ticker"], 0.0) for item in clean_alloc
    )

    (
        ret_portfolio_shift,
        per_ticker_shift,
        events_applied,
        active_events_remaining,
    ) = _apply_active_events(session, clean_alloc, base_returns)

    adjusted_returns = {
        item["ticker"]: base_returns.get(item["ticker"], 0.0)
        + per_ticker_shift.get(item["ticker"], 0.0)
        for item in clean_alloc
    }
    turn_return_final = (
        sum(
            item["weight"] * adjusted_returns.get(item["ticker"], 0.0)
            for item in clean_alloc
        )
        + ret_portfolio_shift
    )

    events_applied_snapshot = [deepcopy(evt) for evt in events_applied]

    rng_seed = (
        int(session.get("seed", 0))
        + turn_n * 1931
        + len(session.get("events_log") or []) * 97
    )
    rng = random.Random(rng_seed)
    period_ctx = {
        "session": session,
        "turn_n": turn_n,
        "rng": rng,
        "seed": rng_seed,
    }
    events_new = _draw_events_for_turn(session["difficulty"], clean_alloc, period_ctx)
    events_new_snapshot = [deepcopy(evt) for evt in events_new]

    active_events_next = active_events_remaining
    if events_new:
        active_events_next = active_events_next + [deepcopy(evt) for evt in events_new]
    session["active_events"] = active_events_next
    ret_ticker_shift_map = {
        ticker: round(shift, 6)
        for ticker, shift in per_ticker_shift.items()
        if abs(shift) > 1e-9
    }
    session.setdefault("events_log", []).append(
        {
            "turn_n": turn_n,
            "applied": events_applied_snapshot,
            "drawn": events_new_snapshot,
        }
    )

    turns_total = int(session.get("turns_total") or 1)
    capital_before = float(session["capital_current"])
    dca_in_turn = 0.0
    if use_dca and turns_total > 0:
        dca_in_turn = session["capital_initial"] / turns_total
        session["capital_current"] = capital_before + dca_in_turn
        session["contrib_so_far"] = session.get("contrib_so_far", 0.0) + dca_in_turn
    else:
        session["capital_current"] = capital_before

    capital_base = float(session["capital_current"])
    # 'turn_return_final' ya incluye: turn_return_market + ret_portfolio_shift + per_ticker_shift
    capital_after = capital_base * (1 + turn_return_final)

    portfolio_value = round(capital_after, 2)
    session["capital_current"] = portfolio_value
    cum_return = (session["capital_current"] / session["capital_initial"]) - 1
    session["cum_return"] = round(cum_return, 6)

    invested_so_far = session["capital_initial"] + session.get("contrib_so_far", 0.0)
    pnl_abs = capital_after - invested_so_far
    pnl_pct = (pnl_abs / invested_so_far) if invested_so_far else 0.0
    cum_return_net = (capital_after / invested_so_far - 1.0) if invested_so_far else 0.0
    delta_vs_prev = capital_after - capital_before

    pending_turn["status"] = "completed"
    pending_turn["closed_at"] = datetime.utcnow().isoformat()

    snapshot = {
        "turn_n": turn_n,
        "range": {"start": pending_turn["start"], "end": pending_turn["end"]},
        "alloc": clean_alloc,
        "use_dca": use_dca,
        "turn_return": round(turn_return_final, 6),
        "turn_return_market": round(turn_return_market, 6),
        "portfolio_value": session["capital_current"],
        "events": events_applied_snapshot,
        "events_applied": events_applied_snapshot,
        "events_new": events_new_snapshot,
        "ret_portfolio_shift": round(ret_portfolio_shift, 6),
    }
    if ret_ticker_shift_map:
        snapshot["ret_ticker_shift"] = ret_ticker_shift_map
    snapshot.update(
        {
            "dca_in_turn": round(dca_in_turn, 2),
            "invested_so_far": round(invested_so_far, 2),
            "pnl_abs": round(pnl_abs, 2),
            "pnl_pct": round(pnl_pct, 6),
            "cum_return_net": round(cum_return_net, 6),
            "delta_vs_prev": round(delta_vs_prev, 2),
        }
    )

    session.setdefault("completed_turns", []).append(snapshot)
    session.setdefault("decisions", []).append(
        {"turn_n": turn_n, "alloc": deepcopy(clean_alloc), "use_dca": use_dca}
    )

    next_turn = _next_pending_turn(session)
    if not next_turn:
        session["closed"] = True

    _update_session(session)

    response_payload = {
        "snapshot": snapshot,
        "cum_return": session["cum_return"],
        "next_turn": next_turn if next_turn else None,
    }
    return jsonify(response_payload), 200


@career_bp.route("/series", methods=["GET"])
def normalized_series():
    tickers_param = request.args.get("tickers", "")
    t0_param = request.args.get("t0")
    t1_param = request.args.get("t1")
    tickers = [t.strip().upper() for t in tickers_param.split(",") if t.strip()]
    if not tickers:
        return _json_error("Debe proporcionar al menos un ticker.", 400)
    unique_tickers = list(dict.fromkeys(tickers))
    if len(unique_tickers) > MAX_ASSETS:
        return _json_error("La cartera admite como mÃ¡ximo 10 activos por turno.", 400)
    start_d = _parse_date(t0_param, "t0")
    end_d = _parse_date(t1_param, "t1")
    if end_d < start_d:
        return _json_error("t1 debe ser igual o posterior a t0.", 400)

    series_map = _build_normalized_series_map(unique_tickers, start_d, end_d)
    series_payload = {ticker: series_map.get(ticker, []) for ticker in unique_tickers}

    response_payload = {
        "base": start_d.isoformat(),
        "series": series_payload,
    }
    return jsonify(response_payload), 200


@career_bp.route("/series/<session_id>", methods=["GET"])
def session_series(session_id: str):
    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)

    tickers_param = request.args.get("tickers", "")
    tickers = [t.strip().upper() for t in tickers_param.split(",") if t.strip()]
    if not tickers:
        return _json_error("Debe proporcionar al menos un ticker.", 400)
    unique_tickers = list(dict.fromkeys(tickers))
    if len(unique_tickers) > MAX_ASSETS:
        return _json_error("La cartera admite como mÃ¡ximo 10 activos por turno.", 400)

    period = session.get("period") or {}
    start_iso = period.get("start")
    end_iso_period = period.get("end")
    if not start_iso:
        return _json_error("La sesiÃ³n no tiene periodo configurado.", 400)
    start_d = date.fromisoformat(start_iso)

    turns = session.get("turns") or []
    if not turns:
        return _json_error("La sesiÃ³n no dispone de turnos configurados.", 400)

    completed_turns = session.get("completed_turns") or []
    turn_lookup = {
        turn.get("n"): turn for turn in turns if isinstance(turn.get("n"), int)
    }
    turn_info: dict[str, Any]
    if completed_turns:
        closed_numbers = [
            snapshot.get("turn_n")
            for snapshot in completed_turns
            if isinstance(snapshot, dict) and isinstance(snapshot.get("turn_n"), int)
        ]
        if closed_numbers:
            last_turn_n = max(closed_numbers)
            turn_info = turn_lookup.get(last_turn_n) if turn_lookup else None
            if turn_info is None and turn_lookup:
                turn_info = turn_lookup.get(max(turn_lookup.keys()))
        else:
            turn_info = None
        if turn_info is None:
            turn_info = turns[-1]
    else:
        turn_info = turns[0]

    end_iso = turn_info.get("end") or end_iso_period or start_iso
    end_d = date.fromisoformat(end_iso)
    if end_d < start_d:
        end_d = start_d
        end_iso = start_iso

    series_map = _build_normalized_series_map(unique_tickers, start_d, end_d)
    series_payload = {ticker: series_map.get(ticker, []) for ticker in unique_tickers}

    entered_map = _entered_on_turn_map(session)
    entered_payload = {
        ticker: entered_map[ticker]
        for ticker in unique_tickers
        if ticker in entered_map
    }

    response_payload = {
        "base": start_iso,
        "range": {"start": start_iso, "end": end_iso},
        "series": series_payload,
        "entered_on_turn": entered_payload,
    }
    return jsonify(response_payload), 200


@career_bp.route("/report/<session_id>", methods=["GET"])
def session_report(session_id: str):
    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)

    include_series = str(request.args.get("include_series", "false")).lower() == "true"
    bench_param = request.args.get("bench", "^GSPC")
    bench_ticker = str(bench_param or "^GSPC").strip().upper() or "^GSPC"

    try:
        start_d, end_d, start_iso, end_iso = _session_analysis_range(session)
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    try:
        report_payload, _ = _generate_report_payload(
            session,
            bench_ticker,
            include_series,
            start_d,
            end_d,
            start_iso,
            end_iso,
        )
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    report_payload["benchmark"]["ticker"] = bench_ticker
    return jsonify(report_payload), 200


@career_bp.route("/ranking", methods=["POST"])
def ranking_submit():
    payload = request.get_json(silent=True) or {}
    session_id = payload.get("session_id")
    if not session_id:
        return _json_error("session_id es obligatorio.", 400)
    if payload.get("consent") is not True:
        return _json_error(
            "Se requiere consentimiento para guardar en el ranking.", 400
        )

    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)

    bench_param = payload.get("bench") or "^GSPC"
    bench_ticker = str(bench_param).strip().upper() or "^GSPC"

    try:
        start_d, end_d, start_iso, end_iso = _session_analysis_range(session)
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    try:
        report_payload, _ = _generate_report_payload(
            session, bench_ticker, False, start_d, end_d, start_iso, end_iso
        )
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    try:
        provided_score = float(payload.get("score"))
        provided_stars = int(payload.get("stars"))
    except (TypeError, ValueError):
        return _json_error("score/stars inválidos.", 400)

    expected_score = report_payload.get("score", {}).get("value")
    expected_stars = report_payload.get("score", {}).get("stars")
    if expected_score is None or expected_stars is None:
        return _json_error("No se pudo calcular la puntuación de la sesión.", 400)
    if abs(provided_score - expected_score) > 0.1 or provided_stars != expected_stars:
        return _json_error("Score proporcionado no coincide con el informe.", 400)

    entry = {
        "session_id": session_id,
        "player": payload.get("player") or session.get("player"),
        "difficulty": session.get("difficulty"),
        "period": {"start": start_iso, "end": end_iso},
        "score": round(expected_score, 2),
        "stars": expected_stars,
        "bench": bench_ticker,
        "created_at": datetime.utcnow().isoformat(),
    }
    _upsert_ranking_entry(entry)
    return jsonify({"ok": True}), 200


@career_bp.route("/ranking", methods=["GET"])
def ranking_list():
    try:
        limit = int(request.args.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))
    entries = _ranking_entries_sorted()
    return jsonify({"entries": entries[:limit]}), 200


@career_bp.route("/share/<session_id>", methods=["GET"])
def session_share(session_id: str):
    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)
    try:
        start_d, end_d, start_iso, end_iso = _session_analysis_range(session)
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    universe_used = sorted(
        {
            str(entry.get("ticker", "")).strip().upper()
            for decision in session.get("decisions") or []
            for entry in decision.get("alloc") or []
            if str(entry.get("ticker", "")).strip()
        }
    )

    bench = "^GSPC"
    seed_value = session.get("seed") or 0
    seed_hash = hashlib.sha256(
        f"{session_id}|{seed_value}|{start_iso}|{end_iso}".encode("utf-8")
    ).hexdigest()[:16]

    payload = {
        "session_id": session_id,
        "difficulty": session.get("difficulty"),
        "period": {"start": start_iso, "end": end_iso},
        "universe_used": universe_used,
        "seed_hash": seed_hash,
        "bench": bench,
    }
    return jsonify(payload), 200


@career_bp.route("/export/<session_id>", methods=["GET"])
def session_export(session_id: str):
    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)

    export_type = (request.args.get("type") or "snapshots").lower()
    bench_param = request.args.get("bench", "^GSPC")
    bench_ticker = str(bench_param or "^GSPC").strip().upper() or "^GSPC"

    try:
        start_d, end_d, start_iso, end_iso = _session_analysis_range(session)
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    try:
        report_payload, context = _generate_report_payload(
            session,
            bench_ticker,
            True,
            start_d,
            end_d,
            start_iso,
            end_iso,
        )
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    filename = f"{session_id}_{export_type}.csv"

    if export_type == "snapshots":
        header = [
            "turn_n",
            "range_start",
            "range_end",
            "weights_json",
            "use_dca",
            "dca_in_turn",
            "turn_return",
            "turn_return_market",
            "ret_portfolio_shift",
            "ret_ticker_shift_json",
            "portfolio_value",
            "events_applied_json",
            "events_new_json",
        ]
        rows = [header]
        for turn in report_payload.get("turns", []):
            range_info = turn.get("range") or {}
            rows.append(
                [
                    turn.get("n"),
                    range_info.get("start"),
                    range_info.get("end"),
                    json.dumps(turn.get("alloc"), ensure_ascii=False),
                    turn.get("use_dca"),
                    turn.get("dca_in_turn"),
                    turn.get("turn_return"),
                    turn.get("turn_return_market"),
                    turn.get("ret_portfolio_shift"),
                    json.dumps(turn.get("ret_ticker_shift"), ensure_ascii=False),
                    turn.get("portfolio_value"),
                    json.dumps(turn.get("events_applied"), ensure_ascii=False),
                    json.dumps(turn.get("events_new"), ensure_ascii=False),
                ]
            )
        return _build_csv_response(filename, rows)

    if export_type == "equity":
        rows = [["date", "value"]]
        series = context["portfolio_series_pd"].sort_index()
        for idx, val in series.items():
            rows.append([idx.date().isoformat(), round(float(val), 4)])
        return _build_csv_response(filename, rows)

    if export_type == "benchmark":
        rows = [["date", "value"]]
        series = context["benchmark_series_pd"].sort_index()
        for idx, val in series.items():
            rows.append([idx.date().isoformat(), round(float(val), 4)])
        return _build_csv_response(filename, rows)

    if export_type == "report":
        meta = report_payload.get("meta", {})
        portfolio_metrics = report_payload.get("portfolio_equity", {}).get(
            "metrics", {}
        )
        benchmark_metrics = report_payload.get("benchmark", {}).get("metrics", {})
        tracking = report_payload.get("tracking", {})
        score = report_payload.get("score", {})
        header = [
            "session_id",
            "player",
            "difficulty",
            "range_start",
            "range_end",
            "capital_initial",
            "capital_current",
            "invested_so_far",
            "pnl_abs",
            "pnl_pct",
            "CAGR_portfolio",
            "CAGR_benchmark",
            "vol_annual_portfolio",
            "vol_annual_benchmark",
            "max_drawdown_portfolio",
            "max_drawdown_benchmark",
            "active_return",
            "tracking_error",
            "information_ratio",
            "score_value",
            "score_stars",
        ]
        rows = [header]
        rows.append(
            [
                meta.get("session_id"),
                meta.get("player"),
                meta.get("difficulty"),
                start_iso,
                end_iso,
                meta.get("capital_initial"),
                meta.get("capital_current"),
                meta.get("invested_so_far"),
                meta.get("pnl_abs"),
                meta.get("pnl_pct"),
                portfolio_metrics.get("CAGR"),
                benchmark_metrics.get("CAGR"),
                portfolio_metrics.get("vol_annual"),
                benchmark_metrics.get("vol_annual"),
                portfolio_metrics.get("max_drawdown"),
                benchmark_metrics.get("max_drawdown"),
                tracking.get("active_return"),
                tracking.get("tracking_error"),
                tracking.get("information_ratio"),
                score.get("value"),
                score.get("stars"),
            ]
        )
        return _build_csv_response(filename, rows)

    return _json_error("Tipo de exportación no soportado.", 400)


@career_bp.route("/benchmark/<session_id>", methods=["GET"])
def session_benchmark(session_id: str):
    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)
    try:
        start_d, end_d, start_iso, end_iso = _session_analysis_range(session)
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    bench_param = request.args.get("bench", "^GSPC")
    bench_ticker = str(bench_param or "^GSPC").strip().upper() or "^GSPC"

    try:
        bench_series_pd, bench_metrics, bench_monthly = _compute_benchmark_package(
            bench_ticker, start_d, end_d
        )
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    portfolio_series_pd = _portfolio_equity_series(session, start_d, end_d)
    portfolio_metrics, portfolio_monthly = _compute_metrics_from_base100(
        portfolio_series_pd
    )
    tracking = _tracking_summary(
        portfolio_metrics, bench_metrics, portfolio_monthly, bench_monthly
    )

    response_payload = {
        "range": {"start": start_iso, "end": end_iso},
        "benchmark": {
            "ticker": bench_ticker,
            "series": _pd_series_to_list(bench_series_pd),
            "metrics": bench_metrics,
        },
        "portfolio_equity": {
            "base": 100.0,
            "series": _pd_series_to_list(portfolio_series_pd),
            "metrics": portfolio_metrics,
        },
        "tracking": tracking,
    }
    return jsonify(response_payload), 200


def _evaluate_combo_result(
    tickers: list[str],
    normalized_map: dict[str, list[list[str, float]]],
) -> dict[str, Any] | None:
    weights = _equal_weights(len(tickers))
    combined_series = _combine_normalized_series(tickers, weights, normalized_map)
    if combined_series.empty:
        return None
    metrics = _compute_basic_metrics(combined_series)
    slim_metrics = {
        "total_return": metrics["total_return"],
        "CAGR": metrics["CAGR"],
        "max_drawdown": metrics["max_drawdown"],
    }
    return {
        "tickers": tickers,
        "weights": weights,
        "series": _pd_series_to_list(combined_series),
        "metrics": slim_metrics,
        "cagr": metrics["CAGR"],
    }


@career_bp.route("/theoretical/<session_id>", methods=["GET"])
def session_theoretical(session_id: str):
    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)
    try:
        start_d, end_d, start_iso, end_iso = _session_analysis_range(session)
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    try:
        kmax_param = int(request.args.get("kmax", 3))
    except (TypeError, ValueError):
        kmax_param = 3
    kmax = max(1, min(kmax_param, 3))

    try:
        summary = _compute_theoretical_summary(session, start_d, end_d, kmax)
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)

    response_payload = {
        "range": {"start": start_iso, "end": end_iso},
        "universe_evaluated": summary["universe"],
        "top": summary["top"],
        "method": summary["method"],
    }
    return jsonify(response_payload), 200


@career_bp.route("/events/<session_id>", methods=["GET"])
def session_events(session_id: str):
    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)
    return (
        jsonify(
            {
                "active_events": session.get("active_events", []),
                "events_log": session.get("events_log", []),
            }
        ),
        200,
    )


@career_bp.route("/event", methods=["POST"])
def inject_event():
    payload = request.get_json(silent=True) or {}
    session_id = payload.get("session_id")
    if not session_id:
        return _json_error("session_id es obligatorio.", 400)
    session = _get_session(session_id)
    if not session:
        raise NotFound("Sesión no encontrada.")
    _ensure_session_defaults(session)
    try:
        event = _build_event_from_payload(payload, session)
    except BadRequest as exc:
        message = getattr(exc, "description", str(exc))
        status_code = exc.code if hasattr(exc, "code") else 400
        return _json_error(message, status_code)
    session["active_events"].append(deepcopy(event))
    session.setdefault("events_log", []).append(
        {"turn_n": None, "applied": [], "drawn": [deepcopy(event)], "source": "manual"}
    )
    _update_session(session)
    return jsonify({"active_events": session.get("active_events", [])}), 200


__all__ = [
    "career_bp",
    "_fetch_adj_close",
    "_normalize_base100",
    "_validate_universe",
    "_draw_events_for_turn",
    "_ensure_max_assets",
]
