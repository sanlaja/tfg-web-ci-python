from app import create_app


def test_index_served():
    app = create_app()
    client = app.test_client()
    res = client.get("/")
    assert res.status_code == 200
    assert b"<html" in res.data
