from app import create_app


def test_empresas_busqueda_q_por_nombre_y_ticker():
    app = create_app()
    client = app.test_client()

    # Búsqueda por nombre (Apple)
    res = client.get("/empresas?q=apple")
    assert res.status_code == 200
    data = res.get_json()
    tickers = {e["ticker"] for e in data}
    assert "AAPL" in tickers

    # Búsqueda parcial por ticker (MSFT)
    res2 = client.get("/empresas?q=msf")
    assert res2.status_code == 200
    data2 = res2.get_json()
    tickers2 = {e["ticker"] for e in data2}
    assert "MSFT" in tickers2

    # Case/acentos insensitivo (tecnología → debería encontrar varias)
    res3 = client.get("/empresas?q=micrósoft")
    assert res3.status_code == 200
    data3 = res3.get_json()
    assert any(e["ticker"] == "MSFT" for e in data3)


def test_empresas_busqueda_q_sin_resultados():
    app = create_app()
    client = app.test_client()

    res = client.get("/empresas?q=zzzz_no_match")
    assert res.status_code == 200
    assert res.get_json() == []
