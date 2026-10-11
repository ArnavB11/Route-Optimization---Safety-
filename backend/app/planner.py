"""Route planning on top of the engine: fastest vs safest, detour cap, Pareto set."""
from __future__ import annotations

import math
import time

import numpy as np

from . import model as M
from .directions import directions
from .engine import Path, RegionGraph, RouteError

SCORE_AT_REFERENCE = 70.0   # a route with traffic-weighted average risk per km scores 70/100
PARETO_LAMBDAS = (0.0, 0.25, 0.5, 0.7, 0.85, 0.95)


def safety_score(risk_per_km: float, ref_per_km: float) -> float:
    """Route Safety Index: 100·exp(−ln(100/70) · r/r̄); 70 = average road."""
    return float(100.0 * math.exp(-math.log(100.0 / SCORE_AT_REFERENCE) * risk_per_km / max(ref_per_km, 1e-15)))


def score_label(s: float) -> str:
    return "Lower risk" if s >= 72 else "Moderate" if s >= 60 else "Higher risk"


class Planner:
    def __init__(self, g: RegionGraph):
        self.g = g

    def plan(self, o_lat, o_lon, d_lat, d_lon, mode="car", hour=9.0,
             safety_weight=0.7, max_detour=0.25, alternatives=True):
        t_start = time.perf_counter()
        g = self.g
        if mode not in ("car", "two_wheeler", "walk"):
            raise RouteError(f"Unknown mode '{mode}'")
        src, ds = g.snap(o_lat, o_lon, mode)
        dst, dd = g.snap(d_lat, d_lon, mode)
        if max(ds, dd) > 1500:
            raise RouteError("A point is too far from the road network")
        if src == dst:
            raise RouteError("Origin and destination snap to the same place")
        c = g.costs(mode, hour)
        lg = g.lg[mode]
        vmax = (M.WALK_SPEED if mode == "walk" else float(g.e_speed[lg.allowed].max())) / 3.6
        L = g.e_len
        rmin = float(np.min(c.edge_risk[lg.allowed] / np.maximum(L[lg.allowed], 1.0)))

        # 1) fastest: pure travel time, h = distance / v_max
        fast = g.astar(src, dst, mode, c.edge_time, c.trans_time, 1.0 / vmax)
        T0, D0, R0 = g.totals(fast, c)

        def weights(lam):
            return g.weights(c, 0.0, 1 - lam, lam, D0, T0, R0)

        def h_coef(lam):
            return (1 - lam) / (vmax * T0) + lam * rmin / R0

        # 2) safest under the detour cap. Minimise λ·R/R₀ + (1−λ)·T/T₀. If the
        #    trip exceeds (1+τ)·T₀, bisect λ downwards (Lagrangian relaxation of
        #    the time budget) using the fast C Dijkstra, then re-solve with A*.
        lam = float(np.clip(safety_weight, 0.0, 1.0))
        capped = False
        safe = g.astar(src, dst, mode, *weights(lam), h_coef(lam))
        if g.totals(safe, c)[0] > (1 + max_detour) * T0:
            capped = True
            lo, hi = 0.0, lam
            for _ in range(6):
                mid = (lo + hi) / 2
                p = g.dijkstra(src, dst, mode, *weights(mid))
                if g.totals(p, c)[0] <= (1 + max_detour) * T0:
                    lo = mid
                else:
                    hi = mid
            lam = lo
            safe = g.astar(src, dst, mode, *weights(lam), h_coef(lam)) if lam > 0 else fast

        routes = {
            "fastest": self.summary(fast, c, mode),
            "safest": self.summary(safe, c, mode),
        }
        if alternatives:
            shortest = g.astar(src, dst, mode, L.astype(float), np.zeros(lg.n_trans), 1.0)
            routes["shortest"] = self.summary(shortest, c, mode)
        routes["safest"]["lambda"] = lam

        # Pareto front (time vs risk) sampled over λ; the "balanced" route is
        # its knee: the point farthest from the fastest→safest chord in
        # normalised (T/T₀, R/R₀) space, i.e. the best risk cut per minute.
        pareto, paths = [], {}
        if alternatives:
            Ts, _, Rs = g.totals(safe, c)
            for l in sorted(set(PARETO_LAMBDAS) | {round(lam, 3)}):
                p = fast if l == 0 else safe if l == round(lam, 3) else g.dijkstra(src, dst, mode, *weights(l))
                key = tuple(p.edges)
                if key in paths:
                    continue
                paths[key] = p
                T, D, R = g.totals(p, c)
                pareto.append({"lambda": l, "time_s": T, "distance_m": D, "risk": R, "key": key,
                               "score": round(safety_score(R / (D / 1000), c.ref_risk_per_km), 1)})
            pareto = [p for p in pareto if not any(
                (q["time_s"] <= p["time_s"] and q["risk"] < p["risk"]) or
                (q["time_s"] < p["time_s"] and q["risk"] <= p["risk"]) for q in pareto)]
            pareto.sort(key=lambda p: p["time_s"])
            x1, y1, x2, y2 = 1.0, 1.0, Ts / T0, Rs / R0
            best, best_d = None, 0.02
            for p in pareto:
                x, y = p["time_s"] / T0, p["risk"] / R0
                if not (T0 < p["time_s"] < Ts):
                    continue
                d = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / math.hypot(x2 - x1, y2 - y1)
                if d > best_d:
                    best, best_d = p, d
            if best is not None:
                routes["balanced"] = self.summary(paths[best["key"]], c, mode)
                routes["balanced"]["lambda"] = best["lambda"]
                best["balanced"] = True
            for p in pareto:
                p.pop("key")

        f, s = routes["fastest"], routes["safest"]
        comparison = {
            "time_delta_s": s["time_s"] - f["time_s"],
            "time_delta_pct": 100 * (s["time_s"] / f["time_s"] - 1),
            "distance_delta_m": s["distance_m"] - f["distance_m"],
            "risk_reduction_pct": 100 * (1 - s["risk"] / f["risk"]) if f["risk"] > 0 else 0.0,
            "score_delta": round(s["score"] - f["score"], 1),
            "blackspots_avoided": len(set(f["blackspot_ids"]) - set(s["blackspot_ids"])),
            "unlit_km_delta": s["exposure"]["unlit_km"] - f["exposure"]["unlit_km"],
            "right_turns_delta": s["exposure"]["right_turns"] - f["exposure"]["right_turns"],
            "same_route": f["edge_hash"] == s["edge_hash"],
            "detour_capped": capped,
            "max_detour": max_detour,
        }
        for r in routes.values():
            r.pop("edge_hash")
        return {
            "region": g.region, "mode": mode, "hour": hour, "is_dark": c.dark > 0.5,
            "snap_distance_m": [round(ds), round(dd)],
            "reference_risk_per_km": c.ref_risk_per_km,
            "routes": routes, "pareto": pareto, "comparison": comparison,
            "stats": {"fastest_expanded": fast.expanded, "safest_expanded": safe.expanded,
                      "compute_ms": round(1000 * (time.perf_counter() - t_start))},
        }

    # ------------------------------------------------------------------
    def summary(self, path: Path, c, mode):
        g, a = self.g, self.g.a
        lg = g.lg[mode]
        e = np.asarray(path.edges, dtype=np.int64)
        t = np.asarray(path.trans, dtype=np.int64)
        seg = a["edge_seg"][e]
        L = g.e_len[e]
        T, D, R = g.totals(path, c)
        km = D / 1000.0

        # risk of each edge incl. the junction manoeuvre that *enters* it
        r_edge = c.edge_risk[e].copy()
        if len(t):
            r_edge[1:] += c.trans_risk[t]
        # Junction risk sits on short edges, so per-edge risk/km is spiky.
        # Smooth with a moving window over the cumulative risk curve.
        cum_d = np.concatenate([[0.0], np.cumsum(L)])
        cum_r = np.concatenate([[0.0], np.cumsum(r_edge)])
        half = max(150.0, min(400.0, D / 60))

        def window_rel(x):
            a, b = np.clip(x - half, 0, D), np.clip(x + half, 0, D)
            span = np.maximum(b - a, 1.0)
            return (np.interp(b, cum_d, cum_r) - np.interp(a, cum_d, cum_r)) / (span / 1000.0) / c.ref_risk_per_km

        rel = window_rel((cum_d[:-1] + cum_d[1:]) / 2)
        levels = np.digitize(rel, [0.6, 1.0, 1.6, 2.5])     # 0 very low … 4 very high
        xs = np.linspace(0, D, 121)
        profile = [[round(float(x) / 1000, 3), round(float(v), 3)] for x, v in zip(xs, window_rel(xs))]

        coords_all, runs = [], []
        for k, (sg, rv) in enumerate(zip(seg, a["edge_rev"][e])):
            pts = a["coords"][a["seg_off"][sg]:a["seg_off"][sg + 1]]
            pts = pts[::-1] if rv else pts
            pts = [[round(float(p[1]), 6), round(float(p[0]), 6)] for p in pts]
            lvl = int(levels[k])
            if runs and runs[-1]["level"] == lvl:
                runs[-1]["coords"].extend(pts[1:])
            else:
                runs.append({"level": lvl, "coords": pts})
            coords_all.extend(pts if not coords_all else pts[1:])

        tn = lg.t_node[t] if len(t) else np.array([], dtype=np.int64)
        is_j = a["node_degree"][tn] >= 3 if len(t) else np.array([], bool)
        ttype = lg.t_type[t] if len(t) else np.array([], np.int8)
        p_sig = a["node_p_signal"][tn] if len(t) else np.array([])
        p_lit = a["seg_p_lit"][seg]
        bs_ids = sorted({int(i) for i in a["seg_bs_id"][seg] if i >= 0})
        bs_info = [g.layers["blackspots"][i] for i in bs_ids]
        arterial_ids = [M.CLASS_ID[x] for x in M.ARTERIAL]
        hosp_d = a["seg_hosp_d"][seg]
        parts = {k: float(v[e].sum() + (c.parts_trans[k][t].sum() if len(t) else 0.0)) for k, v in c.parts_edge.items()}
        score = safety_score(R / max(km, 1e-6), c.ref_risk_per_km)
        crash = parts["road"] + parts["lighting"] + parts["blackspot"]
        return {
            "distance_m": D, "time_s": T, "risk": R, "risk_per_km": R / max(km, 1e-6),
            "relative_risk": R / max(km, 1e-6) / c.ref_risk_per_km,
            "score": round(score, 1), "label": score_label(score),
            "crashes_per_million_trips": round(1e6 * crash, 2) if mode != "walk" else None,
            "breakdown": {k: (v / R if R > 0 else 0) for k, v in parts.items()},
            "geometry": coords_all,
            "runs": runs,
            "profile": profile,
            "exposure": {
                "unlit_km": float(np.sum(L * (1 - p_lit)) / 1000) if c.dark > 0 else 0.0,
                "lit_share": float(np.sum(L * p_lit) / max(D, 1)),
                "arterial_share": float(np.sum(L[np.isin(g.e_cls[e], arterial_ids)]) / max(D, 1)),
                "junctions": int(is_j.sum()),
                "signalised_junctions": int(np.sum(is_j & (p_sig >= 0.5))),
                "uncontrolled_junctions": int(np.sum(is_j & (p_sig < 0.5))),
                "right_turns": int(np.sum(is_j & (ttype == M.TURN_RIGHT))),
                "left_turns": int(np.sum(is_j & (ttype == M.TURN_LEFT))),
                "max_speed_kmh": float(g.e_speed[e].max()),
                "max_hospital_km": float(hosp_d.max() / 1000),
                "mean_hospital_km": float(np.average(hosp_d, weights=L) / 1000),
                "police_within_1km_share": float(np.sum(L[a["seg_police_d"][seg] < 1000]) / max(D, 1)),
                "high_risk_km": float(np.sum(L[rel >= 1.6]) / 1000),
            },
            "blackspot_ids": [b["id"] for b in bs_info],
            "blackspots": [{"id": b["id"], "name": b["name"], "accidents": b["accidents"], "deaths": b["deaths"],
                            "lat": b["lat"], "lon": b["lon"]} for b in bs_info],
            "directions": directions(g, path, c, mode),
            "edge_hash": hash(tuple(path.edges)),
        }
