from app import create_app
import app.career as c

print("start")


def fail_map(tickers, start, end):
    raise c.NoHistoricalDataError(tickers)


app = create_app()
client = app.test_client()
payload = {"player": "t", "difficulty": "intermedio", "capital": 50000}
res = client.post("/api/career/session", json=payload)
print("create status", res.status_code)
sid = res.get_json()["session_id"]
print("sid", sid)
orig = c._build_normalized_series_map
c._build_normalized_series_map = fail_map
resp = client.get(f"/api/career/report/{sid}?bench=%5EGSPC&include_series=true")
print("status", resp.status_code)
print("body", resp.data[:120])
c._build_normalized_series_map = orig
