# Professor-supplied field recordings

All eight supplied originals are preserved under `backend/datasets/field_surveys/source/`. The generated `surveys.json` records their SHA-256 checksums and retains full-resolution accepted samples for local matching. The public API omits full-resolution samples and returns split, decimated display geometry, summary metrics, speed profiles and candidate events.

## Rebuild

From `backend/`, using the existing Conda environment:

```powershell
python -m pipeline.import_surveys
```

Restart the server after regenerating the catalogue: loaded data and spatial indexes are cached per process. No online service or new package is required.

## What the files contain

These are individual car GPS recordings, not a crash database or a representative traffic survey. `Lat` / `Lng` are the CSV track positions. `Time` is UTC; the UI displays India time. `SpeedKPH` is recorded speed in kilometres per hour. `Acc` is GPS accuracy in metres, **not acceleration**. Original coordinates, alternative speed units, device fields and exports remain available in the unchanged originals.

| Corridor | Input rows | Usable | Distance retained | Gaps >5 s | Braking candidates |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ena to Dehgam, NE04 | 3,206 | 3,206 | 71.57 km | 2 | 1 |
| Vadodara to Anand, NE01 | 1,661 | 1,661 | 34.59 km | 2 | 2 |
| Narmada bridge to Kamrej, NH48 | 2,528 | 2,528 | 49.86 km | 2 | 1 |
| Mandal / Manal to Bhatia, NH53 | 8,940 | 8,933 | 140.46 km | 152 | 4 |

The NH53 CSV and KML use different spellings for the starting toll; both are preserved in the displayed label. The CSV runs from 24 to 25 July 2026 and contains substantial gaps. It is not represented as one continuous overnight drive.

## Processing rules and assumptions

- Reject missing/non-finite fields, invalid coordinates, speed outside 0–200 km/h, and GPS accuracy outside (0,25] metres. These are documented quality thresholds, not statutory limits.
- Preserve file order. Split on nonpositive time steps, gaps greater than five seconds, or implied positional speeds above 60 m/s. Never draw a line across those breaks. Isolated points are retained as samples but do not form line geometry.
- Sum geometric distance and elapsed time only across accepted adjacent intervals. Rounded distances are approximate and exclude gaps. Median and 85th-percentile speeds describe accepted GPS samples, not an exposure-weighted traffic population. Kilometre bins use accumulated retained distance, not official chainage, and a bin may span a recording break.
- Compare KML track positions against CSV positions at matching UTC timestamps. Median offsets are approximately 25–27 metres. KML is a different export and has fewer points, particularly for NH53. Do not join positions and speeds by row index. Display geometry follows CSV coordinates so positions and speeds remain paired. KML is used for provenance and export-consistency checks; its geometry is not substituted silently.
- A braking candidate is a recorded speed decrease of at least 3 m/s² over a valid interval, starting at 20 km/h or more. Candidate onsets within five seconds are grouped. This is a screening heuristic for field review, not a validated driving classifier. GPS noise, filtering and sampling can produce false positives. No crash, speeding offence, road defect or driver fault is inferred.

## Application integration

Open **Field trips** from the map controls. Inspect all four corridors, recorded speed per kilometre, quality counts and candidate locations. **View recorded trip** displays the full corridor as a purple line, including portions outside city bounds. Gaps stay disconnected. **Clear field trip from map** removes it. Planning a normal route also clears the field-trip overlay.

`GET /api/surveys` supplies the same catalogue in FastAPI and the fallback server. Car route responses include `routes.<choice>.field_surveys`: nearby observations from the recordings, with corridor ID/name, approximate matched length and median recorded speed on matched samples.

Matching resamples route geometry at approximately 25 m intervals and finds the nearest survey sample within 30 m whose bearing differs by at most 45 degrees. Less than 100 m of overlap is suppressed. This is conservative **proximity and heading matching**, not authoritative map matching. Parallel roads can still be confused and valid matches can be missed. The projected distance approximation is local to Gujarat. Sample speed summaries may repeat nearby samples and are descriptive only.

The observations do not change crash-risk coefficients, estimated travel times, speed limits, lighting or blackspot classifications. One car recording cannot justify generalising operating speed across times, modes and directions. Walking and two-wheeler responses receive no car-survey evidence. Existing risk calculations remain reproducible.

These files do not contain a complete routable highway network. Existing city routing boundaries remain in effect. Of the accepted samples, 288 NE01 readings fall within Vadodara and 6,023 NH53 readings fall within Surat; NE04 and NH48 have no readings inside the current city bounds. Being inside a bounding box does not guarantee a road match. The whole of each supplied corridor can be explored as a recorded trip; new intercity alternatives require an independent road graph and access restrictions.

## Checks

Tests cover all files and row accounting, deterministic rebuild, preservation of gaps, direction/mode/distance gating, public payloads and evidence attached to real car route responses. Run `python -m pytest -q backend/tests` from the repository root.
