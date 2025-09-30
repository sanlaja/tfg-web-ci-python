from app import create_app
import csv
import io


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


def _csv_to_rows(body_bytes: bytes):
    # decodificamos UTF-8 (tolerante BOM)
    text = body_bytes.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


def test_csv_basico_descarga_y_cabeceras(tmp_path, monkeypatch):
    from app import routes

    fake = tmp_path / "analisis.json"
    monkeypatch.setattr(routes, "ANALISIS_PATH", fake)
    c = _client()

    # generamos un par de filas
    for t in ["MSFT", "AAPL"]:
        p = dict(BASE_PAYLOAD, ticker=t)
        assert c.post("/analisis", json=p).status_code == 200

    r = c.get("/analisis.csv")
    assert r.status_code == 200
    # content-type y filename
    ct = r.headers.get("Content-Type", "")
    disp = r.headers.get("Content-Disposition", "")
    assert ct.startswith("text/csv")
    assert "attachment" in disp and "analisis.csv" in disp

    rows = _csv_to_rows(r.data)
    # cabecera
    assert rows[0] == [
        "id",
        "timestamp",
        "ticker",
        "importe_inicial",
        "horizonte_anios",
        "puntuacion",
        "resumen",
    ]
    # al menos 2 filas de datos
    assert len(rows) >= 3


def test_csv_respecta_filtros(tmp_path, monkeypatch):
    from app import routes

    fake = tmp_path / "analisis.json"
    monkeypatch.setattr(routes, "ANALISIS_PATH", fake)
    c = _client()

    for t in ["MSFT", "AAPL", "MSFT", "NVDA"]:
        p = dict(BASE_PAYLOAD, ticker=t)
        assert c.post("/analisis", json=p).status_code == 200

    r = c.get("/analisis.csv?ticker=msft")
    assert r.status_code == 200
    rows = _csv_to_rows(r.data)
    # sin contar cabecera, todos MSFT
    data_rows = rows[1:]
    assert len(data_rows) >= 2
    assert all(row[2].lower() == "msft" for row in data_rows)
