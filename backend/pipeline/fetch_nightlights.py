"""Download a night-time-lights raster for each region from NASA GIBS.

Layer: VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance (NASA Black
Marble VNP46A2, daily, gap-filled, moon/BRDF corrected). GIBS serves an 8-bit
visualisation of radiance, so values are *relative*. The per-pixel median of
several clear dry-season (Dec–Feb) nights removes cloud and moonlight noise.

OpenStreetMap has almost no street-lamp or `lit=*` tags for Gujarat, so this
raster is the primary evidence for whether a road is lit at night and how
much night-time activity surrounds it.

Output: data/raw/<region>/nightlights.npz  (array `nli` in [0,1], `bbox`)
Usage:  python -m pipeline.fetch_nightlights [region ...]
"""
import io
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

from app.config import RAW_DIR, REGIONS

WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
LAYER = "VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance"
DATES = ["2025-12-05", "2025-12-18", "2025-12-29", "2026-01-10",
         "2026-01-22", "2026-02-03", "2026-02-14", "2026-02-25"]
PX_PER_DEG = 1200  # ~90 m per pixel; native VIIRS DNB is ~500 m


def fetch(bbox, date):
    s, w, n, e = bbox
    width, height = round((e - w) * PX_PER_DEG), round((n - s) * PX_PER_DEG)
    params = {"SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.1.1", "LAYERS": LAYER,
              "SRS": "EPSG:4326", "BBOX": f"{w},{s},{e},{n}", "WIDTH": width, "HEIGHT": height,
              "FORMAT": "image/png", "TIME": date}
    req = urllib.request.Request(f"{WMS}?{urllib.parse.urlencode(params)}",
                                 headers={"User-Agent": "SafeRouteGujarat/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                img = Image.open(io.BytesIO(r.read())).convert("L")
            return np.asarray(img, dtype=np.float32)
        except OSError as ex:
            print(f"    retry {attempt + 1}: {ex}")
            time.sleep(5)
    raise RuntimeError(f"GIBS download failed for {date}")


def build(region):
    bbox = REGIONS[region]["bbox"]
    stack = []
    for d in DATES:
        print(f"[{region}] night lights {d}")
        stack.append(fetch(bbox, d))
    med = np.median(np.stack(stack), axis=0)
    lo, hi = np.percentile(med, 5), 255.0
    nli = np.clip((med - lo) / max(hi - lo, 1.0), 0, 1).astype(np.float32)
    out = RAW_DIR / region
    out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out / "nightlights.npz", nli=nli, bbox=np.array(bbox), dates=np.array(DATES))
    print(f"[{region}] saved {nli.shape}, mean={nli.mean():.2f}, saturated={np.mean(nli > 0.98):.2f}")


if __name__ == "__main__":
    for r in sys.argv[1:] or REGIONS:
        build(r)
