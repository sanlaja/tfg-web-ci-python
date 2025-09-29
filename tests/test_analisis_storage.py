from app import create_app


def _client():
    app = create_app()
    return app.test_client()


def _payload_base():
    return {
        "ticker": "MSFT",
        "importe_inicial": 500,
        "horizonte_anios": 10,
        "supuestos": {
            "crecimiento_anual_pct": 8,
            "margen_seguridad_pct": 20,
            "roe_pct": 18,
            "deuda_sobre_activos_pct": 25,
        },
        "justificacion": "Caso de prueba persistencia.",
    }


def test_post_analisis_guarda_en_historial_y_get_lista():
    c = _client()

    # 1) POST crea un análisis y lo devuelve con puntuación/resumen
    res = c.post("/analisis", json=_payload_base())
    assert res.status_code == 200
    data = res.get_json()
    assert data["valido"] is True
    assert isinstance(data["puntuacion"], int)

    # 2) GET /analisis devuelve una lista con al menos 1 elemento
    res2 = c.get("/analisis")
    assert res2.status_code == 200
    lista = res2.get_json()
    assert isinstance(lista, list)
    assert len(lista) >= 1

    # 3) Estructura mínima de cada item guardado
    item = lista[0]
    for key in [
        "id",
        "timestamp",
        "ticker",
        "importe_inicial",
        "horizonte_anios",
        "puntuacion",
        "resumen",
    ]:
        assert key in item


def test_get_analisis_vacio_no_revienta(tmp_path, monkeypatch):
    # Simulamos que el fichero no existe aún
    from app import routes

    fake_path = tmp_path / "analisis.json"
    monkeypatch.setattr(routes, "ANALISIS_PATH", fake_path)

    c = _client()
    res = c.get("/analisis")
    assert res.status_code == 200
    assert res.get_json() == []
