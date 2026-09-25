# Organicity roadmap

## Where we are

Every phase through T is playable, plus the regional economy (portals, families, rents, tolls and presidents),
live governors (U0) and infrastructure and resources (Y). Phases: A–G, H (terrain and water), I (mass transit),
J (people and society), K (disasters and events), L (region and scale),
M (presentation), N (a connected region), O (terrain tools), P (transit and
freight), Q (economy), R (simulation fidelity), S (platform), T (deeper region
play), U0 (governors build real cities) and Y (utility networks, resources and
industry, a visible region). Saves are at v10; older saves migrate automatically
(new fields are optional).
Tests: `node scripts/organicity-test.mjs` (105 headless tests), plus the two
Playwright scripts described at the end of this file.

What a city has today:

- **Land:** four map presets on a 512×512 tile. Roads and lots grade the terrain;
  steep roads get tunnels and viaducts. A terraforming brush reshapes ground.
- **Weather:** rain and snow come in bands, and storms in cells, that sweep across
  the tile with the wind. Only roads under them slow down, and lightning strikes
  inside the cells. Rain ponds in hollows. Storms are forecast three days ahead,
  with a count of buildings at risk. Trees change with the seasons.
- **Roads:** free-form curves, one-ways, junction controls, elevated roads,
  tunnels, ramps and bus lanes. A road drawn to the map edge becomes a regional
  exit.
- **Growth:** road-Voronoi lots, procedural buildings, levels 1–5, merging and
  splitting lots, specializations and gentrification.
- **Eras:** 1800 → cyberpunk, with terraces, skybridges, sky hubs and air traffic.
- **Traffic:** deterministic assignment with congestion, plus visible agents in a
  worker. Rush hours (07–09:30, 16–19) fill the streets and nights are quiet. The
  HUD shows the time of day.
- **Transit:** bus, tram, rail and metro with peak and off-peak timetables, and
  journeys with any number of transfers.
- **Freight:** a goods chain, and cargo rail, harbour and airport terminals.
- **People:** follow any resident through their day (home, commute on their real
  route, work, home) with a diary and a following camera.
- **Economy:** bonds and credit rating, insurance and preparedness, land tax,
  ordinances, trade, exports and utility deals.
- **Region:** a 5×5 world map of cities you found and switch between.
  - Edges continue across tiles, and older cities ease toward newer neighbours.
  - Other cities keep growing in the background, so deals and commuters use
    projected numbers.
  - A university, college, airport, harbour or cargo rail is shared with
    road-linked neighbours.
  - AI neighbours grow and shrink.
- **Platform:**
  - Installable and playable offline (manifest and service worker).
  - A light performance profile for phones.
  - Content packs of district styles and landmarks, sanitised and saved with the
    city.
  - Interface in English, Hungarian and German.
- **Regional economy:**
  - Every city tile has a president, a treasury, housing with rents and jobs with
    salaries.
  - Road exits are portals with toll booths; tolls go to the tile being entered.
  - Families live, work, commute and migrate between tiles.
  - AI presidents compete with you, and every ten years a term ends with a
    comparison of all presidents.
- **Governors and a visible region:**
  - Other governors build real cities: an AI builder lays out streets and zoning,
    utilities and services in phases, with a cash reserve, and works resource deposits.
  - Cities within two tiles run at full simulation in a background worker.
  - Every tile's land is pregenerated in the background, continuing its neighbours'
    coasts, rivers and hills. A city founded there later grows on that same land.
  - All 24 other tiles are drawn around your city, stitched onto its edges, with the
    weather's tint. Full texture (in Settings) draws their lots, roads, shores and
    woods pixel by pixel.
  - Take over an AI city as its governor, or hand one of yours to an AI.
- **Utility networks:** roads still carry power, water and sewage. Power lines (on
  pylons), water pipes and drains join separate road networks into one grid per
  utility, so a plant out of town can feed it. Drains take rain ponds away. The
  optional strict grid needs every building to have all three within reach. There
  is an underground view. Lines cost per metre and have upkeep.
- **Resources and industry:**
  - Seeded deposits (forest, coal, stone, iron and ore) show on the resources overlay.
  - Lumber camps, mines and quarries must sit on a deposit and slowly work it out;
    forests regrow.
  - Seven processors: sawmill, paper mill, furniture works, cement works,
    steelworks, smelter and machinery plant.
  - The market:
    - Leftovers sell at drifting prices if they can leave town.
    - The commodity exchange pays better and imports missing inputs.
    - Warehouses hold stock while prices are low.
  - Plants need road, power, water and workers.
  - Local coal cuts coal plant upkeep, furniture and paper stock the shops, cement
    and steel cut road upkeep, and machinery lifts industrial output.
  - Trucks carry the loads.
- **Presentation:** pedestrians on the pavements, optional ordered dithering and
  light glow (bloom), advisors, news, tutorial and scenarios, sound, photo mode,
  touch controls, accessibility settings, and share links and files.
- **Gentler hazards:** storm surges are rare and shallow, and rain makes puddles,
  not lakes. The zoning brush only paints empty land (Shift repaints).

Known limits:

- A tile holds roughly 1,500 buildings at current lot sizes.
- Inactive cities are projected from their recent trend, not fully simulated.
- Only one resident at a time is followed. Their day follows the visual clock,
  which is independent of the simulation's daily economy.
- Translations cover the menus, dock, HUD, panel titles and start screen; help
  texts and panel contents are still English.
- Pack landmarks use simple box and cylinder models.
- Families are households. Their number in the played city follows the city's
  occupancy: the city's own growth brings newcomers from outside the region.
  Moves between buildings and tiles are family decisions.
- AI cities more than two tiles away have no map yet: their housing and jobs are
  synthetic blocks, handled in aggregate, drawn as a skyline on their pregenerated land.
- Only the played tile has traffic and pedestrians. Background cities simulate
  without vehicles, and the host runs one tile job at a time (about a second each for
  land, a few seconds for a city month) while the game is in view.
- Tile views are 128×128 snapshots: other tiles show boxes for buildings, not
  procedural models.
- Utility lines are straight runs with unlimited capacity; resource trade stays
  within the city's market (no commodity trade between tiles yet).

## Next steps

### Z — Enhancements to infrastructure, industry and the visible region (delivered)
- **Z1. Freight you can see.**
  - Trucks, coloured by commodity, run from working plants to the next plant, a
    terminal or the highway.
  - Industry sales add freight at the regional exits.
- **Z2. Depletion and reclamation.**
  - Warnings as a seam runs out.
  - Worked-out pits and mines can be reclaimed into a lake, and lumber camps into
    replanted woods (undoable).
- **Z3. Regional commodity market.**
  - Every other city's last-month sales are supply; its purchases and its people's
    appetite are demand.
  - Scarce commodities fetch up to ×1.45, gluts down to ×0.7.
  - Rival exchanges trim your exchange's premium.
  - Imported inputs are cheaper when a neighbour sells them.
  - The industry report has a Region column.
- **Z4. Utility capacity.**
  - Each run carries a limited load: 80 MW per power line, 160 units per pipe or drain.
  - A network imports only what its lines carry, and a substation adds 240 MW.
  - Overloaded runs show red in the underground view, and the advisor tells you.
  - Pumps lift water 18 units above themselves and towers 30; homes higher up go dry.
  - Unpowered buildings go dark at night.
- **Z5. People with purpose.**
  - Pedestrians walk from real homes along the fastest route: to stops at rush hour,
    school in the morning, shops by day and parks in the afternoon.
  - They crowd a festival venue while one is on.
- **Z6. Richer neighbours.**
  - Adjacent tiles' buildings get facades with windows that light up at night.
  - Cars drive their streets.
  - Woods next door change with the seasons.
- **Z7. Industrial policy.**
  - District industry policies:
    - industrial park: +15% processing, +10% factory productivity;
    - mining district: +25% extraction, faster depletion, more pollution.
  - Per-plant scrubbers: −65% pollution for +40% upkeep.
  - Mines and mills raise demand for worker housing.
- **Z8. Smarter governors.**
  - AI cities follow fuller chains (up to machinery, exchange and warehouse).
  - They lay power lines and pipes from plants on separate networks, and build
    substations and water towers when needed.
  - They offer you monthly commodity contracts, accepted and ended in the industry
    report.

Also in this pass:
- **Underground layer.** Pipes and drains lie on one flat level below the lowest
  ground on the map. In the underground view:
  - the city is shown as ghosts, with trees and pedestrians hidden;
  - clicks land on the pipe level;
  - blue and brown ground shows what the water pipes and drains reach;
  - the underground bulldozer removes runs without touching roads or buildings.
- **Signs and glow.** Floating problem signs are drawn after post-processing, so no
  glow or dither touches them. Street lamps are softer, and bloom has a higher
  threshold.
- **Cars on slopes.** Vehicles pitch with the ground along their heading, smoothed
  and capped at ±0.45 rad.

### AA — Building, saving, desktop and multiplayer (delivered)
- **Icons and hover cards.** Every buildable has an icon rendered from its real model:
  services, utilities, industry, roads at each level, zones, lines and pipes. Hovering
  shows a card with the model turning in 3D, plus all its numbers (costs, outputs,
  coverage, inputs, pollution, unlocks).
- **Road levels and bridges.**
  - Three elevated levels, chosen with PgUp/PgDn.
  - Chained elevated roads hold their height through joints, ramping only where they
    meet another level or end.
  - Decks run level between their ends, with pillars down to the ground.
  - Ground roads over water become bridges that climb from the banks. They get piers,
    railings, and towers with cables on spans over 70 m.
  - Joints mid-river sit on the deck.
- **Desktop packages.** An Electron app serves the game from `app://` with bundled
  three.js, fully offline. It builds AppImage/deb/tar.gz, dmg/zip and nsis/portable,
  with a GitHub workflow and a smoke test.
- **Saved games.**
  - Whole regions are saved in IndexedDB, with a panel to save, load, overwrite, rename,
    delete, export and import them.
  - They also load from the start screen.
  - Ctrl+S quick-saves, and an autosave runs every five minutes.
- **Multiplayer.**
  - WebRTC data channels with pasted join and answer codes, or an optional
    zero-dependency signalling server.
  - The host keeps the region and runs the AI governors. Each player builds their own
    tile at the same time and sends their city every month.
  - Other players' cities appear next door and on the world map.
  - Chat, money transfers, monthly contracts, land claims and standings.
  - Everything a peer sends is checked.
  - The host can remove a player. The name is barred for the rest of the session;
    their land and city stay.
  - Either party can end a contract between players; the host checks it's really theirs.
  - AI governors' cities sell only for their value: ₵60k for the land, plus ₵150 per
    person, ₵90 per job, and the treasury. The host checks the price against its own
    numbers, stops running the AI there, and hands the city's save to the buyer.
- Known limits:
  - A player plays one tile per session; switching tiles leaves the session, but you
    can rejoin with the same name.
  - Players don't build together on the same tile.
  - Each player's regional economy is their own projection.
  - Players behind strict networks need a TURN server (settable in the panel).

### Next ideas
- Pipe and line capacity upgrades (bigger mains, high-voltage lines), and water
  treatment tied to pollution.
- Commodity flows between tiles as visible portal freight in the background
  simulation.
- Neighbour tiles with their real procedural buildings when viewed up close.

### U — Living citizens
- Many sampled residents with daily schedules (school for children, shops,
  errands), with their trips drawn from the same assignment as traffic.
- Personal stories in the news, such as a resident who moved out because of the
  commute.
- Children travel to their actual school, and students to college.

### V — Deeper regional economy
- Run neighbouring tiles' traffic in a worker at low detail, so portal congestion
  on both sides shapes route choice between several portals.
- Your own approval rating and elections: residents can vote you out of a tile.
- Region-level treaties and budget transfers between tiles (toll-free zones, joint
  services, shared transit across portals).
- Give AI cities real maps generated from their aggregates, so they can be viewed
  and later bought.

### W — Bigger and richer maps
- Variable tile sizes (768 or 1024) with chunked fields and rendering.
- Mountains with snow lines, rivers with flow direction, and islands with ferries.
- More lot shapes and building archetypes for denser cities.

### X — Content and community
- Translate the remaining texts; right-to-left support.
- Richer pack models (roof shapes, windows, emissive signs) and pack-defined
  scenarios.
- An opt-in gallery of shared cities and screenshots (needs a backend and
  moderation).

## History of delivered increments

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

Region, terrain grading, whole-tile weather and phase K:

- Weather covers the whole tile. Rain and snow fall over the entire map and follow
  the terrain; a denser patch around the camera keeps close-ups rich. Streak length
  and opacity scale with zoom.
- Roads grade the ground:
  - Each edge gets a smoothed profile with at most a 9% grade. When the two ends
    are further apart than that allows, the climb is spread evenly.
  - Every junction has a level plateau at the node's height, so roads leave it
    level and meet smoothly.
  - The band under a road is levelled and its shoulders blend back over 5 cells,
    never digging into water, lots or other roads.
- Lots sit on pads: a flat pad between the lot's average height and the road at
  its door, blended over 3 cells. Buildings stand on the pad.
- The ground mesh has twice the resolution, and heights are sampled bilinearly,
  so road edges no longer vanish into hillsides.
- Grading is saved as a compact difference from the natural terrain. Older saves
  replay grading on load.
- Region (SimCity 4 style):
  - A 5×5 world map (M, or "World" in the menu). Your first city sits in the
    centre. AI cities occupy the tiles beyond each highway exit and a few further
    out, and stand on the horizon in 3D.
  - Buy tiles next to land you own; each extra tile costs more. Found a city on a
    bought tile, then switch between cities. Inactive cities are stored compressed
    per tile.
  - Cities next to each other share commuters: jobless workers take neighbouring
    vacancies. Partner cities appear in the Region panel and enlarge the goods
    market.
- Disasters and events (phase K):
  - Earthquakes, tornadoes (spring and summer, more likely in storms) and
    industrial accidents (fire plus a chemical spill that triples pollution) on a
    seeded schedule. Nothing happens before 400 residents or while sandbox's
    "no disasters" switch is on.
  - Wrecked buildings become rubble. Ambulances come from clinics. Fire and depot
    coverage clear rubble faster, then the building is rebuilt a level lower. The
    city stays uneasy for a few weeks.
  - Quakes shake the camera, tornado funnels sweep their track and strip trees.
  - Parks and landmarks host monthly festivals: triple tourism, extra traffic to
    the venue, and fireworks at night.
  - Sandbox buttons trigger each event near the camera.

Validation: 61 headless tests pass. A browser run covered a hills map (road
grading and screenshots), storm rain across the zoomed-out tile, buying a tile,
founding an island city, switching back and forth, horizon skylines, and a quake,
tornado, rubble and fireworks in sandbox, with no new console errors.

Phases N, O, P and Q (save v9):

- N, a connected region:
  - A city founded next to one of yours inherits that neighbour's edge. Water
    follows it within 36 cells, with a wobbly shoreline, and heights blend within
    56. Saves keep this.
  - A road drawn to the map edge becomes a regional exit. Exits on the shared side
    of a neighbouring city become amber border posts, and road ends snap onto
    them. A newly founded city gets stub roads that line up with them.
  - Routed regional trips:
    - Inbound commuters enter by the exit facing the city they come from.
    - Residents working next door drive out through the exit facing it.
    - Freight is split across exits by the size of the neighbour beyond.
    - Loads per exit appear in the Region panel.
  - Utility deals: sell or buy 10–100 units of power or water with an adjacent
    city of yours at 85% of market price. A deal needs a road link on that side,
    and the seller delivers what its surplus allows.
  - AI cities follow a business cycle, grow with trade and shrink as your cities
    out-compete them; the world map shows their trend. Cities can be renamed.
- O, terrain tools:
  - A terraforming brush (raise, lower, level to the start height, smooth). It
    costs ₵3 per unit of earth outside sandbox, skips roads, lots and water, and a
    stroke can be undone.
  - Where a grade-limited road profile runs more than 6 units below the ground it
    becomes a tunnel with portals, leaving the hill intact. More than 6 above, it
    becomes a viaduct on piers, leaving the valley.
- P, transit and freight:
  - Each line runs every 5, 10, 15 or 30 minutes. That sets waiting time,
    capacity (double at 5 minutes) and running cost.
  - Riders transfer between two lines at stations within a 60-unit walk, with a
    penalty and a second wait.
  - A goods chain: shops need goods, supplied first by local industry and then by
    imports over roads and terminals. Short supply cuts shop income and
    happiness; only leftover goods are exported.
  - Cargo rail (1,500 people), harbour (3,000, by water) and airport (8,000)
    terminals take a share of export freight off the highway by capacity and
    raise goods prices by 8%, 15% and 5%. A harbour boosts industry demand, and
    an airport boosts office demand and brings tourists.
- Q, economy:
  - A credit rating from AAA to CCC, based on debt against yearly income, recent
    deficits and debt trouble. Bonds of ₵25k–250k over 10 or 20 years cost
    2–10%, pay interest monthly and repay at maturity; early redemption costs 2%.
    Loans remain for existing saves.
  - Disaster insurance: a premium of 0.04% of building value a month; claims pay
    80% of each wrecked building.
  - Preparedness funding: at up to ₵600 a month it cuts disaster damage by up to
    a third, clears rubble faster and discounts premiums.
  - Land market: lot prices from area and land value, and an optional 0–3% yearly
    land tax that slightly dampens housing and shop demand.
  - Gentrification: old low-rise homes on land worth over 68% redevelop and
    displace residents; the news reports where.

Validation: 71 headless tests pass. A browser run covered:
- opening an east exit, then buying and founding the tile beyond it: its west edge
  matched the neighbour's coast, and a stub road lined up with the exit;
- every budget and region panel section, including credit, bonds, insurance, land
  tax, exits, goods and deals;
- world map renaming, the three freight terminals and a terraform stroke.

There were no new console errors.

Phases R, S and T (save v10):

- R, simulation fidelity:
  - Weather fronts: rain and snow come in a 60–140-cell band moving with the wind
    (160–380 cells a day), with drizzle either side. Storms add three strong cells.
    Road speed penalties apply per road, by how much of the front it sits under.
    Rain drops, light and sky follow the band on screen, and lightning targets
    storm cells.
  - Pluvial ponding: rain adds water to open ground, heaviest under the front. Six
    downhill flow passes a day move it into hollows, and it soaks away over the
    following days. Ponded water floods buildings like surge water.
  - Storm-surge warnings: three days before a storm, the news warns how many
    buildings on low ground by unprotected water are at risk.
  - Seasonal trees: blossom in spring, orange and red in autumn, bare or snowy in
    winter.
  - Follow a resident (inspect a home):
    - A generated person (name, age, children, adults or retirees from the home's
      demographics, and how they travel) walks through their day on the real
      commute route, following the visual clock.
    - A diary, "how life is" bars and a following camera; you can cycle through
      residents.
    - The HUD shows the time of day.
- S, platform:
  - An installable offline app: web manifest, icon and a service worker. Game files
    are fetched network-first, with a cache fallback; three.js and fonts are
    cached on first use.
  - Performance profile: automatic, light or full. Light turns off shadows and uses
    a third of the vehicles and raindrops and nearer simplification. Automatic
    picks light on phones and low-memory devices.
  - Content packs from `packs/index.json` plus the player's own added in Settings.
    Every value is clamped and every string sanitised. Cities that use a pack
    landmark carry its definition in their save, sanitised again on load, so they
    open without the pack. A sample pack ships with two styles and two landmarks.
  - Interface language: English, Hungarian and German for the HUD, dock, menus,
    panel titles and start screen. It follows the browser language by default,
    and can be changed on the start screen or in Settings.
- T, deeper region play:
  - Summaries record monthly growth, spare power and water before deals, and
    shareable services. Each month the other cities of the region carry on:
    population follows recent growth (easing off), jobs and jobless scale, and
    demand eats spare utilities. Deal buyers receive only the seller's projected
    spare supply.
  - Older cities ease their open ground along a shared side toward a newer
    neighbour's edge heights when loaded.
  - Shared services over a road link:
    - A neighbour's university gives graduates-level access and half its seats; a
      college does the same at a lower level.
    - An airport or harbour adds half its demand boost.
    - Terminals add half their export bonus.
  - Transit is a shortest-path network over every stop. Rides go stop to stop;
    transfers walk up to 60 units to another line and wait. Journeys can use any
    number of lines, and full lines are skipped.
  - Each line has a peak and an off-peak headway: commutes use peak, other trips
    off-peak. Costs weight peak as a third of the day.
  - On screen, rush hours bring 1.6× vehicles and nights 0.35×. Buses in service
    follow the current headway.

Validation: 79 headless tests pass. A browser run confirmed:
- packs loaded, the service worker registered, and English, Hungarian and English
  again switched the dock;
- the time of day shows in the HUD, and the resident panel and diary work;
- autumn foliage and the rain band render;
- there were no new console errors.

Regional economy (portals, families, rents, tolls, presidents):

- Portals:
  - Every road exit is a persistent portal linked to the matching exit of the
    neighbouring tile (within 16 cells). AI cities accept any exit facing them, and
    unmatched exits are dead ends.
  - Commuters, freight and migrants cross through them. The played city's exits
    carry the families' commutes and moves, so these cars and removal vans drive
    real routes to the border.
- Families (households): size, earners, income, savings, home, workplace (which
  can be in another tile), rent, commute cost, toll cost and happiness.
  - In the played city there is one family per occupied home, reconciled monthly
    with the city's own arrivals and departures.
  - Families hunt for work every month and reconsider their home about once a
    year. Newcomers settle in for a year first.
- Housing and rent:
  - A home's quality comes from its level, land value and residents' happiness.
  - Rent follows quality, how full the tile's housing is, and the president's
    rent target.
  - Families weigh disposable income (after rent, commute, tolls and living
    costs), quality, services, appeal, pollution, crime, commute time, and rent
    above 45% of income.
- Employment and migration: salaries by job type and level, higher where
  employers struggle to fill jobs. Families compare options across tiles and may
  live in one tile and work in another.
- Tolls: each tile's president sets the toll for entering it, and the revenue
  goes to that tile's treasury. Commuters pay on the way to work and on the way
  home; migrants and trucks pay once. Tolls shape job choice, migration and freight
  routing. Booths stand at the played city's portals, and toll income appears in
  its budget.
- Presidents: one policy object per tile (rent target, tax, toll, development
  priority, infrastructure spending, service funding), applied through the same
  code for you and the AI.
  - In the played city it sets zone taxes (the priority zone 2% lower), all
    service funding, road upkeep and condition, and a demand boost for the
    priority zone.
  - You set it in the President panel (K).
- AI presidents: deterministic and utility-based, each with a priority (growth,
  treasury, employment, housing affordability or city appeal).
  - Once a year each one tries every single-step lever change against a simple
    prediction model and keeps the best.
  - A president in deficit weighs the budget three times as heavily.
  - AI cities grow or shrink with their president's expected growth.
- Background simulation: full (the played tile), near (neighbours: families
  decide and pay their way, no traffic) and far (aggregate population and trend).
  Treasuries of tiles not being played follow a per-resident revenue and cost
  model, and a returning city picks up its evolved treasury.
- Regional migration: a family first scores each reachable tile from a sample of
  its homes, then searches housing in the best one. It moves only if the new
  option beats the current one by a threshold (plus a margin for leaving the
  tile), it can pay the moving cost, and a year has passed since its last move.
  AI cities send families to a linked tile of yours when an ordinary family would
  be clearly better off there.
- Annual statistics for every tile: population, treasury, income, expenses, rent,
  employment, migration in and out, land value, toll revenue, and the president.
- Every ten years a term ends:
  - The report compares every president's change in treasury and residents.
  - An AI president whose tile lost both is voted out.
  - The full history is kept: history charts by metric with term boundaries, and
    every past term, in the President panel.

Validation: 89 headless tests, including ten for this layer in build order:
portals, families, housing and rent, migration, tolls, presidents, AI presidents,
simulation levels, regional migration, and statistics and terms. A browser run
covered the saved region with portals to two AI neighbours: a full term
fast-forwarded to its report, history charts, toll booths and portal flows, with
no errors after fixing a duplicate import.
