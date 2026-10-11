"""Routing engine: per-query costs, turn-aware (edge-based) A*, Dijkstra check.

The search runs on the *line graph*: a state is "arrived via edge e", and a
transition e → f through node v carries the junction cost of that specific
manoeuvre (straight / left / right / U-turn). This is what lets the model
charge a right turn across oncoming traffic more than going straight, and
stops the "safe" route from zig-zagging through every residential lane.

Generalised cost of a path P = (e₁ … e_k) with transitions τᵢ = (eᵢ → eᵢ₊₁):

    C(P) = Σ_e [W_d·D_e/D₀ + W_t·T_e/T₀ + W_s·R_e/R₀]
         + Σ_τ [W_t·T_τ/T₀ + W_s·R_τ/R₀]

D₀, T₀, R₀ are the fastest route's totals (route-relative normalisation).
"""
from __future__ import annotations

from collections import OrderedDict
from threading import RLock

import heapq
import json
import math
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

from . import model as M
from .config import DATA_DIR

MODES = ("car", "two_wheeler", "walk")


class RouteError(Exception):
    pass


@dataclass
class Costs:
    edge_time: np.ndarray     # per edge [s]
    edge_risk: np.ndarray     # per edge (link crash + security)
    trans_time: np.ndarray    # per transition [s]
    trans_risk: np.ndarray    # per transition (junction crash risk)
    parts_edge: dict
    parts_trans: dict
    ref_risk_per_km: float    # traffic-weighted network mean risk per km
    dark: float


@dataclass
class Path:
    edges: list
    trans: list               # transition ids between consecutive edges
    nodes: list
    expanded: int = 0
    cost: float = 0.0


class LineGraph:
    """Successor structure over edges for one travel mode."""

    def __init__(self, a, mask):
        src, dst = a["edge_src"], a["edge_dst"]
        n_nodes, n_edges = len(a["node_lat"]), len(src)
        allowed = np.nonzero(mask)[0]
        order = np.argsort(src[allowed], kind="stable")
        out_edges = allowed[order]
        out_cnt = np.bincount(src[out_edges], minlength=n_nodes)
        out_ptr = np.concatenate([[0], np.cumsum(out_cnt)])
        self.node_out_ptr, self.node_out = out_ptr, out_edges
        self.has_out = out_cnt > 0
        self.allowed = allowed

        # transitions e -> f for every allowed e and allowed f leaving dst[e]
        cnt = np.where(mask, out_cnt[dst], 0)
        t_from = np.repeat(np.arange(n_edges), cnt)
        starts = np.repeat(out_ptr[dst] - np.concatenate([[0], np.cumsum(cnt)])[:-1], cnt)
        t_to = out_edges[np.arange(len(t_from)) + starts]
        # forbid immediate reversal onto the twin edge unless it's a dead end
        twin = t_to == (t_from ^ 1)
        dead_end = out_cnt[dst[t_from]] == 1
        keep = ~twin | dead_end
        t_from, t_to = t_from[keep], t_to[keep]
        delta = (a["edge_b_start"][t_to].astype(np.float64) - a["edge_b_end"][t_from] + 540) % 360 - 180
        self.t_from, self.t_to = t_from, t_to
        self.t_type = M.turn_type(delta)
        self.t_node = dst[t_from]
        cnt2 = np.bincount(t_from, minlength=n_edges)
        self.ptr = np.concatenate([[0], np.cumsum(cnt2)])
        # python lists for the A* inner loop
        self.ptr_l = self.ptr.tolist()
        self.to_l = t_to.tolist()
        self.n_trans = len(t_to)


class RegionGraph:
    def __init__(self, region: str):
        d = DATA_DIR / region
        z = np.load(d / "graph.npz")
        self.a = {k: z[k] for k in z.files}
        self.meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        self.layers = json.loads((d / "layers.json").read_text(encoding="utf-8"))
        self.region = region
        a = self.a
        lat0, lon0 = self.meta["proj_center"]
        self._kx = 6371008.8 * math.cos(math.radians(lat0))
        self._lat0, self._lon0 = math.radians(lat0), math.radians(lon0)
        self.node_xy = np.stack([a["node_x"], a["node_y"]], axis=1)
        self.node_tree = cKDTree(self.node_xy)
        es = a["edge_seg"]
        self.e_len = a["seg_len"][es]
        self.e_cls = a["seg_cls"][es]
        self.e_speed = a["seg_speed"][es]
        self.names = self.meta["names"]
        cal = self.meta["calibration"]
        self.k_link, self.k_junction = cal["k_link"], cal["k_junction"]
        self.lg = {"car": LineGraph(a, a["edge_car"]), "walk": LineGraph(a, a["edge_walk"])}
        self.lg["two_wheeler"] = self.lg["car"]
        self._cache = OrderedDict()
        self._cache_lock = RLock()

    # -- geometry ---------------------------------------------------------
    def project(self, lat, lon):
        return np.array([(math.radians(lon) - self._lon0) * self._kx,
                         (math.radians(lat) - self._lat0) * 6371008.8])

    def snap(self, lat, lon, mode):
        xy = self.project(lat, lon)
        ok = self.lg[mode].has_out
        d, idx = self.node_tree.query(xy, k=12)
        for dist, i in zip(d, idx):
            if i < len(ok) and ok[i]:
                return int(i), float(dist)
        return int(idx[0]), float(d[0])

    # -- costs ----------------------------------------------------------------
    def costs(self, mode: str, hour: float) -> Costs:
        hour = math.floor(hour * 2) / 2
        key = (mode, hour)
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        a, lg = self.a, self.lg[mode]
        es = a["edge_seg"]
        L_km = self.e_len / 1000.0
        dark = M.darkness(hour)
        tod = M.time_of_day_risk(hour)
        p_lit = a["seg_p_lit"][es]
        light_mult = 1 + (M.CMF_UNLIT_NIGHT - 1) * (1 - p_lit) * dark
        bs = a["seg_bs"][es]
        vc = M.PEAK_VC[self.e_cls] * M.DEMAND_PROFILE[int(hour) % 24]

        tn = lg.t_node                                   # junction node of each transition
        is_j = a["node_degree"][tn] >= 3
        p_sig = a["node_p_signal"][tn]
        node_bs = a["node_bs"][tn]
        turn_risk = M.TURN_RISK[lg.t_type]
        # light at the junction ≈ light on the approach edge
        t_light = light_mult[lg.t_from]

        if mode == "walk":
            aadt_f = np.sqrt(M.AADT_PROXY[self.e_cls] / 10000.0)
            sidewalk = a["seg_sidewalk"][es]
            exposure = np.where(sidewalk == 1, 0.3, np.where(sidewalk == 0, 1.0, 0.7))
            base = L_km * exposure * M.pedestrian_fatality(self.e_speed) * aadt_f * tod * 1e-5
            jbase = np.where(is_j, 0.05e-5 * M.pedestrian_fatality(a["node_jspeed"][tn]) * (1 - 0.5 * p_sig)
                             * np.sqrt(a["node_enter_aadt"][tn] / 10000.0) * tod, 0.0)
            edge_time = self.e_len / (M.WALK_SPEED / 3.6)
            trans_time = np.where(is_j, p_sig * 25.0, 0.0)
        else:
            bpr = M.bpr_factor(M.PEAK_VC[self.e_cls], hour)
            v_ff = self.e_speed * (0.95 if mode == "car" else 0.92)
            v_op = v_ff / bpr                                       # time-dependent operating speed
            sev = M.severity(v_op)
            jv = np.minimum(a["node_jspeed"][tn], 60.0)
            jsev = M.severity(jv)
            if mode == "two_wheeler":
                sev = sev * M.two_wheeler_factor(v_op, a["seg_unpaved"][es])
                jsev = jsev * M.two_wheeler_factor(jv, False)
            base = self.k_link * a["seg_freq"][es] * L_km * 1e-6 * sev * tod
            jbase = np.where(is_j, self.k_junction * a["node_jfreq"][tn] * 1e-6 * jsev * tod * turn_risk, 0.0)
            edge_time = self.e_len / (v_ff / 3.6) * bpr
            vc_in = vc[lg.t_from]
            ctrl_delay = p_sig * M.webster_delay(vc_in) + (1 - p_sig) * (
                np.where(a["node_roundabout"][tn], 8.0, 0.0) + M.TURN_TIME[lg.t_type])
            trans_time = np.where(is_j, ctrl_delay, M.TURN_TIME[lg.t_type] * 0.3)

        link = base * light_mult * bs
        junction = jbase * t_light * node_bs
        parts_edge = {"road": base, "lighting": base * (light_mult - 1), "blackspot": base * light_mult * (bs - 1)}
        parts_trans = {"road": jbase, "lighting": jbase * (t_light - 1), "blackspot": jbase * t_light * (node_bs - 1)}

        # traffic-weighted (per vehicle-km) network reference
        allowed = lg.allowed
        w_e = (M.AADT_PROXY[self.e_cls] * self.e_len)[allowed]
        crash_ref = float(np.sum(link[allowed] * M.AADT_PROXY[self.e_cls[allowed]]) / np.sum(w_e / 1000.0))
        # expected junction risk per vkm: each transition weighted by the
        # approach volume × P(turn) with P(turn) = 1 / out-degree
        p_turn = 1.0 / np.maximum(np.diff(lg.ptr)[lg.t_from], 1)
        crash_ref += float(np.sum(junction * M.AADT_PROXY[self.e_cls[lg.t_from]] * p_turn) / np.sum(w_e / 1000.0))
        sec_idx = M.security_index(p_lit, a["seg_activity"][es], a["seg_police_d"][es], a["seg_cctv"][es], dark)
        security = M.SECURITY_GAMMA[mode] * sec_idx * L_km * crash_ref
        parts_edge["security"] = security
        parts_trans["security"] = np.zeros_like(junction)
        edge_risk = link + security
        sec_ref = float(np.sum((security / np.maximum(L_km, 1e-3))[allowed] * w_e) / w_e.sum())
        c = Costs(edge_time=edge_time, edge_risk=edge_risk, trans_time=trans_time, trans_risk=junction,
                  parts_edge=parts_edge, parts_trans=parts_trans, ref_risk_per_km=crash_ref + sec_ref, dark=dark)
        with self._cache_lock:
            self._cache[key] = c
            self._cache.move_to_end(key)
            while len(self._cache) > 6:
                self._cache.popitem(last=False)
        return c

    def weights(self, c: Costs, wd, wt, ws, D0, T0, R0):
        we = wd * self.e_len / D0 + wt * c.edge_time / T0 + ws * c.edge_risk / R0
        wtr = wt * c.trans_time / T0 + ws * c.trans_risk / R0
        return we, wtr

    # -- search ---------------------------------------------------------------
    def astar(self, src, dst, mode, we, wtr, h_per_m) -> Path:
        """Edge-based A*. h(e) = h_per_m · |dst[e] → target| is admissible
        because h_per_m never exceeds the cheapest possible cost per metre."""
        lg, a = self.lg[mode], self.a
        e_dst = a["edge_dst"]
        hnode = np.hypot(*(self.node_xy - self.node_xy[dst]).T) * h_per_m
        h = hnode[e_dst].tolist()
        we_l, wtr_l = we.tolist(), wtr.tolist()
        ptr, to = lg.ptr_l, lg.to_l
        dst_of = e_dst.tolist()
        g, parent = {}, {}
        heap = []
        for f in lg.node_out[lg.node_out_ptr[src]:lg.node_out_ptr[src + 1]].tolist():
            g[f] = we_l[f]
            parent[f] = (-1, -1)
            heapq.heappush(heap, (we_l[f] + h[f], we_l[f], f))
        closed = set()
        goal, expanded = -1, 0
        while heap:
            _, ge, e = heapq.heappop(heap)
            if e in closed:
                continue
            if dst_of[e] == dst:
                goal = e
                break
            closed.add(e)
            expanded += 1
            for k in range(ptr[e], ptr[e + 1]):
                f = to[k]
                if f in closed:
                    continue
                nv = ge + wtr_l[k] + we_l[f]
                if nv < g.get(f, math.inf):
                    g[f] = nv
                    parent[f] = (e, k)
                    heapq.heappush(heap, (nv + h[f], nv, f))
        if goal < 0:
            raise RouteError("No route found between these points")
        edges, trans = [], []
        e = goal
        while e != -1:
            edges.append(e)
            p, k = parent[e]
            if k >= 0:
                trans.append(k)
            e = p
        edges.reverse(); trans.reverse()
        nodes = [int(a["edge_src"][edges[0]])] + [int(e_dst[x]) for x in edges]
        return Path(edges=edges, trans=trans, nodes=nodes, expanded=expanded, cost=g[goal])

    def dijkstra(self, src, dst, mode, we, wtr) -> Path:
        """Same optimum via SciPy's C Dijkstra on the line graph (+ a virtual
        source). Used for batch Pareto sampling and to validate A*."""
        lg, a = self.lg[mode], self.a
        n = len(a["edge_src"])
        S = n
        first = lg.node_out[lg.node_out_ptr[src]:lg.node_out_ptr[src + 1]]
        rows = np.concatenate([lg.t_from, np.full(len(first), S)])
        cols = np.concatenate([lg.t_to, first])
        vals = np.concatenate([wtr + we[lg.t_to], we[first]]) + 1e-12
        G = csr_matrix((vals, (rows, cols)), shape=(n + 1, n + 1))
        dist, pred = dijkstra(G, indices=S, return_predecessors=True)
        cand = np.nonzero(a["edge_dst"] == dst)[0]
        cand = cand[np.isfinite(dist[cand])]
        if not len(cand):
            raise RouteError("No route found between these points")
        goal = int(cand[np.argmin(dist[cand])])
        edges = []
        e = goal
        while e != S and e >= 0:
            edges.append(e)
            e = int(pred[e])
        edges.reverse()
        trans = [self._trans_id(lg, x, y) for x, y in zip(edges[:-1], edges[1:])]
        nodes = [int(a["edge_src"][edges[0]])] + [int(a["edge_dst"][x]) for x in edges]
        return Path(edges=edges, trans=trans, nodes=nodes, cost=float(dist[goal]))

    @staticmethod
    def _trans_id(lg, e, f):
        lo, hi = lg.ptr[e], lg.ptr[e + 1]
        k = lo + int(np.nonzero(lg.t_to[lo:hi] == f)[0][0])
        return k

    def totals(self, path: Path, c: Costs):
        e = np.asarray(path.edges, dtype=np.int64)
        t = np.asarray(path.trans, dtype=np.int64)
        T = float(c.edge_time[e].sum() + c.trans_time[t].sum())
        D = float(self.e_len[e].sum())
        R = float(c.edge_risk[e].sum() + c.trans_risk[t].sum())
        return T, D, R


@lru_cache(maxsize=None)
def get_graph(region: str) -> RegionGraph:
    return RegionGraph(region)
