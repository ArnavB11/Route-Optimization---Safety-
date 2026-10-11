"""Geocode the curated blackspot list (datasets/blackspots_sources.csv).

Writes datasets/blackspots.json. Nominatim is queried at most once per second
(its usage policy). Any coordinates in datasets/blackspots_overrides.json
(manually verified against the map) take precedence over geocoder output.

Usage:  python -m pipeline.geocode_blackspots
"""
import csv
import json
import time
import urllib.parse
import urllib.request

from app.config import DATASETS_DIR, REGIONS

NOMINATIM = "https://nominatim.openstreetmap.org/search"
UA = "SafeRouteGujarat/1.0 (SVNIT academic project)"


def geocode(q: str, bbox):
    s, w, n, e = bbox
    params = {"q": q, "format": "jsonv2", "limit": 1, "viewbox": f"{w},{n},{e},{s}", "bounded": 1}
    req = urllib.request.Request(f"{NOMINATIM}?{urllib.parse.urlencode(params)}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.loads(r.read().decode())
    if not res:
        return None
    return float(res[0]["lat"]), float(res[0]["lon"]), res[0].get("display_name", "")


def main():
    overrides_path = DATASETS_DIR / "blackspots_overrides.json"
    overrides = json.loads(overrides_path.read_text(encoding="utf-8")) if overrides_path.exists() else {}
    out = []
    with open(DATASETS_DIR / "blackspots_sources.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["id"] in overrides:
                lat, lon = overrides[row["id"]]["lat"], overrides[row["id"]]["lon"]
                how = "manual"
            else:
                g = geocode(row["geocode_query"], REGIONS[row["region"]]["bbox"])
                time.sleep(1.1)
                if g is None:
                    print(f"!! {row['id']} {row['name']}: not found – add to overrides")
                    continue
                lat, lon, disp = g
                how = "nominatim"
                print(f"{row['id']} {row['name']} -> {lat:.5f},{lon:.5f}  [{disp[:90]}]")
            out.append({
                "id": row["id"], "region": row["region"], "city": row["city"], "name": row["name"],
                "lat": round(lat, 6), "lon": round(lon, 6), "geocoded_by": how,
                "accidents": int(row["accidents"]) if row["accidents"] else None,
                "deaths": int(row["deaths"]) if row["deaths"] else None,
                "period": row["period"], "category": row["category"],
                "source": row["source"], "source_url": row["source_url"],
            })
    (DATASETS_DIR / "blackspots.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(out)} blackspots written")


if __name__ == "__main__":
    main()
