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
