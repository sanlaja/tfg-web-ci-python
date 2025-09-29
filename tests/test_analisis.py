from app import create_app


def _client():
    app = create_app()
    return app.test_client()


def test_analisis_valido_devuelve_feedback_y_puntuacion():
    client = _client()
    payload = {
        "ticker": "MSFT",
        "importe_inicial": 500,
        "horizonte_anios": 10,
        "supuestos": {
            "crecimiento_anual_pct": 8,
            "margen_seguridad_pct": 20,
            "roe_pct": 18,
            "deuda_sobre_activos_pct": 25,
        },
        "justificacion": "Ventajas competitivas claras, crecimiento cloud y buena rentabilidad.",
    }
    res = client.post("/analisis", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert data["valido"] is True
    assert isinstance(data["puntuacion"], int) and 0 <= data["puntuacion"] <= 100
    assert isinstance(data["observaciones"], list) and len(data["observaciones"]) >= 1
    assert "resumen" in data and isinstance(data["resumen"], str)


def test_analisis_falla_validacion_campos_obligatorios():
    client = _client()
    payload = {
        # falta ticker e importe_inicial
        "horizonte_anios": 2,  # demasiado corto
        "supuestos": {
            "crecimiento_anual_pct": 50,  # irrealista
            "margen_seguridad_pct": -5,  # fuera de rango
            "roe_pct": 5,
            "deuda_sobre_activos_pct": 80,  # alta
        },
        "justificacion": "Breve",
    }
    res = client.post("/analisis", json=payload)
    assert res.status_code == 400
    data = res.get_json()
    # esperamos mensajes de validación
    assert any("ticker" in m.lower() for m in data["errores"])  # falta ticker
    assert any("importe_inicial" in m.lower() for m in data["errores"])
    assert any("horizonte" in m.lower() for m in data["errores"])  # horizonte mínimo
    assert any("margen" in m.lower() for m in data["errores"])  # fuera de rango
    assert any("crecimiento" in m.lower() for m in data["errores"])  # irrealista
    assert any("justificacion" in m.lower() for m in data["errores"])  # demasiado corta


def test_analisis_limites_y_alertas():
    client = _client()
    payload = {
        "ticker": "AAPL",
        "importe_inicial": 100,
        "horizonte_anios": 5,
        "supuestos": {
            "crecimiento_anual_pct": 15,  # alto pero plausiblemente OK
            "margen_seguridad_pct": 10,  # bajo
            "roe_pct": 10,
            "deuda_sobre_activos_pct": 60,  # alta
        },
        "justificacion": "Caso razonable pero con margen bajo y deuda elevada.",
    }
    res = client.post("/analisis", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert data["valido"] is True
    # debería haber observaciones de mejora/alerta
    textos = " ".join(o["msg"].lower() for o in data["observaciones"])
    assert "margen de seguridad" in textos or "deuda" in textos
