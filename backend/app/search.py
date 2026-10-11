"""Local place search over the OSM-derived gazetteer (no external API)."""
from __future__ import annotations

import json
import re
from functools import lru_cache

from .config import CITIES, DATA_DIR, REGIONS

KIND_BOOST = {"Railway station": 3.0, "Airport": 3.0, "University": 2.5, "College": 2.0, "Hospital": 1.8,
              "Mall": 2.0, "Attraction": 2.0, "Area": 2.2, "Bus station": 1.8, "Park": 1.4, "Road": 1.2,
              "Police": 1.2, "School": 1.0, "Place": 1.0, "Shop": 0.6, "Office": 0.6}


STOPWORDS = {"of", "the", "and", "for", "de"}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower()).strip()


@lru_cache(maxsize=None)
def _places(region: str):
    p = DATA_DIR / region / "places.json"
    if not p.exists():
        return []
    rows = json.loads(p.read_text(encoding="utf-8"))
    for r in rows:
        r["_n"] = _norm(r["name"])
        words = [w for w in r["_n"].split() if w not in STOPWORDS]
        r["_acr"] = "".join(w[0] for w in words) if len(words) >= 3 else ""
        r["region"] = region
    return rows


def available_regions():
    return [r for r in REGIONS if (DATA_DIR / r / "graph.npz").exists()]


def search(q: str, city: str | None = None, limit: int = 8):
    qn = _norm(q)
    if len(qn) < 2:
        return []
    tokens = qn.split()
    regions = [CITIES[city]["region"]] if city in CITIES else available_regions()
    results = []
    for reg in regions:
        for r in _places(reg):
            n = r["_n"]
            acronym = bool(r["_acr"]) and len(tokens) == 1 and r["_acr"] == qn
            if not acronym and not all(t in n for t in tokens):
                continue
            score = KIND_BOOST.get(r["kind"], 1.0)
            if acronym:
                score += 6
            elif n == qn:
                score += 5
            elif n.startswith(qn):
                score += 3
            elif any(w.startswith(tokens[0]) for w in n.split()):
                score += 1.5
            score -= len(n) / 80
            results.append((score, r))
    results.sort(key=lambda x: -x[0])
    out, seen = [], set()
    for _, r in results:
        key = (r["_n"], round(r["lat"], 2), round(r["lon"], 2))
        if key in seen:
            continue
        seen.add(key)
        out.append({k: v for k, v in r.items() if not k.startswith("_")})
        if len(out) >= limit:
            break
    return out
