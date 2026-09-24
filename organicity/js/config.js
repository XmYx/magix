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
export const LAYERS = { 1: { name: 'Elevated', cost: 2.5, y: 6 }, 0: { name: 'Ground', cost: 1, y: 0 }, '-1': { name: 'Tunnel', cost: 3.5, y: -5 } };
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
  coal:     { cat: 'util', name: 'Coal plant',        w: 16, d: 14, cost: 16000, upkeep: 750, power: 90, pollution: 1.6, noise: 0.8, desc: 'Cheap, strong power. Pollutes heavily.' },
  wind:     { cat: 'util', name: 'Wind turbine',      w: 5,  d: 5,  cost: 3500,  upkeep: 110, power: 10, noise: 0.2, desc: 'Clean power; output varies with wind.' },
  pump:     { cat: 'util', name: 'Water pump',        w: 7,  d: 7,  cost: 4500,  upkeep: 200, water: 140, nearWater: true, desc: 'Must be placed by the shore.' },
  tower:    { cat: 'util', name: 'Water tower',       w: 5,  d: 5,  cost: 3000,  upkeep: 120, water: 35, desc: 'Small supply, place anywhere.' },
  outlet:   { cat: 'util', name: 'Sewage outlet',     w: 6,  d: 6,  cost: 3500,  upkeep: 150, sewage: 160, nearWater: true, pollution: 0.9, desc: 'Must be by water. Pollutes the shore.' },
  landfill: { cat: 'util', name: 'Landfill',          w: 18, d: 16, cost: 6000,  upkeep: 350, garbage: 700, radius: 380, storage: 160000, pollution: 0.5, desc: 'Garbage trucks cover a road-network radius.' },
  fire:     { cat: 'svc',  name: 'Fire station',      w: 10, d: 9,  cost: 7000,  upkeep: 450, radius: 170, desc: 'Prevents buildings burning down.' },
  police:   { cat: 'svc',  name: 'Police station',    w: 9,  d: 9,  cost: 7000,  upkeep: 450, radius: 170, desc: 'Lowers crime.' },
  clinic:   { cat: 'svc',  name: 'Clinic',            w: 9,  d: 8,  cost: 7500,  upkeep: 500, radius: 160, desc: 'Healthcare raises happiness and appeal.' },
  school:   { cat: 'svc',  name: 'School',            w: 14, d: 12, cost: 9000,  upkeep: 550, radius: 180, desc: 'Education unlocks office demand.' },
  parkS:    { cat: 'svc',  name: 'Pocket park',       w: 7,  d: 7,  cost: 1200,  upkeep: 40,  park: 45, desc: 'Fits leftover corners. Local appeal.' },
  parkL:    { cat: 'svc',  name: 'City park',         w: 18, d: 16, cost: 5000,  upkeep: 160, park: 90, desc: 'Big boost to surrounding land value.' },
  depot:    { cat: 'svc',  name: 'Maintenance depot', w: 12, d: 10, cost: 5000,  upkeep: 300, radius: 260, desc: 'Keeps roads in good condition.' },
  busdepot: { cat: 'svc',  name: 'Bus depot',         w: 12, d: 10, cost: 6000,  upkeep: 400, desc: 'Required for bus stops to operate.' },
  busstop:  { cat: 'svc',  name: 'Bus stop',          w: 3,  d: 2,  cost: 300,   upkeep: 30,  radius: 45, desc: 'Better access, fewer car trips.' },
  // landmarks: one of each, unlocked by population; big appeal radius and tourism income (₵/month)
  plaza:    { cat: 'svc',  name: 'Civic plaza',       w: 16, d: 14, cost: 12000, upkeep: 300, park: 110, landmark: 1000,  tourism: 900,  desc: 'Fountain square that lifts the whole neighbourhood.' },
  museum:   { cat: 'svc',  name: 'Museum',            w: 16, d: 12, cost: 20000, upkeep: 500, park: 80,  landmark: 2500,  tourism: 1800, desc: 'Draws visitors; raises education appeal nearby.' },
  stadium:  { cat: 'svc',  name: 'Stadium',           w: 26, d: 22, cost: 45000, upkeep: 900, park: 60,  landmark: 5000,  tourism: 4000, noise: 0.6, desc: 'Big tourism earner, but noisy.' },
  spire:    { cat: 'svc',  name: 'Observation spire', w: 10, d: 10, cost: 80000, upkeep: 1200, park: 140, landmark: 15000, tourism: 7000, desc: 'Skyline icon visible from everywhere.' },
};
// District architectural styles override facade palettes for growables.
export const STYLES = {
  auto:     { name: 'Era default' },
  brick:    { name: 'Red brick', walls: [0xa8563e, 0xb8674d, 0x9c4a36, 0xc07a58], roof: [0x5a3a30, 0x6a4a3a] },
  stucco:   { name: 'Pastel stucco', walls: [0xf2d6c4, 0xe8e2b0, 0xc8e0d8, 0xf0c8d0], roof: [0xc86a4a, 0xd8804a] },
  modern:   { name: 'Modern concrete', walls: [0xd8d8d2, 0xb8bcc0, 0xe8e6e0], roof: [0x8a8e92, 0x9a9a96] },
  glass:    { name: 'Glass & steel', walls: [0x6f9ac0, 0x5a86b0, 0x88aac8], roof: [0x5a6068, 0x6a7078] },
};

export const OVERLAYS = {
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
  transit:   { name: 'Transit (stops & lines)', good: true },
  desireR:   { name: 'Desirability: housing', good: true },
  desireC:   { name: 'Desirability: shops', good: true },
  desireI:   { name: 'Desirability: industry', good: true },
  desireO:   { name: 'Desirability: offices', good: true },
  districts: { name: 'Districts' },
};

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
