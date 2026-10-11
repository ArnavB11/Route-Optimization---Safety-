# SafeRoute Gujarat

**Multi-objective dynamic route optimisation: safety objective.**
SVNIT · Guide: Prof. Shriniwas Arkatkar

A Google Maps-style web app for **Surat, Ahmedabad, Gandhinagar, Vadodara and Rajkot**. For any trip it shows the normal *fastest* route next to a *safest* route and a *balanced* compromise, and explains the difference: "+3 min, 28 % lower crash risk, avoids 2 accident blackspots".

The safety model combines OpenStreetMap road attributes, NASA satellite night-lights, MoRTH official crash statistics and geo-located accident blackspots from MoRTH and the Gujarat Road Safety Authority. It applies standard traffic-safety formulas: the Nilsson power model, HSM crash modification factors, Empirical-Bayes blackspot weighting, BPR travel time and Webster signal delay. Routes come from a turn-aware A* on the road line graph.

* How the scores are computed: [docs/METHODOLOGY.md](docs/METHODOLOGY.md)
* Simulation results over 400 random trips: [docs/VALIDATION.md](docs/VALIDATION.md)

---

## Quick start

```bash
conda env create -f environment.yml
conda activate saferoute
cd backend
uvicorn app.main:app --port 8000
```

Open **http://127.0.0.1:8000**. The processed road graphs for all five cities are committed in `backend/data/`, so nothing needs downloading. The browser loads map tiles (CARTO) and MapLibre from a CDN, so it needs internet access.

> No FastAPI available? `python devserver.py 8000` serves the same API using only the standard library plus numpy and scipy.

## Using the app

* **Pick a city** from the chips, then **search** two places (local OSM gazetteer, with Photon as fallback; acronyms like "svnit" work). You can also **click the map** ("Directions from / to here") or press the **locate** button.
* **Mode**: car, two-wheeler or walk. **Departure**: time slider (night raises risk and switches on the lighting factors). **Safety priority**: λ in the cost function. **Max detour**: cap on extra time for the safe route.
* **Route cards**: Safest (blue), Balanced (aqua), Fastest (orange), each with a 0–100 safety score where 70 means an average road. The selected route is coloured by risk level along its length.
* **Tabs**: *Overview* (risk breakdown, exposure, blackspots on route), *Directions* (turn-by-turn with per-step risk), *Analysis* (risk-along-route chart and time-vs-safety Pareto front).
* **Layers** (top right): road-risk heatmap, blackspots (click one for sources), police, hospitals, CCTV. **Insights** (chart icon): MoRTH city statistics, time-of-day risk, methodology and data coverage.
* Pins are draggable, and the URL is shareable (it encodes origin, destination, mode, hour and priority).

## Rebuilding the data

Only needed after changing `app/model.py` parameters or to refresh OSM. Run from `backend/`:

```bash
python -m pipeline.fetch_osm            # Overpass download → data/raw/ (≈65 MB, retries across mirrors)
python -m pipeline.fetch_nightlights    # NASA GIBS VIIRS night lights → data/raw/
python -m pipeline.geocode_blackspots   # datasets/blackspots_sources.csv → datasets/blackspots.json
python -m pipeline.build_graph          # → data/<region>/graph.npz, meta.json, layers.json, places.json (~30 s total)
python -m pipeline.validate 25          # → docs/VALIDATION.md
```

Each script accepts region names (`surat ahmedabad vadodara rajkot`) to limit the work.

## Tests

```bash
cd backend && python -m pytest -q
```

The 26 tests cover the model formulas, A* = Dijkstra optimality, heuristic admissibility (checked against exact distances), calibration to MoRTH totals, the detour cap, Pareto non-dominance and API validation.

## Project layout

```
backend/
  app/
    config.py        regions, cities, MoRTH city totals
    model.py         every safety / traffic formula and parameter (cited)
    engine.py        graph loading, per-hour edge & turn costs, line-graph A*, Dijkstra check
    planner.py       fastest / safest (detour-capped) / balanced (Pareto knee), route summaries
    directions.py    turn-by-turn instructions
    search.py        local place search
    api.py           request handlers;  main.py = FastAPI app;  ../devserver.py = stdlib server
  pipeline/          fetch_osm, fetch_nightlights, geocode_blackspots, build_graph, validate
  datasets/          blackspots_sources.csv (with source URLs), manual coordinate overrides
  data/<region>/     built graphs (committed);  data/raw/ is git-ignored
  tests/
frontend/            index.html, css/app.css, js/{app,map,charts,api,util}.js  (no build step)
docs/                METHODOLOGY.md, VALIDATION.md
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cities` | cities, MoRTH stats, data coverage |
| GET | `/api/search?q=&city=` | place search |
| GET | `/api/reverse?lat=&lon=` | nearest named road + locality |
| POST | `/api/route` | body `{origin:{lat,lon}, destination:{lat,lon}, mode, hour, safety_weight, max_detour}` → fastest / safest / balanced / shortest routes, Pareto front, comparison |
| GET | `/api/layers/{region}` | blackspots (with EB weights and sources), police, hospitals, fire, CCTV |
| GET | `/api/network/{region}?mode=&hour=` | GeoJSON risk heatmap of main roads |
| GET | `/api/methodology` | time-of-day and turn factors used by the UI |

Interactive docs are at `/docs` when running under FastAPI.

## Limitations

* Risk values are calibrated model estimates, not observed crash rates per street; geo-coded crash data (iRAD) is not public.
* OSM coverage of signals, lamps and police in Gujarat is sparse, so priors and satellite night-lights fill the gaps. Night-light resolution (~500 m) limits how well routes can be separated by street lighting (see VALIDATION.md).
* Trips must start and end in the same city region; inter-city routing is future work.

## Data & attribution

Road and POI data © OpenStreetMap contributors (ODbL). Basemap © CARTO. Night lights: NASA Black Marble (VNP46A2) via NASA GIBS. Crash statistics: MoRTH *Road Accidents in India* 2019 and 2022. Blackspot audits: Gujarat Road Safety Authority / State Traffic Branch, as reported by Gujarat Samachar. Each blackspot record carries its source URL.
