import { connectWaterPorts } from './waterports.js';
// Organicity — guided tutorial and authored scenarios. The authored scenarios are
// built from a fixed seed, so every player starts from the same city.
import { N, ZONES, SERVICES } from './config.js';

const zoned = (w, ids) => {
  if (w._zc?.v !== w.zoneVersion) {
    const c = new Array(ZONES.length).fill(0);
    for (let i = 0; i < w.zone.length; i++) if (w.zone[i]) c[w.zone[i]]++;
    w._zc = { v: w.zoneVersion, c };
  }
  return ids.reduce((s, id) => s + w._zc.c[id], 0);
};
const has = (sim, ...svc) => [...sim.w.buildings.values()].some((b) => svc.includes(b.svc));

// Steps are checked in order; the coach shows the first unfinished one.
export const TUTORIAL = [
  { label: 'Branch a road off the highway', hint: 'Roads (2): click on the highway’s end, then click again to finish. Any angle and curve works (C).', done: (s) => [...s.w.net.edges.values()].some((e) => e.type !== 'highway') },
  { label: 'Paint housing along your road', hint: 'Zones (3): pick Low-density housing and brush along the street, or Fill block (F).', done: (s) => zoned(s.w, [1, 2]) > 60 },
  { label: 'Build a power plant', hint: 'Utilities (4): a coal plant is cheap and strong; wind turbines are clean. Power travels along the roads.', done: (s) => has(s, 'coal', 'wind') },
  { label: 'Add a water pump or tower', hint: 'Utilities (4): pumps must sit by the shore; water towers go anywhere.', done: (s) => has(s, 'pump', 'tower') },
  { label: 'Add a sewage outlet', hint: 'Utilities (4): outlets sit by the water, downstream of your pump if you can.', done: (s) => has(s, 'outlet') },
  { label: 'Zone shops or industry for jobs', hint: 'Zones (3): commercial, industry or mixed-use. Watch the R/C/I/O demand bars at the top.', done: (s) => zoned(s.w, [3, 4, 6]) > 40 },
  { label: 'Reach 200 residents', hint: 'Let time run (▶▶). People move in once homes have power, water, sewage and a route to the highway.', done: (s) => s.stats.pop >= 200 },
  { label: 'Build a school', hint: 'Services (5): schools raise education, which unlocks offices and higher levels.', done: (s) => has(s, 'school') },
  { label: 'Open the info overlays', hint: 'Overlays (8): see land value, pollution, coverage and traffic painted on the map.', done: (s) => s.tutorialFlags.overlays },
  { label: 'Check the budget', hint: 'Budget (9): taxes, service funding, loans and trade. Keep the monthly balance positive.', done: (s) => s.tutorialFlags.budget },
];

export const SCENARIOS = {
  tutorial: { name: 'Tutorial · your first city', desc: 'A step-by-step guide through roads, zones, utilities and services.' },
  town: { name: 'Thriving town · 1,000 residents', desc: 'Grow a healthy town with work for everyone.' },
  prosper: { name: 'Prosperous city · 2,500 residents', desc: 'A happy city with a monthly surplus.' },
  gridlock: { name: 'Fix the gridlock', desc: 'A dense district with one way out. Untangle its traffic within two years.', seed: 4242 },
  debt: { name: 'Balance the books', desc: 'An overspending town in debt. Get back in the black before the state steps in.', seed: 4242 },
};

function builder(w) {
  const S = (x, z) => w.net.snap(x, z, 3);
  const road = (a, b, t = 'street', c = null) => w.buildRoad(S(...a), c && { x: c[0], z: c[1] }, S(...b), t, 0);
  const svc = (k, x, z) => {
    for (let r = 0; r <= 30; r += 2) for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      const p = w.planService(k, x + dx, z + dz); if (p.ok) { connectWaterPorts(w,w.placeService(k, p)); return true; }
    }
    return false;
  };
  const shore = () => { for (let x = 262; x < N; x++) if (w.water[262 * N + x]) return x; return 300; };
  return { road, svc, shore };
}

// fill every zoned lot with a finished building at `level` (capped per zone) and move people in;
// lots keep their ordinary size, so dense scenarios are many towers rather than a few blocks
function populate(w, sim, level, every = 3) {
  for (let i = 0; i < w.zone.length; i += every) {
    if (!w.zone[i] || !w.free(i) || w.accEdge[i] < 0) continue;
    w.placeGrowable((i % N) + 0.5, Math.floor(i / N) + 0.5, Math.min(2, level));
  }
  for (const b of w.buildings.values()) {
    if (b.svc) continue;
    b.level = Math.min(level, ZONES[b.zone].maxLevel); w.touchBuilding(b);
    b.locked = false; b.built = -400;
    sim.capacity(b); b.occ = b.hh || 0; b.workers = (b.jobs || 0) * 0.85; b.happy = 0.62; b.appeal = 0.5;
  }
}

export function setupScenario(w, sim, key) {
  const B = builder(w), sh = B.shore(), def = SCENARIOS[key]?.def;
  if (def) {   // a pack scenario: its roads, zones and services, then its starting money
    for (const r of def.setup.roads) B.road(r.a, r.b, r.type);
    for (const z of def.setup.zones) w.fillZone(z.at[0], z.at[1], z.zone);
    for (const s of def.setup.services) if (SERVICES[s.key]) B.svc(s.key, s.at[0], s.at[1]);
    if (def.setup.populate) populate(w, sim, def.setup.populate);
    sim.money = def.money; w.undoStack.length = 0; return;
  }
  if (key === 'gridlock') {
    // homes in the west, jobs in the east, and a single lane between them:
    // every commute squeezes through it (fix: more links, wider roads, buses)
    B.road([150, 262], [180, 262]);
    for (const x of [180, 210, 240]) B.road([x, 205], [x, 325]);
    for (const z of [205, 235, 262, 295, 325]) B.road([180, z], [240, z]);
    B.road([240, 262], [266, 262], 'alley');
    for (const x of [266, 296]) B.road([x, 205], [x, 325]);
    for (const z of [205, 325]) B.road([266, z], [296, z]);
    B.road([296, 262], [sh - 8, 262]);
    for (const [x, z, id] of [[195, 220, 2], [225, 220, 2], [195, 248, 2], [225, 248, 6], [195, 278, 2], [225, 278, 2], [195, 310, 6], [225, 310, 2], [281, 232, 5], [281, 293, 3]]) w.fillZone(x, z, id);
    B.svc('coal', 281, 190); B.svc('pump', sh - 5, 254); B.svc('outlet', sh - 5, 272);
    B.svc('fire', 170, 290); B.svc('police', 170, 240); B.svc('clinic', 310, 290); B.svc('school', 170, 315); B.svc('landfill', 310, 225);
    populate(w, sim, 5);
    sim.money = 60000;
  } else if (key === 'debt') {
    B.road([150, 262], [sh - 8, 262], 'avenue');
    B.road([170, 195], [245, 330], 'street', [215, 215]);
    B.road([205, 195], [205, 335]);
    B.road([160, 305], [255, 300], 'street', [210, 365]);
    for (const [x, z, id] of [[178, 240, 1], [228, 215, 1], [185, 285, 3], [230, 285, 4], [215, 318, 6]]) w.fillZone(x, z, id);
    B.svc('coal', 175, 178); B.svc('pump', sh - 5, 254); B.svc('outlet', sh - 5, 272); B.svc('landfill', 150, 290);
    B.svc('fire', 215, 272); B.svc('police', 190, 262); B.svc('clinic', 225, 250); B.svc('school', 190, 300); B.svc('parkL', 240, 240);
    populate(w, sim, 2);
    for (const k of ['fire', 'police', 'clinic', 'school', 'parkL', 'coal', 'pump', 'outlet', 'landfill']) sim.setBudget(k, 1.5);
    sim.tax = { R: 6, C: 6, I: 6, O: 6 };
    sim.takeLoan(50000, 24); sim.money = -12000;
  }
  w.undoStack.length = 0;
}
