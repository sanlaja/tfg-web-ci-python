from flask import Blueprint, jsonify, request
from pathlib import Path
import json
import unicodedata

bp = Blueprint("main", __name__)


@bp.get("/health")
def health():
    return jsonify(status="ok")


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


@bp.get("/empresas")
def listar_empresas():
    """
    Devuelve lista de empresas.
    Filtros opcionales:
      - ?sector=...     → igualdad exacta (normalizada)
      - ?q=...          → búsqueda contiene en ticker o nombre (normalizada)
    """
    sector = request.args.get("sector")
    q = request.args.get("q")

    # Sin filtros → todo
    resultado = EMPRESAS

    # Filtro por sector (igualdad)
    if sector:
        target = _norm(sector)
        resultado = [e for e in resultado if _norm(e.get("sector", "")) == target]

    # Filtro por texto (contiene en ticker o nombre)
    if q:
        needle = _norm(q)

        def coincide(e):
            return needle in _norm(e.get("ticker", "")) or needle in _norm(
                e.get("nombre", "")
            )

        resultado = [e for e in resultado if coincide(e)]

    return jsonify(resultado)
