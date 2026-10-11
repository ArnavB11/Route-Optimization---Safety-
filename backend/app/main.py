"""FastAPI application.  Run:  uvicorn app.main:app --reload  (from backend/)"""
from fastapi import Body, FastAPI, Query, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import api
from .config import FRONTEND_DIR

app = FastAPI(title="SafeRoute Gujarat", version="1.0",
              description="Safety-focused route planning for Surat, Ahmedabad, Gandhinagar, Vadodara and Rajkot.")
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.exception_handler(api.ApiError)
async def api_error(_: Request, ex: api.ApiError):
    return JSONResponse(status_code=ex.status, content={"detail": ex.message})


@app.get("/api/cities")
def cities():
    return api.cities()


@app.get("/api/search")
def search(q: str = "", city: str | None = None):
    return api.do_search(q, city)


@app.get("/api/reverse")
def reverse(lat: float, lon: float):
    return api.reverse(lat, lon)


@app.post("/api/route")
def route(body: dict = Body(...)):
    # FastAPI runs synchronous handlers in its worker thread pool.
    return api.route(body)


@app.get("/api/layers/{region}")
def layers(region: str):
    return api.layers(region)


@app.get("/api/network/{region}")
def network(region: str, mode: str = "car", hour: float = Query(21, ge=0, lt=24)):
    return api.network_handler(region, mode, hour)


@app.get("/api/methodology")
def methodology():
    return api.methodology()


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
