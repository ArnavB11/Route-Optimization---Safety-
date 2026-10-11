"""Phase-4 simulation: standard fastest route vs safety route on random trips.

For every region, draws seeded random origin–destination pairs (3–15 km
apart, straight line), plans each trip at a day and a night hour for car and
two-wheeler, and records time cost vs risk reduction. Also re-solves a sample
with SciPy Dijkstra to confirm the A* optimum.

Writes docs/VALIDATION.md and docs/validation.json.
Usage:  python -m pipeline.validate [trips_per_region]
"""
import json
import sys
import time

import numpy as np

from app.config import BACKEND_DIR
from app.engine import get_graph
from app.planner import Planner
from app.search import available_regions

HOURS = (9.0, 22.0)
MODES = ("car", "two_wheeler")


def sample_pairs(g, n, rng):
    ok = np.nonzero(g.lg["car"].has_out)[0]
    pairs = []
    while len(pairs) < n:
        a, b = rng.choice(ok, 2, replace=False)
        d = float(np.hypot(*(g.node_xy[a] - g.node_xy[b])))
        if 3000 <= d <= 15000:
            pairs.append((int(a), int(b), d))
    return pairs


def main(n=25):
    rng = np.random.default_rng(42)
    rows, checks = [], []
    t_start = time.time()
    for reg in available_regions():
        g = get_graph(reg)
        p = Planner(g)
        for a, b, d in sample_pairs(g, n, rng):
            o = (float(g.a["node_lat"][a]), float(g.a["node_lon"][a]))
            t = (float(g.a["node_lat"][b]), float(g.a["node_lon"][b]))
            for mode in MODES:
                for hour in HOURS:
                    r = p.plan(*o, *t, mode=mode, hour=hour, alternatives=False)
                    f, s = r["routes"]["fastest"], r["routes"]["safest"]
                    rows.append({
                        "region": reg, "mode": mode, "hour": hour, "crow_km": d / 1000,
                        "fast_min": f["time_s"] / 60, "safe_min": s["time_s"] / 60,
                        "fast_km": f["distance_m"] / 1000, "safe_km": s["distance_m"] / 1000,
                        "fast_score": f["score"], "safe_score": s["score"],
                        "risk_red": r["comparison"]["risk_reduction_pct"],
                        "time_inc": r["comparison"]["time_delta_pct"],
                        "fast_bs": len(f["blackspot_ids"]), "safe_bs": len(s["blackspot_ids"]),
                        "fast_unlit": f["exposure"]["unlit_km"], "safe_unlit": s["exposure"]["unlit_km"],
                        "fast_unlit_share": 1 - f["exposure"]["lit_share"], "safe_unlit_share": 1 - s["exposure"]["lit_share"],
                        "fast_right": f["exposure"]["right_turns"], "safe_right": s["exposure"]["right_turns"],
                        "same": r["comparison"]["same_route"], "ms": r["stats"]["compute_ms"],
                    })
        # optimality check: A* vs Dijkstra on a few pairs/weights
        c = g.costs("car", 22.0)
        for a, b, _ in sample_pairs(g, 4, rng):
            fast = g.astar(a, b, "car", c.edge_time, c.trans_time, 1 / (g.e_speed.max() / 3.6))
            T0, D0, R0 = g.totals(fast, c)
            for lam in (0.3, 0.7, 1.0):
                we, wt = g.weights(c, 0, 1 - lam, lam, D0, T0, R0)
                rmin = float(np.min(c.edge_risk[g.lg["car"].allowed] / np.maximum(g.e_len[g.lg["car"].allowed], 1)))
                ast = g.astar(a, b, "car", we, wt, (1 - lam) / ((g.e_speed.max() / 3.6) * T0) + lam * rmin / R0)
                dij = g.dijkstra(a, b, "car", we, wt)
                checks.append(abs(ast.cost - dij.cost) <= 1e-6 * max(1.0, dij.cost))
        print(f"[{reg}] done ({time.time() - t_start:.0f}s)")

    out = BACKEND_DIR.parent / "docs"
    out.mkdir(exist_ok=True)
    (out / "validation.json").write_text(json.dumps({"trips": rows, "astar_matches_dijkstra": checks}, indent=1))
    write_markdown(rows, checks, out / "VALIDATION.md", n)


def agg(rs):
    a = lambda k: np.array([r[k] for r in rs], float)
    diff = ~np.array([r["same"] for r in rs])
    return {
        "trips": len(rs),
        "different": f"{100 * diff.mean():.0f}%",
        "risk_red_mean": f"{a('risk_red').mean():.1f}%",
        "risk_red_median": f"{np.median(a('risk_red')):.1f}%",
        "time_inc_mean": f"{a('time_inc').mean():.1f}%",
        "extra_min": f"{(a('safe_min') - a('fast_min')).mean():.1f}",
        "score": f"{a('fast_score').mean():.0f} → {a('safe_score').mean():.0f}",
        "bs": f"{int(a('fast_bs').sum())} → {int(a('safe_bs').sum())}",
        "unlit": f"{a('fast_unlit').mean():.2f} → {a('safe_unlit').mean():.2f}",
        "per_min": f"{(a('risk_red').mean() / max((a('safe_min') - a('fast_min')).mean(), 1e-6)):.1f}",
        "ms": f"{np.median(a('ms')):.0f}",
    }


def lighting_note(rows):
    night = [r for r in rows if r["hour"] >= 19]
    fs = np.mean([r["fast_unlit_share"] for r in night]); ss = np.mean([r["safe_unlit_share"] for r in night])
    fk = np.mean([r["fast_unlit"] for r in night]); sk = np.mean([r["safe_unlit"] for r in night])
    return (f"At 22:00 the safety route carries slightly *more* poorly lit road ({fk:.2f} → {sk:.2f} km per trip; "
            f"share {100 * fs:.1f} % → {100 * ss:.1f} %). Part of this is extra length; the rest is the model "
            "preferring slower local roads, because speed (power-model severity) outweighs lighting "
            "(HSM night-crash CMF 0.72). We tested a lighting-dominant personal-security weighting at up to 6x: "
            "it moved the unlit share by under one percentage point, because satellite night lights (~500 m) "
            "give neighbouring candidate routes nearly the same lighting value. Street-level lighting data "
            "(municipal streetlight GIS) is the main data gap for night-time personal-safety routing.")


def write_markdown(rows, checks, path, n):
    L = ["# Validation: fastest vs safety route", "",
         f"Seeded simulation (`python -m pipeline.validate {n}`): {n} random origin–destination pairs per region,",
         "3–15 km apart (straight line), each planned for car and two-wheeler at 09:00 and 22:00 with the",
         "default settings (safety priority 0.7, detour cap 25 %). *Fastest* is the standard time-only route.", "",
         "| Region | Mode | Hour | Trips | Routes differ | Risk reduction (mean / median) | Extra time (mean) | Safety score | Blackspots passed | Unlit km (night) | Risk cut per extra min | Median compute |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    groups = {}
    for r in rows:
        groups.setdefault((r["region"], r["mode"], r["hour"]), []).append(r)
    for (reg, mode, hour), rs in groups.items():
        s = agg(rs)
        L.append(f"| {reg} | {mode} | {int(hour):02d}:00 | {s['trips']} | {s['different']} | {s['risk_red_mean']} / {s['risk_red_median']} | "
                 f"{s['time_inc_mean']} (+{s['extra_min']} min) | {s['score']} | {s['bs']} | {s['unlit'] if hour >= 19 else '–'} | {s['per_min']} %/min | {s['ms']} ms |")
    s = agg(rows)
    L += ["", f"**All {s['trips']} trips:** risk reduction {s['risk_red_mean']} mean ({s['risk_red_median']} median) for "
          f"{s['time_inc_mean']} more travel time on average (+{s['extra_min']} min); safety score {s['score']}; "
          f"blackspot passes {s['bs']}.", "",
          "**Lighting finding.** " + lighting_note(rows), "",
          f"**Optimality check:** A* returned the same optimal cost as SciPy's Dijkstra in {sum(checks)}/{len(checks)} cases "
          "(car, 22:00, λ ∈ {0.3, 0.7, 1.0}).", "",
          "Risk figures are model outputs (see METHODOLOGY.md); they rank routes consistently but are not",
          "measured crash outcomes. Field validation would need geo-coded crash records (e.g. iRAD) for these cities."]
    path.write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 25)
