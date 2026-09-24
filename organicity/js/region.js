// Organicity — the region: a 5×5 world map of full-size tiles, SimCity 4 style.
// Your first city sits in the centre. Neighbouring AI cities occupy some tiles
// (one beyond each highway exit, a few more further out). Buy a tile next to one
// you own, found a city there and switch between cities; adjacent cities you run
// trade workers with each other. Inactive cities are stored compressed per tile.
import { N, NEIGHBOUR_NAMES } from './config.js';
import { hash2 } from './util.js';
import { MAP_PRESETS } from './terrain.js';

export const REGION_KEY = 'organicity-region';
export const SIZE = 5;
const PRESETS = Object.keys(MAP_PRESETS);
const CITY_NAMES = ['Organicity', 'Northgate', 'Southmere', 'Westbrook', 'Eastfield', 'Highcliff', 'Lakeview', 'Stonebridge', 'Fernhill', 'Copperton', 'Marlow', 'Redwater'];
export const tileKey = (x, z) => `${x},${z}`;
// services a city can share with neighbouring cities it has a road link to
export const SHARED = { university: 'University places', college: 'College places', airport: 'Airport', harbour: 'Harbour', cargorail: 'Cargo rail' };
export const DIRS = [[-1, 0, 'west'], [1, 0, 'east'], [0, -1, 'north'], [0, 1, 'south']];

// direction of a highway exit node on the map edge
export function exitDir(n) {
  const d = [[n.x, -1, 0], [N - n.x, 1, 0], [n.z, 0, -1], [N - n.z, 0, 1]].sort((a, b) => a[0] - b[0])[0];
  return [d[1], d[2]];
}

export function createRegion(world, sim) {
  const seed = world.seed, c = Math.floor(SIZE / 2), home = tileKey(c, c);
  const r = { id: `r${seed}-${(Date.now() % 1e7).toString(36)}`, seed, size: SIZE, active: home, tiles: {} };
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const k = tileKey(x, z);
    r.tiles[k] = { x, z, seed: Math.floor(hash2(x, z, seed % 99991) * 1e6), preset: PRESETS[Math.floor(hash2(x, z, (seed % 99991) + 5) * PRESETS.length)], kind: 'wild', owned: false };
  }
  Object.assign(r.tiles[home], { seed: world.seed, preset: world.mapPreset || 'river', kind: 'city', owned: true, gov: 'player', name: CITY_NAMES[0] });
  // the neighbours the city already trades with sit beyond its highway exits
  const used = new Set();
  for (const n of world.net.nodes.values()) {
    if (!n.outside) continue;
    const [dx, dz] = exitDir(n), t = r.tiles[tileKey(c + dx, c + dz)]; if (!t || t.kind !== 'wild') continue;
    const nb = sim.regionList().find((q) => q.id === n.id);
    // an AI governor's tile: a city is founded there and grows in the background
    Object.assign(t, { kind: 'ai', gov: 'ai', name: nb?.name || NEIGHBOUR_NAMES[0], pop: Math.round(2000 + hash2(t.x, t.z, seed % 811) * 6000), exitNode: n.id });
    used.add(t.name);
  }
  // a few more AI cities further out
  const free = Object.values(r.tiles).filter((t) => t.kind === 'wild' && Math.abs(t.x - c) + Math.abs(t.z - c) >= 2);
  free.sort((a, b) => hash2(a.x, a.z, seed % 7919) - hash2(b.x, b.z, seed % 7919));
  for (const t of free.slice(0, 4)) {
    const name = NEIGHBOUR_NAMES.find((nm, i) => !used.has(nm) && hash2(i, t.x * 7 + t.z, seed % 613) < 0.6) || NEIGHBOUR_NAMES.find((nm) => !used.has(nm));
    used.add(name); Object.assign(t, { kind: 'ai', gov: 'ai', name, pop: Math.round(2000 + hash2(t.x, t.z, seed % 3571) * 10000) });
  }
  return r;
}

export function loadRegion() { try { return JSON.parse(localStorage.getItem(REGION_KEY) || 'null'); } catch { return null; } }
export function saveRegion(r) { try { localStorage.setItem(REGION_KEY, JSON.stringify(r)); return true; } catch { return false; } }
export const cityKey = (r, k) => `organicity-city:${r.id}:${k}`;

export function neighbours(r, k) {
  const t = r.tiles[k]; if (!t) return [];
  return DIRS.map(([dx, dz, dir]) => ({ dir, t: r.tiles[tileKey(t.x + dx, t.z + dz)] })).filter((q) => q.t);
}
export function canBuy(r, k) { const t = r.tiles[k]; return !!t && t.kind === 'wild' && !t.owned && neighbours(r, k).some((q) => q.t.owned); }
// each extra tile costs more than the last
export function tileCost(r) { const owned = Object.values(r.tiles).filter((t) => t.owned).length; return Math.round((60000 * 1.6 ** (owned - 1)) / 1000) * 1000; }
export function nameFor(r) { const used = new Set(Object.values(r.tiles).map((t) => t.name)); return CITY_NAMES.find((n) => !used.has(n)) || `New town ${Object.keys(r.tiles).length}`; }

// headline numbers (and a small picture) of the city being played, for the world map and its neighbours
export function summarize(world, sim, rend) {
  const st = sim.stats, jobs = st.jobs.C + st.jobs.I + st.jobs.O, filled = st.filled.C + st.filled.I + st.filled.O;
  let thumb = null;
  try {
    const g = rend?.gpx; if (g && typeof document !== 'undefined') {
      const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
      const cx = cv.getContext('2d'), img = cx.createImageData(S, S), k = N / S;
      for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) { const i = ((z * k) * N + x * k) * 4, o = (z * S + x) * 4; img.data[o] = g[i]; img.data[o + 1] = g[i + 1]; img.data[o + 2] = g[i + 2]; img.data[o + 3] = 255; }
      cx.putImageData(img, 0, 0); thumb = cv.toDataURL('image/png');
    }
  } catch { thumb = null; }
  const edges = {}; for (const side of ['west', 'east', 'north', 'south']) edges[side] = edgeProfile(world, side);
  // monthly growth over the last quarter, spare utilities before deals, and services neighbours can share
  const hist = sim.history, back = hist[Math.max(0, hist.length - 4)], growth = back && back.pop > 20 ? Math.max(-0.05, Math.min(0.08, (st.pop / back.pop - 1) / Math.max(1, hist.length - 1 - Math.max(0, hist.length - 4)))) : 0;
  const services = [...new Set([...world.buildings.values()].filter((b) => b.svc && !b.abandoned).map((b) => b.svc))].filter((k) => SHARED[k]);
  return { pop: Math.round(st.pop), jobs: Math.round(jobs), jobsFree: Math.max(0, Math.round(jobs - filled)), unemployed: Math.round(st.workers * st.unemp), year: sim.year, money: Math.round(sim.money), thumb, edges, exits: exitsOf(world).map(({ side, pos }) => ({ side, pos })),
    growth, surplus: { ...(sim.utilSurplus || { power: 0, water: 0 }) }, services, day: sim.day };
}

// what the simulation of tile k sees of its neighbours: adjacent cities you run, with their latest numbers
export function partnersOf(r, k) {
  return neighbours(r, k).filter((q) => q.t.kind === 'city' && q.t.summary).map((q) => ({ key: tileKey(q.t.x, q.t.z), dir: q.dir, name: q.t.name, pop: q.t.summary.pop, jobsFree: q.t.summary.jobsFree, unemployed: q.t.summary.unemployed, surplus: q.t.summary.surplus || null, services: q.t.summary.services || [], player: true }));
}

// ---------------------------------------------------------------- connected tiles
// Each side of a city is described by 128 samples (every 4 cells): [water 0/1, ground height].
// A city founded next to it blends its own edge toward these, so coastlines, rivers and
// hills continue across the border. OPPOSITE maps my side to the neighbour's facing side.
export const OPPOSITE = { west: 'east', east: 'west', north: 'south', south: 'north' };
const SAMPLES = 128, STEP = N / SAMPLES;
export const sideCell = (side, t, d = 0) => side === 'west' ? [d, t] : side === 'east' ? [N - 1 - d, t] : side === 'north' ? [t, d] : [t, N - 1 - d];
export function edgeProfile(world, side) {
  const out = [];
  for (let k = 0; k < SAMPLES; k++) { const [x, z] = sideCell(side, Math.floor(k * STEP + STEP / 2)), i = z * N + x; out.push(world.water[i] ? 1 : 0, +(world.elevation[i] || 0).toFixed(1)); }
  return out;
}
export function sideOf(n) { const [dx, dz] = exitDir(n); return dx < 0 ? 'west' : dx > 0 ? 'east' : dz < 0 ? 'north' : 'south'; }
// road exits (outside nodes) of a city: which side and where along it
export function exitsOf(world) {
  return [...world.net.nodes.values()].filter((n) => n.outside).map((n) => { const side = sideOf(n); return { side, pos: +(side === 'west' || side === 'east' ? n.z : n.x).toFixed(1), id: n.id }; });
}
// For the city on tile k: neighbour edge profiles keyed by *my* side, and the exits that face me.
export function edgeMatchFor(r, k) {
  const out = {};
  for (const { dir, t } of neighbours(r, k)) if (t.kind === 'city' && t.summary?.edges?.[OPPOSITE[dir]]) out[dir] = t.summary.edges[OPPOSITE[dir]];
  return Object.keys(out).length ? out : null;
}
export function stubsFor(r, k) {
  const out = [];
  for (const { dir, t } of neighbours(r, k)) for (const e of t.summary?.exits || []) if (e.side === OPPOSITE[dir]) out.push({ side: dir, pos: e.pos, name: t.name, key: tileKey(t.x, t.z) });
  return out;
}

// ---------------------------------------------------------------- deals between your cities
// A deal is a monthly contract: seller supplies `amount` units of power or water to buyer at `price` per unit.
export function dealsFor(r, k) { return (r.deals || []).filter((d) => d.seller === k || d.buyer === k).map((d) => ({ ...d, role: d.seller === k ? 'sell' : 'buy', partner: d.seller === k ? d.buyer : d.seller })); }
export function addDeal(r, deal) { r.deals ||= []; r.dealId = (r.dealId || 0) + 1; r.deals.push({ id: r.dealId, ...deal }); return r.dealId; }
export function removeDeal(r, id) { r.deals = (r.deals || []).filter((d) => d.id !== id); }

// ---------------------------------------------------------------- AI neighbours over time
// AI cities grow with trade, shrink when your cities out-compete them, and ride a slow business cycle.
export function evolveAI(r, day, trading, yourPop) {
  const months = Math.floor((day - (r.aiDay ?? day)) / 30); if (months <= 0) { r.aiDay ??= day; return; }
  r.aiDay = (r.aiDay ?? day) + months * 30;
  for (const t of Object.values(r.tiles)) {
    if (t.kind !== 'ai') continue;
    for (let m = 0; m < months; m++) {
      const month = Math.floor(r.aiDay / 30) - months + m, cycle = 0.004 * Math.sin(month / 18 + hash2(t.x, t.z, 9) * 6.28);
      const compete = 0.005 * Math.min(1, Math.max(0, (yourPop - t.pop * 0.4) / Math.max(1, t.pop)));
      t.pop = Math.max(3000, Math.round(t.pop * (1 + 0.002 + (trading ? 0.002 : 0) + cycle - compete)));
      t.trend = cycle - compete + (trading ? 0.002 : 0);
    }
  }
}

// ---------------------------------------------------------------- neighbours in the background
// While you play one city, the others carry on at low detail: each month their population
// follows its recent growth (easing off over time), jobs and jobless scale with it, and
// growing demand eats into spare power and water. Numbers settle when you play them again.
export function backgroundMonth(r, activeKey) {
  for (const [k, t] of Object.entries(r.tiles)) {
    const s = t.summary; if (k === activeKey || t.kind !== 'city' || !s) continue;
    const g = s.growth || 0, before = s.pop;
    s.pop = Math.max(0, Math.round(s.pop * (1 + g)));
    s.jobsFree = Math.max(0, Math.round((s.jobsFree || 0) * (1 + g * 0.8)));
    s.unemployed = Math.max(0, Math.round((s.unemployed || 0) * (1 + g * 1.1)));
    if (s.surplus) { const d = (s.pop - before) * 0.012; s.surplus.power = +(s.surplus.power - d).toFixed(1); s.surplus.water = +(s.surplus.water - d * 1.4).toFixed(1); }
    s.growth = +(g * 0.96).toFixed(5);
    s.background = (s.background || 0) + 1;
  }
}
