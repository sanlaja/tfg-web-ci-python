from app import create_app


def test_empresas_lista_basica():
    app = create_app()
    client = app.test_client()

    res = client.get("/empresas")
    assert res.status_code == 200

    data = res.get_json()
    assert isinstance(data, list)
    assert len(data) >= 3

    # Comprobamos estructura mínima de cada empresa
    keys = {"ticker", "nombre", "sector"}
    assert keys.issubset(set(data[0].keys()))

    # Comprobamos algunos tickers conocidos
    tickers = {e["ticker"] for e in data}
    assert {"MSFT", "AAPL", "GOOGL"} <= tickers
