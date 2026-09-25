# Organicity content packs

A pack is one JSON file that adds district architecture styles, landmarks, general
buildables and scenarios to the game. Packs listed in `packs/index.json` load when the
game starts. Players can also add their own under **Settings → Content packs**; those are
kept in the browser, or in the desktop app's profile.

Every value is checked when a pack loads:
- Numbers are clamped to the ranges below; anything missing takes its default.
- Text loses `< > & " ' \``.
- Unknown fields are ignored.

A pack can't run code, only describe things. A city that uses a pack building, or was
started from a pack scenario, carries the definition in its save. So it opens, and a
shared link works, even where the pack isn't installed.

See `sample-pack.json` for a complete example of everything below.

## The file

```json
{
  "name": "My pack",
  "version": 2,
  "author": "Me",
  "styles": { },
  "landmarks": { },
  "buildables": { },
  "scenarios": { }
}
```

- `name` (up to 60 characters) identifies the pack. Adding a pack with the same name
  replaces the earlier one.
- Every key under `styles`, `landmarks`, `buildables` and `scenarios` becomes `pk_<key>`
  in the game. Keys are lower-cased and reduced to letters and digits, up to 24
  characters.
- Limits: 20 styles, 20 landmarks, 30 buildables, 10 scenarios, and 60 parts per model.

## Colours

`"#rrggbb"`, or an integer `0xRRGGBB` written in decimal.

## Styles

District architecture, picked in a district's panel.

```json
"artdeco": { "name": "Art deco", "walls": ["#e8dcc0", "#d8c8a0"], "roof": ["#5a6a70"] }
```

- `walls`: up to 8 colours.
- `roof`: up to 6 colours.

## Landmarks

One per city. They unlock at a population, add appeal (`park`) and bring tourists.

| Field | Range | Default | Meaning |
|---|---|---|---|
| `name` | text | the key | Shown in the Services flyout |
| `w`, `d` | 4–40 | 12 | Footprint in cells (1 cell ≈ 1.5 m) |
| `cost`, `upkeep` | 0–500000, 0–20000 | 20000, 400 | ₵; upkeep is per month |
| `park` | 0–200 | 60 | Appeal radius |
| `unlock` | 0–1000000 | 1000 | Population needed |
| `tourism` | 0–20000 | 1000 | ₵ a month |
| `noise` | 0–1 | 0 | Noise around it |
| `desc` | text (160) | | Shown in the hover card |
| `model` | parts | | See **Models** |

## Buildables

Any number of these can be built. `cat` puts them in the Services (`svc`), Utilities
(`util`) or Industry (`ind`) flyout. They take the same `name`, `w`, `d`, `cost`,
`upkeep`, `desc`, `model` and optional `unlock` as landmarks. `nearWater: true` makes
them sit on the shoreline.

Their effects go in `effects`:

| Effect | Range | Meaning |
|---|---|---|
| `park` | 0–200 | Appeal radius |
| `tourism` | 0–20000 | ₵ a month |
| `jobs` | 0–500 | Workers it employs (counted as industrial jobs) |
| `power` | 0–2000 | MW supplied to its road network's grid |
| `water`, `sewage` | 0–5000 | Units supplied or treated |
| `pollution`, `noise` | 0–1 | Around it |
| `covers` | `fire`, `police`, `clinic`, `school` | Gives that coverage like the game's own building |
| `radius` | 0–120 | Reach of that coverage by road (default 30) |
| `seats`, `patients` | 0–5000 | School seats, or clinic capacity, when it covers `school` or `clinic` |

```json
"healthcentre": {
  "cat": "svc", "name": "Health centre", "w": 12, "d": 10, "cost": 9000, "upkeep": 320, "unlock": 500,
  "effects": { "covers": "clinic", "radius": 30, "patients": 180, "jobs": 14 },
  "model": [ … ]
}
```

## Models

A model is a list of parts laid out in the building's footprint:
- `u` runs across the front, from -1 (left) to 1 (right).
- `v` runs from -1 (back) to 1 (the road side).
- `y` and heights are in units (a storey is about 2.4).

| Field | Applies to | Range | Meaning |
|---|---|---|---|
| `kind` | all | `box` (default), `cyl`, `sign` | A box; a cylinder (`"cyl": true` also works); a glowing sign |
| `u`, `v` | all | -1–1 | Centre of the part |
| `y` | all | 0–120 | Base height |
| `w`, `d` | box, sign | 0.02–1 | Half-width and half-depth, as a share of the footprint |
| `r` | cyl | 0.1–20 | Radius in units |
| `h` | all | 0.05–120 | Height |
| `color` | all | colour | Walls (for a sign, the light) |
| `roof` | box, cyl | colour | Flat top colour |
| `windows` | box | `res`, `off`, `com`, `shop` or `true` | Window facades that light up at night |
| `roofShape` | box, cyl | `flat`, `gable`, `hip`, `pyramid`, `dome`, `spire` | A roof on top of the part |
| `roofH` | with `roofShape` | 0.2–60 | Roof height (default 3) |
| `roofColor` | with `roofShape` | colour | Roof colour |

A `gable` ridge runs along the longer side. `hip` slopes on all four sides, and `pyramid`
meets in a point. `dome` and `spire` are round and sit on a box or a cylinder. Signs are
lit, so they glow at night and bloom when the Light glow setting is on.

## Scenarios

Scenarios appear in the start screen's **Goal** list with the pack's name. They set up a
map and a town, and set goals to reach, optionally by a deadline.

| Field | Range | Meaning |
|---|---|---|
| `name`, `desc` | text | Shown on the start screen |
| `map` | `river`, `hills`, `coast`, `islands` | The map preset |
| `seed` | 0–1000000000 | The map seed, so everyone gets the same land |
| `startYear` | 1800, 1900, 2000 | The starting era |
| `money` | -1000000–10000000 | Starting funds |
| `deadlineDays` | 30–36000 | Optional; a year is 360 days |
| `goals` | up to 8 | `{ "label", "stat", "op": ">=" or "<=", "value" }` |
| `setup` | | The starting town, below |

Goal `stat`s:

| Stat | Measures |
|---|---|
| `pop` | Population |
| `money` | Funds |
| `surplus` | Monthly income minus expenses |
| `happiness` | % |
| `unemployment` | % |
| `jobs` | Number of jobs |
| `buildings` | Number of buildings |
| `transit` | % of trips by transit |
| `pollution` | Average % |
| `year` | The in-game year |

`setup` holds the starting town:
- `roads`: `{ "from": [x, z], "to": [x, z], "type": "street" }`, up to 80. Coordinates
  run 0–512 on the tile; types are `alley`, `street`, `avenue`, `boulevard`, `highway`
  and `ramp`.
- `zones`: `{ "at": [x, z], "zone": 1–6 }`, which fills the block at that point. Zones:
  1 low-density housing, 2 high-density housing, 3 commercial, 4 industrial, 5 office,
  6 mixed-use.
- `services`: `{ "key": "coal", "at": [x, z] }`, placed near that point along a road.
  Any built-in service key works (such as `coal`, `pump`, `tower`, `outlet`, `fire`,
  `police`, `clinic`, `school` or `parkS`), and so do this pack's own buildables as
  `pk_<key>`.
- `populate`: 0–5 fills the zoned lots with finished buildings at that level, with
  people moved in.

## Testing a pack

Add it in **Settings → Content packs**, then place its buildings or start its scenario.
Hover a buildable to check its model and numbers on the card. The game reports a broken
file when you add it, and skips anything it can't use.
