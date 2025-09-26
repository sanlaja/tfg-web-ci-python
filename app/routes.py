from flask import Blueprint, jsonify

bp = Blueprint("main", __name__)


@bp.get("/health")
def health():
    return jsonify(status="ok")


# --- Datos mínimos (MVP). Luego lo pasaremos a fichero/BD ---
EMPRESAS = [
    {"ticker": "MSFT", "nombre": "Microsoft", "sector": "Tecnología"},
    {"ticker": "AAPL", "nombre": "Apple", "sector": "Tecnología"},
    {"ticker": "GOOGL", "nombre": "Alphabet", "sector": "Tecnología"},
    {"ticker": "AMZN", "nombre": "Amazon", "sector": "Consumo"},
    {"ticker": "JNJ", "nombre": "Johnson & Johnson", "sector": "Salud"},
]


@bp.get("/empresas")
def listar_empresas():
    """
    Devuelve lista de empresas en formato JSON.
    Más adelante:
      - leeremos de un CSV/BD
      - añadiremos filtros (sector, año, etc.)
    """
    return jsonify(EMPRESAS)
