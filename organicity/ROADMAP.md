# Organicity: next playable features

Implemented in this increment:

- Service funding, 50–150%, per service type. Scales upkeep and utility capacity;
  road-based coverage scales with the square root of funding and effectiveness
  scales linearly. Funding is included in worker snapshots.
- Up to three loans, fixed monthly payment, 1% monthly interest accrued daily,
  12-month UI term, early repayment without fees. Debt service appears in expenses.
- Three-month cash forecast at current rates, and money/income/expense histories.
- Visible next-level checklist, school/clinic requirements from level 3,
  transit and land-value requirements from level 4, educated workforce for top offices.
- Five-day initial construction and 4 + 2 × level days for upgrades. No capacity
  during construction; unfinished masses and scaffold posts mark the site.
- Building level, age, happiness and combined-problem ground overlays; inspect
  hover readouts, with traffic showing flow and utilization. Pollution and similar
  fields remain normalized simulation indices rather than physical measurements.
- Optional Thriving Town and Prosperous City goals from the new-game screen.
  Goals appear in Budget; completion persists and allows continued play.
- Save v3 migration for budgets, loans and construction. Existing saves remain usable.

Validation: `node scripts/organicity-test.mjs`.

Implemented together in the next increment:

- Building-tint overlays reuse colour buffers; the overlay panel can disable them.
  Turning analysis off restores original colours. Snow whitens roofs outside overlays.
- Inspect a building for directed, congestion-weighted routes to the fastest reachable
  staffed workplace and an outbound highway exit. Curved and partial road segments
  are traced with direction arrows. Worker results are rejected after network edits
  or selection changes. These are representative routes, not per-citizen assignments.
- Four 90-day seasons and seeded five-day weather periods: clear, rain, snow, fog,
  heatwaves and storms. Weather changes road speed and wear, fire risk, utility
  demand and wind power. Sky, fog, precipitation, snowy ground and roofs reflect it.
  Sandbox weather overrides are saved in v4; old saves migrate automatically.

Since then (save v6):

- Traffic and roads: junction controls and queues, visible agent traffic in its own
  worker, bus lines with bus lanes, elevated roads, tunnels and ramps.
- Economy: tax brackets, utility trading, specializations and landmarks.
- Environment: wind-driven smoke, water pollution and a day/night cycle.
- Eras: 1800/1900/2000 starts and rising height ceilings, ending in cyberpunk
  skylines with free-flying air cars.
- Terraces: decks attach at any floor and host services.

Phase G, closing the gaps:

- Annex and cantilever storeys come from `massPlan` (eras.js), so the skyline you
  see is the capacity the simulation counts.
- Skybridges come from the same model in the simulation and the renderer. Linked
  towers share service coverage and get +4% land value per bridge.
- Air traffic is modelled. Hub residents' trips fly to the hub nearest their
  destination while both pads have capacity; the rest drive. Air cars follow these
  flows, and busy pads glow amber or red.
- Bankruptcy, outside sandbox:
  - a warning while in debt;
  - after 3 months, service funding is capped at 75%;
  - after 6 months, a state bailout at 2% a month, or loss of an open scenario.
- Sandbox placement stamps finished, level-locked buildings onto zoned lots.

Phases J, L and M (save v7):

- People and society:
  - Every home has children, adults and retirees. New homes draw young families,
    and residents age with the building. Adults make up the workforce, and
    retirees pay about half the tax.
  - Education runs from school seats to a college (1,500 people) and a university
    (5,000). Graduates staff level-5 offices, and tech firms need a university.
  - Clinic capacity counts retirees three times. Unserved or overloaded homes risk
    illness outbreaks that spread to neighbouring buildings.
  - Eight ordinances, each with a monthly cost: curfew, noise limits, smoke
    detectors, green roofs, free transit, a high-rise ban, car-free centres and a
    vaccination drive. Car-free centres are district policies: a third of their
    trips walk or cycle.
  - A news feed with monthly headlines on named streets, plus seven advisors that
    each link to the overlay showing the problem.
  - New overlays: health, retirees and higher education.
- Scenarios:
  - A guided 10-step tutorial with an on-screen coach.
  - "Fix the gridlock": a fixed-seed city whose homes and jobs are joined by one
    lane, with a two-year deadline.
  - "Balance the books": an overspending town already in debt.
- Region and scale:
  - A named neighbour city beyond each highway exit. Neighbours grow, faster while
    trading.
  - Goods exports from industry, and utility prices that float with the seasons
    and the neighbours' size.
  - Commuter flows shown per neighbour.
  - Distant render chunks are swapped for box stand-ins (level of detail).
  - Vehicle poses are interpolated between worker frames.
- Presentation:
  - A procedural Web Audio soundscape: city hum, nearby traffic, rain, sirens,
    birds and a cyberpunk pad.
  - Photo mode (P): hidden UI, low camera angles, a time-of-day slider and
    crisp PNG export.
  - Touch: one finger builds; two fingers pan, pinch to zoom and twist to rotate.
  - Settings: volume, colour-blind overlay palette, reduced motion, interface size
    and level of detail.
  - Cities share as gzip-compressed links (#city=…) or .organicity files, with
    import on the start screen.

Not done:
- Maps are still 512×512. With current lot sizes a full map holds about 1,500
  buildings, so the ">5k buildings" target isn't reachable. A full map runs a core
  pass in about 0.3 s on the main thread.
- Phase K (disasters and events beyond flooding and lightning) remains.

Validation for the combined increment: 19 headless regression tests, JavaScript syntax
checks, and browser checks of tints/restoration, worker routes, highway switching,
snowfall, travel-time changes, save/reload and selection cleanup passed.

Validation for phase G: 39 headless regression tests pass. A scripted browser run in sandbox, pushed to 2080, showed air trips over 26 hub pairs, 4 skybridges, capacity bonuses on all 12 towers, and the vehicle worker running without errors.

Validation for phases J, L and M: 51 headless regression tests pass. A browser run covered the gridlock scenario, every new panel, the colour-blind palette and interface size, photo mode and PNG export, opening a shared link, the tutorial coach and the audio graph, with no new console errors.


Phases H and I (save v8):

- Fixed stationary street vehicles: rendering interpolates consecutive worker
  snapshots instead of restarting from the last rendered position on every update.
- Weather now stays in a seeded 30-day regime (previously five days).
- New-game maps: river plain, rolling hills, coastal hills and island chain.
  Hills raise road construction costs. Roads, vehicles, buildings, trees and
  ground picking use the heightfield; worker snapshots preserve elevation and speed.
- Rain and storms raise water levels. Floodwater spreads from connected water,
  loses energy inland and is blocked by continuous levees. Gaps admit water.
  Paint levees with Terrain (T), including outside sandbox; placement costs,
  maintenance, demolition, undo and saving are supported.
- Powered storm drains reduce local flood depth. Floods slow roads, displace
  residents and interrupt submerged services. Elevation, flood and snow overlays
  and land/road inspectors expose the state.
- Snow accumulates, persists after snowfall and gradually melts. Funded snowplow
  depots clear roads on their network within their coverage radius. Routed plows
  appear in traffic. Ground and roofs reflect accumulated snow.
- Seeded storm lightning has a visible bolt and can ignite a building, using the
  existing fire dispatch system. Sandbox fire suppression and reduced motion apply.
- Transit lines (L) now support bus, tram, rail and metro with distinct stations.
  Tram tracks follow road routes; rail constructs dedicated elevated tracks with
  piers; metro constructs direct underground connections, shown schematically in
  the transit overlay. Trams queue with road traffic; rail/metro trains follow
  their independent alignments.
- Track construction costs, line/station upkeep, fares and mode capacities differ.
  Trip choices consider walking, waiting and ride time; road transit also reflects
  congestion and weather. Full lines leave excess trips driving, or unserved when
  no road path exists. Rail/metro can carry trips across disconnected road networks.
- Transit statistics distinguish car, bus, tram, rail, metro, air and walking.
  Functioning new stations contribute to transit coverage and building levelups.
- v8 preserves presets, accumulated snow, water level, levees and transit modes;
  older cities retain their original flat river map and bus lines.

Current scope: flooding uses a simplified daily propagation model, not a fluid
solver. Snow is aggregate with local road clearing. Plow vehicles represent depot
coverage rather than clearing individual cells as they pass. Transit is direct-line
assignment without transfers or timetables; rail alignments are straight between
stations and metro is visualized above ground only in the transit overlay.

Validation: `node scripts/organicity-test.mjs`. Browser regression scripts are
`scripts/organicity-browser-test.mjs` (moving vehicles and controls) and
`scripts/organicity-features-browser-test.mjs` (hills, stations, tracks, trains and
levees). Serve the repository on port 8777 and provide Playwright through the
normal package resolver or `PLAYWRIGHT_MODULE`; `CITY_URL` overrides the URL.
