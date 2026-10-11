# SafeRoute Gujarat — Methodology

Multi-objective dynamic route optimisation, **safety objective**.
Study area: Surat, Ahmedabad–Gandhinagar, Vadodara, Rajkot.

This document explains every number the app shows: where the data comes from, which formula turns it into a cost, and which parts are measured versus assumed.

---

## 1. Data sources

| Layer | Source | What we use | Status |
|---|---|---|---|
| Road network | OpenStreetMap via Overpass API | 13 drivable `highway` classes, `oneway`, `maxspeed`, `lanes`, `lit`, `surface`, `bridge`, `junction=roundabout`, `sidewalk`; node tags `traffic_signals`, `stop`, `give_way`, `traffic_calming` | measured (crowd-sourced) |
| Safety POIs | OpenStreetMap | police, hospitals, fire stations, CCTV, bus stops, shops/eateries/offices (activity) | measured, **sparse** in Gujarat |
| Night-time light | NASA Black Marble VNP46A2 (VIIRS DNB, gap-filled, BRDF/moon corrected) via NASA GIBS; per-pixel median of 8 clear nights, Dec 2025 – Feb 2026 | lighting probability & night activity | measured (satellite, ~500 m) |
| City crash totals | MoRTH, *Road Accidents in India 2022*, Table 6.2 | annual accidents, killed, injured per million-plus city | official |
| Time of day | MoRTH 2022, Table 7.3 | share of crashes per 3-h window | official (national) |
| Road features / junctions | MoRTH 2022, Tables 1.3, 3.6, 3.7, 6.9 | NH/SH/other crash density, bridge severity, junction & control shares | official (national) |
| Blackspots — NH | MoRTH, *Road Accidents in India 2019*, Annexure 52 (top-10 per state, 2016-18) | Jambuva Bridge NH-48, Vadodara: 36 crashes / 30 deaths | official |
| Blackspots — city | Gujarat Road Safety Authority audit of Ahmedabad (reported 22 Jun 2026); State Traffic Branch + GRSA festive-season list 2022-24 (reported 21 Oct 2025) — both via Gujarat Samachar | 15 Ahmedabad, 4 Vadodara, 1 Gandhinagar, 1 Surat locations with crash & death counts | official audit, secondary reporting |
| Fatal incident | Deccan Herald / Gujarat Samachar (Apr 2025) | Indira Circle, Rajkot (city-bus crash, 3–4 killed) | single incident, low weight |

**Geocoding.** Blackspots were geocoded with Nominatim (bounded to the city) and, where that failed, located from OSM's own features (e.g. "Pandya Flyover", the paired NH-48 bridges at Jambuva, the University Road × 150 Ft Ring Road junction for Indira Circle). Every manual coordinate and its evidence is in `backend/datasets/blackspots_overrides.json`. Locations we could not pin unambiguously were **dropped, not guessed**: Varsada Cut (Vadodara), Beti village (Rajkot), Hojiwala Gates (Surat), Army Camp (Gandhinagar).

**Why not crime data?** NCRB publishes crime only at city level (Ahmedabad and Surat among the 19 metros). A city-wide number cannot change which route wins *inside* that city, so it is not used in routing. Personal security uses street-level proxies instead (§3.6).

---

## 2. Graph model

* Nodes are intersections (OSM nodes shared by ≥ 2 ways, plus way ends); edges are road segments between them, keeping full geometry.
* Each segment yields two directed edges (`2i` forward, `2i+1` reverse). Car and two-wheeler use only legal directions; walking uses both and excludes motorways.
* The largest **strongly connected component** is kept (≥ 98.9 % of nodes in every city), so any snapped origin can reach any destination.
* Routing runs on the **line graph**: a search state is "arrived via edge *e*", and a transition *e → f* through node *v* carries the cost of that specific manoeuvre. Immediate U-turns onto the same segment are forbidden except at dead ends.

| Region | Nodes | Directed edges | Road km |
|---|---|---|---|
| Ahmedabad – Gandhinagar | 78 893 | 207 282 | 9 130 |
| Surat | 65 107 | 168 166 | 6 294 |
| Vadodara | 52 328 | 133 858 | 4 392 |
| Rajkot | 33 815 | 94 294 | 3 457 |

---

## 3. Safety model

Risk is **expected harm per trip**: crash frequency × severity, plus a personal-security term. Everything is computed per vehicle (individual risk), which is what a route choice changes.

### 3.1 Link risk (per traversal of edge *e*)

```
R_link = k · f_c · CMF_static · L_km · 10⁻⁶ · S(v_op) · TOD(h) · CMF_light(h) · EB_e
```

| Term | Meaning | Value / source |
|---|---|---|
| `f_c` | relative crash frequency per vehicle-km for road class *c* | motorway 0.35 … primary 1.0 … residential 1.6 (local streets have more conflicts per vkm; FHWA urban crash-rate relativities) |
| `CMF_static` | product of crash modification factors | divided carriageway 0.80 · unpaved 1.30 · bridge 1.25 (MoRTH 2022 Tab 6.9: bridges 3.0 % of crashes, 4.6 % of deaths) · bus stop 1.08 each · traffic calming 0.85 · roadside activity up to 1.25 |
| `S(v)` | severity, Nilsson power model | `S(v) = (1−φ)(v/40)² + φ(v/40)⁴`, φ = 0.33 (local fatal share: Ahmedabad 0.29, Vadodara 0.38, Surat 0.43) |
| `v_op` | operating speed | `maxspeed` tag or class default (IRC urban speeds), divided by the BPR factor at hour *h* (§4) — congestion lowers severity |
| `TOD(h)` | time-of-day risk per vkm | MoRTH 2022 crash share ÷ traffic share per 3-h window, normalised to a traffic-weighted mean of 1 (00–03 h: 1.28×, 09–12 h: 0.79×) |
| `CMF_light` | darkness | `1 + (1/0.72 − 1)·(1 − p_lit)·dark(h)` — HSM: lighting reduces night injury crashes by 28 % |
| `EB_e` | blackspot multiplier | §3.4 |
| `k` | calibration constant | §3.3 |

**Lighting probability.** OSM has `lit=*` on < 1 % of Gujarat roads and almost no street lamps. We use
`p_lit = 0.25·prior_c + 0.75·NLI`, where NLI is the normalised VIIRS night-light index at the segment midpoint, overridden by an explicit `lit` tag or ≥ 1 mapped lamp per 100 m.

### 3.2 Junction risk (per manoeuvre *e → f* at node *v*, degree ≥ 3)

```
R_junction = k_j · arms · control · (AADT_minor/1000)^0.35 · S(min(v,60)) · TOD · turn · CMF_light · EB_v
```

* **arms**: 3-leg 1.0, 4-leg 1.5, 5+ 1.8 (conflict points grow with legs).
* **control**: signal 0.70 (HSM signalisation CMF), roundabout 0.60, stop/give-way 0.90, uncontrolled 1.0. OSM signal coverage is poor, so `P(signal)` falls back to a prior based on the *second-highest* road class meeting there.
* **(AADT_minor)^0.35**: the HSM intersection safety-performance-function exponent on the minor road (0.2–0.5). Crossing a side street is far safer than crossing another arterial.
* **turn** — India drives on the left, so a right turn crosses opposing traffic: straight 1.0, left 0.75, **right 1.60**, U-turn 2.20.

Turn costs are why the search runs on the line graph. Without them, a "safest" route happily zig-zags through dozens of residential lanes.

### 3.3 Calibration to MoRTH totals

Each edge gets an exposure proxy `AADT_c` by class (trunk 40 000 … residential 1 200 veh/day). Predicted annual crashes are

```
N_e = k · f_c · CMF · L_km · AADT_c · 365 / 10⁶        N_v = k_j · J_v · AADT_enter · 365 / 10⁶
```

`k_j/k` is set so junctions carry 35 % of crashes (an urban assumption; the national figure is 22 % because it includes rural highways). `k` is then set so that ΣN_e + ΣN_v equals the city's 2022 MoRTH total (Ahmedabad region 1 882 = 1 711 × 1.10 for Gandhinagar; Surat 683; Vadodara 478; Rajkot 498). The absolute risk per trip is therefore anchored to real counts, which is what makes the "estimated crashes per million trips" figure meaningful.

### 3.4 Empirical-Bayes blackspot adjustment

For a documented blackspot *b* with `N_obs` crashes over `Y` years:

```
N_pred = Σ predicted crashes on edges / junctions within 250 m   (MoRTH blackspot = 500 m stretch)
w      = 1 / (1 + κ · N_pred · Y)                                  κ = 0.6 (NB over-dispersion)
N_EB   = w · N_pred + (1 − w) · N_obs/Y
mult   = clip(N_EB / N_pred, 1, 8) · clip((deaths/accidents) / φ, 0.7, 2)^0.5,  floored at 1
EB_e   = 1 + (mult − 1) · exp(−d² / (2 · 150²))                   d = distance from the blackspot
```

EB stops one bad year at a quiet junction from dominating, but trusts long records. Example: Odhav Ring Road (30 crashes in ~5.5 years) gets ×3.1; Jambuva Bridge (36 crashes, 30 deaths) gets ×11.3.

### 3.5 Two-wheeler and pedestrian modes

* **Two-wheeler** (≈ 45 % of India's road deaths, MoRTH 2022): severity × `(1.15 + 0.45·clip((v−30)/30, 0, 1))`, and ×1.25 more on unpaved roads.
* **Walking**: risk per km ∝ exposure (sidewalk 0.3, none 1.0, unknown 0.7) × pedestrian fatality probability at traffic speed, `P(v) = 1/(1+e^{6.9−0.09v})` (Rosén & Sander 2009) × √(AADT/10 000). Junction crossings ∝ P(v) × (1 − 0.5·P(signal)).

### 3.6 Personal security (non-collision safety)

A CPTED-style index in [0, 1] per km:

```
night: 0.45·(1−p_lit) + 0.30·(1−activity) + 0.15·(1−e^{−d_police/1500}) + 0.10·(1−CCTV)
day:   0.6·0.30·(1−activity) + 0.5·0.15·(1−e^{−d_police/1500})
```

`activity = 1 − (1 − POI density) · (1 − 0.6·NLI)`, so lit, busy streets give "eyes on the street". It is converted into crash-risk units by multiplying by the network's mean crash risk per km and by a mode weight γ: car 0.15, two-wheeler 0.45, walk 1.0.

### 3.7 Safety score

```
score = 100 · exp(−ln(100/70) · r / r̄)
```

Here *r* is the route's risk per km and *r̄* is the **traffic-weighted** (per vehicle-km) network average for the same mode and hour. So **70 means an average road**: higher is safer, and 100 means zero risk. Labels: ≥ 82 Very safe, ≥ 72 Safe, ≥ 60 Moderate, ≥ 45 Risky.

---

## 4. Travel-time model

```
t_e = L / v_ff · [1 + 0.15 · (VC_c · D(h))⁴]                     BPR (1964)
d_signal = C(1−λ)² / (2(1 − λ·x)),  C = 90 s, λ = g/C = 0.45      Webster uniform delay
d_turn  = 0 / 3 / 7 / 15 s  (straight / left / right / U) at non-signalised junctions, 8 s at roundabouts
```

`VC_c` is the class peak volume/capacity ratio and `D(h)` an hourly demand profile, so the same trip is slower at 9 am than at 2 am. A junction above a class-specific V/C becomes a bottleneck because the BPR term grows with the 4th power (proposal Q11).

---

## 5. Routing

### 5.1 Cost function (route-relative normalisation)

```
C(P) = Σ_e [W_d·D_e/D₀ + W_t·T_e/T₀ + W_s·R_e/R₀] + Σ_turns [W_t·T_τ/T₀ + W_s·R_τ/R₀]
```

D₀, T₀ and R₀ are the **fastest route's** totals for the same origin and destination. This answers proposal Q2 ("different units") better than network min–max scaling. Each objective becomes "fraction of the baseline trip", so the weights mean exactly what the slider says: at λ = 0.5, one percent of extra time is worth one percent less risk. The app exposes `W_s = λ`, `W_t = 1−λ`, `W_d = 0`. Distance is still reported, and is used for the "shortest" reference route.

### 5.2 Modified A*

* Search over the line graph with turn-aware transition costs (§2, §3.2).
* Heuristic `h(e) = |x_dst(e) − x_target| · [W_t/(v_max·T₀) + W_s·r_min/R₀]`, where `r_min` is the smallest risk per metre on any edge. Straight-line distance never exceeds path length, travel at `v_max` is the fastest possible, and transition costs are ≥ 0, so `h` is a lower bound: **admissible**, and A* returns the optimum. `tests/test_routing.py` checks this against exact Dijkstra distances, and the validation run confirms A* = Dijkstra on every sampled weight.
* Typical response is 0.3–1.2 s for a full plan (fastest + safest + shortest + balanced + Pareto sampling) on the 207 k-edge Ahmedabad graph, in pure Python. SciPy's C Dijkstra is used for batch Pareto sampling and the detour bisection.

### 5.3 Detour cap ("sanity threshold", Q9)

Minimise `λ·R/R₀ + (1−λ)·T/T₀`. If the result exceeds `(1+τ)·T₀` (τ = 25 % by default), bisect λ downwards. This is Lagrangian relaxation of the time-budget constraint, and gives the safest route that still fits the budget.

### 5.4 Pareto front and the *Balanced* route (Q15)

The optimal route is sampled for λ ∈ {0, 0.25, 0.5, 0.7, 0.85, 0.95} plus the user's λ; dominated routes are dropped. The **Balanced** route is the knee of the front: the point farthest from the Fastest → Safest chord in (T/T₀, R/R₀) space, i.e. the largest risk cut per extra minute.

---

## 6. What the numbers mean — and don't

* Scores and "% lower risk" are **model outputs**. They rank routes consistently using measured road attributes, official crash totals and audited blackspots, but they are not observed crash rates for individual streets. Geo-coded crash records (MoRTH iRAD) are not public; with them, `f_c` and the CMFs could be re-estimated directly.
* `AADT_c`, `LIT_PRIOR`, `SIGNAL_PRIOR`, the 35 % junction share and the security weights are documented **assumptions**. All live in `backend/app/model.py`, and the graphs rebuild in under a minute if they change.
* Satellite night lights are 500 m resolution and saturate in city cores. They separate lit urban roads from dark peripheral ones, but cannot tell two adjacent lanes apart. As a result, at night the safety route carries slightly *more* poorly lit road than the fastest route (see VALIDATION.md): the model prefers slower local roads (speed outweighs the lighting CMF), and stronger lighting weights barely change route choice at this resolution. Municipal streetlight GIS layers would close this gap.
* Routing is within one city region. Inter-city trips (e.g. Ahmedabad → Vadodara on NE-1) would need a highway-only graph linking regions.

---

## 7. Mapping to the anticipated viva questions

| Q | Where it's answered |
|---|---|
| 1 Modified A* vs Dijkstra | §5.2: line-graph A* with turn-dependent costs; heuristic proven admissible; tested equal to Dijkstra |
| 2 Combining units | §5.1: route-relative normalisation |
| 4 Safety data | §1, §3: OSM + VIIRS lighting, MoRTH, GRSA audits, EB blackspots |
| 5 API failure | All data is local after the build; nothing live is needed to route |
| 7 Overhead | §5.2 timings; static factors precomputed in `graph.npz`, per-hour costs vectorised in NumPy and cached |
| 8 Predictive traffic | Costs use the *departure* hour's BPR/demand profile; extending to arrival-time-dependent costs needs a time-expanded search |
| 9 Cleanest/safest only | §5.3 detour cap |
| 10 Data structure | §2: directed multigraph → line graph |
| 11 Bottleneck | §4: BPR V/C, 4th-power penalty |
| 12 Bike vs car | §3.5 mode profiles |
| 13 Validation | `docs/VALIDATION.md`: risk exposure integral of fastest vs safest over random trips |
| 14 Heuristic | §5.2 |
| 15 Pareto | §5.4 |
| 16 Missing OSM data | Priors that err pessimistic: unknown sidewalk 0.7, unknown lighting falls back to satellite × class prior |
| 17 Explain the choice | Route cards, headline ("+3 min, 28 % lower risk, avoids 2 blackspots"), risk breakdown, risk-along-route chart |
| 18 Scaling | Contraction hierarchies / ALT landmarks on the line graph; the per-hour cost arrays already make customisable CH (CCH) a natural fit |

---

## References

* MoRTH, Transport Research Wing. *Road Accidents in India 2022*; *Road Accidents in India 2019* (Annexure 52).
* AASHTO (2010). *Highway Safety Manual*, Part D crash modification factors.
* Nilsson, G. (2004). *Traffic safety dimensions and the Power Model.* Lund University Bulletin 221.
* Elvik, R. (2009). *The Power Model of the relationship between speed and road safety.* TØI 1034/2009.
* Rosén, E., & Sander, U. (2009). Pedestrian fatality risk as a function of car impact speed. *Accident Analysis & Prevention* 41(3).
* Hauer, E. (1997). *Observational Before–After Studies in Road Safety* (Empirical Bayes).
* Bureau of Public Roads (1964). *Traffic Assignment Manual*.
* Webster, F. V. (1958). *Traffic Signal Settings.* Road Research Technical Paper 39.
* Román, M. O. et al. (2018). NASA's Black Marble nighttime lights product suite. *Remote Sensing of Environment* 210.
* Hart, Nilsson & Raphael (1968). A formal basis for the heuristic determination of minimum cost paths (A*).
* Bouhsissin, Sael & Benabbou (2023). Driver behavior classification: a systematic literature review. *IEEE Access* 11 (context on behaviour data sources; future work).
