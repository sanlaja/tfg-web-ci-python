import csv
import io
import json
import math
import unicodedata
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Blueprint, Response, jsonify, render_template, request
import pandas as pd
import yfinance as yf


bp = Blueprint("main", __name__)


# ----------------------
#   Vistas HTML
# ----------------------
@bp.get("/")
def home():
    return render_template("home.html", active="home", nav_mode="landing")


@bp.get("/inicio")
def inicio_alias():
    return render_template("inicio.html", active="inicio", nav_mode="practice")


@bp.get("/empresas")
def empresas_page():
    accept = request.accept_mimetypes
    wants_json = request.args.get("format") == "json" or (
        accept.best == "application/json"
        or accept["application/json"] >= accept["text/html"]
    )
    if wants_json and request.args.get("format") != "html":
        return listar_empresas()
    return render_template("empresas.html", active="empresas", nav_mode="practice")


@bp.get("/nuevo-analisis")
def analisis_page():
    return render_template("analisis.html", active="analisis", nav_mode="practice")


@bp.get("/historial")
def historial_page():
    return render_template("historial.html", active="historial", nav_mode="practice")


@bp.get("/aprende")
def aprende_page():
    return render_template("aprende.html", active="aprende", nav_mode="practice")


@bp.get("/manual")
def manual_page():
    return render_template("manual.html", active="manual", nav_mode="manual")


@bp.get("/modo-carrera")
def career_page():
    return render_template("career.html", active="career", nav_mode="career")


# ----------------------
#   Health
# ----------------------
@bp.get("/health")
def health():
    return jsonify(status="ok")


# ----------------------
#   Datos de empresas
# ----------------------
DATA_PATH = Path(__file__).resolve().parent / "data" / "empresas.json"


def _cargar_empresas():
    with DATA_PATH.open("r", encoding="utf-8-sig") as f:
        data = json.load(f)
    for e in data:
        assert {"ticker", "nombre", "sector"} <= set(e.keys())
    return data


EMPRESAS = _cargar_empresas()


def _norm(s: str) -> str:
    if not isinstance(s, str):
        return ""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch)).lower()


@bp.get("/empresas/sectores")
def listar_sectores():
    sectores = sorted(
        {(e.get("sector") or "").strip() for e in EMPRESAS if e.get("sector")}
    )
    return jsonify(sectores)


@bp.get("/empresas-data")
def listar_empresas():
    """
    Devuelve lista de empresas.
    Filtros opcionales:
      - ?sector=...  ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ igualdad exacta (normalizada)
      - ?q=...       ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ bÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºsqueda contiene en ticker o nombre (normalizada)
      - ?page&per_page ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ (opcional) si se envÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­an, responde paginado
    """
    sector = request.args.get("sector")
    q = request.args.get("q")

    resultado = EMPRESAS

    if sector:
        target = _norm(sector)
        resultado = [e for e in resultado if _norm(e.get("sector", "")) == target]

    if q:
        needle = _norm(q)

        def coincide(e):
            return needle in _norm(e.get("ticker", "")) or needle in _norm(
                e.get("nombre", "")
            )

        resultado = [e for e in resultado if coincide(e)]

    # Solo paginar si el cliente lo pide
    page = request.args.get("page")
    per_page = request.args.get("per_page")
    if page or per_page:
        return jsonify(_paginate(resultado, page, per_page))
    return jsonify(resultado)


# ----------------------
#   Motor de anÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lisis
# ----------------------
def _validar_payload(p):
    errores = []

    ticker = p.get("ticker")
    if not ticker or not isinstance(ticker, str):
        errores.append("Falta 'ticker' (string).")

    importe = p.get("importe_inicial")
    if not isinstance(importe, (int, float)) or importe <= 0:
        errores.append("'importe_inicial' debe ser numerico > 0.")

    horizonte = p.get("horizonte_anios")
    if horizonte is None:
        errores.append("Falta el campo 'horizonte_anios'.")
    elif not isinstance(horizonte, int):
        errores.append("El campo 'horizonte_anios' debe ser un entero.")
    elif horizonte < 1:
        errores.append(
            "Horizonte mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nimo: 1 aÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â±o (horizonte_anios >= 1)."
        )

    sup = p.get("supuestos") or {}
    if not isinstance(sup, dict):
        errores.append("'supuestos' debe ser un objeto con porcentajes.")
        sup = {}
    else:
        p["supuestos"] = sup

    def pct_ok(clave, minimo, maximo):
        if clave not in sup:
            return None
        valor = sup.get(clave)
        if valor is None:
            return None
        if not isinstance(valor, (int, float)):
            errores.append(f"'{clave}' debe ser numerico.")
            return None
        if valor < minimo or valor > maximo:
            errores.append(f"'{clave}' debe estar entre {minimo} y {maximo}.")
        return valor

    pct_ok("crecimiento_anual_pct", 0, 100)
    pct_ok("margen_seguridad_pct", 0, 100)
    pct_ok("roe_pct", 0, 100)
    pct_ok("deuda_sobre_activos_pct", 0, 100)

    just = p.get("justificacion")
    if just is not None and not isinstance(just, str):
        errores.append("'justificacion' debe ser texto.")
    elif isinstance(just, str) and len(just.strip()) < 20:
        errores.append("La 'justificacion' debe tener al menos 20 caracteres.")

    modo = p.get("modo") or "SIN_DCA"
    if modo not in {"DCA", "SIN_DCA"}:
        errores.append("'modo' debe ser 'DCA' o 'SIN_DCA'.")
    elif modo == "DCA":
        dca = p.get("dca") or {}
        if not isinstance(dca, dict):
            errores.append("'dca' debe ser un objeto con aporte y frecuencia.")
            dca = {}
        aporte = dca.get("aporte")
        if aporte is None or not isinstance(aporte, (int, float)) or aporte < 0:
            errores.append("'dca.aporte' no puede ser negativo.")
        frecuencia = (dca.get("frecuencia") or "").upper()
        if frecuencia not in {"WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"}:
            errores.append("'dca.frecuencia' no es valida.")
    else:
        p["dca"] = None

    crec = sup.get("crecimiento_anual_pct")
    if isinstance(crec, (int, float)) and crec > 25:
        errores.append("Crecimiento anual > 25% sostenido es probablemente irrealista.")

    return errores


def _normalizar_payload(datos):
    datos = dict(datos or {})

    ticker = datos.get("ticker")
    if isinstance(ticker, str):
        datos["ticker"] = ticker.strip().upper()

    def to_float(value):
        if value in (None, ""):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    if "importe_inicial" in datos:
        imp = to_float(datos.get("importe_inicial"))
        if imp is not None:
            datos["importe_inicial"] = imp if not imp.is_integer() else int(imp)

    if "horizonte_anios" in datos:
        try:
            datos["horizonte_anios"] = int(round(float(datos["horizonte_anios"])))
        except (TypeError, ValueError):
            pass

    sup_in = datos.get("supuestos")
    sup = dict(sup_in) if isinstance(sup_in, dict) else {}

    mapping = {
        "crecimiento_anual_estimado": "crecimiento_anual_pct",
        "margen_seguridad_pct": "margen_seguridad_pct",
        "roe_pct": "roe_pct",
        "deuda_sobre_activos_pct": "deuda_sobre_activos_pct",
    }
    for origen, destino in mapping.items():
        if origen in datos and destino not in sup:
            sup[destino] = datos[origen]

    for clave in (
        "crecimiento_anual_pct",
        "margen_seguridad_pct",
        "roe_pct",
        "deuda_sobre_activos_pct",
    ):
        val = to_float(sup.get(clave))
        sup[clave] = 0.0 if val is None else val

    datos["supuestos"] = sup

    modo = datos.get("modo")
    if modo not in {"DCA", "SIN_DCA"}:
        modo = "SIN_DCA"
    datos["modo"] = modo

    if modo == "DCA":
        dca = datos.get("dca")
        if not isinstance(dca, dict):
            dca = {}
        aporte = to_float(dca.get("aporte"))
        aporte_norm = 0.0 if aporte is None else aporte
        if isinstance(aporte_norm, float) and aporte_norm.is_integer():
            aporte_norm = int(aporte_norm)
        frecuencia = (dca.get("frecuencia") or "MONTHLY").upper()
        datos["dca"] = {"aporte": aporte_norm, "frecuencia": frecuencia}
    else:
        datos["dca"] = None

    just = datos.get("justificacion")
    if just is not None and not isinstance(just, str):
        datos["justificacion"] = str(just)

    if "crecimiento_anual_estimado" in datos:
        ce = to_float(datos["crecimiento_anual_estimado"])
        datos["crecimiento_anual_estimado"] = (
            ce if ce is not None else sup.get("crecimiento_anual_pct")
        )
    else:
        datos["crecimiento_anual_estimado"] = sup.get("crecimiento_anual_pct")

    if "margen_seguridad_pct" in datos:
        ms = to_float(datos["margen_seguridad_pct"])
        datos["margen_seguridad_pct"] = (
            ms if ms is not None else sup.get("margen_seguridad_pct")
        )
    else:
        datos["margen_seguridad_pct"] = sup.get("margen_seguridad_pct")

    for key in ("inicio", "fin"):
        val = datos.get(key)
        if isinstance(val, str):
            val = val.strip()
            datos[key] = val or None
        elif val not in (None,):
            datos[key] = str(val)

    return datos


def _puntuar_y_observar(p):
    """Heurística muy simple para MVP: 0–100."""
    sup = p["supuestos"]
    horizon = p["horizonte_anios"]

    score = 50
    obs = []

    # Horizonte
    if horizon >= 10:
        score += 10
        obs.append({"tipo": "ok", "msg": "Horizonte largo (≥10 años)."})
    elif horizon >= 5:
        score += 5
        obs.append({"tipo": "ok", "msg": "Horizonte adecuado (≥5 años)."})

    # ROE
    roe = sup.get("roe_pct", 0)
    if roe >= 15:
        score += 10
    elif roe >= 8:
        score += 5

    # Deuda
    deuda = sup.get("deuda_sobre_activos_pct", 0)
    if deuda <= 30:
        score += 10
    elif deuda <= 60:
        score += 3
    else:
        score -= 5

    # Margen de seguridad
    margen = sup.get("margen_seguridad_pct", 0)
    if margen >= 20:
        score += 10
        obs.append({"tipo": "ok", "msg": "Margen de seguridad sólido (≥20%)."})
    elif margen >= 10:
        score += 3
        obs.append(
            {"tipo": "mejora", "msg": "Margen de seguridad algo justo (10–20%)."}
        )
    else:
        score -= 5
        obs.append({"tipo": "alerta", "msg": "Margen de seguridad bajo (<10%)."})

    # Crecimiento
    crec = sup.get("crecimiento_anual_pct", 0)
    if crec > 25:
        score -= 10
        obs.append(
            {
                "tipo": "alerta",
                "msg": "Supuesto de crecimiento >25% parece optimista/irrealista.",
            }
        )
    elif crec >= 5:
        score += 5
        obs.append({"tipo": "ok", "msg": "Crecimiento razonable (5–25%)."})
    else:
        obs.append(
            {"tipo": "mejora", "msg": "Crecimiento bajo: compénsalo con precio/margen."}
        )

    # Justificación
    if len((p.get("justificacion") or "").strip()) >= 60:
        score += 5
        obs.append({"tipo": "ok", "msg": "Buena justificación (detallada)."})
    else:
        obs.append(
            {
                "tipo": "mejora",
                "msg": "Amplía la justificación: riesgos, sensibilidad, comparables.",
            }
        )

    score = max(0, min(100, int(round(score))))

    if score >= 80:
        resumen = "Análisis sólido."
    elif score >= 60:
        resumen = "Análisis razonable con áreas de mejora."
    else:
        resumen = "Análisis débil: revisa supuestos, riesgos y valoración."

    return score, obs, resumen


# ----------------------
#   Persistencia anÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lisis


def _fix_mojibake(s):
    if not isinstance(s, str):
        return s
    if "Ã" not in s and "Â" not in s:
        return s
    try:
        return s.encode("latin-1").decode("utf-8")
    except Exception:
        return s


def _sanear_registro(r: dict) -> dict:
    if not isinstance(r, dict):
        return r
    if "resumen" in r:
        r["resumen"] = _fix_mojibake(r["resumen"])
    if isinstance(r.get("observaciones"), list):
        out = []
        for o in r["observaciones"]:
            if not isinstance(o, dict):
                continue
            msg = _fix_mojibake(o.get("msg", ""))
            if any(k in msg.lower() for k in ("roe", "deuda")):
                continue
            out.append({**o, "msg": msg})
        r["observaciones"] = out
    return r


# ----------------------

DATA_DIR = Path(__file__).resolve().parent / "data"
ANALISIS_PATH = DATA_DIR / "analisis.json"


def _cargar_lista(path: Path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError:
            return []
    if isinstance(data, list):
        data = [_sanear_registro(x) for x in data]
    return data


def _guardar_lista(path: Path, lista):
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(lista, list):
        lista = [_sanear_registro(x) for x in lista]
    with path.open("w", encoding="utf-8") as f:
        json.dump(lista, f, ensure_ascii=False, indent=2)


def _registrar_analisis(datos):
    errores = _validar_payload(datos)
    if errores:
        return jsonify({"valido": False, "errores": errores}), 400

    puntuacion, observaciones, resumen = _puntuar_y_observar(datos)

    registro = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "ticker": datos.get("ticker"),
        "importe_inicial": datos.get("importe_inicial"),
        "horizonte_anios": datos.get("horizonte_anios"),
        "supuestos": datos.get("supuestos", {}),
        "justificacion": datos.get("justificacion", ""),
        "modo": datos.get("modo"),
        "dca": datos.get("dca"),
        "crecimiento_anual_estimado": datos.get("crecimiento_anual_estimado"),
        "margen_seguridad_pct": datos.get("margen_seguridad_pct"),
        "puntuacion": puntuacion,
        "observaciones": observaciones,
        "resumen": resumen,
    }

    registro["inicio"] = datos.get("inicio")
    registro["fin"] = datos.get("fin")

    backtest_payload = {
        "ticker": registro.get("ticker"),
        "importe_inicial": registro.get("importe_inicial"),
        "horizonte_anios": registro.get("horizonte_anios"),
        "modo": registro.get("modo"),
        "dca": registro.get("dca"),
        "inicio": registro.get("inicio"),
        "fin": registro.get("fin"),
    }
    backtest_snapshot = None
    try:
        backtest_snapshot = _market_backtest_core(backtest_payload)
    except BacktestError:
        backtest_snapshot = None
    except Exception:
        backtest_snapshot = None

    registro["backtest"] = backtest_snapshot

    registro = _sanear_registro(registro)

    historial = _cargar_lista(ANALISIS_PATH)
    historial.insert(0, registro)
    _guardar_lista(ANALISIS_PATH, historial)

    return jsonify(
        {
            "valido": True,
            "puntuacion": puntuacion,
            "observaciones": observaciones,
            "resumen": resumen,
            "registro": {
                "id": registro["id"],
                "timestamp": registro["timestamp"],
                "ticker": registro["ticker"],
                "importe_inicial": registro["importe_inicial"],
                "horizonte_anios": registro["horizonte_anios"],
                "modo": registro["modo"],
                "dca": registro["dca"],
            },
        }
    )


@bp.post("/analisis")
def crear_analisis():
    datos_brutos = request.get_json(silent=True) or {}
    datos = _normalizar_payload(datos_brutos)
    return _registrar_analisis(datos)


@bp.post("/api/propuestas")
def crear_propuesta_api():
    datos_brutos = request.get_json(silent=True) or {}
    datos = _normalizar_payload(datos_brutos)
    return _registrar_analisis(datos)


@bp.get("/analisis")
def listar_analisis():
    """
    Devuelve el historial de anÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lisis (mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡s recientes primero).
    Filtros opcionales (se aplican ANTES del paginado):
      - ?ticker=MSFT      (case-insensitive, igualdad exacta)
      - ?desde=YYYY-MM-DD (inclusive por fecha de timestamp)
      - ?hasta=YYYY-MM-DD (exclusivo del dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­a siguiente; simplificamos usando prefijos)
    Paginado opcional:
      - ?page, ?per_page
    """
    historial = _cargar_lista(ANALISIS_PATH)

    # --- Filtros ---
    ticker = request.args.get("ticker")
    desde = request.args.get("desde")
    hasta = request.args.get("hasta")
    historial = _filtrar_analisis(historial, ticker, desde, hasta)

    if ticker:
        tnorm = _norm(ticker)
        historial = [h for h in historial if _norm(h.get("ticker", "")) == tnorm]

    # Para fechas, usamos comparaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n por prefijo de fecha (YYYY-MM-DD)
    # porque timestamp estÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ en ISO completo (YYYY-MM-DDTHH:MM:SSZ)
    if desde:
        # mantenemos items cuya fecha >= desde
        historial = [h for h in historial if h.get("timestamp", "")[:10] >= desde]
    if hasta:
        # mantenemos items cuya fecha < hasta (exclusivo)
        historial = [h for h in historial if h.get("timestamp", "")[:10] < hasta]

    # --- Respuesta: lista o paginado ---
    page = request.args.get("page")
    per_page = request.args.get("per_page")
    if page or per_page:
        return jsonify(_paginate(historial, page, per_page))
    return jsonify(historial)


@bp.get("/analisis.csv")
def exportar_analisis_csv():
    """
    Exporta el historial de anÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lisis en CSV (UTF-8 con BOM para Excel).
    Acepta los mismos filtros que GET /analisis: ?ticker, ?desde, ?hasta
    """
    historial = _cargar_lista(ANALISIS_PATH)
    ticker = request.args.get("ticker")
    desde = request.args.get("desde")
    hasta = request.args.get("hasta")
    historial = _filtrar_analisis(historial, ticker, desde, hasta)

    headers = [
        "id",
        "timestamp",
        "ticker",
        "importe_inicial",
        "horizonte_anios",
        "puntuacion",
        "resumen",
    ]

    has_backtest = any(h.get("backtest") for h in historial)
    if has_backtest:
        headers += ["bt_start", "bt_end", "bt_invested", "bt_final", "bt_pnl_pct"]

    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(headers)
    for h in historial:
        row = [
            h.get("id", ""),
            h.get("timestamp", ""),
            h.get("ticker", ""),
            h.get("importe_inicial", ""),
            h.get("horizonte_anios", ""),
            h.get("puntuacion", ""),
            (h.get("resumen", "") or "").replace("\n", " ").strip(),
        ]
        if has_backtest:
            bt = h.get("backtest") or {}
            row.extend(
                [
                    bt.get("start") or "",
                    bt.get("end") or "",
                    bt.get("invested") if bt.get("invested") is not None else "",
                    bt.get("final_value") if bt.get("final_value") is not None else "",
                    bt.get("pnl_pct") if bt.get("pnl_pct") is not None else "",
                ]
            )
        w.writerow(row)

    # AÃƒÆ’Ã‚Â±adimos BOM para que Excel detecte UTF-8 automÃƒÆ’Ã‚Â¡ticamente
    csv_text = "\ufeff" + out.getvalue()

    return Response(
        csv_text,
        headers={
            "Content-Disposition": 'attachment; filename="analisis.csv"',
            "Content-Type": "text/csv; charset=utf-8",
        },
        status=200,
    )


# ----------------------
#   Helpers generales
# ----------------------


def _paginate(lista, page: str | None, per_page: str | None):
    p = int(page) if page and page.isdigit() and int(page) > 0 else 1
    pp = int(per_page) if per_page and per_page.isdigit() and int(per_page) > 0 else 10
    total = len(lista)
    start = (p - 1) * pp
    end = start + pp
    items = lista[start:end]
    has_next = end < total
    return {
        "items": items,
        "page": p,
        "per_page": pp,
        "total": total,
        "has_next": has_next,
    }


def _parse_date_yyyy_mm_dd(s: str | None):
    if not s:
        return None
    try:
        from datetime import datetime

        # interpretamos fecha en UTC a medianoche
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _filtrar_analisis(
    historial, ticker: str | None, desde: str | None, hasta: str | None
):
    if ticker:
        tnorm = _norm(ticker)
        historial = [h for h in historial if _norm(h.get("ticker", "")) == tnorm]
    if desde:
        historial = [h for h in historial if h.get("timestamp", "")[:10] >= desde]
    if hasta:
        historial = [h for h in historial if h.get("timestamp", "")[:10] < hasta]
    return historial


# --- Yahoo Finance: Datos de mercado y backtest ---
def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return pd.to_datetime(value).date()
    except Exception:
        return None


def _as_bool(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "t", "yes", "y"}


def _normalize_price_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return df
    if isinstance(df.columns, pd.MultiIndex):
        df = df.copy()
        df.columns = df.columns.get_level_values(0)
    return df


def _extract_series(df: pd.DataFrame, column: str, ticker: str) -> pd.Series:
    if df is None or df.empty or column not in df:
        return pd.Series(dtype=float)
    series = df[column].copy()
    if isinstance(series, pd.DataFrame):
        if ticker in series.columns:
            series = series[ticker]
        else:
            series = series.iloc[:, 0]
    return series


def _series_with_date_index(series: pd.Series) -> pd.Series:
    series = series.copy()
    if not series.empty:
        series.index = pd.to_datetime(series.index).date
    return series


def _series_to_map(series: pd.Series) -> dict[str, float | None]:
    return {
        str(idx): (None if pd.isna(val) else float(val)) for idx, val in series.items()
    }


def _first_price_on_or_after(series: pd.Series, target: date) -> float | None:
    if series.empty:
        return None
    for idx, value in series.sort_index().items():
        if idx >= target and not pd.isna(value):
            return float(value)
    return None


def _last_price_on_or_before(series: pd.Series, target: date) -> float | None:
    if series.empty:
        return None
    for idx in series.sort_index().index[::-1]:
        value = series.loc[idx]
        if idx <= target and not pd.isna(value):
            return float(value)
    return None


def _round_or_none(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    return round(value, digits)


class BacktestError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _download_history_df(
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
    return _normalize_price_df(df)


def _compute_price_summary(
    ticker: str, start_d: date, end_d: date, df: pd.DataFrame
) -> dict:
    adj = _series_with_date_index(_extract_series(df, "Adj Close", ticker))
    close = _series_with_date_index(_extract_series(df, "Close", ticker))
    dividends = _series_with_date_index(_extract_series(df, "Dividends", ticker))

    if adj.empty and close.empty:
        raise BacktestError("Sin datos de precios para el rango solicitado", 404)

    notes: list[str] = []

    start_price_adj = _first_price_on_or_after(adj, start_d)
    if start_price_adj is None:
        notes.append("Precio inicial ajustado no disponible en el rango")

    end_price_adj = _last_price_on_or_before(adj, end_d)
    if end_price_adj is None:
        notes.append("Precio final ajustado no disponible en el rango")

    start_price = _first_price_on_or_after(close, start_d)
    if start_price is None:
        notes.append("Precio inicial sin ajustar no disponible en el rango")

    end_price = _last_price_on_or_before(close, end_d)
    if end_price is None:
        notes.append("Precio final sin ajustar no disponible en el rango")

    variation_adj_pct = None
    if start_price_adj and end_price_adj and start_price_adj != 0:
        variation_adj_pct = (end_price_adj / start_price_adj - 1) * 100

    variation_raw_pct = None
    if start_price and end_price and start_price != 0:
        variation_raw_pct = (end_price / start_price - 1) * 100

    has_dividends = (
        bool(dividends.fillna(0).ne(0).any()) if not dividends.empty else False
    )

    now_price = None
    try:
        fast_info = yf.Ticker(ticker).fast_info
        candidate = getattr(fast_info, "last_price", None)
        if candidate is not None and not (
            isinstance(candidate, float) and math.isnan(candidate)
        ):
            now_price = float(candidate)
    except Exception:
        now_price = None

    if now_price is None:
        fallback = end_price_adj if end_price_adj is not None else None
        if fallback is None and not adj.dropna().empty:
            fallback = float(adj.dropna().iloc[-1])
        if fallback is not None:
            now_price = fallback
            notes.append("Tiempo real no disponible; se usa ultimo cierre ajustado")
        else:
            notes.append("Tiempo real no disponible")

    return {
        "start_price_adj": _round_or_none(start_price_adj, 4),
        "end_price_adj": _round_or_none(end_price_adj, 4),
        "variation_adj_pct": _round_or_none(variation_adj_pct, 2),
        "start_price": _round_or_none(start_price, 4),
        "end_price": _round_or_none(end_price, 4),
        "variation_raw_pct": _round_or_none(variation_raw_pct, 2),
        "now_price": _round_or_none(now_price, 4) if now_price is not None else None,
        "has_dividends": has_dividends,
        "notes": notes,
        "adj_series": adj,
    }


def _iso(d):
    if pd.isna(d):
        return None
    return str(pd.to_datetime(d).date())


@bp.get("/market/ohlc/<ticker>")
def market_ohlc(ticker):
    """
    Devuelve OHLCV + Adj Close para un ticker.
    Query params:
      - start=YYYY-MM-DD
      - end=YYYY-MM-DD
      - interval=1d|1wk|1mo (default 1d)
    Respuesta: lista de objetos {date, open, high, low, close, adj_close, volume}
    """
    t = (ticker or "").strip()
    if not t:
        return jsonify({"error": "Ticker requerido"}), 400

    start = request.args.get("start")
    end = request.args.get("end")
    interval = request.args.get("interval", "1d")

    try:
        df = yf.download(
            t,
            start=start,
            end=end,
            interval=interval,
            auto_adjust=False,
            progress=False,
        )
        if df is None or df.empty:
            return jsonify([])

        df = _normalize_price_df(df)

        df = df.rename(
            columns={
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Adj Close": "adj_close",
                "Volume": "volume",
            }
        ).reset_index()

        rows = []
        for _, r in df.iterrows():
            rows.append(
                {
                    "date": _iso(r.get("Date")),
                    "open": None if pd.isna(r.get("open")) else float(r.get("open")),
                    "high": None if pd.isna(r.get("high")) else float(r.get("high")),
                    "low": None if pd.isna(r.get("low")) else float(r.get("low")),
                    "close": None if pd.isna(r.get("close")) else float(r.get("close")),
                    "adj_close": (
                        None
                        if pd.isna(r.get("adj_close"))
                        else float(r.get("adj_close"))
                    ),
                    "volume": (
                        None if pd.isna(r.get("volume")) else int(r.get("volume"))
                    ),
                }
            )
        return jsonify(rows)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _gen_schedule(start_date: date, end_date: date, freq: str):
    step = {"WEEKLY": 7, "MONTHLY": 30, "QUARTERLY": 91, "ANNUAL": 365}.get(
        (freq or "").upper(), 30
    )
    d = start_date
    while d <= end_date:
        yield d
        d = d + timedelta(days=step)


def _nearest_trading_close(adj_close_by_day: dict, d: date):
    # busca el primer dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­a con dato >= fecha objetivo (forward fill hacia adelante)
    for i in range(0, 14):
        k = str(d + timedelta(days=i))
        v = adj_close_by_day.get(k)
        if v is not None:
            return float(v)
    return None


def _market_backtest_core(payload: dict) -> dict:
    t = (payload.get("ticker") or "").strip().upper()
    if not t:
        raise BacktestError("Ticker requerido", 400)

    try:
        horizon = int(payload.get("horizonte_anios") or 0)
    except (TypeError, ValueError):
        raise BacktestError("Horizonte invalido", 400)
    if horizon < 1:
        raise BacktestError("Horizonte >= 1 aÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â±o", 400)

    try:
        invested_initial = float(payload.get("importe_inicial") or 0)
    except (TypeError, ValueError):
        invested_initial = 0.0
    if invested_initial <= 0:
        raise BacktestError("Importe inicial debe ser mayor a 0", 400)

    modo = (payload.get("modo") or "SIN_DCA").upper()
    if modo not in {"DCA", "SIN_DCA"}:
        modo = "SIN_DCA"

    dca = payload.get("dca") or {}
    aporte = 0.0
    freq = "MONTHLY"
    if modo == "DCA" and isinstance(dca, dict):
        try:
            aporte = float(dca.get("aporte") or 0.0)
        except (TypeError, ValueError):
            aporte = 0.0
        if aporte < 0:
            raise BacktestError("Aporte DCA no puede ser negativo", 400)
        freq = (dca.get("frecuencia") or "MONTHLY").upper()

    today = date.today()
    start_raw = payload.get("inicio")
    if start_raw:
        start_d = _parse_iso_date(start_raw)
        if not start_d:
            raise BacktestError("Fecha de inicio invalida", 400)
    else:
        try:
            start_d = today.replace(year=today.year - horizon)
        except ValueError:
            start_d = today - timedelta(days=365 * horizon)

    end_raw = payload.get("fin")
    if end_raw:
        end_d = _parse_iso_date(end_raw)
        if not end_d:
            raise BacktestError("Fecha de fin invalida", 400)
    else:
        end_d = today

    if end_d < start_d:
        raise BacktestError(
            "La fecha de fin debe ser posterior o igual a la inicial", 400
        )

    df = _download_history_df(t, start_d, end_d, include_actions=True)
    if df is None or df.empty:
        raise BacktestError("Sin datos para el rango solicitado", 404)

    metrics = _compute_price_summary(t, start_d, end_d, df)
    adj = metrics.get("adj_series")
    if adj is None or adj.empty:
        raise BacktestError("Sin datos de precios ajustados", 404)

    adj_map = _series_to_map(adj)

    first_px = _nearest_trading_close(adj_map, start_d)
    if first_px is None:
        raise BacktestError("No hay precio inicial cercano", 404)

    invested = invested_initial
    shares = invested / first_px if first_px else 0.0

    if modo == "DCA" and aporte > 0:
        for d in _gen_schedule(start_d + timedelta(days=1), end_d, freq):
            px = _nearest_trading_close(adj_map, d)
            if px:
                invested += aporte
                shares += aporte / px

    last_px = _last_price_on_or_before(adj, end_d)
    if last_px is None and not adj.dropna().empty:
        last_px = float(adj.dropna().iloc[-1])
    if last_px is None:
        raise BacktestError("No hay precio final disponible", 404)

    final_value = shares * last_px
    pnl_abs = final_value - invested
    pnl_pct = (pnl_abs / invested) * 100 if invested > 0 else 0.0

    result = {
        "ticker": t,
        "start": str(start_d),
        "end": str(end_d),
        "desde": str(start_d),
        "hasta": str(end_d),
        "invested": _round_or_none(invested, 2),
        "shares": float(shares),
        "last_price": _round_or_none(last_px, 4),
        "final_value": _round_or_none(final_value, 2),
        "pnl_abs": _round_or_none(pnl_abs, 2),
        "pnl_pct": _round_or_none(pnl_pct, 2),
        "modo": modo,
        "start_price_adj": metrics["start_price_adj"],
        "end_price_adj": metrics["end_price_adj"],
        "variation_adj_pct": metrics["variation_adj_pct"],
        "start_price": metrics["start_price"],
        "end_price": metrics["end_price"],
        "variation_raw_pct": metrics["variation_raw_pct"],
        "now_price": metrics["now_price"],
        "has_dividends": metrics["has_dividends"],
        "notes": metrics["notes"],
    }

    metrics.pop("adj_series", None)
    return result


@bp.post("/market/backtest")
def market_backtest():
    """
    Calcula el resultado real de una inversiÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n dada usando precios Ajustados (Adj Close).
    Body JSON esperado:
    {
      "ticker": "AAPL",
      "importe_inicial": 1000,
      "horizonte_anios": 3,
      "modo": "DCA"|"SIN_DCA",
      "dca": {"aporte": 100, "frecuencia": "MONTHLY"} | null,
      "inicio": "YYYY-MM-DD" (opcional; por defecto hoy - horizonte_anios),
      "fin": "YYYY-MM-DD" (opcional; por defecto hoy)
    }
    """
    payload = request.get_json(silent=True) or {}
    try:
        result = _market_backtest_core(payload)
        return jsonify(result)
    except BacktestError as exc:
        return jsonify({"error": str(exc)}), exc.status_code
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@bp.get("/market/summary")
def market_summary():
    t = (request.args.get("ticker") or "").strip().upper()
    if not t:
        return jsonify({"error": "Ticker requerido"}), 400

    start_raw = request.args.get("start")
    if not start_raw:
        return jsonify({"error": "Parametro start requerido"}), 400
    start_d = _parse_iso_date(start_raw)
    if not start_d:
        return jsonify({"error": "Fecha de inicio invalida"}), 400

    end_raw = request.args.get("end")
    if end_raw:
        end_d = _parse_iso_date(end_raw)
        if not end_d:
            return jsonify({"error": "Fecha de fin invalida"}), 400
    else:
        end_d = date.today()

    if end_d < start_d:
        return (
            jsonify(
                {"error": "La fecha de fin debe ser posterior o igual a la inicial"}
            ),
            400,
        )

    # adjusted = _as_bool(request.args.get("adjusted"), True) # no usado

    df = _download_history_df(t, start_d, end_d, include_actions=True)
    if df is None or df.empty:
        return jsonify({"error": "Sin datos para el rango solicitado"}), 404

    try:
        metrics = _compute_price_summary(t, start_d, end_d, df)
    except BacktestError as exc:
        return jsonify({"error": str(exc)}), exc.status_code

    metrics.pop("adj_series", None)

    response = {
        "ticker": t,
        "start": str(start_d),
        "end": str(end_d),
        "start_price_adj": metrics["start_price_adj"],
        "end_price_adj": metrics["end_price_adj"],
        "variation_adj_pct": metrics["variation_adj_pct"],
        "start_price": metrics["start_price"],
        "end_price": metrics["end_price"],
        "variation_raw_pct": metrics["variation_raw_pct"],
        "now_price": metrics["now_price"],
        "has_dividends": metrics["has_dividends"],
        "notes": metrics["notes"],
    }
    return jsonify(response)


@bp.get("/market/ohlc_csv")
def market_ohlc_csv():
    t = (request.args.get("ticker") or "").strip().upper()
    if not t:
        return jsonify({"error": "Ticker requerido"}), 400

    start_raw = request.args.get("start")
    if not start_raw:
        return jsonify({"error": "Parametro start requerido"}), 400
    start_d = _parse_iso_date(start_raw)
    if not start_d:
        return jsonify({"error": "Fecha de inicio invalida"}), 400

    end_raw = request.args.get("end")
    if end_raw:
        end_d = _parse_iso_date(end_raw)
        if not end_d:
            return jsonify({"error": "Fecha de fin invalida"}), 400
    else:
        end_d = date.today()

    if end_d < start_d:
        return (
            jsonify(
                {"error": "La fecha de fin debe ser posterior o igual a la inicial"}
            ),
            400,
        )

    adjusted = _as_bool(request.args.get("adjusted"), True)

    df = yf.download(
        t,
        start=str(start_d),
        end=str(end_d + timedelta(days=1)),
        interval="1d",
        auto_adjust=False if not adjusted else False,
        actions=True,
        progress=False,
    )
    df = _normalize_price_df(df)
    if df is None or df.empty:
        return jsonify({"error": "Sin datos para el rango solicitado"}), 404

    df_out = df.reset_index().copy()
    columns_order = [
        "Date",
        "Open",
        "High",
        "Low",
        "Close",
        "Adj Close",
        "Volume",
        "Dividends",
        "Stock Splits",
    ]
    for column in columns_order:
        if column not in df_out.columns:
            df_out[column] = None
    df_out = df_out[columns_order]
    df_out = df_out.sort_values("Date")

    buffer = io.StringIO()
    df_out.to_csv(buffer, index=False)
    filename = f"{t}_{start_d}_{end_d}{'_adj' if adjusted else ''}.csv"
    return Response(
        buffer.getvalue(),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "text/csv; charset=utf-8",
        },
        status=200,
    )
