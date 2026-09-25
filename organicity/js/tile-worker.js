// Organicity — background tile worker. While you play one city, the others run here at full
// simulation fidelity (no rendering): each job loads a city (or founds a new AI city),
// applies its president's policy and the region's family moves, simulates some days (with the
// AI governor building monthly if the tile is AI-run) and returns the updated save, the
// city's numbers, its housing and jobs for the regional economy, and a view to draw it by.
import { World } from './world.js';
import { Sim, SANDBOX_DEFAULTS } from './sim.js';
import { makeSave, loadSave } from './save.js';
import { aiBuild } from './builder.js';
import { applyPolicy } from './presidents.js';
import { summarize, edgesOf } from './region.js';
import { technology } from './eras.js';
import { cityBlocks, viewSnapshot } from './tileview.js';

const days = (sim, n) => { sim.speed = 1; sim.paused = false; sim.budgetMs = 3; for (let d = 0; d < n; d++) for (let k = 0; k < 30; k++) sim.update(1 / 30); };

export function found(g) {
  const world = new World(g.seed, g.preset);
  world.edgeMatch = g.edgeMatch || null; world.newGame();
  const sim = new Sim(world, { worker: false, startYear: g.startYear, eraPace: g.eraPace });
  if (g.year > sim.year) { sim.startYear = g.year; sim.year = world.year = g.year; sim.tech = technology(g.year); }
  sim.money = 90000;
  for (const st of g.stubs || []) {   // roads to where the neighbours' roads reach the border
    const e = st.side === 'west' ? [0.5, st.pos] : st.side === 'east' ? [511.5, st.pos] : st.side === 'north' ? [st.pos, 0.5] : [st.pos, 511.5];
    const i = st.side === 'west' ? [34, st.pos] : st.side === 'east' ? [478, st.pos] : st.side === 'north' ? [st.pos, 34] : [st.pos, 478];
    world.buildRoad(world.net.snap(e[0], e[1], 3), null, world.net.snap(i[0], i[1], 3), 'street', 0);
  }
  return { world, sim };
}

// pregenerated land for a tile nobody has built on yet: its view from next door and its edges
export function terrainTile(g) {
  const world = new World(g.seed, g.preset); world.edgeMatch = g.edgeMatch || null; world.genTerrain();
  return { view: viewSnapshot(world), edges: edgesOf(world) };
}

export function runTile(m) {
  if (m.terrain) return terrainTile(m.terrain);
  let world, sim;
  if (m.generate) ({ world, sim } = found(m.generate));
  else ({ world, sim } = loadSave(m.save, { worker: false }));
  for (const b of world.buildings.values()) if (!b.svc) sim.capacity(b);   // homes and jobs are known before the first simulated day
  for (const [id, occ] of m.occ || []) { const b = world.buildings.get(id); if (b && b.hh) b.occ = Math.max(0, Math.min(b.hh, occ)); }   // families who moved in or out
  if (m.credit) sim.money += m.credit;                                                              // tolls earned at its portals
  if (m.policy) applyPolicy(sim, m.policy);
  const ai = m.gov === 'ai', log = [];
  if (m.generate) {   // an AI founding: a few quick months to lay out a starting town
    sim.sandbox = { ...SANDBOX_DEFAULTS, infinite: false, instant: true, noFires: true, noIllness: true, noDisasters: true };
    for (let k = 0; k < 8; k++) { log.push(...aiBuild(world, sim, { dev: m.policy?.dev })); days(sim, 30); }
    sim.sandbox = null;
  }
  for (let d = 0; d < (m.days || 0); d++) { days(sim, 1); if (ai && sim.day % 30 === 0) log.push(...aiBuild(world, sim, { dev: m.policy?.dev })); }
  world.undoStack.length = 0;
  return { save: makeSave(world, sim), summary: summarize(world, sim, null), view: viewSnapshot(world), blocks: cityBlocks(world, sim), day: sim.day, built: log };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = ({ data: m }) => {
    try { self.postMessage({ id: m.id, key: m.key, ok: true, ...runTile(m) }); }
    catch (e) { self.postMessage({ id: m.id, key: m.key, ok: false, err: e.message, stack: e.stack }); }
  };
}
