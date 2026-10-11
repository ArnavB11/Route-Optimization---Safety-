"""Road-safety and travel-time model.

Every formula used to cost an edge lives here so the build pipeline and the
API share one definition. Sources for each parameter are cited inline and
collected in docs/METHODOLOGY.md.

Notation (per directed edge e, entering node v):
    L      length [km]
    c      OSM road class
    V      operating speed [km/h]
    h      hour of departure (0–23)
    m      travel mode: car | two_wheeler | walk
"""
from __future__ import annotations

import numpy as np

# ---------------------------------------------------------------------------
# Road classes
# ---------------------------------------------------------------------------
CLASSES = [
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street",
]
CLASS_ID = {c: i for i, c in enumerate(CLASSES)}
ARTERIAL = {"motorway", "trunk", "primary", "secondary",
            "motorway_link", "trunk_link", "primary_link", "secondary_link"}


def _per_class(d: dict) -> np.ndarray:
    return np.array([d[c] for c in CLASSES], dtype=np.float64)


# Default operating speed when no maxspeed tag exists (Indian urban roads;
# IRC:106-1990 design speeds, reduced to observed urban operating speeds).
DEFAULT_SPEED = _per_class({
    "motorway": 90, "motorway_link": 45, "trunk": 60, "trunk_link": 40,
    "primary": 50, "primary_link": 35, "secondary": 40, "secondary_link": 30,
    "tertiary": 35, "tertiary_link": 30, "unclassified": 32, "residential": 25,
    "living_street": 15,
})

# Relative crash *frequency* per vehicle-km before severity weighting.
# Access-controlled roads have the fewest conflicts per vkm. Local streets
# have *higher* crash rates per vkm than arterials (more accesses, parked
# vehicles, pedestrians, no markings, encroachment – roughly 1.5–2× in FHWA
# urban crash-rate tables), but those crashes are less severe; severity is
# handled separately below. Calibrated so that per-vkm *harm* on local
# streets is ~0.4–0.5× an arterial's, in line with FHWA urban fatality
# rates by functional class rather than the raw speed ratio alone.
BASE_FREQUENCY = _per_class({
    "motorway": 0.35, "motorway_link": 0.60, "trunk": 0.85, "trunk_link": 0.90,
    "primary": 1.00, "primary_link": 1.00, "secondary": 1.05, "secondary_link": 1.00,
    "tertiary": 1.20, "tertiary_link": 1.10, "unclassified": 1.60, "residential": 1.60,
    "living_street": 1.20,
})

# Exposure proxy (AADT, vehicles/day) used only to calibrate absolute crash
# counts against MoRTH city totals and for the Empirical-Bayes blackspot step.
AADT_PROXY = _per_class({
    "motorway": 45000, "motorway_link": 12000, "trunk": 40000, "trunk_link": 12000,
    "primary": 28000, "primary_link": 10000, "secondary": 16000, "secondary_link": 8000,
    "tertiary": 9000, "tertiary_link": 6000, "unclassified": 3000, "residential": 1200,
    "living_street": 300,
})

# Peak-hour volume/capacity ratio per class (for the BPR delay function).
PEAK_VC = _per_class({
    "motorway": 0.70, "motorway_link": 0.80, "trunk": 0.95, "trunk_link": 0.90,
    "primary": 1.00, "primary_link": 0.90, "secondary": 0.90, "secondary_link": 0.85,
    "tertiary": 0.80, "tertiary_link": 0.75, "unclassified": 0.55, "residential": 0.40,
    "living_street": 0.25,
})

# Prior probability that a road is street-lit when OSM has no `lit` tag.
LIT_PRIOR = _per_class({
    "motorway": 0.40, "motorway_link": 0.50, "trunk": 0.75, "trunk_link": 0.70,
    "primary": 0.80, "primary_link": 0.75, "secondary": 0.70, "secondary_link": 0.65,
    "tertiary": 0.60, "tertiary_link": 0.55, "unclassified": 0.30, "residential": 0.45,
    "living_street": 0.45,
})

# Probability that a junction of the given (highest) class is signal-controlled
# when OSM lacks a traffic_signals tag (OSM signal coverage in Gujarat is low).
SIGNAL_PRIOR = _per_class({
    "motorway": 0.0, "motorway_link": 0.0, "trunk": 0.55, "trunk_link": 0.20,
    "primary": 0.50, "primary_link": 0.20, "secondary": 0.35, "secondary_link": 0.15,
    "tertiary": 0.15, "tertiary_link": 0.10, "unclassified": 0.02, "residential": 0.01,
    "living_street": 0.0,
})

# ---------------------------------------------------------------------------
# Severity: Nilsson power model
# ---------------------------------------------------------------------------
V_REF = 40.0
# Share of crashes that are fatal in the study cities: MoRTH 2022 Table 6.2
# (killed / accidents): Ahmedabad 488/1711 = 0.29, Surat 0.43, Vadodara 0.38.
FATAL_SHARE = 0.33


def severity(v):
    """Expected harm per crash relative to a 40 km/h road.

    Nilsson (2004) power model: injury crashes scale with (v/v0)^2 and fatal
    crashes with (v/v0)^4. Weighted by the local fatal share.
    """
    r = np.asarray(v, dtype=np.float64) / V_REF
    return (1 - FATAL_SHARE) * r ** 2 + FATAL_SHARE * r ** 4


def pedestrian_fatality(v):
    """Probability a pedestrian struck at impact speed v [km/h] is killed.

    Rosén & Sander (2009), Accident Analysis & Prevention 41(3):536-542.
    """
    return 1.0 / (1.0 + np.exp(6.9 - 0.090 * np.asarray(v, dtype=np.float64)))


# ---------------------------------------------------------------------------
# Crash modification factors (CMF); 1.0 = no effect
# ---------------------------------------------------------------------------
CMF_UNLIT_NIGHT = 1.0 / 0.72   # HSM Part D: lighting cuts night injury crashes 28 %
CMF_DIVIDED = 0.80             # median / divided carriageway (HSM ch.13 median CMFs)
CMF_UNPAVED = 1.30
CMF_BRIDGE = 1.25              # MoRTH 2022 Tab 6.9: bridges 3.0 % of crashes, 4.6 % of deaths
CMF_TRAFFIC_CALMING = 0.85     # humps / calming on the link
CMF_BUS_STOP = 1.08            # per bus stop on link (stopping buses, crossing pedestrians)
CMF_ACTIVITY_MAX = 1.25        # dense roadside activity → pedestrian/vehicle conflicts

# Junctions: relative risk per traversal (scaled later by calibration).
ARMS_FACTOR = {3: 1.0, 4: 1.5}            # 5+ arms → 1.8
ARMS_FACTOR_5PLUS = 1.8
CMF_SIGNAL = 0.70                         # HSM: signalisation of urban 4-leg, injury crashes
CMF_ROUNDABOUT = 0.60                     # conservative vs HSM (Indian "circles" are large & fast)
CMF_STOP_GIVEWAY = 0.90

# Turning movements (India drives on the left, so a RIGHT turn crosses the
# opposing stream). Index: 0 straight, 1 left, 2 right, 3 U-turn.
# Risk factor multiplies the junction risk; time is extra manoeuvre delay [s]
# at junctions that are not signal-controlled.
TURN_STRAIGHT, TURN_LEFT, TURN_RIGHT, TURN_UTURN = 0, 1, 2, 3
TURN_RISK = np.array([1.00, 0.75, 1.60, 2.20])
TURN_TIME = np.array([0.0, 3.0, 7.0, 15.0])
TURN_LABEL = ("straight", "left", "right", "uturn")


def turn_type(delta_deg):
    """Classify heading change δ = bearing_out − bearing_in ∈ (−180, 180]."""
    d = np.asarray(delta_deg, dtype=np.float64)
    a = np.abs(d)
    return np.where(a < 35, TURN_STRAIGHT, np.where(a > 155, TURN_UTURN,
                    np.where(d > 0, TURN_RIGHT, TURN_LEFT))).astype(np.int8)

# Two-wheelers: ~45 % of road deaths in India (MoRTH 2022) – extra
# vulnerability on fast mixed-traffic roads and bad surfaces.
def two_wheeler_factor(v, unpaved):
    v = np.asarray(v, dtype=np.float64)
    return (1.15 + 0.45 * np.clip((v - 30.0) / 30.0, 0, 1)) * np.where(unpaved, 1.25, 1.0)


# ---------------------------------------------------------------------------
# Time of day
# ---------------------------------------------------------------------------
# MoRTH 2022, Table 7.3: share of accidents per 3-hour interval, starting 00:00.
CRASH_SHARE_3H = np.array([5.1, 5.2, 10.5, 14.2, 14.7, 17.3, 20.4, 11.5])
# Assumed share of daily vehicle-km per interval (typical Indian urban 24-h
# count profile, IRC:SP:41 style). Risk per vkm ∝ crash share / traffic share.
TRAFFIC_SHARE_3H = np.array([4.0, 4.0, 13.0, 18.0, 15.0, 17.0, 19.0, 10.0])
_raw = CRASH_SHARE_3H / TRAFFIC_SHARE_3H
TOD_RISK_3H = _raw / np.sum(_raw * TRAFFIC_SHARE_3H / TRAFFIC_SHARE_3H.sum())

# Hourly demand profile (fraction of peak) for congestion.
DEMAND_PROFILE = np.array([
    0.15, 0.10, 0.08, 0.08, 0.12, 0.25, 0.50, 0.75, 0.95, 1.00, 0.90, 0.80,
    0.78, 0.75, 0.75, 0.80, 0.88, 0.97, 1.00, 0.95, 0.80, 0.60, 0.40, 0.25,
])


def time_of_day_risk(hour: float) -> float:
    return float(TOD_RISK_3H[int(hour) % 24 // 3])


def darkness(hour: float) -> float:
    """0 = daylight, 1 = full night. Gujarat: sunset ≈ 18:15–19:20, sunrise ≈ 06:00–07:15."""
    h = hour % 24
    if 7 <= h < 18:
        return 0.0
    if 18 <= h < 19.5:
        return (h - 18) / 1.5
    if 6 <= h < 7:
        return 1 - (h - 6)
    return 1.0


# ---------------------------------------------------------------------------
# Travel time
# ---------------------------------------------------------------------------
BPR_ALPHA, BPR_BETA = 0.15, 4.0      # Bureau of Public Roads (1964)
WALK_SPEED = 4.8                     # km/h
SIGNAL_CYCLE, SIGNAL_GREEN_RATIO = 90.0, 0.45


def bpr_factor(peak_vc, hour):
    """t / t0 = 1 + α (v/c)^β, with v/c scaled by the hourly demand profile."""
    vc = np.asarray(peak_vc) * DEMAND_PROFILE[int(hour) % 24]
    return 1.0 + BPR_ALPHA * vc ** BPR_BETA


def webster_delay(vc):
    """Uniform delay term of Webster's formula [s]: C(1-λ)² / (2(1-λx))."""
    lam = SIGNAL_GREEN_RATIO
    x = np.minimum(np.asarray(vc, dtype=np.float64), 0.95)
    return SIGNAL_CYCLE * (1 - lam) ** 2 / (2 * (1 - lam * x))


# ---------------------------------------------------------------------------
# Personal security (non-collision safety)
# ---------------------------------------------------------------------------
# Weighted index in [0,1] (1 = least secure). Weights follow CPTED literature
# (lighting and natural surveillance dominate); police proximity and CCTV are
# secondary. Multiplied by mode/time weight γ below.
SEC_W_LIGHT, SEC_W_ACTIVITY, SEC_W_POLICE, SEC_W_CCTV = 0.45, 0.30, 0.15, 0.10
SECURITY_GAMMA = {"car": 0.15, "two_wheeler": 0.45, "walk": 1.0}


def security_index(p_lit, activity, police_dist_m, cctv, dark):
    """Personal-security risk per km in [0, 1]."""
    lighting_gap = (1 - p_lit) * dark
    act = 1 - activity
    police_far = 1 - np.exp(-np.asarray(police_dist_m) / 1500.0)
    no_cctv = 1 - cctv
    day = SEC_W_ACTIVITY * act * 0.6 + SEC_W_POLICE * police_far * 0.5
    night = (SEC_W_LIGHT * lighting_gap + SEC_W_ACTIVITY * act
             + SEC_W_POLICE * police_far + SEC_W_CCTV * no_cctv)
    return (1 - dark) * day + dark * night
