// Organicity — save format and migrations. Every save carries a version `v`;
// older saves are upgraded step by step so new fields never break old cities.
import { World } from './world.js';
import { Sim } from './sim.js';

export const SAVE_VERSION = 8;
export const SAVE_KEY = 'organicity-save';

// MIGRATIONS[n] upgrades a version-n save to version n+1.
const MIGRATIONS = {
  7: s => {s.world.mapPreset ||= 'river';s.world.hazards ||= {snow:0,surge:0};for(const l of s.world.lines || [])l.mode ||= 'bus';return s;},
  // v7: ordinances, neighbouring cities, news feed, debt state, car-free districts
  6: (s) => {
    Object.assign(s.sim, { ordinances: s.sim.ordinances || {}, region: s.sim.region || {}, news: s.sim.news || [], milestone: s.sim.milestone || 0, debtMonths: s.sim.debtMonths || 0, austerity: !!s.sim.austerity, gameOver: !!s.sim.gameOver });
    for (const d of s.world.districts || []) if (d && d.policy) d.policy.carFree = !!d.policy.carFree;
    return s;
  },
  // v6: junction control (node field 4), grade separation + bus lanes (edge fields 8–9), bus lines
  5: (s) => {
    s.world.nodes = s.world.nodes.map((n) => (n.length >= 5 ? n : [...n, 'auto']));
    s.world.edges = s.world.edges.map((e) => (e.length >= 10 ? e : [...e.slice(0, 8), ...Array(8 - Math.min(8, e.length)).fill(0), 0, 0]));
    s.world.lines = s.world.lines || []; s.world.lineId = s.world.lineId || 1;
    return s;
  },
  4: s => { s.sim.startYear=2000;s.sim.eraPace=1;s.world.platforms=[];s.world.platformId=1;return s; },
  3: (s) => { s.sim.weatherOverride = null; return s; },
  2: (s) => {
    s.sim.serviceBudgets = {}; s.sim.loans = []; s.sim.loanId = 1;
    s.sim.scenario = null; s.sim.scenarioWon = false;
    for (const b of s.world.buildings) b.constructionUntil = 0;
    return s;
  },
  1: (s) => {
    // v2: one-way roads (edge field 7), sandbox settings, building level locks
    s.world.edges = s.world.edges.map((e) => (e.length >= 8 ? e : [...e, 0]));
    s.sim.sandbox = s.sim.sandbox ?? null;
    for (const b of s.world.buildings) b.locked = !!b.locked;
    return s;
  },
};

export function migrate(save) {
  if (!save || typeof save !== 'object' || !save.world || !save.sim) throw new Error('Not an Organicity save');
  let s = { ...save, v: typeof save.v === 'number' ? save.v : 1 };
  if (s.v > SAVE_VERSION) throw new Error(`This save comes from a newer version (v${s.v}); this game reads up to v${SAVE_VERSION}.`);
  while (s.v < SAVE_VERSION) {
    const step = MIGRATIONS[s.v];
    if (!step) throw new Error(`No migration from save v${s.v}`);
    s = step(s); s.v++;
  }
  return s;
}

export function makeSave(world, sim) {
  return { v: SAVE_VERSION, world: world.serialize(), sim: sim.serialize() };
}

export function loadSave(raw, opts = {}) {
  const s = migrate(raw);
  const world = World.load(s.world);
  const sim = new Sim(world, { ...opts, sandbox: s.sim.sandbox });
  sim.load(s.sim);
  return { world, sim };
}
