from flask import Blueprint, jsonify, request
from pathlib import Path
import json
import unicodedata

bp = Blueprint("main", __name__)


@bp.get("/health")
def health():
    return jsonify(status="ok")


# --- Carga de datos desde JSON ---
DATA_PATH = Path(__file__).resolve().parent / "data" / "empresas.json"


def _cargar_empresas():
    with DATA_PATH.open("r", encoding="utf-8-sig") as f:
        data = json.load(f)
    # Validación mínima de estructura
    for e in data:
        assert {"ticker", "nombre", "sector"} <= set(e.keys())
    return data


EMPRESAS = _cargar_empresas()


def _norm(s: str) -> str:
    """Normaliza para comparar sin tildes y sin mayúsculas."""
    if not isinstance(s, str):
        return ""
    nfkd = unicodedata.normalize("NFKD", s)
    # elimina diacríticos y pasa a minúsculas
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch)).lower()


@bp.get("/empresas")
def listar_empresas():
    """Devuelve lista de empresas. Soporta ?sector= (opcional)."""
    sector = request.args.get("sector")
    if not sector:
        return jsonify(EMPRESAS)

    target = _norm(sector)
    filtradas = [e for e in EMPRESAS if _norm(e.get("sector", "")) == target]
    return jsonify(filtradas)
