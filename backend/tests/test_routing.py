import json

import numpy as np
import pytest

from app.config import DATA_DIR, REGION_ANNUAL_ACCIDENTS
from app.engine import get_graph
from app.planner import Planner

REGION = "vadodara"
pytestmark = pytest.mark.skipif(not (DATA_DIR / REGION / "graph.npz").exists(),
                                reason="run `python -m pipeline.build_graph vadodara` first")

TRIP = (22.3121, 73.1795, 22.2400, 73.1950)   # MS University → Makarpura


@pytest.fixture(scope="module")
def g():
    return get_graph(REGION)


def test_calibration_reproduces_morth_total(g):
    z = np.load(DATA_DIR / REGION / "graph.npz")
    total = z["seg_N"].sum() + z["node_N"].sum()
    assert abs(total - REGION_ANNUAL_ACCIDENTS[REGION]) < 1.0


def test_line_graph_has_no_immediate_reversals_except_dead_ends(g):
    lg = g.lg["car"]
    rev = lg.t_to == (lg.t_from ^ 1)
    dead = np.diff(lg.node_out_ptr)[g.a["edge_dst"][lg.t_from]] == 1
    assert not np.any(rev & ~dead)


@pytest.mark.parametrize("lam", [0.0, 0.5, 0.9])
def test_astar_matches_dijkstra(g, lam):
    c = g.costs("car", 21)
    src, _ = g.snap(TRIP[0], TRIP[1], "car")
    dst, _ = g.snap(TRIP[2], TRIP[3], "car")
    vmax = g.e_speed.max() / 3.6
    fast = g.astar(src, dst, "car", c.edge_time, c.trans_time, 1 / vmax)
    T0, D0, R0 = g.totals(fast, c)
    we, wt = g.weights(c, 0, 1 - lam, lam, D0, T0, R0)
    allowed = g.lg["car"].allowed
    rmin = float(np.min(c.edge_risk[allowed] / np.maximum(g.e_len[allowed], 1)))
    a = g.astar(src, dst, "car", we, wt, (1 - lam) / (vmax * T0) + lam * rmin / R0)
    d = g.dijkstra(src, dst, "car", we, wt)
    assert a.cost == pytest.approx(d.cost, rel=1e-9)


def test_heuristic_is_admissible(g):
    """h(n) never exceeds the true remaining cost (checked against exact Dijkstra distances)."""
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra
    c = g.costs("car", 9)
    dst, _ = g.snap(TRIP[2], TRIP[3], "car")
    vmax = g.e_speed.max() / 3.6
    ids = g.lg["car"].allowed
    n = len(g.node_xy)
    # reverse node graph with edge time as weight (junction delays ≥ 0 only add cost)
    G = csr_matrix((c.edge_time[ids] + 1e-12, (g.a["edge_dst"][ids], g.a["edge_src"][ids])), shape=(n, n))
    true_to_go = dijkstra(G, indices=dst)
    h = np.hypot(*(g.node_xy - g.node_xy[dst]).T) / vmax
    ok = np.isfinite(true_to_go)
    assert np.all(h[ok] <= true_to_go[ok] + 1e-6)


@pytest.fixture(scope="module")
def plan_night(g):
    return Planner(g).plan(*TRIP, mode="car", hour=21, safety_weight=0.7, max_detour=0.25)


def test_safest_is_no_riskier_and_respects_detour_cap(plan_night):
    r, c = plan_night["routes"], plan_night["comparison"]
    assert r["safest"]["risk"] <= r["fastest"]["risk"] + 1e-15
    assert r["safest"]["time_s"] <= 1.25 * r["fastest"]["time_s"] + 1e-6
    assert r["fastest"]["time_s"] <= r["safest"]["time_s"] + 1e-6
    assert c["risk_reduction_pct"] >= 0


def test_pareto_front_is_non_dominated_and_sorted(plan_night):
    p = plan_night["pareto"]
    assert [x["time_s"] for x in p] == sorted(x["time_s"] for x in p)
    for a in p:
        for b in p:
            assert not (b["time_s"] < a["time_s"] and b["risk"] < a["risk"])


def test_night_increases_risk_on_same_route(g):
    pl = Planner(g)
    day = pl.plan(*TRIP, mode="car", hour=11)["routes"]["fastest"]
    night = pl.plan(*TRIP, mode="car", hour=2)["routes"]["fastest"]
    assert night["crashes_per_million_trips"] > day["crashes_per_million_trips"]


def test_response_is_json_serialisable(plan_night):
    json.dumps(plan_night)


def test_walk_mode_ignores_oneway(g):
    walk = Planner(g).plan(*TRIP, mode="walk", hour=20)
    car = Planner(g).plan(*TRIP, mode="car", hour=20)
    assert walk["routes"]["shortest"]["distance_m"] <= car["routes"]["shortest"]["distance_m"] + 1e-6
    assert walk["routes"]["safest"]["crashes_per_million_trips"] is None


def test_cost_bucket_is_independent_of_request_order(g):
    first = g.costs("car", 9.49)
    same = g.costs("car", 9.0)
    assert first is same
    g._cache.clear()
    exact = g.costs("car", 9.0)
    np.testing.assert_allclose(first.edge_risk, exact.edge_risk)
    np.testing.assert_allclose(first.edge_time, exact.edge_time)


def test_cost_cache_is_bounded(g):
    for hour in range(8):
        g.costs("car", hour)
    assert len(g._cache) == 6
    assert ("car", 0.0) not in g._cache
    assert g.costs("car", 7) is g.costs("car", 7.4)

@pytest.mark.parametrize("mode", ["car", "two_wheeler", "walk"])
def test_snap_is_nearest_available_node(g, mode):
    ids = np.flatnonzero(g.lg[mode].has_out)
    for lat, lon in [(TRIP[0], TRIP[1]), (TRIP[2], TRIP[3]), (22.30, 73.20)]:
        node, distance = g.snap(lat, lon, mode)
        expected = np.linalg.norm(g.node_xy[ids] - g.project(lat, lon), axis=1).min()
        assert g.lg[mode].has_out[node]
        assert distance == pytest.approx(expected)


def test_snap_searches_beyond_twelve_unavailable_nodes():
    from scipy.spatial import cKDTree
    from app.engine import RegionGraph
    graph = RegionGraph.__new__(RegionGraph)
    graph.project = lambda lat, lon: np.array([lat, lon])
    ids = np.array([20])
    graph.snap_indexes = {"car": (ids, cKDTree([[20, 0]]))}
    node, distance = graph.snap(0, 0, "car")
    assert node == 20 and distance == 20


@pytest.mark.parametrize("mode,cap", [("car", 0), ("two_wheeler", .1), ("walk", .25)])
def test_high_safety_preference_keeps_time_limit(g, mode, cap):
    result = Planner(g).plan(*TRIP, mode=mode, hour=21, safety_weight=1, max_detour=cap, alternatives=False)
    fast, safe = result["routes"]["fastest"], result["routes"]["safest"]
    assert safe["time_s"] <= fast["time_s"] * (1 + cap) + 1e-6
    assert safe["risk"] <= fast["risk"] + 1e-15
    # Packed segment coordinates are float32; node coordinates retain more precision.
    for point, coords in zip(result["snapped_points"], [safe["geometry"][0], safe["geometry"][-1]]):
        assert point["lon"] == pytest.approx(coords[0], abs=1e-5)
        assert point["lat"] == pytest.approx(coords[1], abs=1e-5)
