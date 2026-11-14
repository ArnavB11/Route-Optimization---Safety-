# SafeRoute Gujarat

Complete project documentation and explanation

SVNIT | Project supervisor: Prof. Shriniwas Arkatkar

Prepared: 14 November 2026

Live application: https://route-optimization-safety.vercel.app

Repository: https://github.com/ArnavB11/Route-Optimization---Safety-

This guide explains the implemented project for students, evaluators and maintainers. The software baseline reviewed is commit `adc94a5`. Verification results are dated observations, not permanent guarantees about later releases.

## 1. Project overview

SafeRoute Gujarat is a safety-focused route-planning prototype. Given a starting point, destination, travel mode and departure time, it compares a fastest estimated route with a route that gives more importance to estimated safety. The user can decide how much extra travel time is acceptable.

The project addresses a practical question: can available road, junction, lighting and crash-location information support a more informed route choice, while keeping the detour understandable?

The team's objective is safety. Time and distance support the comparison. Air quality and separate traffic-efficiency objectives belong to other teams. The project has no AQI optimisation, live traffic feed, driver-behaviour classifier or crime-prediction model.

The app provides route comparison, historical blackspot overlays, readable directions, field-recording exploration, saved trips, shareable trip links and a moving location arrow. Voice guidance was deliberately removed. The current location feature shows position on the selected route rather than speaking navigation instructions.

**Essential interpretation:** a safer-choice label means lower estimated risk under the implemented model and settings. It is not a guarantee of safety or evidence that actual crashes have been reduced.

## 2. Coverage and user workflow

The interface supports Surat, Ahmedabad, Gandhinagar, Vadodara and Rajkot. There are four road graphs because Ahmedabad and Gandhinagar share one connected region. General intercity routing between the other regions is not implemented.

| Graph region | Nodes | Directed edges | Stored road length |
| --- | ---: | ---: | ---: |
| Ahmedabad and Gandhinagar | 78,893 | 207,282 | 9,130.1 km |
| Surat | 65,107 | 168,166 | 6,293.6 km |
| Vadodara | 52,328 | 133,858 | 4,391.9 km |
| Rajkot | 33,815 | 94,294 | 3,457.3 km |

These figures come from the committed graph metadata. They describe this extracted network, not a certified inventory of all roads in each city.

A normal user journey is:

1. Select a city and a travel mode: car, two-wheeler or walking.
2. Select a start and destination through search, map pins or device location.
3. Compare the safer-choice and fastest-route cards. Select a card to highlight its route.
4. Adjust departure time, safety priority and extra travel time under Trip options.
5. Inspect Directions, route explanations, estimated lighting and known blackspots.
6. Choose Follow my location to see a moving arrow, or Preview route to see a labelled simulation.
7. Save the trip locally or copy its link if needed.

Saved trips are stored in this browser, with a maximum of five. They are not an account-based cloud history. Shared links contain trip coordinates and preferences, so sharing a link also shares those locations.

Departure and arrival displays use India time, including when the visitor's browser uses a different timezone. On smaller screens, Show map and Show trip switch between the planning panel and map.

## 3. System architecture and technology

The frontend and API are served from the same origin. There is no separate frontend build requirement for normal use and no database service to provision.

```text
User chooses places and preferences
                 |
                 v
HTML / CSS / JavaScript interface + MapLibre map
                 |
                 v
FastAPI endpoints: validation and region selection
                 |
                 v
Spatial snapping -> road/junction costs -> route planner
                 |
                 v
Processed graphs + crash inputs + optional survey evidence
                 |
                 v
Route geometry, comparison, directions and explanations
```

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Interface | HTML, CSS, native JavaScript modules | Inputs, route cards, responsive layout, themes and controls |
| Map | MapLibre GL JS 4.7.1 with CARTO tiles | Road display, route lines, pins, arrow and overlays |
| Backend | Python, FastAPI, Uvicorn | Request handling, validation and static frontend hosting |
| Numerical routing | NumPy, SciPy and custom A* | Graph arrays, spatial indexes, route costs and searches |
| Data preparation | Python tools and Pillow | OSM imports, night-light preparation and graph construction |
| Place search | Local OSM gazetteer; optional Photon fallback | Location suggestions and nearby labels |
| Verification | pytest, httpx and Node's test runner | Backend/API and frontend regressions |
| Hosting | Vercel Python runtime | HTTPS frontend/API deployment from GitHub |

React, NetworkX, OSMnx, PostGIS, Google Maps APIs and AQI APIs are not dependencies of this implementation. Some proposal material describes a broader suggested stack; this guide describes the code that exists.

Internet is needed for the hosted app, the MapLibre CDN script, map tiles and optional external search. Having local graph files does not make the complete browser experience offline-capable.

## 4. Data sources and evidence quality

The implementation combines several different kinds of evidence. They must not be presented as interchangeable.

| Input | Use | Interpretation and limitation |
| --- | --- | --- |
| OpenStreetMap roads and junctions | Network, road features, geometry and place names | Community-mapped observations with incomplete tags and restrictions |
| OpenStreetMap safety POIs | Police, hospitals, CCTV and roadside activity | Coverage varies; proximity does not establish service quality or response time |
| NASA night-light imagery | Coarse lighting and activity proxy | Roughly 500 m imagery cannot verify an individual street lamp or lane |
| MoRTH city crash totals | Regional calibration | Aggregate historical counts do not validate individual street risk |
| Documented blackspot and incident records | Local risk adjustment and map overlays | Periods and evidence types differ; records require attribution and location checks |
| Professor-supplied CSV/KML files | Recorded journeys and contextual route evidence | Individual car recordings, not crash records or representative traffic counts |
| Model parameters and priors | Fill missing features and estimate time/risk | Assumptions; require sensitivity analysis and independent validation |

The existing reference review explains the role of the supplied driver-behaviour review, blackspot-treatment presentation, mid-block traffic material, original proposal and implementation guide. Those documents are reference material, not instructions or proof that every proposed feature has been implemented.

Source tables, URLs and manual coordinate evidence are retained under `backend/datasets/`. Ambiguous locations should be excluded or reviewed rather than assigned invented coordinates.

## 5. How the safety model works

The route risk has three main components: road-segment crash harm, junction/turn crash harm and a personal-security proxy. A route adds the relevant costs over its road segments and transitions.

Road-segment risk considers road class, length, estimated operating speed, time of day, lighting, historical blackspot adjustment and road features. The model distinguishes frequency from severity: a slow street may have more minor conflicts per kilometre while a faster road may have more severe outcomes.

Junction risk considers the junction environment and the particular movement through it. In left-side traffic, a right turn crosses opposing traffic. The implemented relative movement factors are straight 1.00, left 0.75, right 1.60 and U-turn 2.20. These are model assumptions, not locally measured universal crash rates.

Car and two-wheeler costs include mode-specific operating-speed and vulnerability assumptions. Walking uses pedestrian exposure, sidewalk information and a speed-related pedestrian fatality model. Missing sidewalks, signals and lighting are not interpreted automatically as confirmed absence; documented priors are used where the graph construction supports them.

The personal-security component uses lighting, nearby activity, police distance and CCTV as proxies. It is not a trained crime predictor. These proxies are scaled to the model's network reference and weighted by travel mode. Hospital proximity is context, not a prediction of ambulance response.

Regional calibration uses historical city accident totals, assumed traffic exposure and an assumed junction share. Blackspot adjustment blends model expectation with observed historical records and spreads influence around the recorded location. Calibration to aggregate totals does not validate the combined per-trip crash-harm and security score as an observed probability.

### 5.1 Understanding the displayed score

The safety index is calculated from estimated route risk per kilometre relative to a traffic-weighted network reference for the mode and time:

```text
score = 100 * exp(-ln(100/70) * route_risk_per_km / reference_risk_per_km)
```

A score of 70 corresponds to that model reference. Higher values indicate lower relative modelled risk. Current labels are Lower risk at 72 or above, Moderate from 60 to below 72, and Higher risk below 60. A score is not a percentage probability of safe arrival.

The displayed risk reduction compares total estimated route risk with the fastest route:

```text
risk_reduction_percent = 100 * (1 - safer_route_risk / fastest_route_risk)
```

For example, an illustrative 30% lower estimated risk means the model assigns 0.70 times the baseline total risk. It does not mean that real crashes were observed to decrease by 30%.

## 6. How route selection works

The network is a directed graph. A search state represents arriving along a road segment; moving to another segment adds the cost of the junction movement. This turn-aware representation prevents junctions from being treated as cost-free connections.

The request passes through these stages:

1. Validate coordinates, mode, time and preference ranges.
2. Identify a supported graph region. Both selected points must fit the same region.
3. Snap each point to a graph node available to the selected travel mode.
4. Calculate or retrieve costs for the mode and departure-time bucket.
5. Find the fastest estimated route as a baseline.
6. Find a safety-weighted route and enforce the selected detour allowance through a bounded weight search.
7. Return geometry, time/distance, modelled risk, score, exposures, directions and comparison information.

The normal safety cost uses the fastest trip's time and risk as reference units:

```text
weighted_cost = (1 - safety_weight) * route_time / baseline_time
              + safety_weight * route_risk / baseline_risk
```

Distance is reported and can support research alternatives, but it is not an independent optimisation weight in the normal safety slider.

If the candidate exceeds the permitted travel time, the planner reduces the safety weight using six bisection iterations and retains a route whose duration was checked. With a 25% allowance and a fastest estimated duration of 20 minutes, the budget is 25 minutes. A higher safety preference cannot override that budget.

This is an approximation to the constrained route-choice problem. The project does not prove that it finds the globally minimum-risk route among every path inside the time budget. A* and Dijkstra comparisons check optimality for a chosen weighted graph cost, which is a different claim.

Optional research responses include shortest paths and sampled Pareto alternatives. The normal interface sends `include_analysis: false` to avoid this extra computation. A single displayed route can mean both searches found the same path.

### 6.1 Travel time and access warnings

Travel times use road-class speeds, assumed time-of-day demand, a BPR-style delay function, signal delay and turn delay. They are not live traffic measurements. Costs are based on departure settings rather than a live traffic forecast along the entire trip.

The app reports snapping distances. An offset above 75 m triggers an access warning, while the planner rejects points more than 1,500 m from the available network. Missing access paths are not silently included in geometry or travel time. Comprehensive turn prohibitions, closures and vehicle-access restrictions remain a limitation.

## 7. Professor-supplied field recordings

All four CSV/KML corridor pairs are integrated. Original files are preserved byte-for-byte under `backend/datasets/field_surveys/source/`, with checksums recorded by the import pipeline. CSV coordinates and speeds remain paired; KML is used for provenance and export-consistency checks.

| Corridor | Input readings | Accepted | Retained distance | Braking candidates |
| --- | ---: | ---: | ---: | ---: |
| Ena to Dehgam, NE04 | 3,206 | 3,206 | 71.57 km | 1 |
| Vadodara to Anand, NE01 | 1,661 | 1,661 | 34.59 km | 2 |
| Narmada bridge to Kamrej, NH48 | 2,528 | 2,528 | 49.86 km | 1 |
| Mandal / Manal to Bhatia, NH53 | 8,940 | 8,933 | 140.46 km | 4 |

There are 16,335 input readings, of which 16,328 pass the import checks. `Acc` means GPS accuracy in metres, not acceleration. Recorded timestamps are UTC and displayed in India time.

Quality rules reject invalid coordinates, non-finite values, speeds outside 0-200 km/h and accuracy outside (0,25] m. Tracks split at non-positive time differences, gaps over five seconds or implied positional speeds above 60 m/s. No line or distance is added across those gaps. NH53 contains substantial gaps and is not presented as a continuous overnight drive.

A braking candidate is a recorded speed drop of at least 3 m/s squared over a valid interval, beginning at 20 km/h or more. Nearby onsets are grouped. Candidates need field review; they are not confirmed crashes, offences, road defects or evidence of driver fault.

Field trips shows full recorded corridors as disconnected purple-line sections, with speed profiles and quality summaries. Some extend outside the supported city graphs. Recorded corridors do not create a complete intercity routing network.

Car-route evidence uses nearby samples within 30 m, heading agreement within 45 degrees, and at least 100 m of approximate overlap. Routes are sampled at roughly 25 m intervals. This proximity-and-heading method can confuse parallel roads and is not authoritative map matching. Evidence is descriptive and does not change risk coefficients or estimated travel times. It is not applied as car evidence to walking or two-wheeler routes.

## 8. Device location and moving arrow

The project has two location flows with different purposes.

**Use my location** finds a possible starting point. It combines precise and network acquisition, keeps status visible and preserves existing trip entries on failure. A precise reading selects the origin. An approximate reading requires the user to choose Use approximate location. A separate 35-second deadline ends requests when the browser never completes them.

**Follow my location** keeps the selected route on screen and updates an arrow using browser-reported coordinates. The arrow is not forced onto the route line. Recenter resumes camera following after map exploration. Stop tracking clears the watch, timers, arrow, accuracy circle, pending route updates and optional screen wake lock.

Arrow rotation uses a valid device heading while moving, or a bearing from displacement greater than the reported uncertainty and at least 5 m. It remains stable at rest. Without a known heading it initially points north; this is not a compass measurement. Fresh approximate fixes can still move a grey arrow with an accuracy circle. They do not advance precise route-progress or arrival calculations.

Route progress requires accuracy within 35 m and a position no older than 15 seconds. Arrival needs a more precise fix within a 12 m walking or 22 m vehicle radius. If the mapped endpoint differs from the destination, the app distinguishes the end of the mapped route from arrival.

Confirmed off-route movement can request a new route after three precise fixes over eight seconds, beyond 35 m for walking or 55 m for vehicles. Requests preserve mode, safety preference and detour limit, with a 20-second timeout and 30-second retry cooldown. Unsupported or failed updates keep the existing route visible.

Live location needs HTTPS or localhost plus browser and operating-system permission. Keep the page open and unlocked. Embedded browsers may never complete the permission request; the app offers retry, browser handoff and a copyable link. Hosting on HTTPS enables the browser API but cannot manufacture a device reading.

Preview route is a visibly labelled simulation. Hosted previews were checked at 390x844, 360x640 and landscape 844x390. The moving/rotating arrow and controls rendered, and ending preview removed the arrow. These are viewport checks in a desktop browser, not Android/iOS device or GPS field validation. The embedded browser remained permission-pending. Physical mobile GPS movement, background tracking and on-road behaviour remain unverified.

## 9. Codebase guide and API

| File or directory | Role |
| --- | --- |
| `backend/app/config.py` | Coverage, city metadata, file locations and calibration totals |
| `backend/app/model.py` | Safety, mode, speed, lighting, time and security parameters/formulas |
| `backend/app/engine.py` | Graph loading, spatial indexes, costs, cache, A* and Dijkstra |
| `backend/app/planner.py` | Baseline comparison, detour search, route summaries and scores |
| `backend/app/directions.py` | Readable manoeuvres and cumulative offsets |
| `backend/app/search.py` | Local place-name and acronym search |
| `backend/app/api.py` | Shared request validation and framework-independent handlers |
| `backend/app/main.py` | FastAPI routes, compression and frontend serving |
| `backend/app/surveys.py` | Survey catalogue and route-evidence matching |
| `backend/data/<region>/` | Graph arrays, metadata, places and safety layers |
| `backend/pipeline/` | Data downloads, graph construction, survey import and simulation |
| `frontend/js/app.js` | State, search, selected places, route planning and controls |
| `frontend/js/map.js` | Map layers, pins, location arrow, accuracy circle and camera |
| `frontend/js/location.js` | Device acquisition, freshness, permission status and recovery |
| `frontend/js/planner-location.js` | Bounded starting-point acquisition and approximate consent |
| `frontend/js/navigation.js` | Geometry projection, route progress, arrival and arrow bearing |
| `frontend/js/navigation-ui.js` | Live/preview lifecycle, map following and rerouting |
| `frontend/js/trip.js` | Coordinate checks, saved trips and comparison helpers |
| `frontend/index.html`, `frontend/css/app.css` | App shell, responsive styling and themes |
| `app.py`, `pyproject.toml`, `vercel.json` | Hosting entry point, runtime dependencies and Vercel settings |

Key endpoints are:

| Method and path | Purpose |
| --- | --- |
| `GET /api/cities` | Cities, regions and readiness |
| `GET /api/search` | Local suggestions with query and optional city |
| `GET /api/reverse` | Nearby label for latitude/longitude |
| `POST /api/route` | Fastest and safety-weighted route comparison |
| `GET /api/layers/{region}` | Blackspots and safety points of interest |
| `GET /api/network/{region}` | Major-road relative-risk display |
| `GET /api/surveys` | Survey summaries, display geometry and quality information |
| `GET /api/methodology` | Model factors for research clients |
| `GET /docs` | FastAPI interactive API schema |

Example route request:

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

Supported modes are `car`, `two_wheeler` and `walk`. Hour is in [0,24), safety weight and detour in [0,1]. The API rejects invalid modes, non-finite numbers and unsupported coordinates. Responses include route geometry, distance/time, scores, directions, comparison factors and snapping information.

### 9.1 Efficiency and reliability

Graphs load on demand and are cached per process. Mode-specific spatial indexes accelerate snapping. Each graph keeps at most six cost sets, using locked cache operations and consistent half-hour buckets. NumPy vectorises costs; SciPy supports spatial queries and Dijkstra searches. The normal UI skips research alternatives. Browser requests cancel obsolete route calculations, and stale search responses are checked before replacing selections.

These measures reduce repeated work but do not guarantee a fixed latency. Python CPU work, large graphs, concurrent visitors and serverless cold starts can still affect response times. A cache is local to a function instance, not a shared persistent service.

## 10. Installation, operation and deployment

Use the existing Conda environment; a working setup does not need dependencies reinstalled. From the repository root:

```powershell
conda activate saferoute
python -m uvicorn app.main:app --app-dir backend --port 8000
```

Open `http://127.0.0.1:8000`. Replace the environment name if different. For first-time setup only, use `conda env create -f environment.yml`. `requirements.txt` also supports an independent Python environment. Node.js 22 or newer runs frontend tests; it is not a frontend runtime/build requirement.

The local fallback is `python devserver.py 8000` from `backend/`, when NumPy and SciPy are installed but FastAPI is unavailable. It is a development fallback, not the recommended public server.

Rebuild the professor's catalogue only when required:

```powershell
cd backend
python -m pipeline.import_surveys
```

Normal startup uses committed processed graphs. Rebuilding OSM/night-light inputs is a deliberate online maintenance task, documented in README. Raw downloads are ignored by Git. Restart the backend after changing cached data.

Vercel uses the repository root, the FastAPI preset and root `app.py`, which exports the existing backend application. `pyproject.toml` specifies Python 3.12 and runtime dependencies; `vercel.json` sets a 60-second function duration and excludes development inputs. `.vercelignore` omits raw downloads, tests and temporary artifacts. The processed graphs and survey catalogue must remain in deployment inputs. No database or API key is needed.

Local development and production share the same API application. The frontend calls same-origin `/api/*` paths. Deploying only the frontend directory would omit routing. Vercel's HTTPS address is suitable for phone access; a desktop's localhost address is not reachable as localhost on another device.

Work on `balodi`, push it, then integrate into `main`. The production deployment has been verified from `main`. Branch equality, a successful deployment status and public API checks are separate checks; a Git push alone does not prove the site is healthy. No ChatGPT or OpenAI co-author trailers are added.

## 11. Verification, findings and limits

The reviewed release passed 73 backend tests and 50 frontend tests. Backend coverage includes model behaviour, A*/Dijkstra agreement, detour limits, mode-specific snapping, API validation, direction offsets and survey integration. Frontend coverage includes location lifecycle, failure recovery, approximate-origin consent, arrow heading, marker reuse, route progress, rerouting, recenter and cleanup.

```powershell
python -m pytest -q backend/tests
node --test frontend/tests/*.test.mjs
```

An existing Starlette/httpx deprecation warning was reported during backend checks. Tests used the existing environment; no local testing packages were installed for these changes.

Production checks confirmed HTTP 200 for the homepage, five ready cities, four survey corridors and successful fastest/safer route calculation. Mobile-sized hosted preview checks confirmed rendering and simulated movement. They do not establish real-device GPS reliability or observed safety improvement.

The pre-existing simulation report describes 400 modelled trips, with 26.9% mean modelled risk reduction for 13.5% extra estimated time. These are historical simulation outputs, not a fresh experiment for this documentation, not deployment latency benchmarks and not observed crash reduction. Its night-time result also shows that safety-weighted routes can include more poorly lit distance when slower-road severity assumptions dominate coarse lighting estimates.

Important remaining limitations are sparse road tags and POIs, coarse lighting, assumed exposure/demand, incomplete turn/access restrictions, outdated or uncertain source records, no live closures or traffic, city-bound routing and unverified mobile field tracking. A model can be internally consistent while still being wrong about real conditions.

Priority next steps are independent incident/exposure validation, municipal street-light information, field checks of route legality and crossings, tests on physical Android/iOS devices, and load/cold-start measurement. More features should not replace better evidence.

## 12. Demonstration and explanation guide

A short demonstration can proceed as follows:

1. Explain the safety-only objective and identify the supported cities.
2. Open the hosted app and select the SVNIT campus to Dumas Road example in Surat.
3. Compare the fastest and safer-choice cards. Explain extra time and estimated risk separately.
4. Change safety priority or the detour allowance and show that the selected route can change.
5. Open a blackspot or field-trip overlay and distinguish historical crash evidence from a recorded car journey.
6. Start Preview route. Show the moving arrow and simulation label, then end it.
7. If using a real phone, request precise location with consent and show actual updates only if received.
8. Finish with the data limitations and the need for independent validation.

Illustrative spoken introduction: "Our project compares a fastest estimated route with a safety-weighted alternative. It uses available road and junction information, historical crash locations and lighting estimates. The user chooses an acceptable detour. The results are model estimates that support a decision, not guarantees of safe travel."

Common evaluator questions:

| Question | Accurate answer |
| --- | --- |
| Is this Google Maps? | No. It is a custom academic safety planner using MapLibre and processed road graphs. |
| Is this machine learning? | The implemented route choice uses explicit mathematical models and graph search, not a trained predictive classifier. |
| Why include travel time in a safety project? | It provides the baseline and a practical detour budget; AQI and independent traffic-efficiency objectives are outside scope. |
| Why model turns? | The risk and delay of a junction depend on the movement through it, not only its location. |
| Does the professor's data change the safety score? | No. It provides contextual recorded-trip evidence and quality-reviewed visualisations. |
| Does 30% lower risk mean 30% fewer crashes? | No. It is a reduction in the model's total route risk relative to the baseline. |
| Does the algorithm guarantee the safest feasible path? | No. Weighted graph search is checked separately from the approximate detour-constrained search. |
| Has mobile GPS been validated? | Arrow preview and permission handling were checked; real-phone movement and on-road validation remain outstanding. |
| Why might location fail? | Permission, browser restrictions, disabled device services or inadequate readings can prevent acquisition. |
| What is the strongest next improvement? | Better independent road-safety evidence and physical-device/field validation. |

## 13. Maintenance checklist and reading map

For a release, verify the intended branch and clean working tree, run relevant tests, push `balodi`, integrate into `main`, verify the deployed source commit, and check the public homepage and route API. Use the site's demo route to test the UI without inventing a user's location. Never present a preview as real GPS movement.

For data changes, preserve original files and checksums, document thresholds, rebuild reproducibly, inspect gaps and map coverage, rerun survey/routing tests and restart cached services. For model changes, document coefficients and evidence, compare routes across settings and rerun validation deliberately. Do not replace historical simulation results silently.

Further project documents:

- README: quick setup, usage, repository guide and API examples.
- `docs/METHODOLOGY.md`: formulas, calibration, model parameters and assumptions.
- `docs/FIELD_SURVEYS.md`: file inventory, quality rules and matching details.
- `docs/NAVIGATION.md`: location acquisition, arrow, lifecycle and browser limits.
- `docs/DEPLOYMENT.md`: Vercel setup and release checks.
- `docs/REFERENCE_REVIEW.md`: supplied literature and scope decisions.
- `docs/VALIDATION.md`: historical seeded simulation, with its limitations.
- `docs/CHANGE_VERIFICATION.md`: dated verification notes from implementation work.

The source code and processed data are the implementation reference. This guide is intended to explain that implementation without turning assumptions, simulations or UI behaviour into unsupported research claims.
