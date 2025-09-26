from flask import Blueprint, jsonify
from pathlib import Path
import json

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


@bp.get("/empresas")
def listar_empresas():
    """Devuelve lista de empresas en formato JSON."""
    return jsonify(EMPRESAS)
