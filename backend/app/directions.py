"""Turn-by-turn instructions from the line-graph turn types and road names."""
from __future__ import annotations

from . import model as M

COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
CLASS_LABEL = {
    "motorway": "the expressway", "motorway_link": "the expressway ramp", "trunk": "the highway",
    "trunk_link": "the highway ramp", "primary": "the main road", "primary_link": "the slip road",
    "secondary": "the main road", "secondary_link": "the slip road", "tertiary": "the local road",
    "tertiary_link": "the slip road", "unclassified": "the local road", "residential": "a residential street",
    "living_street": "a lane",
}


def _delta(a, e_in, e_out):
    return (float(a["edge_b_start"][e_out]) - float(a["edge_b_end"][e_in]) + 540) % 360 - 180


def directions(g, path, costs, mode):
    a, lg = g.a, g.lg[mode]
    edges, trans = path.edges, path.trans
    if not edges:
        return []

    def road(e):
        n = g.names[int(a["seg_name"][a["edge_seg"][e]])]
        return n if n else CLASS_LABEL[M.CLASSES[int(g.e_cls[e])]]

    def named(e):
        return bool(g.names[int(a["seg_name"][a["edge_seg"][e]])])

    def new_step(kind, side, e, node, text):
        return {"type": kind, "modifier": side, "road": road(e), "text": text, "distance_m": 0.0,
                "time_s": 0.0, "risk": 0.0, "lat": float(a["node_lat"][node]), "lon": float(a["node_lon"][node])}

    b0 = float(a["edge_b_start"][edges[0]])
    cur = new_step("depart", None, edges[0], path.nodes[0],
                   f"Head {COMPASS[int((b0 + 22.5) // 45) % 8]} on {road(edges[0])}")
    steps = []
    in_roundabout = False
    for i, e in enumerate(edges):
        if i > 0:
            k = trans[i - 1]
            node = int(lg.t_node[k])
            ttype = int(lg.t_type[k])
            delta = _delta(a, edges[i - 1], e)
            is_j = a["node_degree"][node] >= 3
            name_changed = road(e) != cur["road"]
            ra = bool(a["node_roundabout"][node])
            if ra and is_j and not in_roundabout:
                in_roundabout = True
                steps.append(cur)
                cur = new_step("roundabout", None, e, node, "Enter the roundabout")
            elif in_roundabout and not ra:
                in_roundabout = False
                cur["text"] = f"At the roundabout, take the exit onto {road(e)}"
                cur["road"] = road(e)
            elif not in_roundabout and is_j and (ttype != M.TURN_STRAIGHT or (name_changed and named(e))):
                steps.append(cur)
                if ttype == M.TURN_STRAIGHT:
                    text, kind, side = f"Continue onto {road(e)}", "continue", None
                elif ttype == M.TURN_UTURN:
                    text, kind, side = f"Make a U-turn onto {road(e)}", "uturn", None
                else:
                    side = "right" if ttype == M.TURN_RIGHT else "left"
                    verb = "Slight" if abs(delta) < 55 else "Sharp" if abs(delta) > 130 else "Turn"
                    text, kind = f"{verb} {side} onto {road(e)}", "turn"
                cur = new_step(kind, side, e, node, text)
        cur["distance_m"] += float(g.e_len[e])
        cur["time_s"] += float(costs.edge_time[e]) + (float(costs.trans_time[trans[i - 1]]) if i > 0 else 0.0)
        cur["risk"] += float(costs.edge_risk[e]) + (float(costs.trans_risk[trans[i - 1]]) if i > 0 else 0.0)
    steps.append(cur)

    # fold tiny hops (< 30 m) into the previous step to keep the list readable
    merged = []
    for s in steps:
        if merged and s["distance_m"] < 30 and s["type"] == "continue":
            m = merged[-1]
            m["distance_m"] += s["distance_m"]; m["time_s"] += s["time_s"]; m["risk"] += s["risk"]
        else:
            merged.append(s)
    last = path.nodes[-1]
    merged.append({"type": "arrive", "modifier": None, "road": "", "text": "Arrive at your destination",
                   "distance_m": 0.0, "time_s": 0.0, "risk": 0.0,
                   "lat": float(a["node_lat"][last]), "lon": float(a["node_lon"][last])})
    ref = costs.ref_risk_per_km
    for s in merged:
        km = s["distance_m"] / 1000
        s["relative_risk"] = round((s.pop("risk") / km) / ref, 2) if km > 0.02 else None
    return merged
