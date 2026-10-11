"""HTTP boundary checks. Optional when only the fallback server is installed."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

@pytest.mark.parametrize("payload", ["{broken", "null", "[]", '"route"'])
def test_malformed_route_returns_client_error(payload):
    response = client.post("/api/route", content=payload, headers={"Content-Type": "application/json"})
    assert 400 <= response.status_code < 500


def test_home_and_search():
    assert client.get("/").status_code == 200
    assert client.get("/api/search", params={"q": "svnit", "city": "surat"}).json()["results"]


def test_lightweight_route():
    response = client.post("/api/route", json={
        "origin": {"lat": 22.3121, "lon": 73.1795},
        "destination": {"lat": 22.2400, "lon": 73.1950},
        "include_analysis": False,
    })
    assert response.status_code == 200
    data = response.json()
    assert set(data["routes"]) == {"fastest", "safest"}
    assert data["pareto"] == []
    assert data["routes"]["safest"]["time_s"] <= data["routes"]["fastest"]["time_s"] * 1.25 + .01
