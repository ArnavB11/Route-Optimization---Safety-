"""Download raw OpenStreetMap data for every study region.

Two datasets per region, cached under backend/data/raw/<region>/:
  roads.json  – drivable highway ways + their nodes (tags on nodes give
                traffic signals, crossings, stop signs, speed bumps …)
  pois.json   – safety-relevant features: street lamps, police, hospitals,
                fire stations, CCTV, bus stops, and "activity" POIs (shops,
                eateries, …) used as a natural-surveillance proxy, plus named
                places for the search box.

Usage:  python -m pipeline.fetch_osm [region ...] [--force]
"""
import json
import sys

from app.config import RAW_DIR, REGIONS
from pipeline.overpass import bbox_tiles, query

ROAD_CLASSES = (
    "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|"
    "secondary_link|tertiary|tertiary_link|unclassified|residential|living_street"
)


def roads_ql(b):
    s, w, n, e = b
    return (f'[out:json][timeout:240];'
            f'way["highway"~"^({ROAD_CLASSES})$"]["area"!="yes"]["access"!~"^(private|no)$"]'
            f'({s},{w},{n},{e});(._;>;);out body;')


def pois_ql(b):
    s, w, n, e = b
    bb = f"({s},{w},{n},{e})"
    return (
        "[out:json][timeout:240];("
        f'node["highway"="street_lamp"]{bb};'
        f'nwr["amenity"~"^(police|hospital|clinic|fire_station|bus_station)$"]{bb};'
        f'nwr["healthcare"="hospital"]{bb};'
        f'node["man_made"="surveillance"]{bb};'
        f'node["highway"="bus_stop"]{bb};'
        f'nwr["shop"]["name"]{bb};'
        f'nwr["amenity"~"^(restaurant|cafe|fast_food|bank|atm|pharmacy|fuel|school|college|university|'
        f'cinema|theatre|marketplace|place_of_worship|library|townhall|courthouse|post_office)$"]{bb};'
        f'nwr["tourism"~"^(attraction|museum|hotel|zoo|theme_park)$"]["name"]{bb};'
        f'nwr["leisure"~"^(park|stadium|sports_centre)$"]["name"]{bb};'
        f'nwr["railway"="station"]["name"]{bb};'
        f'nwr["aeroway"="aerodrome"]["name"]{bb};'
        f'nwr["office"]["name"]{bb};'
        f'nwr["place"~"^(suburb|neighbourhood|quarter|village|town)$"]["name"]{bb};'
        ");out center tags;"
    )


def merge(chunks):
    seen, out = set(), []
    for c in chunks:
        for el in c.get("elements", []):
            key = (el["type"], el["id"])
            if key not in seen:
                seen.add(key)
                out.append(el)
    return {"elements": out}


def fetch_region(key: str, force: bool = False):
    cfg = REGIONS[key]
    d = RAW_DIR / key
    d.mkdir(parents=True, exist_ok=True)
    for name, ql_fn in (("roads", roads_ql), ("pois", pois_ql)):
        path = d / f"{name}.json"
        if path.exists() and not force:
            print(f"[{key}] {name}: cached")
            continue
        tiles = list(bbox_tiles(cfg["bbox"], *cfg["tiles"]))
        chunks = []
        for i, t in enumerate(tiles, 1):
            print(f"[{key}] {name}: tile {i}/{len(tiles)}")
            chunks.append(query(ql_fn(t)))
        data = merge(chunks)
        path.write_text(json.dumps(data), encoding="utf-8")
        print(f"[{key}] {name}: {len(data['elements'])} elements saved")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    for k in args or REGIONS:
        fetch_region(k, force="--force" in sys.argv)
