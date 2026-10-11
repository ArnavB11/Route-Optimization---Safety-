"""Minimal Overpass API client with endpoint rotation and retries (stdlib only).

Public Overpass servers are frequently overloaded (HTTP 429/504, or a 200 with
an HTML "server too busy" body), so every query is retried across mirrors.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINTS = [
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "SafeRouteGujarat/1.0 (SVNIT academic project)"


class OverpassError(RuntimeError):
    pass


def http_post(url: str, form: dict, timeout: int) -> tuple[int, str]:
    body = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, ""


def query(ql: str, attempts: int = 12, timeout: int = 300) -> dict:
    last = None
    for i in range(attempts):
        url = ENDPOINTS[i % len(ENDPOINTS)]
        try:
            status, text = http_post(url, {"data": ql}, timeout)
            if status == 200 and text.lstrip().startswith("{"):
                data = json.loads(text)
                remark = data.get("remark", "")
                if "runtime error" in remark or "timed out" in remark:
                    raise OverpassError(remark)
                return data
            last = f"{url} -> HTTP {status}"
        except (OSError, ValueError, OverpassError) as e:
            last = f"{url} -> {e}"
        wait = min(5 * (i + 1), 30)
        print(f"    overpass retry {i + 1}/{attempts} ({last}); waiting {wait}s")
        time.sleep(wait)
    raise OverpassError(f"all Overpass attempts failed; last error: {last}")


def bbox_tiles(bbox, rows: int, cols: int):
    s, w, n, e = bbox
    dlat, dlon = (n - s) / rows, (e - w) / cols
    for i in range(rows):
        for j in range(cols):
            yield (s + i * dlat, w + j * dlon, s + (i + 1) * dlat, w + (j + 1) * dlon)
