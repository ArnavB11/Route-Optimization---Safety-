"""Build the routable, safety-annotated road graph for each region.

Input  (data/raw/<region>/):  roads.json, pois.json, nightlights.npz
       (datasets/):            blackspots.json
Output (data/<region>/):       graph.npz   – node/edge arrays + geometry
                               meta.json   – names, calibration, stats
                               layers.json – map overlays (police, hospitals …)
                               places.json – search gazetteer

Usage:  python -m pipeline.build_graph [region ...]
"""
from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter, defaultdict

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from app import model as M
from app.config import DATA_DIR, DATASETS_DIR, RAW_DIR, REGION_ANNUAL_ACCIDENTS, REGIONS

EARTH_R = 6371008.8
JUNCTION_SHARE = 0.35      # share of urban crashes at junctions (assumption, see METHODOLOGY)
EB_OVERDISPERSION = 0.6    # negative-binomial k for urban segments (HSM order of magnitude)
BLACKSPOT_RADIUS = 250.0   # MoRTH blackspot = 500 m stretch → ±250 m
BLACKSPOT_SIGMA = 150.0    # Gaussian decay of the blackspot effect [m]

IMPORTANCE = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4,
              "unclassified": 5, "residential": 6, "living_street": 7}


def importance(cls: str) -> float:
    base = cls.replace("_link", "")
    return IMPORTANCE[base] + (0.5 if cls.endswith("_link") else 0)


class Projector:
    """Local equirectangular projection in metres (error < 0.1 % at city scale)."""

    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = math.radians(lat0), math.radians(lon0)
        self.kx = EARTH_R * math.cos(self.lat0)

    def __call__(self, lat, lon):
        lat, lon = np.radians(np.asarray(lat, float)), np.radians(np.asarray(lon, float))
        return np.stack([(lon - self.lon0) * self.kx, (lat - self.lat0) * EARTH_R], axis=-1)


def parse_speed(v: str | None):
    if not v:
        return None
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s*(mph)?", v)
    if not m:
        return None
    s = float(m.group(1)) * (1.609 if m.group(2) else 1.0)
    return s if 5 <= s <= 130 else None


def parse_int(v: str | None):
    try:
        return int(float(v.split(";")[0])) if v else None
    except ValueError:
        return None


def period_years(p: str) -> float:
    m = re.match(r"(\d{4})-(\d{4})", p)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return max(1.0, b - a + (0.5 if b >= 2026 else 1.0))
    return 1.5


# ---------------------------------------------------------------------------
def load_raw(region):
    d = RAW_DIR / region
    roads = json.loads((d / "roads.json").read_text(encoding="utf-8"))["elements"]
    pois = json.loads((d / "pois.json").read_text(encoding="utf-8"))["elements"]
    nl = np.load(d / "nightlights.npz")
    return roads, pois, nl


def split_ways(roads):
    nodes = {e["id"]: e for e in roads if e["type"] == "node"}
    ways = [e for e in roads if e["type"] == "way" and e.get("tags", {}).get("highway") in M.CLASS_ID]
    use = Counter()
    for w in ways:
        nds = [n for n in w["nodes"] if n in nodes]
        w["nodes"] = nds
        use.update(nds)
        if nds:
            use[nds[0]] += 1
            use[nds[-1]] += 1
    is_vertex = {n for n, c in use.items() if c >= 2}

    segments = []
    for w in ways:
        nds = w["nodes"]
        if len(nds) < 2:
            continue
        start = 0
        for i in range(1, len(nds)):
            if nds[i] in is_vertex or i == len(nds) - 1:
                if nds[i] != nds[start]:
                    segments.append((w, nds[start:i + 1]))
                start = i
    return nodes, segments


def way_attrs(tags):
    cls = tags["highway"]
    ow = tags.get("oneway", "no")
    junction = tags.get("junction", "")
    oneway = 1 if ow in ("yes", "true", "1") else (-1 if ow == "-1" else 0)
    if oneway == 0 and (cls in ("motorway", "motorway_link") or junction in ("roundabout", "circular")):
        oneway = 1
    maxspeed = parse_speed(tags.get("maxspeed"))
    lanes = parse_int(tags.get("lanes"))
    surface = tags.get("surface", "")
    return {
        "cls": M.CLASS_ID[cls], "oneway": oneway, "maxspeed": maxspeed, "lanes": lanes or 0,
        "lit": {"yes": 1, "24/7": 1, "automatic": 1, "no": 0}.get(tags.get("lit", ""), -1),
        "unpaved": surface in ("unpaved", "dirt", "gravel", "ground", "sand", "earth", "mud", "compacted"),
        "bridge": tags.get("bridge", "no") not in ("no", ""),
        "roundabout": junction in ("roundabout", "circular"),
        "sidewalk": {"both": 1, "left": 1, "right": 1, "yes": 1, "separate": 1, "no": 0, "none": 0}.get(tags.get("sidewalk", ""), -1),
        "name": tags.get("name:en") or tags.get("name") or tags.get("ref") or "",
        "ref": tags.get("ref", ""),
    }


def poi_points(pois):
    """Classify POIs → {category: [(lat, lon, name)]}."""
    cats = defaultdict(list)
    activity_amen = {"restaurant", "cafe", "fast_food", "bank", "atm", "pharmacy", "fuel", "school",
                     "college", "university", "cinema", "theatre", "marketplace", "place_of_worship",
                     "library", "townhall", "courthouse", "post_office", "bus_station"}
    for e in pois:
        t = e.get("tags", {})
        if e["type"] == "node":
            lat, lon = e["lat"], e["lon"]
        elif "center" in e:
            lat, lon = e["center"]["lat"], e["center"]["lon"]
        else:
            continue
        name = t.get("name:en") or t.get("name") or ""
        a = t.get("amenity")
        if t.get("highway") == "street_lamp":
            cats["lamp"].append((lat, lon, ""))
        if a == "police":
            cats["police"].append((lat, lon, name or "Police station"))
        if a == "hospital" or t.get("healthcare") == "hospital":
            cats["hospital"].append((lat, lon, name or "Hospital"))
        if a == "clinic":
            cats["clinic"].append((lat, lon, name))
        if a == "fire_station":
            cats["fire"].append((lat, lon, name or "Fire station"))
        if t.get("man_made") == "surveillance":
            cats["cctv"].append((lat, lon, ""))
        if t.get("highway") == "bus_stop":
            cats["bus_stop"].append((lat, lon, name))
        if "shop" in t or a in activity_amen or "office" in t or "tourism" in t or "leisure" in t:
            cats["activity"].append((lat, lon, name))
    return cats


def gazetteer(pois, seg_names, seg_mid_ll):
    out, seen = [], set()
    kind_of = [("railway", "station", "Railway station"), ("aeroway", "aerodrome", "Airport"),
               ("amenity", "university", "University"), ("amenity", "college", "College"),
               ("amenity", "hospital", "Hospital"), ("amenity", "police", "Police"),
               ("amenity", "bus_station", "Bus station"), ("tourism", None, "Attraction"),
               ("leisure", None, "Park"), ("shop", "mall", "Mall"), ("amenity", "school", "School"),
               ("place", None, "Area"), ("amenity", None, "Place"), ("shop", None, "Shop"),
               ("office", None, "Office")]
    for e in pois:
        t = e.get("tags", {})
        name = t.get("name:en") or t.get("name")
        if not name:
            continue
        if e["type"] == "node":
            lat, lon = e["lat"], e["lon"]
        elif "center" in e:
            lat, lon = e["center"]["lat"], e["center"]["lon"]
        else:
            continue
        kind = None
        for k, v, label in kind_of:
            if k in t and (v is None or t[k] == v):
                kind = label
                break
        key = (name.lower(), round(lat, 3), round(lon, 3))
        if kind and key not in seen:
            seen.add(key)
            out.append({"name": name, "kind": kind, "lat": round(lat, 6), "lon": round(lon, 6)})
    # Roads: one entry per name at the midpoint of its longest segment.
    best = {}
    for name, (lat, lon, L) in zip(seg_names, seg_mid_ll):
        if name and (name not in best or L > best[name][2]):
            best[name] = (lat, lon, L)
    for name, (lat, lon, L) in best.items():
        if L > 150:
            out.append({"name": name, "kind": "Road", "lat": round(lat, 6), "lon": round(lon, 6)})
    return out


def sample_raster(nl, lat, lon):
    arr, (s, w, n, e) = nl["nli"], nl["bbox"]
    h, wd = arr.shape
    fy = (n - np.asarray(lat)) / (n - s) * (h - 1)
    fx = (np.asarray(lon) - w) / (e - w) * (wd - 1)
    y0 = np.clip(np.floor(fy).astype(int), 0, h - 2)
    x0 = np.clip(np.floor(fx).astype(int), 0, wd - 2)
    dy, dx = np.clip(fy - y0, 0, 1), np.clip(fx - x0, 0, 1)
    return (arr[y0, x0] * (1 - dx) * (1 - dy) + arr[y0, x0 + 1] * dx * (1 - dy)
            + arr[y0 + 1, x0] * (1 - dx) * dy + arr[y0 + 1, x0 + 1] * dx * dy)


# ---------------------------------------------------------------------------
def build(region: str):
    print(f"[{region}] loading raw data")
    roads, pois, nl = load_raw(region)
    nodes, segments = split_ways(roads)
    s, w, n, e = REGIONS[region]["bbox"]
    proj = Projector((s + n) / 2, (w + e) / 2)

    # ---- segments (undirected) -------------------------------------------
    seg_attr, seg_coords, seg_off, seg_u, seg_v, seg_len = [], [], [0], [], [], []
    for way, nds in segments:
        ll = np.array([(nodes[i]["lat"], nodes[i]["lon"]) for i in nds])
        xy = proj(ll[:, 0], ll[:, 1])
        L = float(np.sum(np.hypot(*np.diff(xy, axis=0).T)))
        if L < 0.5:
            continue
        seg_attr.append(way_attrs(way["tags"]))
        seg_coords.append(ll)
        seg_off.append(seg_off[-1] + len(ll))
        seg_u.append(nds[0]); seg_v.append(nds[-1]); seg_len.append(L)
    S = len(seg_attr)
    seg_len = np.array(seg_len)
    coords = np.concatenate(seg_coords).astype(np.float64)
    seg_off = np.array(seg_off, dtype=np.int64)
    print(f"[{region}] {S} segments")

    # ---- largest strongly connected component (car) -----------------------
    osm_ids = np.unique(np.concatenate([seg_u, seg_v]))
    idx = {int(o): i for i, o in enumerate(osm_ids)}
    su = np.array([idx[u] for u in seg_u]); sv = np.array([idx[v] for v in seg_v])
    ow = np.array([a["oneway"] for a in seg_attr])
    fwd, bwd = ow >= 0, ow <= 0
    rows = np.concatenate([su[fwd], sv[bwd]]); cols = np.concatenate([sv[fwd], su[bwd]])
    G = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(osm_ids),) * 2).tocsr()
    _, lab = connected_components(G, directed=True, connection="strong")
    keep_lab = np.bincount(lab).argmax()
    keep_node = lab == keep_lab
    seg_keep = keep_node[su] & keep_node[sv]
    old_to_new = -np.ones(len(osm_ids), dtype=np.int64)
    old_to_new[keep_node] = np.arange(keep_node.sum())
    node_osm = osm_ids[keep_node]
    N = len(node_osm)
    print(f"[{region}] largest SCC: {N} nodes ({keep_node.mean():.1%}), {seg_keep.sum()} segments")

    seg_ids = np.nonzero(seg_keep)[0]
    seg_attr = [seg_attr[i] for i in seg_ids]
    seg_len = seg_len[seg_ids]
    new_coords, new_off = [], [0]
    for i in seg_ids:
        c = coords[seg_off[i]:seg_off[i + 1]]
        new_coords.append(c); new_off.append(new_off[-1] + len(c))
    coords = np.concatenate(new_coords); seg_off = np.array(new_off, dtype=np.int64)
    su, sv = old_to_new[su[seg_ids]], old_to_new[sv[seg_ids]]
    S = len(seg_ids)

    node_ll = np.array([(nodes[int(o)]["lat"], nodes[int(o)]["lon"]) for o in node_osm])
    node_xy = proj(node_ll[:, 0], node_ll[:, 1])

    A = {k: np.array([a[k] for a in seg_attr]) for k in seg_attr[0] if k not in ("name", "ref")}
    cls = A["cls"].astype(np.int64)
    cls_names = [M.CLASSES[c] for c in cls]
    speed = np.where(np.array([a["maxspeed"] or 0 for a in seg_attr]) > 0,
                     np.array([a["maxspeed"] or 0 for a in seg_attr], float), M.DEFAULT_SPEED[cls])
    speed = np.minimum(speed, M.DEFAULT_SPEED[cls] * 1.25)

    # ---- sample points along segments for spatial joins -------------------
    samp_xy, samp_seg = [], []
    for i in range(S):
        c = coords[seg_off[i]:seg_off[i + 1]]
        xy = proj(c[:, 0], c[:, 1])
        for a, b in zip(xy[:-1], xy[1:]):
            k = max(1, int(np.hypot(*(b - a)) // 20))
            t = np.linspace(0, 1, k + 1)[:-1, None]
            samp_xy.append(a + t * (b - a)); samp_seg.append(np.full(k, i))
        samp_xy.append(xy[-1:]); samp_seg.append(np.array([i]))
    samp_xy = np.concatenate(samp_xy); samp_seg = np.concatenate(samp_seg)
    stree = cKDTree(samp_xy)
    mid_ll = np.array([coords[(seg_off[i] + seg_off[i + 1] - 1) // 2] for i in range(S)])
    mid_xy = proj(mid_ll[:, 0], mid_ll[:, 1])

    cats = poi_points(pois)

    def per_segment_count(cat, radius):
        pts = cats.get(cat, [])
        if not pts:
            return np.zeros(S)
        xy = proj([p[0] for p in pts], [p[1] for p in pts])
        d, j = stree.query(xy, distance_upper_bound=radius)
        ok = np.isfinite(d)
        return np.bincount(samp_seg[j[ok]], minlength=S).astype(float)

    def nearest_dist(cat):
        pts = cats.get(cat, [])
        if not pts:
            return np.full(S, 5000.0)
        t = cKDTree(proj([p[0] for p in pts], [p[1] for p in pts]))
        return t.query(mid_xy)[0]

    per100 = 100.0 / np.maximum(seg_len, 20.0)
    lamps = per_segment_count("lamp", 30) * per100
    act_poi = 1 - np.exp(-per_segment_count("activity", 60) * per100 / 1.5)
    bus_stops = per_segment_count("bus_stop", 25)
    cctv = (per_segment_count("cctv", 80) > 0).astype(float)
    police_d = nearest_dist("police")
    hosp_d = nearest_dist("hospital")
    nli = sample_raster(nl, mid_ll[:, 0], mid_ll[:, 1])
    activity = 1 - (1 - act_poi) * (1 - 0.6 * nli)

    lit_tag = A["lit"]
    p_lit = np.clip(0.25 * M.LIT_PRIOR[cls] + 0.75 * nli, 0, 1)
    p_lit = np.where(lamps >= 1.0, np.maximum(p_lit, 0.9), p_lit)
    p_lit = np.where(lit_tag == 1, 0.97, np.where(lit_tag == 0, 0.03, p_lit))

    divided = (A["oneway"] != 0) & np.isin(cls, [M.CLASS_ID[c] for c in ("trunk", "primary", "secondary", "motorway")])
    cmf_static = (np.where(divided, M.CMF_DIVIDED, 1.0) * np.where(A["unpaved"], M.CMF_UNPAVED, 1.0)
                  * np.where(A["bridge"], M.CMF_BRIDGE, 1.0) * (M.CMF_BUS_STOP ** np.minimum(bus_stops, 3))
                  * (1 + (M.CMF_ACTIVITY_MAX - 1) * act_poi))
    calming_nodes = {o for o, nd in nodes.items() if nd.get("tags", {}).get("traffic_calming")}
    # traffic calming on a segment: any calming-tagged node inside it
    if calming_nodes:
        seg_calm_osm = set()
        for way, nds in segments:
            if any(nd in calming_nodes for nd in nds[1:-1]):
                seg_calm_osm.add((nds[0], nds[-1]))
        seg_calm = np.array([(int(node_osm[a]), int(node_osm[b])) in seg_calm_osm for a, b in zip(su, sv)])
        cmf_static = cmf_static * np.where(seg_calm, M.CMF_TRAFFIC_CALMING, 1.0)

    freq = M.BASE_FREQUENCY[cls] * cmf_static          # crash frequency per vkm (relative)

    # ---- junctions --------------------------------------------------------
    nbrs = defaultdict(set); node_best = defaultdict(list); node_round = np.zeros(N, bool)
    node_speed = np.zeros(N)
    for i in range(S):
        a, b = su[i], sv[i]
        nbrs[a].add(b); nbrs[b].add(a)
        node_best[a].append(cls_names[i]); node_best[b].append(cls_names[i])
        node_speed[a] = max(node_speed[a], speed[i]); node_speed[b] = max(node_speed[b], speed[i])
        if seg_attr[i]["roundabout"]:
            node_round[a] = node_round[b] = True
    degree = np.array([len(nbrs[i]) for i in range(N)])

    sig_pts = [(nd["lat"], nd["lon"]) for nd in nodes.values() if nd.get("tags", {}).get("highway") == "traffic_signals"]
    sig_tagged = np.zeros(N, bool)
    if sig_pts:
        sig_tagged = cKDTree(proj(*np.array(sig_pts).T)).query(node_xy, distance_upper_bound=35)[0] < 35
    stopgw = np.array([nodes[int(o)].get("tags", {}).get("highway") in ("stop", "give_way") for o in node_osm])

    p_signal = np.zeros(N); minor_aadt = np.zeros(N); enter_aadt = np.zeros(N)
    for v in range(N):
        cl = sorted(node_best[v], key=importance)
        if len(cl) >= 2:
            second = cl[1]
            p_signal[v] = 1.0 if sig_tagged[v] else M.SIGNAL_PRIOR[M.CLASS_ID[second]]
            minor_aadt[v] = M.AADT_PROXY[M.CLASS_ID[second]]
        enter_aadt[v] = sum(M.AADT_PROXY[M.CLASS_ID[c]] for c in cl) / 2
    p_signal = np.where(node_round, 0.0, p_signal)
    arms = np.where(degree >= 5, M.ARMS_FACTOR_5PLUS, np.where(degree == 4, M.ARMS_FACTOR[4], M.ARMS_FACTOR[3]))
    ctrl = p_signal * M.CMF_SIGNAL + (1 - p_signal) * np.where(node_round, M.CMF_ROUNDABOUT, np.where(stopgw, M.CMF_STOP_GIVEWAY, 1.0))
    jfreq = np.where(degree >= 3, arms * ctrl * (np.maximum(minor_aadt, 300) / 1000.0) ** 0.35, 0.0)
    jspeed = np.minimum(node_speed, 60.0)

    # ---- calibration to MoRTH city crash totals ---------------------------
    aadt = M.AADT_PROXY[cls]
    link_exposure = freq * (seg_len / 1000) * aadt * 365 / 1e6
    junction_exposure = jfreq * enter_aadt * 365 / 1e6
    total = REGION_ANNUAL_ACCIDENTS[region]
    kJ_rel = (JUNCTION_SHARE / (1 - JUNCTION_SHARE)) * link_exposure.sum() / max(junction_exposure.sum(), 1e-9)
    scale = total / (link_exposure.sum() + kJ_rel * junction_exposure.sum())
    k_link, k_junction = scale, scale * kJ_rel
    N_link = k_link * link_exposure                 # predicted crashes / year per segment
    N_junc = k_junction * junction_exposure         # predicted crashes / year per node
    print(f"[{region}] calibrated: k_link={k_link:.3f}, k_junction={k_junction:.3f} -> {N_link.sum() + N_junc.sum():.0f} crashes/yr")

    # ---- Empirical-Bayes blackspot adjustment -----------------------------
    seg_bs = np.ones(S); node_bs = np.ones(N); seg_bs_id = np.full(S, -1)
    bs_all = json.loads((DATASETS_DIR / "blackspots.json").read_text(encoding="utf-8"))
    bs_out = []
    ntree = cKDTree(node_xy)
    for b in (x for x in bs_all if x["region"] == region):
        bxy = proj(b["lat"], b["lon"])
        near_samples = stree.query_ball_point(bxy, BLACKSPOT_RADIUS)
        segs_in = np.unique(samp_seg[near_samples]) if near_samples else np.array([], int)
        frac = np.array([np.mean(np.hypot(*(samp_xy[samp_seg == sg] - bxy).T) <= BLACKSPOT_RADIUS) for sg in segs_in]) if len(segs_in) else np.array([])
        nodes_in = ntree.query_ball_point(bxy, BLACKSPOT_RADIUS)
        n_pred = float(np.sum(N_link[segs_in] * frac) + np.sum(N_junc[nodes_in])) if len(segs_in) else 0.0
        years = period_years(b["period"])
        obs = b["accidents"] if b["accidents"] is not None else b["deaths"]
        if obs is None or n_pred <= 0:
            mult, n_obs, n_eb, wgt = 1.5, None, None, None
        else:
            n_obs = obs / years
            wgt = 1.0 / (1.0 + EB_OVERDISPERSION * n_pred * years)
            n_eb = wgt * n_pred + (1 - wgt) * n_obs
            mult = float(np.clip(n_eb / n_pred, 1.0, 8.0))
            if b["deaths"] and b["accidents"]:
                mult *= float(np.clip((b["deaths"] / b["accidents"]) / M.FATAL_SHARE, 0.7, 2.0) ** 0.5)
            mult = max(mult, 1.0)   # an officially listed blackspot is never treated as safer than predicted
        d_seg = np.full(S, np.inf)
        near = stree.query_ball_point(bxy, 2.7 * BLACKSPOT_SIGMA)
        if near:
            dd = np.hypot(*(samp_xy[near] - bxy).T)
            np.minimum.at(d_seg, samp_seg[near], dd)
        m_seg = 1 + (mult - 1) * np.exp(-d_seg ** 2 / (2 * BLACKSPOT_SIGMA ** 2))
        upd = m_seg > seg_bs
        seg_bs_id[upd & (m_seg > 1.05)] = len(bs_out)
        seg_bs = np.maximum(seg_bs, m_seg)
        d_node = np.hypot(*(node_xy - bxy).T)
        node_bs = np.maximum(node_bs, 1 + (mult - 1) * np.exp(-d_node ** 2 / (2 * BLACKSPOT_SIGMA ** 2)))
        bs_out.append({**b, "n_pred_per_year": round(n_pred, 3), "n_obs_per_year": None if n_obs is None else round(n_obs, 3),
                       "n_eb_per_year": None if n_eb is None else round(n_eb, 3), "eb_weight": None if wgt is None else round(wgt, 3),
                       "risk_multiplier": round(mult, 2), "years": years})
        print(f"    blackspot {b['id']:7s} pred={n_pred:5.2f}/yr obs={n_obs if n_obs is None else round(n_obs, 2)}/yr -> x{mult:.2f}")

    # ---- directed edges -----------------------------------------------------
    e_src, e_dst, e_seg, e_rev, e_car = [], [], [], [], []
    for i in range(S):
        o = seg_attr[i]["oneway"]
        e_src.append(su[i]); e_dst.append(sv[i]); e_seg.append(i); e_rev.append(False); e_car.append(o >= 0)
        e_src.append(sv[i]); e_dst.append(su[i]); e_seg.append(i); e_rev.append(True); e_car.append(o <= 0)
    e_src, e_dst, e_seg = map(np.array, (e_src, e_dst, e_seg))
    e_rev, e_car = np.array(e_rev), np.array(e_car)
    e_walk = ~np.isin(cls[e_seg], [M.CLASS_ID["motorway"], M.CLASS_ID["motorway_link"]])

    # edge bearings (start / end) for turn instructions
    def bearing(p, q):
        dlon = math.radians(q[1] - p[1]); la1, la2 = math.radians(p[0]), math.radians(q[0])
        y = math.sin(dlon) * math.cos(la2); x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlon)
        return (math.degrees(math.atan2(y, x)) + 360) % 360
    b_start = np.zeros(len(e_seg)); b_end = np.zeros(len(e_seg))
    for k, (sg, rv) in enumerate(zip(e_seg, e_rev)):
        c = coords[seg_off[sg]:seg_off[sg + 1]]
        if rv:
            c = c[::-1]
        b_start[k] = bearing(c[0], c[1]); b_end[k] = bearing(c[-2], c[-1])

    names = sorted({a["name"] for a in seg_attr})
    name_id = {nm: i for i, nm in enumerate(names)}
    seg_name = np.array([name_id[a["name"]] for a in seg_attr])

    out = DATA_DIR / region
    out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out / "graph.npz",
        node_lat=node_ll[:, 0], node_lon=node_ll[:, 1], node_x=node_xy[:, 0], node_y=node_xy[:, 1],
        node_degree=degree, node_p_signal=p_signal, node_roundabout=node_round, node_jfreq=jfreq,
        node_jspeed=jspeed, node_bs=node_bs, node_N=N_junc, node_enter_aadt=enter_aadt,
        seg_len=seg_len, seg_cls=cls, seg_speed=speed, seg_freq=freq, seg_p_lit=p_lit, seg_nli=nli,
        seg_activity=activity, seg_police_d=police_d, seg_hosp_d=hosp_d, seg_cctv=cctv, seg_lamps=lamps,
        seg_unpaved=A["unpaved"], seg_bridge=A["bridge"], seg_divided=divided, seg_sidewalk=A["sidewalk"],
        seg_lanes=A["lanes"], seg_bs=seg_bs, seg_bs_id=seg_bs_id, seg_N=N_link, seg_name=seg_name,
        seg_off=seg_off, coords=coords.astype(np.float32),
        edge_src=e_src, edge_dst=e_dst, edge_seg=e_seg, edge_rev=e_rev, edge_car=e_car, edge_walk=e_walk,
        edge_b_start=b_start.astype(np.float32), edge_b_end=b_end.astype(np.float32),
    )
    meta = {
        "region": region, "name": REGIONS[region]["name"], "bbox": REGIONS[region]["bbox"],
        "nodes": int(N), "segments": int(S), "edges": int(len(e_seg)),
        "km": round(float(seg_len.sum() / 1000), 1),
        "calibration": {"annual_accidents": total, "k_link": k_link, "k_junction": k_junction,
                        "junction_share": JUNCTION_SHARE},
        "coverage": {"osm_lit_tag": float(np.mean(lit_tag >= 0)), "osm_maxspeed": float(np.mean([a['maxspeed'] is not None for a in seg_attr])),
                     "signals_tagged": int(sig_tagged.sum()), "street_lamps": len(cats.get("lamp", [])),
                     "police": len(cats.get("police", [])), "hospitals": len(cats.get("hospital", [])),
                     "cctv": len(cats.get("cctv", []))},
        "names": names,
        "proj_center": [(s + n) / 2, (w + e) / 2],
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    layers = {
        "police": [{"lat": p[0], "lon": p[1], "name": p[2]} for p in cats.get("police", [])],
        "hospital": [{"lat": p[0], "lon": p[1], "name": p[2]} for p in cats.get("hospital", [])],
        "fire": [{"lat": p[0], "lon": p[1], "name": p[2]} for p in cats.get("fire", [])],
        "cctv": [{"lat": p[0], "lon": p[1]} for p in cats.get("cctv", [])],
        "blackspots": bs_out,
    }
    (out / "layers.json").write_text(json.dumps(layers, ensure_ascii=False), encoding="utf-8")
    seg_names_str = [a["name"] for a in seg_attr]
    places = gazetteer(pois, seg_names_str, [(mid_ll[i, 0], mid_ll[i, 1], seg_len[i]) for i in range(S)])
    (out / "places.json").write_text(json.dumps(places, ensure_ascii=False), encoding="utf-8")
    print(f"[{region}] done: {N} nodes, {len(e_seg)} edges, {meta['km']} km, {len(places)} places")


if __name__ == "__main__":
    for r in sys.argv[1:] or REGIONS:
        build(r)
