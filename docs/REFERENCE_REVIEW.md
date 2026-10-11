# Reference review and scope decisions

The five supplied documents are background references. Their proposed tasks do not override the team's current safety-only scope.

| Reference | Relevance to this implementation | Boundary |
| --- | --- | --- |
| Bouhsissin, Sael and Benabbou, *Driver Behavior Classification: A Systematic Literature Review*, IEEE Access (2023), DOI 10.1109/ACCESS.2023.3243865; supplied as `10041146.pdf` | Explains behaviour classification, datasets and sensing approaches | No driver telemetry or labelled behavioural data is available here. The app does not infer aggressive driving or claim a trained behaviour classifier. |
| Dr. Shriniwas S. Arkatkar, *Crash Data Analysis & Black Spot Treatment*, road safety auditor course (2021), 143 slides | Supports examining road environment, crash locations, severity and junction design together | Routing around a recorded blackspot is not a road treatment or proof of a causal reduction in crashes. Site diagnosis and before/after evaluation need field evidence. |
| *Measurement of Traffic Flow Characteristics at Mid-Block Sections*, 62 pages | Background on speed, flow, measurement and the difference between observations and traffic models | Time estimates here use assumed demand patterns; they are not observed live traffic measurements. |
| *Route Optimization Based on Safety, AQI & Efficiency*, six-slide proposal | Original motivation and team/project context | AQI and separate traffic-efficiency objectives are now outside this team's scope. Proposal claims about real-time feeds or pollution outcomes are not implemented or verified results. |
| *Project Implementation Guide*, four pages | Suggested architecture, milestones and SVNIT project context | The proposed React/OSMnx/PostGIS stack is not the actual stack. Use README for the implemented architecture and setup. |

## Current research position

The existing implementation combines road and junction models with historical crash records and coarse lighting/security proxies. It can compare modelled routes, quantify the detour and expose the reasons for a choice. It cannot establish that those choices reduce observed crashes without suitable independent validation.

The detailed coefficients remain in `METHODOLOGY.md` and code. Reviewing the supplied documents does not independently validate every pre-existing coefficient or source record. No new crash data or numerical research claims were fabricated from these references.

## Next evidence needed

1. Verify blackspot coordinates, dates and attribution against primary records.
2. Check sample recommended routes in the field, including access restrictions, turn prohibitions and lighting.
3. Obtain geocoded incident and exposure data for held-out validation rather than evaluating only against the model's own risk function.
4. Compare routes across modes, departure times and a range of origins/destinations. Report detour and modelled risk separately from actual crash outcomes.
