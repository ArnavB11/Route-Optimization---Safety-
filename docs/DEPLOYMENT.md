# Vercel deployment

Live app: [route-optimization-safety.vercel.app](https://route-optimization-safety.vercel.app). The initial production deployment used `balodi` commit `f215a5b`. Public API checks confirmed five ready cities, four survey corridors, and successful fastest/safer route calculation for a Surat trip.

Import this repository into Vercel with repository root `./` and framework **FastAPI**. The root `app.py` exports the same application as the local server. `pyproject.toml` selects Python 3.12 and runtime dependencies. `vercel.json` configures a 60-second function limit and excludes development inputs. No API keys or database setup are required.

Deploy `balodi` when reviewing current work. The owner’s integration workflow remains `balodi` to `main`; use `main` as production after merging when adopting automatic production deploys. Do not deploy just `frontend/`: the same-origin `/api/*` routes need the Python backend and processed graph files.

Keep `backend/data/{surat,ahmedabad,vadodara,rajkot}/` and `backend/datasets/field_surveys/surveys.json` in deployment artifacts. Raw Overpass downloads and pipeline/test files are excluded. Processed graph inputs are about 30 MB; Vercel also bundles installed Python dependencies and enforces its function size limits. Large graph initialization can cause cold starts. Caches are per function instance and need no persistent disk writes.

After deployment check `/`, `/js/app.js`, `/api/cities`, `/api/surveys` and a real `/api/route` request. Confirm all five cities are marked ready. Test route selection and preview in a browser. HTTPS permits browser geolocation, but each visitor still needs browser/device location permission; hosting cannot guarantee GPS availability.

The first release was checked locally using the existing Conda environment: 73 backend tests and 50 frontend tests passed. Root-entry-point smoke checks returned HTTP 200 for the home page, JavaScript, cities and surveys. No dependencies were installed locally.

Reference: [Vercel FastAPI deployment documentation](https://vercel.com/docs/frameworks/backend/fastapi).
