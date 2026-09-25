// Organicity — shared constants and definitions.
// World units: 1 grid cell = 1 unit (~1.5 m). The world is N × N cells.

export const N = 512;              // fine land grid (zoning, occupancy, lots)
export const FC = 8;               // coarse field cell size (land value, pollution, coverage…)
export const FN = N / FC;          // coarse field resolution
export const DEPTH = 18;           // max zonable distance from a road's kerb
export const FLOOR_H = 1.6;        // storey height
export const BAY_W = 2.0;          // facade bay width (window texture repeat)
export const DAY_SECONDS = 1.0;    // real seconds per sim day at 1× speed
export const MONTH_DAYS = 30;

export const ROADS = {
  alley:     { name: 'Alley',     width: 4,  speed: 5,  capacity: 250,  cost: 5,  upkeep: 0.04, desc: 'Narrow lane — splits deep blocks, slow.' },
  street:    { name: 'Street',    width: 6,  speed: 9,  capacity: 800,  cost: 9,  upkeep: 0.07, desc: 'Two-lane local street.' },
  avenue:    { name: 'Avenue',    width: 9,  speed: 12, capacity: 1900, cost: 18, upkeep: 0.14, desc: 'Four lanes, good for commerce.' },
  boulevard: { name: 'Boulevard', width: 12, speed: 14, capacity: 3000, cost: 30, upkeep: 0.22, desc: 'Six lanes with a planted median. Raises appeal.' },
  highway:   { name: 'Highway',   width: 10, speed: 22, capacity: 4200, cost: 45, upkeep: 0.3,  desc: 'Fast, no zoning access, noisy.', noAccess: true },
  ramp:      { name: 'Ramp',      width: 5,  speed: 15, capacity: 1600, cost: 16, upkeep: 0.1,  desc: 'One-way slip road for interchanges; draw it in the direction of travel.', noAccess: true, oneway: 1 },
};
// Grade separation: cost multipliers and the height/depth of the deck; ramps are RAMP_LEN long.
export const LAYERS = { 3: { name: 'Elevated · 18 m', cost: 4.2, y: 18 }, 2: { name: 'Elevated · 12 m', cost: 3.3, y: 12 }, 1: { name: 'Elevated · 6 m', cost: 2.5, y: 6 }, 0: { name: 'Ground', cost: 1, y: 0 }, '-1': { name: 'Tunnel', cost: 3.5, y: -5 } };
export const BRIDGE_DECK = 4.5;   // a bridge deck's height above the water
export const RAMP_LEN = 14;
// Junction control: base delay (s), through capacity (veh / peak), build cost.
export const JUNCTIONS = {
  auto:       { name: 'Uncontrolled', delay: 1.2, capacity: 1600, cost: 0 },
  stop:       { name: 'All-way stop', delay: 3.0, capacity: 1100, cost: 400 },
  signal:     { name: 'Traffic lights', delay: 3.5, capacity: 2800, cost: 2500 },
  roundabout: { name: 'Roundabout', delay: 1.6, capacity: 2600, cost: 4000 },
};
export const BRIDGE_COST_MULT = 4;

// Zone ids are stored per cell (Uint8). kind = demand bucket.
export const ZONES = [
  null,
  { id: 1, key: 'rl', name: 'Low-density housing',  short: 'R',  kind: 'R', color: [104, 196, 84],  maxLevel: 3, frontage: 10, depth: 15 },
  { id: 2, key: 'rh', name: 'High-density housing', short: 'R+', kind: 'R', color: [42, 150, 60],   maxLevel: 5, frontage: 14, depth: 18 },
  { id: 3, key: 'c',  name: 'Commercial',           short: 'C',  kind: 'C', color: [70, 140, 230],  maxLevel: 5, frontage: 12, depth: 15 },
  { id: 4, key: 'i',  name: 'Industrial',           short: 'I',  kind: 'I', color: [230, 190, 50],  maxLevel: 3, frontage: 20, depth: 18 },
  { id: 5, key: 'o',  name: 'Office',               short: 'O',  kind: 'O', color: [150, 110, 220], maxLevel: 5, frontage: 16, depth: 18 },
  { id: 6, key: 'm',  name: 'Mixed-use',            short: 'M',  kind: 'M', color: [230, 120, 160], maxLevel: 5, frontage: 12, depth: 16 },
];

// Floors by zone & level [min, max]
export const FLOORS = {
  rl: [null, [1, 1], [2, 2], [3, 3]],
  rh: [null, [3, 3], [4, 5], [6, 8], [9, 14], [15, 24]],
  c:  [null, [1, 2], [2, 3], [3, 5], [6, 10], [10, 16]],
  i:  [null, [1, 2], [2, 2], [2, 3]],
  o:  [null, [3, 3], [4, 6], [8, 12], [14, 20], [22, 32]],
  m:  [null, [2, 3], [3, 4], [5, 7], [8, 11], [12, 18]],
};
// Merged lot area limits (cells) by level
export const MAX_AREA = {
  rl: [0, 150, 170, 320],
  rh: [0, 260, 360, 560, 900, 1400],
  c:  [0, 220, 320, 520, 900, 1400],
  i:  [0, 420, 800, 1600],
  o:  [0, 280, 400, 700, 1100, 1700],
  m:  [0, 240, 340, 560, 900, 1400],
};
// appeal needed to reach level n
export const LEVEL_APPEAL = [0, 0, 0.42, 0.54, 0.65, 0.75];

// Service / utility buildings. w = frontage, d = depth (cells). upkeep per month.
export const SERVICES = {
  stormdrain: { cat:'util', name:'Storm drain', w:4,d:4,cost:1800,upkeep:90,radius:45,desc:'Powered pumps reduce flooding within 45 units. Requires road access, power and water.' },
  snowdepot: { cat:'svc', name:'Snowplow depot',w:12,d:9,cost:5500,upkeep:320,radius:180,desc:'Snowplows clear roads on the same network within 180 units. Requires power and water.' },
  tramstop: { cat:'svc', name:'Tram stop',w:5,d:3,cost:900,upkeep:50,radius:55,desc:'Build a tram line between stops. Tracks follow streets.' },
  railstation: { cat:'svc', name:'Rail station',w:18,d:10,cost:14000,upkeep:450,radius:85,desc:'Rail lines build dedicated elevated tracks between stations.' },
  metrostation: { cat:'svc', name:'Metro station',w:7,d:6,cost:18000,upkeep:600,radius:65,desc:'Metro lines build direct tunnels between stations. Use the transit overlay to see trains.' },
  coal:     { cat: 'util', name: 'Coal plant',        w: 16, d: 14, cost: 16000, upkeep: 750, power: 90, pollution: 1.6, noise: 0.8, desc: 'Cheap, strong power. Pollutes heavily.' },
  wind:     { cat: 'util', name: 'Wind turbine',      w: 5,  d: 5,  cost: 3500,  upkeep: 110, power: 10, noise: 0.2, desc: 'Clean power; output varies with wind.' },
  pump:     { cat: 'util', name: 'Water pump',        w: 7,  d: 7,  cost: 4500,  upkeep: 200, water: 140, nearWater: true, desc: 'Must be placed by the shore.' },
  tower:    { cat: 'util', name: 'Water tower',       w: 5,  d: 5,  cost: 3000,  upkeep: 120, water: 35, desc: 'Small supply, place anywhere.' },
  substation: { cat: 'util', name: 'Substation', w: 6, d: 6, cost: 6000, upkeep: 120, capBoost: 240, desc: 'Transformers where power lines meet a road network: it can take 240 MW more from the grid than its lines alone.' },
  outlet:   { cat: 'util', name: 'Sewage outlet',     w: 6,  d: 6,  cost: 3500,  upkeep: 150, sewage: 160, nearWater: true, pollution: 0.9, desc: 'Must be by water. Pollutes the shore.' },
  landfill: { cat: 'util', name: 'Landfill',          w: 18, d: 16, cost: 6000,  upkeep: 350, garbage: 700, radius: 380, storage: 160000, pollution: 0.5, desc: 'Garbage trucks cover a road-network radius.' },
  fire:     { cat: 'svc',  name: 'Fire station',      w: 10, d: 9,  cost: 7000,  upkeep: 450, radius: 170, desc: 'Prevents buildings burning down.' },
  police:   { cat: 'svc',  name: 'Police station',    w: 9,  d: 9,  cost: 7000,  upkeep: 450, radius: 170, desc: 'Lowers crime.' },
  clinic:   { cat: 'svc',  name: 'Clinic',            w: 9,  d: 8,  cost: 7500,  upkeep: 500, radius: 160, patients: 1600, desc: 'Healthcare raises happiness and appeal.' },
  school:   { cat: 'svc',  name: 'School',            w: 14, d: 12, cost: 9000,  upkeep: 550, radius: 180, seats: 700, desc: 'Education unlocks office demand.' },
  parkS:    { cat: 'svc',  name: 'Pocket park',       w: 7,  d: 7,  cost: 1200,  upkeep: 40,  park: 45, desc: 'Fits leftover corners. Local appeal.' },
  parkL:    { cat: 'svc',  name: 'City park',         w: 18, d: 16, cost: 5000,  upkeep: 160, park: 90, desc: 'Big boost to surrounding land value.' },
  transformer: { cat: 'util', name: 'Transformer station', w: 12, d: 10, cost: 12000, upkeep: 450, capBoost: 480, desc: 'Connects high-voltage lines to the local road grid. Place within 18 m of a high-voltage run.', model: [{ kind: 'box', w: 0.8, d: 0.7, h: 4, color: 0x86939b }, { kind: 'cyl', r: 2, y: 4, h: 3, color: 0xc3b472 }] },
  treatment: { cat: 'util', name: 'Water treatment', w: 16, d: 14, cost: 18000, upkeep: 650, treatment: 0.8, desc: 'Removes 80% of pump contamination on its connected water grid.', model: [{ kind: 'cyl', r: 5, h: 3, color: 0x58aacc }] },
  sewageplant: { cat: 'util', name: 'Secondary sewage treatment', w: 18, d: 16, cost: 20000, upkeep: 700, sewage: 500, treatmentLevel: 0.75, desc: 'Treats 500 sewage units with 75% less discharge pollution.', model: [{ kind: 'cyl', r: 6, h: 3, color: 0x839b91 }] },
  advancedsewage: { cat: 'util', name: 'Advanced sewage treatment', w: 22, d: 18, cost: 42000, upkeep: 1200, sewage: 900, treatmentLevel: 0.95, desc: 'Treats 900 sewage units with 95% less discharge pollution.', model: [{ kind: 'cyl', r: 7, h: 4, color: 0x76aaa9 }] },
  parking: { cat: 'svc', name: 'Parking lot', w: 18, d: 14, cost: 3500, upkeep: 100, parking: 100, desc: '100 parking spaces. Scarce parking shifts trips to walking and transit.', model: [{ kind: 'box', w: 1, d: 1, h: 0.2, color: 0x444952 }, { kind: 'sign', w: 0.1, d: 0.1, h: 4, color: 0x408cff }] },
  depot:    { cat: 'svc',  name: 'Maintenance depot', w: 12, d: 10, cost: 5000,  upkeep: 300, radius: 260, desc: 'Keeps roads in good condition.' },
  busdepot: { cat: 'svc',  name: 'Bus depot',         w: 12, d: 10, cost: 6000,  upkeep: 400, desc: 'Required for bus stops to operate.' },
  busstop:  { cat: 'svc',  name: 'Bus stop',          w: 3,  d: 2,  cost: 300,   upkeep: 30,  radius: 45, desc: 'Better access, fewer car trips.' },
  // freight terminals: exports leave by rail, sea or air instead of trucks on the highway (freight = capacity)
  cargorail:  { cat: 'svc', name: 'Cargo rail terminal', w: 22, d: 12, cost: 30000,  upkeep: 900,  freight: 400, unlock: 1500, exportBonus: 0.08, noise: 0.3, desc: 'Ships exports by rail: fewer trucks and better goods prices.' },
  ferry:      { cat: 'svc', name: 'Ferry pier',          w: 8,  d: 12, cost: 9000,   upkeep: 220,  tourism: 300, unlock: 400, nearWater: true, desc: 'A pier where ferries tie up. Two piers across the water get a ferry shuttling between them; it brings a few visitors.' },
  harbour:    { cat: 'svc', name: 'Harbour',             w: 24, d: 18, cost: 60000,  upkeep: 1500, freight: 900, unlock: 3000, exportBonus: 0.15, nearWater: true, noise: 0.4, desc: 'Container port by the water: big export capacity, and industry wants to be near it.' },
  airport:    { cat: 'svc', name: 'Airport',             w: 44, d: 16, cost: 120000, upkeep: 3000, freight: 250, unlock: 8000, exportBonus: 0.05, tourism: 3000, noise: 0.9, desc: 'Air freight, tourists and business travel. Offices want to be near it; neighbours hate the noise.' },
  // higher education: unlocked by population; seats serve residents across a wide road radius
  college:  { cat: 'svc',  name: 'College',           w: 18, d: 14, cost: 22000, upkeep: 1100, radius: 320, unlock: 1500, seats: 900,  desc: 'Higher education: more skilled workers and office demand.' },
  university: { cat: 'svc', name: 'University',       w: 28, d: 22, cost: 60000, upkeep: 2400, radius: 600, unlock: 5000, seats: 2500, park: 50, desc: 'Graduates unlock top offices and tech firms.' },
  // landmarks: one of each, unlocked by population; big appeal radius and tourism income (₵/month)
  plaza:    { cat: 'svc',  name: 'Civic plaza',       w: 16, d: 14, cost: 12000, upkeep: 300, park: 110, landmark: 1000,  tourism: 900,  desc: 'Fountain square that lifts the whole neighbourhood.' },
  museum:   { cat: 'svc',  name: 'Museum',            w: 16, d: 12, cost: 20000, upkeep: 500, park: 80,  landmark: 2500,  tourism: 1800, desc: 'Draws visitors; raises education appeal nearby.' },
  stadium:  { cat: 'svc',  name: 'Stadium',           w: 26, d: 22, cost: 45000, upkeep: 900, park: 60,  landmark: 5000,  tourism: 4000, noise: 0.6, desc: 'Big tourism earner, but noisy.' },
  spire:    { cat: 'svc',  name: 'Observation spire', w: 10, d: 10, cost: 80000, upkeep: 1200, park: 140, landmark: 15000, tourism: 7000, desc: 'Skyline icon visible from everywhere.' },
  // resource industry (see resources.js): extractors sit on a deposit, processors turn inputs into
  // products, the exchange and warehouse run the market. All need road, power, water and workers;
  // output leaves by the highway or a freight terminal.
  lumbercamp: { cat: 'ind', chain: 'extract', name: 'Lumber camp',     w: 14, d: 12, cost: 9000,  upkeep: 220, jobs: 25,  dep: 'timber', out: 'timber', rate: 60, reach: 26, pollution: 0.05, noise: 0.15, desc: 'Fells the forest around it. Timber regrows slowly.' },
  coalmine:   { cat: 'ind', chain: 'extract', name: 'Coal mine',       w: 16, d: 14, cost: 16000, upkeep: 420, jobs: 60,  dep: 'coal',   out: 'coal',   rate: 70, reach: 18, pollution: 0.35, noise: 0.3, desc: 'Digs coal: fuel for power plants, steelworks, smelters and cement kilns.' },
  quarry:     { cat: 'ind', chain: 'extract', name: 'Stone quarry',    w: 18, d: 16, cost: 10000, upkeep: 240, jobs: 30,  dep: 'stone',  out: 'stone',  rate: 80, reach: 18, pollution: 0.15, noise: 0.45, desc: 'Cuts stone for cement.' },
  ironmine:   { cat: 'ind', chain: 'extract', name: 'Iron mine',       w: 16, d: 14, cost: 18000, upkeep: 450, jobs: 60,  dep: 'iron',   out: 'iron',   rate: 55, reach: 18, pollution: 0.3, noise: 0.3, desc: 'Mines iron ore for steel.' },
  oremine:    { cat: 'ind', chain: 'extract', name: 'Ore mine',        w: 16, d: 14, cost: 18000, upkeep: 450, jobs: 50,  dep: 'ore',    out: 'ore',    rate: 45, reach: 18, pollution: 0.3, noise: 0.3, desc: 'Mines copper and tin ore for the smelter.' },
  sawmill:    { cat: 'ind', chain: 'process', name: 'Sawmill',         w: 18, d: 12, cost: 14000, upkeep: 300, jobs: 40,  in: { timber: 1 }, out: 'lumber', rate: 50, pollution: 0.1, noise: 0.3, desc: 'Saws timber into lumber.' },
  papermill:  { cat: 'ind', chain: 'process', name: 'Paper mill',      w: 18, d: 14, cost: 20000, upkeep: 420, jobs: 50,  in: { timber: 1.2 }, out: 'paper', rate: 40, pollution: 0.35, noise: 0.2, unlock: 800, desc: 'Pulps timber into paper; shops sell it as goods.' },
  furniture:  { cat: 'ind', chain: 'process', name: 'Furniture works', w: 16, d: 12, cost: 18000, upkeep: 380, jobs: 70,  in: { lumber: 1 }, out: 'furniture', rate: 35, pollution: 0.05, noise: 0.15, unlock: 800, desc: 'Turns lumber into furniture; shops sell it as goods.' },
  cementworks:{ cat: 'ind', chain: 'process', name: 'Cement works',    w: 18, d: 16, cost: 24000, upkeep: 500, jobs: 45,  in: { stone: 1, coal: 0.3 }, out: 'cement', rate: 55, pollution: 0.5, noise: 0.3, unlock: 1200, desc: 'Burns stone with coal into cement. Local cement and steel make road upkeep cheaper.' },
  steelworks: { cat: 'ind', chain: 'process', name: 'Steelworks',      w: 24, d: 18, cost: 45000, upkeep: 900, jobs: 140, in: { iron: 1, coal: 1 }, out: 'steel', rate: 40, pollution: 0.8, noise: 0.5, unlock: 2500, desc: 'A blast furnace: iron and coal become steel.' },
  smelter:    { cat: 'ind', chain: 'process', name: 'Smelter',         w: 18, d: 14, cost: 35000, upkeep: 700, jobs: 80,  in: { ore: 1, coal: 0.5 }, out: 'metals', rate: 30, pollution: 0.7, noise: 0.35, unlock: 2500, desc: 'Smelts ore into copper and tin.' },
  machinery:  { cat: 'ind', chain: 'process', name: 'Machinery plant', w: 22, d: 16, cost: 55000, upkeep: 1000, jobs: 120, in: { steel: 1, metals: 0.5 }, out: 'machinery', rate: 25, pollution: 0.25, noise: 0.3, unlock: 5000, desc: 'Builds machines from steel and metals. Local machinery makes every factory more productive.' },
  exchange:   { cat: 'ind', chain: 'market', name: 'Commodity exchange', w: 14, d: 12, cost: 30000, upkeep: 600, jobs: 40, unlock: 1500, desc: 'Traders sell your commodities at better prices and import the inputs your plants lack.' },
  warehouse:  { cat: 'ind', chain: 'market', name: 'Warehouse',       w: 20, d: 14, cost: 12000, upkeep: 250, jobs: 20, stock: 600, desc: 'Stores commodities, so plants keep running and sales wait for good prices.' },
};
// District architectural styles override facade palettes for growables.
export const STYLES = {
  auto:     { name: 'Era default' },
  brick:    { name: 'Red brick', walls: [0xa8563e, 0xb8674d, 0x9c4a36, 0xc07a58], roof: [0x5a3a30, 0x6a4a3a] },
  stucco:   { name: 'Pastel stucco', walls: [0xf2d6c4, 0xe8e2b0, 0xc8e0d8, 0xf0c8d0], roof: [0xc86a4a, 0xd8804a] },
  modern:   { name: 'Modern concrete', walls: [0xd8d8d2, 0xb8bcc0, 0xe8e6e0], roof: [0x8a8e92, 0x9a9a96] },
  glass:    { name: 'Glass & steel', walls: [0x6f9ac0, 0x5a86b0, 0x88aac8], roof: [0x5a6068, 0x6a7078] },
};

// utility lines drawn by the player: they join separate road networks into one utility grid,
// and under the strict grid rule every building needs one of each within reach
export const ULINES = {
  power: { name: 'Power line', cost: 4, upkeep: 0.03, cap: 80, reach: 12, color: 0xf0c040, desc: 'Pylons carry electricity between networks; plants far from town can feed it.' },
  water: { name: 'Water pipe', cost: 6, upkeep: 0.04, cap: 160, reach: 14, color: 0x4aa0ff, desc: 'Underground mains carry fresh water between networks and to the buildings along them.' },
  sewer: { name: 'Drain', cost: 7, upkeep: 0.05, cap: 160, reach: 14, color: 0x9a7a4a, desc: 'Underground drains carry sewage to outlets and take rainwater off the streets (less ponding).' },
};

export const OVERLAYS = {
  resources: { name: 'Natural resources' },
  pipes: { name: 'Underground: pipes & lines' },
  none:      { name: 'None' },
  level: { name: 'Building level', good: true },
  happiness: { name: 'Happiness', good: true },
  problems: { name: 'Building problems' },
  age: { name: 'Building age (0–365 days)', good: true },
  landvalue: { name: 'Land value', good: true },
  pollution: { name: 'Pollution' },
  noise:     { name: 'Noise' },
  crime:     { name: 'Crime' },
  traffic:   { name: 'Traffic' },
  access:    { name: 'Accessibility', good: true },
  power:     { name: 'Electricity', good: true },
  water:     { name: 'Water & sewage', good: true },
  garbage:   { name: 'Garbage pickup', good: true },
  fire:      { name: 'Fire coverage', good: true },
  police:    { name: 'Police coverage', good: true },
  clinic:    { name: 'Health coverage', good: true },
  school:    { name: 'Education', good: true },
  park:      { name: 'Parks', good: true },
  waterpol:  { name: 'Water pollution' },
  elevation: { name: 'Terrain elevation', good:true },
  flooding: { name:'Flood depth', good:false },
  snow: { name:'Snow accumulation', good:false },
  transit:   { name: 'Transit (stops & lines)', good: true },
  desireR:   { name: 'Desirability: housing', good: true },
  desireC:   { name: 'Desirability: shops', good: true },
  desireI:   { name: 'Desirability: industry', good: true },
  desireO:   { name: 'Desirability: offices', good: true },
  health:    { name: 'Health (care & illness)', good: true },
  seniors:   { name: 'Demographics: retirees' },
  higher:    { name: 'Higher education', good: true },
  districts: { name: 'Districts' },
};

// City-wide ordinances: a monthly cost and effects wired through the simulation.
export const ORDINANCES = {
  curfew:     { name: 'Youth curfew',        cost: 400, desc: 'Crime −25%; shops earn 8% less.' },
  noise:      { name: 'Noise limits',        cost: 250, desc: 'Noise −30%; industry earns 5% less.' },
  smoke:      { name: 'Smoke detectors',     cost: 300, desc: 'Fires break out 40% less often.' },
  greenRoofs: { name: 'Green roofs',         cost: 350, desc: 'Air pollution −15%; land value +2 points.' },
  freeTransit:{ name: 'Free public transit', cost: 0,   desc: 'No bus fares; buses carry 50% more of the trips they serve.' },
  highrise:   { name: 'High-rise ban',       cost: 0,   desc: 'Buildings stop at 8 floors; land value +3 points in low-rise areas.' },
  carFree:    { name: 'Car-free centres',    cost: 500, desc: 'Districts marked car-free: less noise and pollution, more walking and transit.' },
  vaccination:{ name: 'Vaccination drive',   cost: 450, desc: 'Illness outbreaks start and spread half as often.' },
};

// Neighbouring cities beyond the map edge, one per highway exit (names by seed).
export const NEIGHBOUR_NAMES = ['Ashford', 'Brightwater', 'Cobalt Bay', 'Dunmere', 'Eastholm', 'Fairhaven', 'Greyport', 'Hollowbrook', 'Ironvale', 'Juniper Falls', 'Kestrel', 'Lowmarsh'];
export const STREET_NAMES = ['Elm', 'Oak', 'Maple', 'Cedar', 'Birch', 'Willow', 'Harbour', 'Mill', 'Station', 'Church', 'Market', 'Bridge', 'River', 'Park', 'Hill', 'Canal', 'Orchard', 'Quarry', 'Foundry', 'Garden', 'Kings', 'Queens', 'Beacon', 'Lantern'];
export const STREET_KINDS = { alley: 'Lane', street: 'St', avenue: 'Ave', boulevard: 'Blvd', highway: 'Hwy', oneway: 'St', ramp: 'Ramp' };

export const DISTRICT_COLORS = [
  null, [255, 110, 110], [110, 180, 255], [255, 200, 90], [150, 230, 130], [210, 140, 255],
  [90, 220, 220], [255, 150, 210], [200, 200, 120], [140, 160, 255], [255, 170, 120],
  [120, 255, 190], [230, 120, 120], [160, 220, 255], [220, 255, 140], [255, 255, 255],
];

export const PRIORITIES = {
  balanced:  'Balanced',
  safety:    'Safety first (fire + police ×1.3)',
  health:    'Health first (clinics ×1.3)',
  education: 'Education first (schools ×1.3)',
};

export const START_MONEY = 70000;
