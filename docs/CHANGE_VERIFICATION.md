# Planner location acquisition (14 November 2026)

- Replaced the separate high-accuracy-only, 10-second request behind Use my location with the shared precise/network tracker and a bounded 35-second request lifecycle.
- Added persistent permission/service status, retry/cancel, explicit approximate-origin selection, browser handoff and a selectable page address. Failed requests preserve existing trip entries.
- Frontend: 50 tests passed, including fallback after high-accuracy failure, approximate-origin consent, expiry, cancellation, denial/retry and a permission prompt that never completes. JavaScript syntax and whitespace checks passed. No packages installed.
- Browser check: the embedded browser still reported pending permission. Obtaining an actual device reading remains unverified and requires a browser/device location service that completes the request.

# Map location simplification (14 November 2026)

- Removed speech synthesis, voice prompts, mute/repeat controls and the large turn instruction panel. The selected route remains visible with a compact location card.
- Added a rotating location arrow using device heading or meaningful measured displacement. Accurate and approximate positions update the marker; approximate readings retain an uncertainty circle and do not advance route progress.
- Frontend: 43 tests passed, including marker movement/rotation/reuse, stable heading, approximate updates, recenter, permission recovery and cleanup. JavaScript syntax and Git whitespace checks passed.
- Browser: verified the new Follow my location control and a labelled route preview with a moving, rotating arrow, compact card and no voice controls or turn panel. End preview restored the planner and removed the location arrow.
- No new dependencies. Real-device movement remains unverified; browser/device location permission is still necessary. Changes remain local on `balodi`.

# Location recovery fix (14 November 2026)

- Frontend: 40 Node tests passed, including permission states, initial timeout, network bootstrap, approximate locations, stationary refresh, stale callbacks, bounded reconnection, retry and explicit preview recovery.
- Browser: live mode reported pending location permission instead of falsely claiming GPS loss. Retry preserved the trip; preview remained explicitly simulated. No browser location permission was granted during verification.
- Accurate device movement and on-road guidance remain unverified. The embedded browser had not supplied a position; the UI explains enabling permission or opening the trip in a regular browser.
- No dependencies installed. Changes remain local on `balodi`.

# Navigation integration (14 November 2026)

- Backend: 73 tests passed, including direction offsets, time/distance conservation and distinct roundabout entry/exit. The existing Starlette/httpx warning remains.
- Frontend: 24 Node tests passed for trip helpers, navigation progression, voice playback/mute/deduplication, GPS gating, arrival, crossings, rerouting, permission denial and resource cleanup.
- Browser: selected-route preview, moving location, changing instructions, remaining distance/time, mute/unmute/repeat and mobile layout at 390 x 844. Simulated trip completion correctly showed an unmapped final connection instead of claiming destination arrival.
- Live GPS movement, physical audio output and on-road route legality have not been independently validated. See NAVIGATION.md for release limits.
- Existing Conda environment used; no packages installed. Earlier field-survey work remains present. No commit or push performed for this change.

# Field data integration (13 November 2026)

- Imported all four supplied CSV/KML pairs with SHA-256 source checksums and a deterministic offline rebuild.
- 16,335 input readings, 16,328 accepted. Recording gaps, backwards/duplicate times and position jumps are excluded from continuous geometry/distance/duration.
- Backend: 71 tests passed; frontend: four tests passed. Existing Starlette/httpx deprecation warning remains.
- Browser: all four catalogue entries load, full NE04 corridor draws as a purple line outside city bounds, persistent recorded-trip label and clearing controls are present.
- Real NE01 route evidence is covered by a route-response regression test; direction/mode/distance exclusions and synthetic recording-gap behaviour are covered separately.
- No packages installed. Existing crash-risk coefficients and travel-time calculations are unchanged by these individual car recordings.

# Change verification (25 October 2026)

- Used the existing `saferoute` Conda environment. No dependencies were installed.
- Backend suite: 64 tests passed. New coverage checks mode-specific nearest-node snapping and detour caps for car, two-wheeler and walking. One existing third-party Starlette/httpx deprecation warning remains.
- Frontend: four Node tests passed for coordinate parsing, midnight arrival, factual route explanations and saved-trip validation. JavaScript syntax checks and Git whitespace checks passed.
- Browser: keyboard-only local place selection, automatic destination focus, trip planning, save/reopen/delete, selected-route restoration and a 470 m access warning.
- Mobile at 390 x 844: Show map reduced the panel to 94 px and kept the route visible. Show trip restored the controls. The viewport was reset after testing.
- The previous model simulation was not regenerated. This change adds no claim of observed crash reduction or general routing speedup.

## Earlier verification (11 October 2026)


- Backend suite: 57 tests passed, including HTTP validation and the lightweight route response. One third-party Starlette/httpx deprecation warning was emitted.
- JavaScript syntax checks and `git diff --check` passed.
- Browser checks: city selection, sample route planning, shared-trip restoration, directions, light/dark themes and a 390 x 844 mobile viewport.
- Single warm-cache benchmark, SVNIT campus to Dumas Road, car at 21:00: full research response 336 ms / 35,484 JSON bytes; lightweight response 77 ms / 19,253 bytes. This is a local sample, not a throughput benchmark or universal speedup claim.
- The existing 400-trip simulation report was not regenerated and remains a separate prior result.

Run commands and architecture are documented in the README. Temporary test dependencies were isolated from the user's Conda environment.
