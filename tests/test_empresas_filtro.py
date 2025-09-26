from app import create_app


def test_empresas_filtrado_por_sector():
    app = create_app()
    client = app.test_client()

    # Sin filtro: deberían venir muchas (>= 5)
    res_all = client.get("/empresas")
    assert res_all.status_code == 200
    data_all = res_all.get_json()
    assert isinstance(data_all, list)
    assert len(data_all) >= 5

    # Con filtro: Tecnología
    res = client.get("/empresas?sector=Tecnología")
    assert res.status_code == 200
    data = res.get_json()
    assert all(e["sector"].lower() == "tecnología".lower() for e in data)
    # Deben existir resultados en tu dataset de ejemplo
    assert any(e["ticker"] in {"MSFT", "AAPL", "GOOGL", "NVDA"} for e in data)

    # Case-insensitive
    res2 = client.get("/empresas?sector=tecnologÍa")
    assert res2.status_code == 200
    data2 = res2.get_json()
    assert data == data2  # mismo resultado aunque cambie mayúsculas/acentos


def test_empresas_filtro_sector_inexistente_devuelve_lista_vacia():
    app = create_app()
    client = app.test_client()

    res = client.get("/empresas?sector=NoExiste")
    assert res.status_code == 200
    assert res.get_json() == []
