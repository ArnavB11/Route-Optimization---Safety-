# SafeRoute Gujarat

A safety-focused route planner for Surat, Ahmedabad, Gandhinagar, Vadodara and Rajkot. Compare a **safer choice** with the **fastest estimated route**, see the additional travel time, and inspect known crash locations along the way.

SVNIT | Project supervisor: Prof. Shriniwas Arkatkar

## Project scope

Our team's objective is **safety**. The app considers road layout, junction manoeuvres, crash history, estimated lighting and personal-security proxies. Time and distance help users judge whether a safer detour is practical. AQI and standalone traffic-efficiency optimisation belong to other teams and are outside this implementation.

This is an academic route-planning prototype. It does not provide live traffic, live incident reporting, crime prediction or GPS navigation. Safety scores are model estimates, not measured crash probabilities or proof that a route is safe.

## Run with your existing Conda environment

From the repository root, activate the environment that already contains the project dependencies:

```powershell
conda activate saferoute
python -m uvicorn app.main:app --app-dir backend --port 8000
```

Replace `saferoute` with your environment's name if different. Open **http://127.0.0.1:8000**. No frontend build step, account, API key or database is required. Restart the server after backend changes, or add `--reload` during development.

If port 8000 is occupied, use `--port 8001` and open that port instead.

### First-time installation only

```powershell
conda env create -f environment.yml
conda activate saferoute
python -m uvicorn app.main:app --app-dir backend --port 8000
```

For a separate Python 3.12 virtual environment, `requirements.txt` is also provided. Do not reinstall dependencies into an existing working Conda environment unnecessarily.

The committed data covers **four graph regions**. Ahmedabad and Gandhinagar share one graph. All five cities are available without rebuilding the data. MapLibre, map tiles and optional Photon search need internet access. Local routing and local place search use the committed files.

If FastAPI is unavailable, a local development fallback uses Python's HTTP server plus NumPy and SciPy:

```powershell
cd backend
python devserver.py 8000
```

This fallback is for local development. Use FastAPI for the normal application.

## Using the app

1. Choose a city and travel mode: car, two-wheeler or walking.
2. Search and select your starting point and destination. Alternatively, choose points on the map, drag the pins, or use your location.
3. Routes appear after both places are selected. **Find routes** also refreshes the trip.
4. Compare the safer choice with the fastest route. Select a card to highlight it and open **Directions** for the route steps.
5. Open **Trip options** to change departure time, safety preference or extra travel time. The 100% option permits up to twice the fastest estimated duration.
6. Expand the route details for lighting, junctions and safety factors. Map layers can show recorded blackspots, hospitals, police and CCTV.
7. **Save trip** stores up to five trips on this browser only. Reopen or delete them from the starting screen. Saved trips keep places and travel mode and use your current departure and safety settings.
8. On mobile, **Show map** hides the planning panel so you can see the route. **Show trip** brings the controls back.
9. **Copy trip link** preserves both coordinates, mode, departure time, safety preference, detour limit and selected route. Anyone with the link can see those trip coordinates.

A single card means both searches selected the same route for these settings. It does not establish that no safer route exists under every possible setting.

## Technology and responsibilities

| Component | Tools | Role |
| --- | --- | --- |
| Interface | HTML, CSS, native JavaScript modules | Search, route cards, directions, responsive map panel and themes |
| Map | MapLibre GL JS 4.7.1, CARTO basemap | Road map, route geometry, draggable pins and safety overlays |
| API | Python, FastAPI, Uvicorn | Validated requests and static frontend hosting |
| Routing | NumPy, SciPy, custom A* | Vectorised costs, spatial snapping and turn-aware path search |
| Data preparation | Python standard library, NumPy, SciPy, Pillow | OSM ingestion, night-light processing and graph construction |
| Place search | Local OSM gazetteer, optional Photon fallback | Names, acronyms and place suggestions |
| Verification | pytest; optional httpx for HTTP tests | Model, routing and request regression checks |

React, NetworkX, OSMnx, PostGIS, AQI APIs and paid Google Maps APIs are not dependencies of the current codebase. Earlier proposal documents describe a broader possible stack.

## How a request works

```text
Search / select two places
          |
          v
Browser sends coordinates and trip preferences
          |
          v
API validates inputs and identifies the graph region
          |
          v
Spatial index snaps points to the road network
          |
          v
Road + junction costs for mode and departure time
          |
          v
Fastest route -> safety-weighted route with detour limit
          |
          v
Route geometry, estimated time, safety factors and directions
```

The graph uses directed road segments and transitions between them. This lets a turn carry its own delay and risk. A* uses a lower-bound distance heuristic. SciPy Dijkstra provides an independent optimality check and computes the optional research alternatives.

The safety route combines risk and travel time relative to the fastest route. If it exceeds the chosen time allowance, the planner reduces the safety weight using a bounded search. This is a weighted-cost approximation to constrained routing, **not a proof of the globally safest path under a time budget**.

Departure and estimated arrival times use **India time (Asia/Kolkata)**, including when the browser is in another timezone. The route overview explains available differences such as mapped crash locations avoided, fewer turns or less poorly lit road. If either selected point is more than 75 metres from the snapped road node, the app displays an access warning. Reaching the road is not part of the route or estimated travel time.

The score compares estimated risk per kilometre with a traffic-weighted network reference. A score of 70 represents that reference. A displayed percentage reduction compares the model's total route risk with the fastest route's total risk. Neither number is a measured reduction in real-world crashes.

### Performance and reliability

- City listing reads small metadata files without constructing all road graphs.
- Graphs load on demand and remain cached for the server process.
- Each graph retains at most six recently used cost sets, with locked cache operations. Departure costs use consistent half-hour buckets.
- FastAPI runs route calculations in its worker thread pool so they do not execute directly on the async event loop. CPU capacity still limits concurrent requests.
- The normal interface skips shortest-path and Pareto research calculations using `include_analysis: false`.
- Input validation rejects invalid modes, coordinates, non-finite numbers and unsupported option ranges.
- Road snapping uses a separate spatial index for the nodes available to each travel mode, avoiding the previous twelve-candidate limit.
- Detour bisection keeps the feasible path that was actually checked, rather than solving again and potentially choosing a different path with the same weighted cost.
- Local place matches appear immediately while the optional online fallback continues. Search suggestions support keyboard selection and screen-reader combobox semantics.
- New route requests cancel obsolete browser requests. Search and reverse-geocoding responses are checked against the current selection.
- Photon fallback times out after 4.5 seconds. The local gazetteer remains available without Photon.

## Repository guide

```text
backend/
  app/
    config.py        Supported cities, bounds, paths and crash totals
    model.py         Safety and travel-time formulas and parameters
    engine.py        Graphs, spatial index, costs, A* and Dijkstra
    planner.py       Route comparisons, detour handling and summaries
    directions.py    Manoeuvres and readable instructions
    search.py        Local names, acronyms and ranking
    api.py           Framework-independent request validation/handlers
    main.py          FastAPI routes, compression and frontend hosting
  pipeline/
    overpass.py              Download retries and endpoint rotation
    fetch_osm.py             Road and place downloads
    fetch_nightlights.py     NASA GIBS raster preparation
    geocode_blackspots.py    Resolve documented crash locations
    build_graph.py           Build graph arrays and metadata
    validate.py              Seeded simulation and validation report
  data/<region>/
    graph.npz        Compressed road graph and model inputs
    meta.json        Names, calibration and coverage
    places.json      Search gazetteer
    layers.json      Blackspots and safety points of interest
  datasets/          Blackspot records, source URLs and overrides
  tests/             Model, routing and API regression tests
  devserver.py       Local fallback server
frontend/
  index.html         App shell and controls
  css/app.css        Responsive layout, themes and component styling
  js/app.js          Application state, search and route interactions
  js/api.js          HTTP client and optional Photon fallback
  js/map.js          MapLibre map, overlays and popups
  js/charts.js       Chart helpers for detailed visualisations
  js/util.js         Formatting, icons and shared helpers
  js/trip.js         Coordinate validation, route reasons and saved-trip helpers
  tests/             Node regression checks for pure trip helpers
docs/
  METHODOLOGY.md      Detailed formulas and assumptions
  VALIDATION.md      Existing simulation report
  validation.json    Existing simulation results
  REFERENCE_REVIEW.md  Relationship of supplied references to project scope
```

## API

FastAPI's interactive schema is at `/docs`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/cities` | Supported cities and data coverage |
| GET | `/api/search?q=svnit&city=surat` | Local place suggestions |
| GET | `/api/reverse?lat=21.1673&lon=72.7853` | Nearby road and area label |
| POST | `/api/route` | Plan and compare routes |
| GET | `/api/layers/surat` | Blackspots and safety POIs |
| GET | `/api/network/surat?mode=car&hour=21` | Major-road risk GeoJSON |
| GET | `/api/methodology` | Model factors for research clients |

Example route body:

```json
{
  "origin": {"lat": 21.1673, "lon": 72.7853},
  "destination": {"lat": 21.1418, "lon": 72.7562},
  "mode": "car",
  "hour": 21,
  "safety_weight": 0.7,
  "max_detour": 0.25,
  "include_analysis": false
}
```

`hour` is in `[0,24)`, safety weight and detour are in `[0,1]`. Supported modes are `car`, `two_wheeler` and `walk`. Omitting `include_analysis` retains the full response for existing research clients, including shortest route, sampled Pareto alternatives and a balanced route when available. Points must lie inside the same graph region.

## Tests and simulation

Run from the repository root in the activated environment:

```powershell
python -m pytest -q backend/tests
node --test frontend/tests/*.test.mjs
```

HTTP integration tests use `httpx` and skip if FastAPI or httpx is unavailable. Core tests require NumPy, SciPy and pytest. Tests cover model formulas, A*/Dijkstra agreement, heuristic admissibility, detour limits, Pareto ordering, API validation and deterministic bounded caching.

To regenerate the simulation report deliberately:

```powershell
cd backend
python -m pipeline.validate 25
```

This overwrites `docs/VALIDATION.md` and `docs/validation.json`. The existing report is a prior model simulation, not a clinical or field validation of actual crash reduction. Unit test success does not establish real-world safety.

## Rebuilding source data

Normal startup does not need this. These steps need internet and may take time due to public-service limits. Run from `backend/`:

```powershell
python -m pipeline.fetch_osm surat
python -m pipeline.fetch_nightlights surat
python -m pipeline.geocode_blackspots
python -m pipeline.build_graph surat
```

The OSM, night-light and graph scripts accept region names `surat`, `ahmedabad`, `vadodara`, `rajkot`; omit names to process all regions. The blackspot geocoder processes its full source table. Raw downloads are ignored by Git. Preserve evidence for manual coordinate overrides and inspect coverage after rebuilding.

## Data quality and limits

- Historical city crash totals calibrate the model. They do not validate individual street risks.
- Street lighting, signals, traffic demand and security include assumptions or proxies. Satellite imagery is too coarse to confirm every street lamp.
- Police/CCTV proximity is not crime-rate data. Hospital distances describe proximity, not emergency response time.
- One-way roads are modelled, but comprehensive OSM turn restrictions, closures and vehicle-specific access rules are not implemented. Follow signs and verify routes before relying on them.
- Points snap to the nearest graph node available to the travel mode, potentially some distance from the selected location. The API reports the offset and snapped coordinates. Footpaths outside the included road network may be missing.
- Departure-time estimates do not update edge-by-edge as a trip progresses. There is no live traffic feed.
- No general intercity routing, live rerouting or voice guidance is implemented. Ahmedabad and Gandhinagar are supported together because they share a graph.

See [methodology](docs/METHODOLOGY.md), [simulation report](docs/VALIDATION.md), and [reference review](docs/REFERENCE_REVIEW.md).

## Contribution workflow

Work on **`balodi`** and integrate reviewed changes from **`balodi` into `main`**. Do not work directly on `main`. Do not include ChatGPT or OpenAI co-author trailers. These conventions are also recorded in `AGENTS.md`.

## Attribution

Roads and POIs: OpenStreetMap contributors (ODbL). Basemap: CARTO. Night-light visualisation: NASA Black Marble VNP46A2 via GIBS. Historical crash statistics: MoRTH *Road Accidents in India* 2019 and 2022. Gujarat crash-location reports and manual-location evidence are linked in `backend/datasets/`. Research formulas and their assumptions are documented in `docs/METHODOLOGY.md`.
