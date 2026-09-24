# Organicity

A browser city builder in 3D pixel art, where nothing snaps to a grid. Draw streets
at any angle and curve; every wedge, sliver and corner between them becomes a lot,
and procedural buildings grow to fit it. It runs as plain ES modules with three.js
from a CDN; there is no build step.

**Play:** serve the repository root (for example `python3 -m http.server 8777`) and
open `http://localhost:8777/organicity/`.

## What's in the game

| Area | Highlights |
|---|---|
| Land | River, hills, coast and island presets. Roads and lots grade the terrain, and steep roads get tunnels and viaducts. A terraforming brush (raise, lower, level, smooth), levees, and sandbox water painting |
| Roads | Free-form curves, one-ways, stop signs, signals and roundabouts, elevated roads, tunnels and ramps, bus lanes, parallel twins, an upgrade brush |
| Growth | Road-Voronoi lots, levels 1–5, lot merging and splitting, leisure, tech and forestry specializations, district policies and styles |
| Eras | Start in 1800, 1900 or 2000. Height limits rise to cyberpunk skylines with annexes, cantilevers, skybridges, sky hubs and air traffic. Terraces attach at any floor |
| Traffic | Deterministic assignment with congestion and junction delays. Visible vehicles run in their own worker |
| Transit | Bus, tram, rail and metro lines with stations, mode choice, peak and off-peak timetables, journeys with several transfers; rush hours on the streets |
| Freight | A goods chain from industry to shops; cargo rail, harbour and airport terminals |
| Society | Follow any resident through their day; age groups, school → college → university, clinics and outbreaks, crime, eight ordinances, car-free centres |
| Economy | Taxes and brackets, service funding, bonds with a credit rating, bankruptcy and bailouts, utility trade and deals, exports, tourism, disaster insurance and preparedness, land tax and gentrification |
| Weather & hazards | Seasons and 30-day regimes, rain bands and storm cells sweeping across the tile, rain ponding in hollows, storm forecasts, flooding, snow and plows, lightning, earthquakes, tornadoes, industrial accidents, festivals, seasonal trees |
| Region | A 5×5 world map: buy tiles, found, rename and switch between cities. Coasts and hills continue across tile edges, roads meet at border exits, regional trips are routed through exits, other cities keep growing in the background, services are shared with neighbours, and AI neighbours grow and shrink |
| Play modes | Free play, sandbox, a guided tutorial and scenarios ("Fix the gridlock", "Balance the books", population goals) |
| Platform | Installable and playable offline, a light performance profile for phones, content packs (district styles and landmarks), English, Hungarian and German interface |
| Regional economy | Tile presidents (you and AI), families with incomes, rents and savings, housing and job markets, portals with toll booths between tiles, commuting and migration across tiles, annual statistics and 10-year presidential terms with comparison charts |
| Presentation | Advisors and news, overlays, day and night, a generated soundscape, photo mode with PNG export, touch controls, colour-blind palette, UI scale, reduced motion, share links and files |

Keys: `1`–`7` tools · `8` overlays · `9` budget · `L` transit lines · `T` terrain ·
`Y` society · `N` advisors · `R` region · `K` president · `M` world map · `P` photo mode ·
`Space` pause · `Ctrl+Z` undo. Right-drag rotates, middle-drag pans, the wheel zooms.

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
| `packs.js` / `i18n.js` | Content packs (validated) and interface languages |
| `scenarios.js`, `share.js`, `audio.js`, `save.js`, `config.js`, `util.js` | Tutorial and scenarios, share links, sound, save migrations, tuning tables, helpers |

The app shell is `index.html` with `manifest.webmanifest`, `icon.svg` and the offline service worker `sw.js`; content packs live in `packs/` (see `packs/sample-pack.json` for the format).

Saves live in `localStorage`. The current city is stored under `organicity-save`,
the region (including its economy: presidents, families, history) under `organicity-region`, and each region city under
`organicity-city:<region>:<tile>` (gzip). Saves carry a version, and older ones
migrate step by step (see `save.js`).

## Tests

```bash
node scripts/organicity-test.mjs            # 89 headless simulation tests
node scripts/organicity-test.mjs grading    # run tests whose name matches
```

The browser regression scripts are `scripts/organicity-browser-test.mjs` and
`scripts/organicity-features-browser-test.mjs`. They need Playwright and a server
on port 8777; `CITY_URL` overrides the address.

See [ROADMAP.md](ROADMAP.md) for current status, known limits and next steps.
