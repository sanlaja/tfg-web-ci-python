from app import create_app


def test_empresas_datos_json_basico():
    app = create_app()
    client = app.test_client()

    res = client.get("/empresas")
    assert res.status_code == 200

    data = res.get_json()
    assert isinstance(data, list)
    assert len(data) >= 5

    required = {"ticker", "nombre", "sector"}
    for e in data:
        assert required <= set(e.keys())
        assert isinstance(e["ticker"], str) and e["ticker"]
        assert isinstance(e["nombre"], str) and e["nombre"]
        assert isinstance(e["sector"], str) and e["sector"]
