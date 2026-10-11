# Validation: fastest vs safety route

Seeded simulation (`python -m pipeline.validate 25`): 25 random origin–destination pairs per region,
3–15 km apart (straight line), each planned for car and two-wheeler at 09:00 and 22:00 with the
default settings (safety priority 0.7, detour cap 25 %). *Fastest* is the standard time-only route.

| Region | Mode | Hour | Trips | Routes differ | Risk reduction (mean / median) | Extra time (mean) | Safety score | Blackspots passed | Unlit km (night) | Risk cut per extra min | Median compute |
|---|---|---|---|---|---|---|---|---|---|---|---|
| surat | car | 09:00 | 25 | 100% | 21.7% / 23.8% | 11.5% (+3.0 min) | 70 → 77 | 0 → 0 | – | 7.2 %/min | 185 ms |
| surat | car | 22:00 | 25 | 100% | 25.2% / 24.5% | 13.7% (+3.2 min) | 70 → 78 | 0 → 0 | 1.55 → 1.89 | 7.8 %/min | 237 ms |
| surat | two_wheeler | 09:00 | 25 | 100% | 25.9% / 28.4% | 13.1% (+3.5 min) | 71 → 79 | 0 → 0 | – | 7.5 %/min | 190 ms |
| surat | two_wheeler | 22:00 | 25 | 100% | 26.1% / 26.2% | 13.6% (+3.3 min) | 71 → 78 | 0 → 0 | 1.55 → 1.86 | 7.8 %/min | 223 ms |
| ahmedabad | car | 09:00 | 25 | 100% | 23.7% / 20.3% | 12.7% (+3.7 min) | 71 → 78 | 14 → 7 | – | 6.4 %/min | 251 ms |
| ahmedabad | car | 22:00 | 25 | 100% | 28.4% / 25.1% | 15.6% (+4.1 min) | 69 → 78 | 15 → 6 | 1.71 → 1.81 | 7.0 %/min | 253 ms |
| ahmedabad | two_wheeler | 09:00 | 25 | 100% | 27.4% / 22.5% | 12.0% (+3.5 min) | 70 → 79 | 14 → 7 | – | 7.7 %/min | 253 ms |
| ahmedabad | two_wheeler | 22:00 | 25 | 100% | 28.5% / 26.3% | 14.8% (+4.0 min) | 69 → 78 | 15 → 6 | 1.71 → 1.79 | 7.2 %/min | 238 ms |
| vadodara | car | 09:00 | 25 | 100% | 23.0% / 22.6% | 11.1% (+3.0 min) | 72 → 79 | 11 → 3 | – | 7.7 %/min | 211 ms |
| vadodara | car | 22:00 | 25 | 100% | 29.8% / 26.5% | 14.9% (+3.6 min) | 71 → 79 | 8 → 2 | 1.34 → 1.71 | 8.3 %/min | 270 ms |
| vadodara | two_wheeler | 09:00 | 25 | 100% | 25.1% / 20.7% | 10.9% (+3.1 min) | 72 → 80 | 11 → 3 | – | 8.2 %/min | 206 ms |
| vadodara | two_wheeler | 22:00 | 25 | 100% | 28.8% / 26.2% | 13.9% (+3.5 min) | 71 → 79 | 7 → 3 | 1.34 → 1.55 | 8.2 %/min | 270 ms |
| rajkot | car | 09:00 | 25 | 100% | 24.1% / 23.1% | 13.2% (+3.4 min) | 71 → 78 | 2 → 1 | – | 7.1 %/min | 174 ms |
| rajkot | car | 22:00 | 25 | 100% | 33.4% / 33.5% | 15.8% (+3.7 min) | 68 → 78 | 4 → 1 | 1.80 → 2.28 | 9.1 %/min | 223 ms |
| rajkot | two_wheeler | 09:00 | 25 | 100% | 26.8% / 24.5% | 13.9% (+3.7 min) | 71 → 79 | 2 → 1 | – | 7.4 %/min | 181 ms |
| rajkot | two_wheeler | 22:00 | 25 | 100% | 33.4% / 33.7% | 15.7% (+3.7 min) | 68 → 78 | 4 → 1 | 1.80 → 2.28 | 9.1 %/min | 186 ms |

**All 400 trips:** risk reduction 26.9% mean (24.8% median) for 13.5% more travel time on average (+3.5 min); safety score 70 → 78; blackspot passes 107 → 41.

**Lighting finding.** At 22:00 the safety route carries slightly *more* poorly lit road (1.60 → 1.90 km per trip; share 14.2 % → 16.7 %). Part of this is extra length; the rest is the model preferring slower local roads, because speed (power-model severity) outweighs lighting (HSM night-crash CMF 0.72). We tested a lighting-dominant personal-security weighting at up to 6x: it moved the unlit share by under one percentage point, because satellite night lights (~500 m) give neighbouring candidate routes nearly the same lighting value. Street-level lighting data (municipal streetlight GIS) is the main data gap for night-time personal-safety routing.

**Optimality check:** A* returned the same optimal cost as SciPy's Dijkstra in 48/48 cases (car, 22:00, λ ∈ {0.3, 0.7, 1.0}).

Risk figures are model outputs (see METHODOLOGY.md); they rank routes consistently but are not
measured crash outcomes. Field validation would need geo-coded crash records (e.g. iRAD) for these cities.
