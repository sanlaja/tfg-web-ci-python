import csv
import io

# --- Helpers -----------------------------------------------------------


def _client():
    from app import create_app

    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def _csv_to_rows(data: bytes):
    return list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))


BASE_PAYLOAD = {
    "ticker": "MSFT",
    "importe_inicial": 1000,
    "horizonte_anios": 2,
    "supuestos": {
        "crecimiento_anual_pct": 5,
        "margen_seguridad_pct": 10,
        "roe_pct": 10,
        "deuda_sobre_activos_pct": 30,
    },
    "justificacion": "Empresa sólida con buenos fundamentales y baja deuda.",
    "modo": "SIN_DCA",
}


# --- Tests -------------------------------------------------------------


def test_csv_basico_descarga_y_cabeceras(tmp_path, monkeypatch):
    """
    Verifica que /analisis.csv devuelve un CSV válido,
    con las cabeceras esperadas (y tolera columnas bt_* adicionales).
    """
    from app import routes

    fake = tmp_path / "analisis.json"
    monkeypatch.setattr(routes, "ANALISIS_PATH", fake)
    c = _client()

    # Generar un par de filas de ejemplo
    for t in ["MSFT", "AAPL"]:
        p = dict(BASE_PAYLOAD, ticker=t)
        assert c.post("/analisis", json=p).status_code == 200

    r = c.get("/analisis.csv")
    assert r.status_code == 200

    # Content-Type y nombre de archivo
    ct = r.headers.get("Content-Type", "")
    disp = r.headers.get("Content-Disposition", "")
    assert ct.startswith("text/csv")
    assert "attachment" in disp and "analisis.csv" in disp

    rows = _csv_to_rows(r.data)
    assert len(rows) >= 2  # al menos cabecera + 1 fila

    # Cabecera: validar prefijo esperado
    expected_prefix = [
        "id",
        "timestamp",
        "ticker",
        "importe_inicial",
        "horizonte_anios",
        "puntuacion",
        "resumen",
    ]

    header = rows[0]
    # Aseguramos que las primeras columnas son correctas
    assert header[: len(expected_prefix)] == expected_prefix

    # Si hay columnas adicionales (bt_start, etc.), comprobar que empiezan por "bt_"
    if len(header) > len(expected_prefix):
        extra = header[len(expected_prefix) :]
        assert all(col.startswith("bt_") for col in extra)

    # Verificar contenido de filas
    for row in rows[1:]:
        assert len(row) >= len(expected_prefix)
        assert row[2] in ("MSFT", "AAPL")


def test_csv_vacio(tmp_path, monkeypatch):
    """
    Si no hay registros, el CSV debe contener solo la cabecera.
    """
    from app import routes

    fake = tmp_path / "analisis.json"
    monkeypatch.setattr(routes, "ANALISIS_PATH", fake)
    c = _client()

    r = c.get("/analisis.csv")
    assert r.status_code == 200
    rows = _csv_to_rows(r.data)
    assert len(rows) == 1  # solo cabecera
    assert "ticker" in rows[0]
