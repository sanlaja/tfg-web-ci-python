from flask import Blueprint, jsonify, request, Response, render_template
from pathlib import Path
from datetime import datetime
import json
import unicodedata
import uuid
import csv
import io


bp = Blueprint("main", __name__)


# ----------------------
#   Vistas HTML
# ----------------------
@bp.get("/")
def inicio():
    return render_template("inicio.html", active="inicio")


@bp.get("/inicio")
def inicio_alias():
    return render_template("inicio.html", active="inicio")


@bp.get("/empresas")
def empresas_page():
    accept = request.accept_mimetypes
    wants_json = request.args.get("format") == "json" or (
        accept.best == "application/json"
        or accept["application/json"] >= accept["text/html"]
    )
    if wants_json and request.args.get("format") != "html":
        return listar_empresas()
    return render_template("empresas.html", active="empresas")


@bp.get("/nuevo-analisis")
def analisis_page():
    return render_template("analisis.html", active="analisis")


@bp.get("/historial")
def historial_page():
    return render_template("historial.html", active="historial")


@bp.get("/aprende")
def aprende_page():
    return render_template("aprende.html", active="aprende")


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
      - ?sector=...  → igualdad exacta (normalizada)
      - ?q=...       → búsqueda contiene en ticker o nombre (normalizada)
      - ?page&per_page → (opcional) si se envían, responde paginado
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
#   Motor de análisis
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
    if not isinstance(horizonte, int) or horizonte < 5:
        errores.append("'horizonte_anios' debe ser un entero >= 5.")

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
        obs.append({"tipo": "ok", "msg": "ROE alto (≥15%)."})
    elif roe >= 8:
        score += 5
        obs.append({"tipo": "ok", "msg": "ROE razonable (≥8%)."})
    else:
        obs.append(
            {"tipo": "mejora", "msg": "ROE bajo: revisa rentabilidad del negocio."}
        )

    # Deuda
    deuda = sup.get("deuda_sobre_activos_pct", 0)
    if deuda <= 30:
        score += 10
        obs.append({"tipo": "ok", "msg": "Deuda moderada (≤30%)."})
    elif deuda <= 60:
        score += 3
        obs.append(
            {"tipo": "mejora", "msg": "Deuda medio-alta: vigila el apalancamiento."}
        )
    else:
        score -= 5
        obs.append(
            {"tipo": "alerta", "msg": "Deuda elevada (>60%): riesgo financiero."}
        )

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

    # Bounded score
    score = max(0, min(100, int(round(score))))

    # Resumen simple
    if score >= 80:
        resumen = "Análisis sólido."
    elif score >= 60:
        resumen = "Análisis razonable con áreas de mejora."
    else:
        resumen = "Análisis débil: revisa supuestos, riesgos y valoración."

    return score, obs, resumen


# ----------------------
#   Persistencia análisis
# ----------------------

DATA_DIR = Path(__file__).resolve().parent / "data"
ANALISIS_PATH = DATA_DIR / "analisis.json"


def _cargar_lista(path: Path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []


def _guardar_lista(path: Path, lista):
    path.parent.mkdir(parents=True, exist_ok=True)
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
    Devuelve el historial de análisis (más recientes primero).
    Filtros opcionales (se aplican ANTES del paginado):
      - ?ticker=MSFT      (case-insensitive, igualdad exacta)
      - ?desde=YYYY-MM-DD (inclusive por fecha de timestamp)
      - ?hasta=YYYY-MM-DD (exclusivo del día siguiente; simplificamos usando prefijos)
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

    # Para fechas, usamos comparación por prefijo de fecha (YYYY-MM-DD)
    # porque timestamp está en ISO completo (YYYY-MM-DDTHH:MM:SSZ)
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
    Exporta el historial de análisis en CSV (UTF-8 con BOM para Excel).
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

    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(headers)
    for h in historial:
        w.writerow(
            [
                h.get("id", ""),
                h.get("timestamp", ""),
                h.get("ticker", ""),
                h.get("importe_inicial", ""),
                h.get("horizonte_anios", ""),
                h.get("puntuacion", ""),
                (h.get("resumen", "") or "").replace("\n", " ").strip(),
            ]
        )

    # 👇 Añadimos BOM para que Excel detecte UTF-8 automáticamente
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
