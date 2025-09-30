from app import create_app
from datetime import datetime, timedelta


def _client():
    app = create_app()
    return app.test_client()


BASE_PAYLOAD = {
    "importe_inicial": 100,
    "horizonte_anios": 5,
    "supuestos": {
        "crecimiento_anual_pct": 10,
        "margen_seguridad_pct": 20,
        "roe_pct": 15,
        "deuda_sobre_activos_pct": 30,
    },
    "justificacion": "Caso suficientemente largo para pasar validación.",
}


def test_filtro_por_ticker(tmp_path, monkeypatch):
    # Aislamos el fichero de almacenamiento
    from app import routes

    fake = tmp_path / "analisis.json"
    monkeypatch.setattr(routes, "ANALISIS_PATH", fake)
    c = _client()

    # Creamos 3 análisis con tickers diferentes
    for t in ["MSFT", "AAPL", "MSFT"]:
        p = dict(BASE_PAYLOAD, ticker=t)
        assert c.post("/analisis", json=p).status_code == 200

    # Filtrar por ticker (case-insensitive)
    r = c.get("/analisis?ticker=msft")
    assert r.status_code == 200
    data = r.get_json()
    assert isinstance(data, list)
    assert all(item["ticker"].lower() == "msft" for item in data)
    assert len(data) == 2


def test_filtro_por_fecha_desde_hasta(tmp_path, monkeypatch):
    from app import routes

    fake = tmp_path / "analisis.json"
    monkeypatch.setattr(routes, "ANALISIS_PATH", fake)
    c = _client()

    # Creamos dos análisis "en el pasado" y uno "hoy".
    # No podemos manipular el timestamp interno fácilmente sin tocar el código,
    # así que creamos 3 y luego reescribimos el archivo con timestamps controlados.
    for t in ["MSFT", "AAPL", "NVDA"]:
        p = dict(BASE_PAYLOAD, ticker=t)
        assert c.post("/analisis", json=p).status_code == 200

    # Cargamos el fichero y reescribimos timestamps
    import json

    with open(fake, "r", encoding="utf-8") as f:
        lista = json.load(f)

    hoy = datetime.utcnow()
    hace_3d = (hoy - timedelta(days=3)).isoformat() + "Z"
    hace_1d = (hoy - timedelta(days=1)).isoformat() + "Z"
    hoy_iso = hoy.isoformat() + "Z"

    # lista está en orden "más reciente primero"; ajustamos manualmente
    # Asignamos: 0 -> hoy, 1 -> hace_1d, 2 -> hace_3d
    lista[0]["timestamp"] = hoy_iso
    lista[1]["timestamp"] = hace_1d
    lista[2]["timestamp"] = hace_3d

    with open(fake, "w", encoding="utf-8") as f:
        json.dump(lista, f, ensure_ascii=False, indent=2)

    # Filtrar desde ayer (solo hoy)
    desde = hoy.date().isoformat()  # YYYY-MM-DD
    r1 = c.get(f"/analisis?desde={desde}")
    assert r1.status_code == 200
    data1 = r1.get_json()
    assert all(
        item["timestamp"] >= desde
        for item in [{"timestamp": d["timestamp"]} for d in data1]
    )

    # Filtrar hasta ayer (excluye hoy)
    r2 = c.get(f"/analisis?hasta={desde}")
    assert r2.status_code == 200
    data2 = r2.get_json()
    # ninguno debería tener timestamp >= hoy_iso
    assert all(d["timestamp"] < desde for d in data2) or len(data2) == 0


def test_filtros_combinados_y_paginado(tmp_path, monkeypatch):
    from app import routes

    fake = tmp_path / "analisis.json"
    monkeypatch.setattr(routes, "ANALISIS_PATH", fake)
    c = _client()

    # Generamos 7 MSFT y 3 AAPL
    for _ in range(7):
        p = dict(BASE_PAYLOAD, ticker="MSFT")
        assert c.post("/analisis", json=p).status_code == 200
    for _ in range(3):
        p = dict(BASE_PAYLOAD, ticker="AAPL")
        assert c.post("/analisis", json=p).status_code == 200

    # Filtrar por ticker y paginar
    r = c.get("/analisis?ticker=MSFT&page=1&per_page=5")
    assert r.status_code == 200
    data = r.get_json()
    assert set(data.keys()) == {"items", "page", "per_page", "total", "has_next"}
    assert len(data["items"]) == 5
    assert data["total"] == 7
    assert data["has_next"] is True

    r2 = c.get("/analisis?ticker=MSFT&page=2&per_page=5")
    data2 = r2.get_json()
    assert len(data2["items"]) == 2
    assert data2["has_next"] is False
