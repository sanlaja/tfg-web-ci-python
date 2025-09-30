from app import create_app


def _client():
    app = create_app()
    return app.test_client()


def test_empresas_paginado_items_y_meta():
    c = _client()
    res = c.get("/empresas?page=1&per_page=3")
    assert res.status_code == 200
    data = res.get_json()
    assert set(data.keys()) == {"items", "page", "per_page", "total", "has_next"}
    assert len(data["items"]) == 3
    assert data["page"] == 1
    assert data["per_page"] == 3
    assert data["total"] >= 5  # tenemos al menos 5 en el dataset


def test_empresas_paginado_fuera_de_rango():
    c = _client()
    res = c.get("/empresas?page=999&per_page=5")
    assert res.status_code == 200
    data = res.get_json()
    assert data["items"] == []
    assert data["has_next"] is False
