"""Static configuration: study regions, cities and file locations.

A *region* is one routable road graph. Ahmedabad and Gandhinagar share a
region because the two cities form a single commuting corridor (SG Highway /
Sarkhej-Gandhinagar Highway), so trips between them must be routable.
"""
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
DATASETS_DIR = BACKEND_DIR / "datasets"
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"

# bbox = (south, west, north, east)
REGIONS = {
    "surat": {
        "name": "Surat",
        "bbox": (21.05, 72.68, 21.30, 72.98),
        "tiles": (2, 2),
    },
    "ahmedabad": {
        "name": "Ahmedabad – Gandhinagar",
        "bbox": (22.93, 72.47, 23.28, 72.72),
        "tiles": (3, 2),
    },
    "vadodara": {
        "name": "Vadodara",
        "bbox": (22.20, 73.08, 22.42, 73.28),
        "tiles": (2, 2),
    },
    "rajkot": {
        "name": "Rajkot",
        "bbox": (22.20, 70.70, 22.40, 70.92),
        "tiles": (2, 2),
    },
}

# Cities shown in the UI. `stats` is MoRTH "Road Accidents in India 2022",
# Table 6.2 (million-plus cities). Gandhinagar is not a million-plus city, so
# it carries no city-level row.
CITIES = {
    "surat": {
        "name": "Surat", "region": "surat", "center": (21.1702, 72.8311), "zoom": 12.2,
        "stats": {"accidents_2021": 704, "accidents_2022": 683, "killed_2021": 272,
                  "killed_2022": 293, "injured_2021": 513, "injured_2022": 553},
    },
    "ahmedabad": {
        "name": "Ahmedabad", "region": "ahmedabad", "center": (23.0225, 72.5714), "zoom": 12.0,
        "stats": {"accidents_2021": 1433, "accidents_2022": 1711, "killed_2021": 404,
                  "killed_2022": 488, "injured_2021": 1062, "injured_2022": 1305},
    },
    "gandhinagar": {
        "name": "Gandhinagar", "region": "ahmedabad", "center": (23.2156, 72.6369), "zoom": 12.4,
        "stats": None,
    },
    "vadodara": {
        "name": "Vadodara", "region": "vadodara", "center": (22.3072, 73.1812), "zoom": 12.4,
        "stats": {"accidents_2021": 464, "accidents_2022": 478, "killed_2021": 146,
                  "killed_2022": 181, "injured_2021": 349, "injured_2022": 378},
    },
    "rajkot": {
        "name": "Rajkot", "region": "rajkot", "center": (22.3039, 70.8022), "zoom": 12.5,
        "stats": {"accidents_2021": 346, "accidents_2022": 498, "killed_2021": 136,
                  "killed_2022": 150, "injured_2021": 290, "injured_2022": 422},
    },
}

# Accidents per year used to calibrate each region's crash model (MoRTH 2022).
# Ahmedabad region also covers Gandhinagar; Gandhinagar district is small, so
# its share is approximated as +10 % on top of Ahmedabad city.
REGION_ANNUAL_ACCIDENTS = {
    "surat": 683,
    "ahmedabad": round(1711 * 1.10),
    "vadodara": 478,
    "rajkot": 498,
}
