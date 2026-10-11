"""Framework-independent request handlers (wrapped by main.py / devserver.py)."""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np

from . import model as M
from .config import CITIES, REGIONS
from .engine import RouteError, get_graph
from .planner import Planner
from .search import available_regions, search


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def region_of(lat: float, lon: float):
    for r in available_regions():
        s, w, n, e = REGIONS[r]["bbox"]
        if s <= lat <= n and w <= lon <= e:
            return r
    return None


def nearest_city(lat, lon):
    return min(CITIES, key=lambda c: (CITIES[c]["center"][0] - lat) ** 2 + (CITIES[c]["center"][1] - lon) ** 2)


def cities():
    ready = set(available_regions())
    out = []
    for key, c in CITIES.items():
        reg = c["region"]
        meta = get_graph(reg).meta if reg in ready else None
        out.append({"id": key, "name": c["name"], "region": reg, "center": c["center"], "zoom": c["zoom"],
                    "stats": c["stats"], "ready": reg in ready,
                    "network_km": meta["km"] if meta else None, "coverage": meta["coverage"] if meta else None})
    return {"cities": out, "regions": {r: {"name": REGIONS[r]["name"], "bbox": REGIONS[r]["bbox"]} for r in REGIONS}}


def do_search(q: str, city: str | None):
    return {"results": search(q or "", city)}


def reverse(lat: float, lon: float):
    reg = region_of(lat, lon)
    if not reg:
        return {"name": f"{lat:.5f}, {lon:.5f}", "road": "", "area": "", "region": None, "city": None}
    g = get_graph(reg)
    a = g.a
    xy = g.project(lat, lon)
    # nearest *named* road within 200 m
    road, best = "", 1e9
    for i in g.node_tree.query_ball_point(xy, 200):
        for e in range(g.lg["walk"].node_out_ptr[i], g.lg["walk"].node_out_ptr[i + 1]):
            eid = g.lg["walk"].node_out[e]
            n = g.names[int(a["seg_name"][a["edge_seg"][eid]])]
            d = float(np.hypot(*(g.node_xy[i] - xy)))
            if n and d < best:
                road, best = n, d
    area = nearest_area(reg, lat, lon)
    city = nearest_city(lat, lon)
    parts = [p for p in (road, area) if p]
    label = ", ".join(parts) if parts else f"{lat:.4f}, {lon:.4f}"
    return {"name": label, "road": road, "area": area, "region": reg, "city": city,
            "city_name": CITIES[city]["name"]}


@lru_cache(maxsize=None)
def _areas(reg):
    from .search import _places
    rows = [p for p in _places(reg) if p["kind"] == "Area"]
    return rows, (np.array([[p["lat"], p["lon"]] for p in rows]) if rows else np.zeros((0, 2)))


def nearest_area(reg, lat, lon):
    rows, arr = _areas(reg)
    if not len(rows):
        return ""
    d = (arr[:, 0] - lat) ** 2 + ((arr[:, 1] - lon) * math.cos(math.radians(lat))) ** 2
    i = int(np.argmin(d))
    return rows[i]["name"] if d[i] < (0.025 ** 2) else ""


def route(body: dict):
    try:
        o, dst = body["origin"], body["destination"]
        o_lat, o_lon, d_lat, d_lon = float(o["lat"]), float(o["lon"]), float(dst["lat"]), float(dst["lon"])
    except (KeyError, TypeError, ValueError):
        raise ApiError(400, "origin and destination {lat, lon} are required")
    r1, r2 = region_of(o_lat, o_lon), region_of(d_lat, d_lon)
    if r1 is None or r2 is None:
        raise ApiError(422, "Both points must be inside a supported city (Surat, Ahmedabad, Gandhinagar, Vadodara, Rajkot)")
    if r1 != r2:
        raise ApiError(422, f"Inter-city trips aren't supported yet ({REGIONS[r1]['name']} → {REGIONS[r2]['name']}). Pick both points in the same city.")
    mode = body.get("mode", "car")
    hour = float(body.get("hour", 9))
    if not (0 <= hour < 24):
        raise ApiError(400, "hour must be in [0, 24)")
    try:
        return Planner(get_graph(r1)).plan(
            o_lat, o_lon, d_lat, d_lon, mode=mode, hour=hour,
            safety_weight=float(body.get("safety_weight", 0.7)),
            max_detour=float(body.get("max_detour", 0.25)))
    except RouteError as ex:
        raise ApiError(422, str(ex))


def layers(region: str):
    if region not in available_regions():
        raise ApiError(404, f"Region '{region}' has not been built")
    return get_graph(region).layers


@lru_cache(maxsize=64)
def network(region: str, mode: str, hour_bucket: float):
    """Major-road risk map: GeoJSON of tertiary+ segments coloured by risk/km."""
    if region not in available_regions():
        raise ApiError(404, f"Region '{region}' has not been built")
    g = get_graph(region)
    a = g.a
    c = g.costs(mode, hour_bucket)
    major = [M.CLASS_ID[x] for x in M.CLASSES if x not in ("residential", "living_street", "unclassified")]
    # one direction per segment (forward edges are the even ids)
    fwd = np.arange(0, len(a["edge_seg"]), 2)
    keep = fwd[np.isin(g.e_cls[fwd], major) & (g.e_len[fwd] > 15)]
    rel = (c.edge_risk[keep] / (g.e_len[keep] / 1000)) / c.ref_risk_per_km
    feats = []
    for e, r in zip(keep.tolist(), rel.tolist()):
        sg = int(a["edge_seg"][e])
        pts = a["coords"][a["seg_off"][sg]:a["seg_off"][sg + 1]]
        if len(pts) > 6:
            pts = pts[np.unique(np.linspace(0, len(pts) - 1, 6).astype(int))]
        feats.append({"type": "Feature", "properties": {"r": round(r, 2)},
                      "geometry": {"type": "LineString", "coordinates": [[round(float(p[1]), 5), round(float(p[0]), 5)] for p in pts]}})
    return {"type": "FeatureCollection", "features": feats}


def network_handler(region: str, mode: str = "car", hour: float = 21):
    if mode not in ("car", "two_wheeler", "walk"):
        raise ApiError(400, "bad mode")
    return network(region, mode, float(math.floor(float(hour))))


def methodology():
    return {
        "tod_risk": [{"from": 3 * i, "to": 3 * i + 3, "crash_share": float(M.CRASH_SHARE_3H[i]),
                      "traffic_share": float(M.TRAFFIC_SHARE_3H[i]), "risk": round(float(M.TOD_RISK_3H[i]), 3)}
                     for i in range(8)],
        "turn_risk": dict(zip(M.TURN_LABEL, M.TURN_RISK.tolist())),
        "security_gamma": M.SECURITY_GAMMA,
        "fatal_share": M.FATAL_SHARE,
    }
