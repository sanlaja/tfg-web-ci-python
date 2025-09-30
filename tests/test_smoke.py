def test_empresas_endpoint(client):
    res = client.get("/empresas")
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list) or "items" in data  # soporta modo paginado
