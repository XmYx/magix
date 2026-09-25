# Organicity roadmap

## Status

Organicity is a complete, playable city builder. It runs in the browser (installable
and offline) and as a desktop app for Linux, macOS and Windows. You can play one
city, a region of up to 25 cities, or a region shared with friends over
peer-to-peer multiplayer.

- **Delivered phases:** A–T, the regional economy, U0 (governors build real cities),
  Y (utility networks, resources and a visible region), Z (infrastructure, industry
  and the visible region), AA (building, saving, desktop and multiplayer), AC
  (living citizens), AD (infrastructure depth), AF (presentation), and AG2 (richer
  content packs). A short history is at the end
  of this file.
- **Saves:** single-city saves are at v10. Older saves migrate step by step
  (`save.js`), and fields added since v10 are optional. Saved games (whole regions)
  live in IndexedDB and export to `.organicity-game` files.
- **Tests:**
  - `node scripts/organicity-test.mjs`: 115 headless tests covering simulation,
    saves, region, economy, residents and elections, infrastructure, multiplayer
    protocol and signalling.
  - Playwright browser scripts: `scripts/organicity-browser-test.mjs` and
    `scripts/organicity-features-browser-test.mjs`, `scripts/organicity-photo-browser-test.mjs` and `scripts/organicity-acad-browser-test.mjs`. They need a server on port 8777;
    `CITY_URL` overrides the address.
  - The desktop app has a smoke test (`ORGANICITY_SMOKE=1`) that runs in CI.

---

## What the game has

### Land, water and weather
- **Maps:** a 512×512 tile with four presets: river plain, rolling hills, coastal
  hills and island chain.
  - A seeded heightfield, trees and woods that change with the seasons.
  - Seeded resource deposits: forest, coal, stone, iron and ore.
- **Terrain tools:**
  - Raise, lower, level and smooth at ₵3 per unit of earth; a stroke can be undone.
  - Levees.
  - Water painting (sandbox only).
- **Grading:**
  - Roads grade the ground to at most a 9% slope, with level plateaus at junctions
    and blended shoulders.
  - Lots sit on pads.
  - Where a profile runs 6 units into a hill it becomes a tunnel; 6 units above a
    valley, a viaduct.
- **Weather:**
  - Seeded 30-day regimes and four seasons.
  - Rain and snow bands and storm cells move with the wind. Only roads under them
    slow down, and lightning strikes inside storm cells.
  - Storms are forecast three days ahead, with a count of buildings at risk.
- **Hazards:**
  - Storm surges are rare and shallow.
  - Rain puddles in hollows and soaks away.
  - Levees hold water back; storm drains and underground drains take it away.
  - Snow builds up, and snowplow depots clear it.
  - Lightning can start fires.
- **Disasters and events:**
  - Earthquakes, tornadoes and industrial accidents (with chemical spills), none
    before 400 residents.
  - Rubble, then rebuilding a level lower; ambulances.
  - Festivals at parks and landmarks, with fireworks at night.
  - Sandbox can switch disasters off or trigger each one.

### Roads and traffic
- **Drawing:** free-form straight and curved roads at any angle.
  - Road types: alley, street, avenue, boulevard, highway and ramp.
  - One-ways, parallel twins (dual carriageways), bus lanes, and an upgrade brush.
  - Shift snaps to 15°.
- **Levels:** ground; three elevated levels at 6, 12 and 18 m (PgUp/PgDn); and tunnels.
  - Roads join only roads on their own level.
  - Chained elevated roads hold their height through joints and ramp only where
    they meet another level or end. Decks run level, with pillars down to the ground.
- **Bridges:** ground roads over water climb from the banks to a deck.
  - Piers, railings, and towers with cables on spans over 70 m.
  - A joint in mid-river sits on the deck.
  - Styles: automatic, beam, arch, suspension or lift bridge, each with a cost and a
    span limit. Lift bridges open for boats, and road traffic waits.
- **Upkeep and parking:**
  - Maintenance crews drive out from depots and repair the most worn roads.
  - Parking lots add spaces; where parking is scarce, more work trips walk or take
    transit.
- **Junctions:** uncontrolled, all-way stop, traffic lights or roundabout, each
  with its own delay and capacity.
- **Traffic:**
  - Deterministic assignment with congestion and junction delays.
  - Visible vehicles run in a worker. They queue at signals, spill back, and tilt
    on slopes.
  - Rush hours (07:00–09:30 and 16:00–19:00) and quiet nights.
  - Service vehicles: fire engines, ambulances, police, garbage trucks, snowplows,
    removal vans and freight trucks coloured by commodity.
- **Pedestrians:** residents walk from real homes along real routes: to stops at
  rush hour, school in the morning, shops by day and parks in the afternoon.
  Crowds gather at festivals.

### Growth and buildings
- **Lots:** road-Voronoi lots. Every wedge, curve and sliver becomes a lot.
  - Six zones: low- and high-density housing, commercial, industrial, office and
    mixed-use.
  - The zoning brush paints only empty land (Shift repaints); a fill mode zones a
    whole block.
- **Buildings:** procedural buildings at levels 1–5.
  - Lots merge and split.
  - Leisure, tech and forestry specializations.
  - Gentrification and abandonment.
  - Construction takes time and shows scaffolding.
- **Eras:** 1800, 1900 or 2000 starts, with technology pace ×1, ×5 or ×10. Height
  ceilings rise through the eras to cyberpunk.
  - Annexes, cantilevers and skybridges count toward capacity.
  - Sky hubs and air traffic.
- **Terraces:** decks at any floor that hold parks, plazas, services and transit.
- **Districts:** painted freely, each with:
  - local taxes, density and height limits, historic protection and car-free centres;
  - green industry;
  - an industrial park or mining-district policy;
  - an architecture style;
  - service priorities.

### Utilities
- **Supply:** coal and wind power, water pumps and towers, sewage outlets,
  landfills, storm drains and substations. Plants and pumps have funding levels.
- **Networks:** roads carry power, water and sewage along them.
  - Power lines (on pylons), water pipes and drains join separate road networks into
    one grid per utility.
  - Capacity is limited: 80 MW per power line and 160 units per pipe or drain.
    Substations add 240 MW, and overloaded runs show red.
  - Water pressure: pumps lift water 18 units and towers 30, so homes higher up
    need a tower.
  - The optional strict grid needs every building to have a line of each kind
    within reach.
  - Tiers: high-voltage lines (480 MW) with transformer stations, trunk mains and
    interceptor drains (640 units).
  - Runs are drawn straight, curved, or routed along the streets.
  - Treatment: water treatment removes pumped-in contamination; secondary and
    advanced sewage plants cut discharge pollution by 75% and 95%.
- **Underground editor:**
  - Pipes and drains lie on one flat level below the lowest ground.
  - The city turns see-through, and coverage shows as blue (water) and brown (drains).
  - The underground bulldozer removes runs only.
- **Trade and contracts:** utilities trade over the highway. Power and water deals
  run between your cities, and contracts with other players.
- **Blackouts:** unpowered buildings go dark at night.

### Services, society and people
- **Services:**
  - Emergency and safety: fire, police and clinics with dispatch and response times.
  - Education: schools, a college and a university.
  - Parks: pocket and city parks.
  - Depots: maintenance, bus and snowplow.
  - Landmarks: civic plaza, museum, stadium and observation spire; the sample pack
    adds a clock tower and a lighthouse.
  - Service funding runs from 50% to 150%.
- **People:**
  - Children, adults and retirees in every home.
  - Education feeds top-level offices.
  - Clinic load and illness outbreaks; crime.
  - Eight ordinances.
  - A sample of residents with daily schedules to their actual school, college,
    workplace or park, walking or driving their real routes. Follow any of them,
    with a diary and a following camera.
  - Approval and elections: approval shows in the President panel, and each
    ten-year term ends in an election that needs 50%.
- **Advisors and news:** seven advisors, each linking to the overlay that shows
  their problem, and a news feed that names the streets and tells families' stories
  (who moved, and why).

### Transit and freight
- **Transit:** bus, tram, rail (elevated track) and metro (underground).
  - Stations, peak and off-peak headways, fares and capacity.
  - Journeys with any number of transfers, and mode choice.
- **Freight:**
  - A goods chain from industry to shops.
  - Cargo rail, harbour and airport terminals.
  - Freight split across the regional exits by the size of the neighbour beyond.

### Resources and industry
- **Extractors:** lumber camps, coal, iron and ore mines, and stone quarries.
  - They must sit on a deposit and work it out; forests regrow.
  - Warnings come as a seam runs out, and worked-out sites can be reclaimed into
    lakes or woods.
- **Processors:** sawmill, paper mill, furniture works, cement works, steelworks,
  smelter and machinery plant.
  - A commodity exchange pays better prices and imports missing inputs.
  - Warehouses hold stock while prices are low.
- **Requirements:** road, power, water, workers, and a highway link or freight
  terminal to sell through.
- **Local effects:**
  - Coal cuts coal plant upkeep.
  - Furniture and paper stock the shops.
  - Cement and steel cut road upkeep.
  - Machinery lifts factory output.
  - Industry raises demand for worker housing.
- **Scrubbers:** −65% pollution for +40% upkeep, per plant.
- **Regional market:**
  - Other cities' sales and appetite set prices, from ×0.7 to ×1.45.
  - Rival exchanges trim your premium.
  - AI governors offer monthly contracts.
- **Industry report:** stock, flows, prices, the regional market and contracts.

### Economy
- **Taxes:** zone taxes, brackets and land tax.
- **Borrowing:** bonds with a credit rating from AAA to CCC, plus loans for older saves.
- **Disaster cover:** insurance and preparedness funding.
- **Debt trouble:** warnings, service cuts and a bailout, outside sandbox.
- **Trade and tourism:** exports, tourism, and prices that change with the seasons
  and the neighbours' size.
- **Budget panel:** income and expense lines, a three-month forecast and histories.
- **Goals and scenarios:**
  - Goals: Thriving Town and Prosperous City.
  - Scenarios: Fix the gridlock and Balance the books.
  - A 10-step guided tutorial.

### Region
- **World map:** a 5×5 region (M). Buy land next to your own, found cities,
  rename them and switch between them.
- **Visible neighbours:**
  - Every tile's land is pregenerated in the background, continuing its neighbours'
    coasts, rivers and hills; a city founded later grows on that land.
  - All 24 other tiles are drawn around your city, blended onto its edges and
    tinted by the weather.
  - Adjacent tiles get lit window facades, traffic and seasonal woods.
  - Full texture (in Settings) draws their lots, roads and shores pixel by pixel.
- **AI governors:** they build real cities (streets, zoning, utilities, services,
  industry chains, and lines to remote plants).
  - Cities within two tiles run at full simulation in a background worker; those
    further out are aggregates.
  - You can take over an AI city, or hand one of yours to an AI.
- **Regional economy:**
  - Portals with toll booths, and families that live, work, commute and migrate
    between tiles.
  - Housing, rents and salaries.
  - Presidents (you and AI) with policies; ten-year terms with reports and history
    charts.
  - Shared universities, colleges, airports, harbours and terminals.

### Multiplayer
- **Connecting:** peer-to-peer over WebRTC.
  - The host opens their region from the Multiplayer panel (J).
  - Friends join from the start screen by pasting codes (no server needed), or
    through the optional signalling server `scripts/organicity-signal.mjs`.
  - STUN and TURN servers are settable, or left empty for play on a local network.
- **Playing together:**
  - Each player gets land and builds their own city at the same time. Every month
    their city's numbers and view go to everyone.
  - Other players' cities appear next door and on the world map in their colour.
- **Interaction:**
  - Chat and money transfers.
  - Monthly commodity, power and water contracts; either party can end one.
  - Claiming land next to your own.
  - Buying AI cities at their value (land, residents, jobs and treasury). The host
    checks the price against its own numbers and hands the city's save to the buyer.
  - Standings.
- **Hosting:** the host keeps the region, runs the AI governors, relays messages,
  and can remove players.
- **Safety:** everything a peer sends is checked and bounded before use.

### Building tools and interface
- **Buildables:** every buildable has an icon rendered from its real model.
  Hovering shows a card with the model turning in 3D and all its numbers.
- **Overlays:** 34, including land value, pollution, noise, crime,
  coverage, traffic, problems, flooding, snow, elevation, transit, desirability,
  resources and underground.
- **Undo:** for roads, zones, services, terrain, lines and reclamation.
- **Saved games:**
  - Save, load, overwrite, rename, delete, export and import whole regions, in the
    game or from the start screen.
  - Ctrl+S quick-saves; an autosave runs every five minutes.
  - Single cities also share as links (`#city=…`) or `.organicity` files.
- **Presentation:**
  - Day and night, and a procedural soundscape with positional industry, train and crowd audio.
  - Flowing river shaders, harbour boats and ferries; mountain rock textures, snow lines and seasonal neighbour ground colours.
  - Photo mode with PNG export, scripted camera paths and silent WebM video export (including desktop).
  - Optional ordered dithering and light glow; problem signs stay crisp above the
    effects.
- **Controls and accessibility:**
  - Touch controls.
  - Colour-blind palette, UI scale and reduced motion.
  - Performance profile: automatic, light or full.
- **Content packs:** district styles, landmarks, buildables and scenarios, checked and saved with the city. Models support roofs, windows and emissive signs; see [the modding guide](packs/README.md).
- **Languages:** English, Hungarian and German.
- **Platforms:**
  - An installable offline web app (PWA).
  - Desktop packages built with Electron: AppImage, deb and tar.gz for Linux; dmg
    and zip for macOS (x64 and arm64); installer and portable for Windows. They
    bundle three.js and run fully offline.
  - GitHub workflow: `.github/workflows/organicity-desktop.yml`.

### Keys
`1`–`7` tools · `I` industry · `L` transit · `T` terrain · `8` overlays · `9` budget ·
`Y` society · `N` advisors · `R` region · `K` president · `J` multiplayer · `M` world map ·
`P` photo · `Space` pause · `+`/`-` speed · `Ctrl+Z` undo · `Ctrl+S` quick save ·
`PgUp`/`PgDn` road level · `C` curve · `F` block fill · `[`/`]` brush size · `Q`/`E` rotate ·
`WASD` move · `Esc` cancel.

---

## Known limits

- **Scale:**
  - A tile is 512×512 and holds about 1,500 buildings at current lot sizes.
  - The simulation's core pass runs on the main thread for large cities (about 0.2 s
    at 1,500 buildings).
- **Other tiles:**
  - Background cities simulate without vehicles.
  - The background runner does one job at a time, and only while the game is on
    screen.
  - Tiles more than two steps away are aggregates, drawn as a skyline.
  - Other tiles are drawn from 128×128 snapshots: boxes rather than procedural
    buildings.
- **Residents:**
  - Schedules cover a sample of residents, not the whole population.
  - One resident at a time can be followed, on the visual clock rather than the
    economy's.
  - Elections judge only your own tile.
- **Hazards:** flooding is a daily propagation model, not a fluid solver. Snow is
  aggregate, cleared by coverage.
- **Utilities:** capacity is per run and per tier; there is no hydraulic pressure
  network.
- **Roads:** lift bridges open on a fixed timetable rather than for each passing
  boat. Parking is a citywide balance, not per block.
- **Multiplayer:**
  - One tile per player per session; switching tiles leaves the session, and you
    rejoin with the same name.
  - No co-op on the same tile, and no host migration: the session ends if the host
    leaves.
  - Each player's regional economy is their own projection.
  - Strict networks need a TURN server.
- **Translation:** menus, dock, HUD, panel titles and start screen only; help and
  panel contents are English.
- **Photo tours:** silent WebM exports use the current render resolution and real-time frame rate; paths are kept for the current session.
- **Desktop builds:** unsigned; macOS packages must be built on a Mac or in CI.

---

## Next steps

Listed in the suggested order. Each phase can ship on its own, keeps saves
migratable, and adds headless tests (and browser checks where it shows on screen).

### AB — Multiplayer depth (high value; builds directly on AA)
1. **Play any of your tiles in-session.** Switch cities without reloading the page,
   so the peer connection survives. It needs a boot path that tears down and
   rebuilds the world, simulation and renderer in place.
2. **Reconnect and host hand-over.**
   - Guests reconnect automatically after a dropped connection.
   - The host can pass hosting to another player, with the region snapshot and AI
     saves sent over.
3. **One regional economy.** The host runs the families and migration model for
   everyone, and guests receive their tile's results, instead of each player
   projecting their own.
4. **Co-op on one tile.** Replicate player actions (roads, zones, services, lines)
   as commands in a lockstep order. The owner's simulation stays authoritative, and
   visitors see a streamed view.
5. **Session tools.**
   - Room codes and lobby listing on the signalling server.
   - Spectators.
   - Rules for a session: sandbox, start year, win condition such as first to 50k
     people or the best treasury after 10 years.
   - A final scoreboard.
6. **Diplomacy.** Toll-free agreements between players, shared transit lines across
   portals, and joint services.

### AC — Living citizens — delivered
1. **Delivered — Residents with schedules.** A sample of residents is assigned real
   destinations along the traffic network: children to a school with free seats,
   students to a college or university, adults to a workplace, retirees to a park.
   Each gets an outbound and a return route and a departure time. Short or
   car-free trips, and trips where parking is scarce, are walked. The followed
   resident and the pedestrians use these same routes.
2. **Delivered — Personal stories.** The news reports families who move in, move away
   or change homes, and the reason: a better job, a shorter commute, a lower toll
   or cheaper rent.
3. **Delivered — Approval and elections.** Approval is weighted by residents and comes
   from happiness, health, utilities, jobs, commute length and tolls. It shows in
   the President panel. At each ten-year term end you face an election and need
   50% to stay in office. Losing ends an unfinished goal game; free play and
   sandbox continue.

### AD — Infrastructure depth — delivered
1. **Delivered — Utility tiers.**
   - High-voltage lines carry 480 MW, and trunk mains and interceptor drains carry
     640 units.
   - Transformer stations join high-voltage runs to the local grid and add 480 MW.
   - Water treatment removes 80% of the contamination pumped into its grid.
   - Secondary and advanced sewage plants treat 500 and 900 units, with 75% and 95%
     less pollution in the discharge.
2. **Delivered — Curved and routed runs.** Lines and pipes can be drawn straight,
   curved like roads, or routed automatically along streets (ignoring one-way rules).
3. **Delivered — Road upkeep.** Maintenance depots send crews along real routes to the
   most worn roads, repairing them as they drive. Depot funding sets the speed.
4. **Delivered — Parking.** Parking demand comes from residents and workers. Kerbs
   cover half of it, and parking lots add 100 spaces each. Where parking is scarce,
   more work trips walk or take transit.
5. **Delivered — Bridge styles.** Automatic, beam (60 m span), arch (140 m),
   suspension (400 m) or lift bridge (90 m), each with its own cost and span limit.
   Lift bridges open for boats half an hour in every six, and road traffic waits.

Also fixed in this phase: the Ubuntu desktop build failed at the `.deb` step for want
of a project homepage. `desktop/package.json` now sets `homepage`, and all three
platform builds complete.

### AE — Scale and performance
1. **Bigger tiles:** 768 or 1024, with chunked fields and rendering.
2. **Core pass in the worker:** move it entirely off the main thread and profile at
   5,000 or more buildings.
3. **Richer neighbours:** instanced procedural buildings for other tiles when viewed
   up close, and streaming of their views.
4. **Lighter background runner:** a shared worker pool for background tiles, and
   progress while the game is minimised (desktop).

### AF — Presentation — delivered
1. **Delivered — Water:** a water shader with flow direction on rivers; ferries and boats in
   harbours.
2. **Delivered — Mountains:** snow lines and rock textures; seasonal ground colours on
   neighbour tiles.
3. **Delivered — Camera tours:** capture up to 16 viewpoints, preview eased camera paths, choose a 2–120 second duration, cancel and restore the camera, and export silent WebM video on desktop or supported browsers.
4. **Delivered — Sound:** positional sound for industry, trains and crowds.

### AG — Content, community and release
1. **Translations:** the remaining texts, right-to-left support, and more languages.
2. **Delivered — Richer packs:** roof shapes, windows and emissive signs in pack models;
   pack-defined scenarios and buildables; a documented modding format.
3. **Release pipeline:**
   - Signed and notarised desktop builds.
   - Auto-update.
   - GitHub releases from `desktop-v*` tags.
   - The Playwright scripts running in CI.
4. **Gallery:** an opt-in gallery of shared cities and screenshots. This needs a
   backend and moderation.

---

## History

| Phase | Delivered | Save / tests |
|---|---|---|
| A–F | Free-form roads, lots and buildings; zoning; utilities and services; budget; overlays; sandbox | v1–v2 |
| Increment 1 | Service funding, loans, forecast, level-up checklist, construction time, goals | v3 · 19 |
| Increment 2 | Route inspection, seasons and weather | v4 |
| v6 | Junction controls, agent traffic in a worker, bus lines and lanes, elevated roads, tunnels, eras, terraces, specializations, landmarks | v6 |
| G | Mass plans count toward capacity, working skybridges, modelled air traffic, bankruptcy, placing buildings in sandbox | 39 |
| J, L, M | Demographics, education, health, ordinances, news and advisors; tutorial and scenarios; neighbour cities; level of detail; audio, photo mode, touch, accessibility, share links | v7 · 51 |
| H, I | Map presets and heights, flooding and levees, snow and plows, lightning; tram, rail and metro | v8 |
| Region, K | Terrain grading and pads, whole-tile weather, the 5×5 region; earthquakes, tornadoes, accidents, rubble, festivals | 61 |
| N, O, P, Q | Connected tiles and exits, utility deals; terraforming, tunnels and viaducts; headways and transfers, goods chain, freight terminals; credit rating, bonds, insurance, land tax, gentrification | v9 · 71 |
| R, S, T | Weather fronts, ponding, surge warnings, following residents; PWA, performance profile, content packs, languages; region projection, shared services, transit network, rush hours | v10 · 79 |
| Regional economy | Portals, families, housing and rent, jobs and salaries, migration, tolls, presidents, AI presidents, simulation levels, terms and history | 89 |
| U0 | AI governors build real cities, background tile simulation, visible neighbours, taking over and handing over cities | 92 |
| Y | Gentler floods, non-destructive zoning, dithering and glow, pedestrians, power lines, pipes and drains, strict grid, deposits and the industry chain, pregenerated seamless tiles | 97 |
| Z | Freight trucks, depletion and reclamation, regional commodity market, utility capacity and pressure, pedestrians with errands, richer neighbours, industrial policy, smarter governors, underground editor, crisp signs, cars on slopes | 99 |
| AA | Icons and 3D hover cards, road levels and bridges, desktop packages, saved games, peer-to-peer multiplayer (chat, trade, contracts, claims, standings, removing players, buying AI cities at their value) | 105 |
| AF / AG2 | Flowing water and boats, mountain and seasonal ground textures, positional audio, richer packs and modding guide; photo camera tours and WebM export | v10 · 108 |
| AC / AD | Residents with schedules, family stories, approval and elections; utility tiers, transformers and treatment, curved and routed runs, maintenance crews, parking, bridge styles and lift bridges; Ubuntu `.deb` packaging fixed | v10 · 115 |
