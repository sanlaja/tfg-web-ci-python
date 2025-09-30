from app import create_app


def _client():
    app = create_app()
    return app.test_client()


def test_analisis_paginado_lista_y_meta(tmp_path, monkeypatch):
    # Usar fichero temporal para no tocar datos reales
    from app import routes

    fake = tmp_path / "analisis.json"
    monkeypatch.setattr(routes, "ANALISIS_PATH", fake)

    c = _client()
    payload = {
        "ticker": "MSFT",
        "importe_inicial": 100,
        "horizonte_anios": 5,
        "supuestos": {
            "crecimiento_anual_pct": 10,
            "margen_seguridad_pct": 20,
            "roe_pct": 15,
            "deuda_sobre_activos_pct": 30,
        },
        "justificacion": "Caso demo lo bastante largo para pasar validación.",
    }

    # Genera 6 análisis
    for _ in range(6):
        assert c.post("/analisis", json=payload).status_code == 200

    res = c.get("/analisis?page=1&per_page=5")
    assert res.status_code == 200
    data = res.get_json()
    assert set(data.keys()) == {"items", "page", "per_page", "total", "has_next"}
    assert len(data["items"]) == 5
    assert data["total"] == 6
    assert data["has_next"] is True

    res2 = c.get("/analisis?page=2&per_page=5")
    data2 = res2.get_json()
    assert len(data2["items"]) == 1
    assert data2["has_next"] is False
