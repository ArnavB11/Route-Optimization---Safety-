"""Dependency-free development server exposing the same API as app/main.py.

Use when FastAPI isn't installed:  python devserver.py  [port]
Production / normal use:          uvicorn app.main:app --port 8000
"""
import json
import mimetypes
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from app import api
from app.config import FRONTEND_DIR


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body: bytes, ctype="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, fn, *args):
        try:
            self._send(200, json.dumps(fn(*args)).encode())
        except api.ApiError as ex:
            self._send(ex.status, json.dumps({"detail": ex.message}).encode())
        except Exception as ex:  # noqa: BLE001
            traceback.print_exc()
            self._send(500, json.dumps({"detail": str(ex)}).encode())

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        p = u.path
        if p == "/api/cities":
            return self._json(api.cities)
        if p == "/api/search":
            return self._json(api.do_search, q.get("q", ""), q.get("city"))
        if p == "/api/reverse":
            return self._json(api.reverse, float(q["lat"]), float(q["lon"]))
        if p.startswith("/api/layers/"):
            return self._json(api.layers, p.rsplit("/", 1)[1])
        if p.startswith("/api/network/"):
            return self._json(api.network_handler, p.rsplit("/", 1)[1], q.get("mode", "car"), float(q.get("hour", 21)))
        if p == "/api/methodology":
            return self._json(api.methodology)
        f = (FRONTEND_DIR / (p.lstrip("/") or "index.html")).resolve()
        if FRONTEND_DIR.resolve() not in f.parents and f != FRONTEND_DIR.resolve() / "index.html" or not f.is_file():
            return self._send(404, b"not found", "text/plain")
        self._send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream")

    def do_POST(self):
        if urlparse(self.path).path != "/api/route":
            return self._send(404, b"{}")
        n = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._send(400, b'{"detail":"invalid JSON"}')
        self._json(api.route, body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"SafeRoute dev server on http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
