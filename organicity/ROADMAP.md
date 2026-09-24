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

Next: heightmap terrain and map presets, flooding, snow and snowplows, and
lightning (H). Then trams, rail and metro with mode choice (I), and demographics,
education, health, crime and ordinances (J). After that come disasters and events
(K), neighbour cities and larger chunked maps (L), and audio, photo mode, touch
controls, tutorials and city sharing (M).

Validation for the combined increment: 19 headless regression tests, JavaScript syntax
checks, and browser checks of tints/restoration, worker routes, highway switching,
snowfall, travel-time changes, save/reload and selection cleanup passed.

Validation for phase G: 39 headless regression tests pass. A scripted browser run in sandbox, pushed to 2080, showed air trips over 26 hub pairs, 4 skybridges, capacity bonuses on all 12 towers, and the vehicle worker running without errors.
