# Organicity

A browser city builder in 3D pixel art, where nothing snaps to a grid. Draw streets
at any angle and curve; every wedge, sliver and corner between them becomes a lot,
and procedural buildings grow to fit it. It runs as plain ES modules with three.js
from a CDN; there is no build step.

**Play:** serve the repository root (for example `python3 -m http.server 8777`) and
open `http://localhost:8777/organicity/`.

**Desktop app (Linux, macOS, Windows):** `cd desktop && npm install && npm start` runs it
in its own window, fully offline (three.js is bundled). `npm run dist:linux` (AppImage,
deb, tar.gz), `npm run dist:mac` (dmg, zip; x64 and arm64) and `npm run dist:win`
(installer, portable) build packages. macOS packages must be built on a Mac. The workflow
`.github/workflows/organicity-desktop.yml` builds all three on GitHub (manually or on a
`desktop-v*` tag) and smoke-tests the Linux app. Builds are unsigned. `ORGANICITY_SMOKE=1`
makes the app found a city, report errors and quit. The icon comes from
`scripts/organicity-icon.py`.

## What's in the game

| Area | Highlights |
|---|---|
| Land | River, hills, coast and island presets. Roads and lots grade the terrain, and steep roads get tunnels and viaducts. A terraforming brush (raise, lower, level, smooth), levees, and sandbox water painting |
| Roads | Free-form curves, one-ways, stop signs, signals and roundabouts, three elevated levels (6, 12 and 18 m) that hold their height from joint to joint (PgUp/PgDn), tunnels and ramps, bridges over water in five styles (automatic, beam, arch, suspension, lift bridges that open for boats), bus lanes, parallel twins, an upgrade brush; maintenance crews repair worn roads, and parking lots change how many people drive |
| Growth | Road-Voronoi lots, levels 1–5, lot merging and splitting, leisure, tech and forestry specializations, district policies and styles |
| Eras | Start in 1800, 1900 or 2000. Height limits rise to cyberpunk skylines with annexes, cantilevers, skybridges, sky hubs and air traffic. Terraces attach at any floor |
| Traffic | Deterministic assignment with congestion and junction delays. Visible vehicles run in their own worker |
| Transit | Bus, tram, rail and metro lines with stations, mode choice, peak and off-peak timetables, journeys with several transfers; rush hours on the streets |
| Freight | A goods chain from industry to shops; cargo rail, harbour and airport terminals; visible trucks carry commodities between plants and out of town |
| Resources & industry | Seeded forest, coal, stone, iron and ore deposits (resources overlay). Lumber camps, mines and quarries work them out; a sawmill, paper mill, furniture works, cement works, steelworks, smelter and machinery plant process them; a commodity exchange and warehouses run the market, priced by a regional market with contracts from AI governors. Districts can be industrial parks or mining districts, and plants can fit scrubbers. Plants need road, power, water, workers and a way out. Local coal, goods, building materials and machinery lower costs and raise output |
| Utilities | Roads carry power, water and sewage. Power lines (on pylons), water pipes and drains join separate networks, up to their capacity (substations raise it). Water pressure needs towers uphill. Drains clear rain ponds, and an optional strict grid makes every building need all three nearby. Runs can be straight, curved or routed along streets; high-voltage lines with transformer stations and trunk mains carry far more; water treatment and two levels of sewage treatment cut pollution. An underground editor shows pipes on one flat level with their coverage, and has a bulldozer that leaves the city untouched |
| Society | Residents with daily schedules to their real school, college, workplace or park; family stories in the news; approval and ten-year elections you can lose; follow any resident through their day; age groups, school → college → university, clinics and outbreaks, crime, eight ordinances, car-free centres |
| Economy | Taxes and brackets, service funding, bonds with a credit rating, bankruptcy and bailouts, utility trade and deals, exports, tourism, disaster insurance and preparedness, land tax and gentrification |
| Weather & hazards | Seasons and 30-day regimes, rain bands and storm cells sweeping across the tile, rain ponding in hollows, storm forecasts, flooding, snow and plows, lightning, earthquakes, tornadoes, industrial accidents, festivals, seasonal trees |
| Region | A 5×5 world map: buy tiles, found, rename and switch between cities. Every tile's land is pregenerated in the background and drawn around your city, joined seamlessly (optionally with full pixel texture and woods). Other governors really build their cities tile by tile, and you can take one over or hand yours to an AI. Coasts and hills continue across tile edges, roads meet at border exits, regional trips are routed through exits, other cities keep growing in the background, services are shared with neighbours, and AI neighbours grow and shrink |
| Play modes | Free play, sandbox, a guided tutorial and scenarios ("Fix the gridlock", "Balance the books", population goals) |
| Platform | Installable and playable offline, a light performance profile for phones, content packs (district styles, landmarks, buildables and scenarios), English, Hungarian and German interface |
| Regional economy | Tile presidents (you and AI), families with incomes, rents and savings, housing and job markets, portals with toll booths between tiles, commuting and migration across tiles, annual statistics and 10-year presidential terms with comparison charts |
| Building | Every buildable has an icon rendered from its real model; hovering it shows a card with the model turning in 3D and all its numbers |
| Saved games | Save, load, overwrite, rename, delete, export and import whole regions in the game (IndexedDB); Ctrl+S quick-saves, and an autosave is kept every five minutes; single-city files and share links remain |
| Multiplayer | Peer-to-peer (WebRTC): a host opens their region; friends join from the start screen, each gets land and builds their city at the same time. Everyone sees each other's cities next door; there's chat, money and monthly commodity or utility contracts (either party can end one), land claims, AI cities bought at their value, standings, and the host can remove players. Join by pasting codes (no server), or through the optional signalling server `scripts/organicity-signal.mjs` |
| Presentation | Pedestrians on the pavements, optional ordered dithering and light glow (bloom), advisors and news, overlays, day and night, positional industry, train and crowd sounds, flowing rivers and boats, mountain snow lines and rock textures, photo mode with PNG export, camera tours and silent WebM video export, touch controls, colour-blind palette, UI scale, reduced motion, share links and files |

Keys: `1`–`7` tools · `8` overlays · `9` budget · `L` transit lines · `T` terrain ·
`I` industry · `J` multiplayer · `Y` society · `N` advisors · `R` region · `K` president · `M` world map · `P` photo mode ·
`Space` pause · `Ctrl+Z` undo · `Ctrl+S` quick save · `PgUp`/`PgDn` road level. Right-drag rotates, middle-drag pans, the wheel zooms.

Photo tours: press **P**, move the camera and choose **Add viewpoint** at each stop
(at least two, up to 16). Choose a duration, then **Preview path** or **Export WebM**.
Stop/cancel or exiting photo mode restores the starting camera and discards an
unfinished recording. Completed exports are silent and use the current render
resolution; playback and recording work while the simulation is paused. Paths
last for the current session. WebM requires a browser with canvas recording support
and is also available in the desktop app.

## Code map (`js/`)

| File | Role |
|---|---|
| `main.js` | Boot, saving, region tile switching, frame loop |
| `world.js` | Map state: water, heights, zones, lots, buildings, platforms, undo, save and load |
| `roads.js` / `routes.js` | Bézier road graph, snapping, splitting, shortest paths |
| `terrain.js` | Heightfields, road and lot grading, tunnels and viaducts, flooding, snow and lightning |
| `sim.js` | Daily economy, utilities, growth, society, region market, news and advisors |
| `core.js` / `worker.js` | Coverage, land-value fields and traffic assignment, in a Web Worker |
| `assign.js` | Traffic assignment: clusters, gravity model, congestion, air trips, regional exits, freight terminals, transit headways and transfers |
| `agents.js` / `agent-worker.js` | Visible vehicles: lanes, signals, spillback |
| `transit.js` | Transit modes, tracks and stations |
| `disasters.js` | Earthquakes, tornadoes, accidents, rubble and recovery, festivals |
| `region.js` | World map tiles, AI cities, buying, per-tile saves, edge profiles and exits, utility deals |
| `eras.js` | Technology by year, building floors, mass plans, sky hubs and bridges |
| `procgen.js` / `render.js` | Building meshes and the three.js renderer |
| `ui.js` / `tools.js` | Panels, HUD, world map, input and tools |
| `weather.js` | Seeded weather regimes and moving fronts |
| `regionsim.js` / `families.js` / `presidents.js` | Regional economy: portals, tolls, simulation levels, families, housing and job markets, presidents and terms |
| `tilehost.js` / `tile-worker.js` / `tileview.js` / `builder.js` | Other tiles in the background: AI governors' city builder, full-fidelity simulation of nearby cities, pregenerated land for every tile, and the views drawn next door |
| `preview.js` | Icons and the 3D hover cards for buildables |
| `saves.js` | Saved games (whole regions) in IndexedDB, with export and import |
| `mp.js` / `mpgame.js` | Multiplayer: the protocol, links and WebRTC codes; hosting and joining a region in the game |
| `grid.js` / `resources.js` | Utility grids joined by power lines, pipes and drains; resource deposits and the industry chain and market |
| `photo.js` / `water.js` | Camera tours and WebM recording; river flow fields and boat routes |
| `packs.js` / `i18n.js` | Content packs (validated) and interface languages |
| `scenarios.js`, `share.js`, `audio.js`, `save.js`, `config.js`, `util.js` | Tutorial and scenarios, share links, sound, save migrations, tuning tables, helpers |

The app shell is `index.html` with `manifest.webmanifest`, `icon.svg` and the offline service worker `sw.js`; content packs live in `packs/` (see [the modding guide](packs/README.md) and `packs/sample-pack.json`).

Saves live in `localStorage`. The current city is stored under `organicity-save`,
the region (including its economy: presidents, families, history) under `organicity-region`, and each region city under
`organicity-city:<region>:<tile>` (gzip), with the view each tile shows its neighbours under
`organicity-view:<region>:<tile>`. Saves carry a version, and older ones
migrate step by step (see `save.js`).

## Tests

```bash
node scripts/organicity-test.mjs            # 115 headless simulation tests
node scripts/organicity-test.mjs grading    # run tests whose name matches
```

The browser regression scripts are `scripts/organicity-browser-test.mjs` and
`scripts/organicity-features-browser-test.mjs`, `scripts/organicity-photo-browser-test.mjs` and `scripts/organicity-acad-browser-test.mjs`. They need Playwright and a server
on port 8777; `CITY_URL` overrides the address. Run the photo test with
`PHOTO_DESKTOP=1` to check the Electron app and its native video download instead
(requires the desktop dependencies).

See [ROADMAP.md](ROADMAP.md) for current status, known limits and next steps.
