import pytest

from app import api
from app.config import DATA_DIR

pytestmark = pytest.mark.skipif(not (DATA_DIR / "vadodara" / "graph.npz").exists(), reason="graphs not built")


def test_cities_lists_all_five():
    ids = {c["id"] for c in api.cities()["cities"]}
    assert ids == {"surat", "ahmedabad", "gandhinagar", "vadodara", "rajkot"}


@pytest.mark.parametrize("body,status", [
    ({}, 400),
    ({"origin": {"lat": 22.31, "lon": 73.18}}, 400),
    ({"origin": {"lat": 19.07, "lon": 72.87}, "destination": {"lat": 22.31, "lon": 73.18}}, 422),   # Mumbai
    ({"origin": {"lat": 22.31, "lon": 73.18}, "destination": {"lat": 22.30, "lon": 73.17}, "hour": 30}, 400),
])
def test_route_validation(body, status):
    with pytest.raises(api.ApiError) as e:
        api.route(body)
    assert e.value.status == status


def test_intercity_rejected_with_clear_message():
    if not (DATA_DIR / "rajkot" / "graph.npz").exists():
        pytest.skip("rajkot not built")
    with pytest.raises(api.ApiError) as e:
        api.route({"origin": {"lat": 22.31, "lon": 73.18}, "destination": {"lat": 22.30, "lon": 70.80}})
    assert e.value.status == 422 and "Inter-city" in e.value.message


def test_search_acronym_and_prefix():
    if not (DATA_DIR / "surat" / "graph.npz").exists():
        pytest.skip("surat not built")
    names = [r["name"] for r in api.do_search("svnit", "surat")["results"]]
    assert names and names[0].startswith("Sardar Vallabhbhai")
    assert api.do_search("x", "surat")["results"] == []


def test_blackspot_layer_has_sources():
    for b in api.layers("vadodara")["blackspots"]:
        assert b["source_url"].startswith("http") and b["risk_multiplier"] >= 1.0
