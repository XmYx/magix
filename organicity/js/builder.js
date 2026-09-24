// Organicity — the AI governor's city builder. AI governors build real cities with the same
// actions a player has (roads, zoning, utilities, services), paid from their own treasury:
//  1. keep power, water, sewage and garbage ahead of demand;
//  2. put fire, police, clinics and schools where homes lack them;
//  3. when zoned land runs short, extend the street network from a junction (on a grid angle
//     of their own, avoiding water) and zone the new street by demand and the development
//     priority of their president's policy.
// Deterministic for a given city and day. Runs monthly inside the background tile worker.
import { N, SERVICES } from './config.js';
import { mulberry32, hash2 } from './util.js';

// an AI governor keeps a reserve: ₵5,000 behind essential utilities, ₵15,000 behind anything else
const ESSENTIAL = new Set(['coal', 'wind', 'pump', 'tower', 'outlet']);
const reserve = (key) => (ESSENTIAL.has(key) ? 5000 : 15000);
function tryService(w, sim, key, x, z, R = 40) {
  if (!SERVICES[key] || !sim.canAfford(SERVICES[key].cost + reserve(key))) return false;
  for (let r = 0; r <= R; r += 4) for (let a = 0; a < (r ? 8 : 1); a++) {
    const p = w.planService(key, x + Math.cos(a * Math.PI / 4) * r, z + Math.sin(a * Math.PI / 4) * r);
    if (p.ok) { w.placeService(key, p); sim.spend(SERVICES[key].cost); return true; }
  }
  return false;
}
function tryRoad(w, sim, ax, az, bx, bz, type = 'street', keep = 15000) {
  if (bx < 6 || bz < 6 || bx > N - 6 || bz > N - 6) return null;
  for (let t = 0; t <= 1.0001; t += 0.1) { const c = w.cellAt(ax + (bx - ax) * t, az + (bz - az) * t); if (c < 0 || w.water[c]) return null; }
  const A = w.net.snap(ax, az, 3), B = w.net.snap(bx, bz, 3), C = { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
  if (!w.net.check(A, C, B, type).ok) return null;
  const cost = w.roadCost(A, C, B, type).cost; if (!sim.canAfford(cost + keep)) return null;
  const res = w.buildRoad(A, null, B, type, 0); if (!res.edges.length) return null;
  sim.spend(cost); return res;
}

// zone kind for a new street: by demand, with the president's priority weighing in
function pickZone(sim, rng, dev, farFromCentre) {
  const d = sim.demand, pop = sim.stats.pop || 0;
  const w = { R: Math.max(4, d.R + 50) * (dev === 'housing' ? 1.6 : 1), C: Math.max(2, d.C + 35) * (dev === 'commerce' ? 1.6 : 1),
    I: Math.max(2, d.I + 30) * (dev === 'industry' ? 1.6 : 1) * (farFromCentre ? 1.4 : 0.5), O: (sim.stats.eduRate > 0.35 ? Math.max(0, d.O + 20) : 0) * (dev === 'offices' ? 1.6 : 1) };
  let t = rng() * (w.R + w.C + w.I + w.O);
  const kind = (t -= w.R) < 0 ? 'R' : (t -= w.C) < 0 ? 'C' : (t -= w.I) < 0 ? 'I' : 'O';
  if (kind === 'R') return pop > 2500 && rng() < 0.45 ? 2 : 1;
  if (kind === 'C') return pop > 1500 && rng() < 0.3 ? 6 : 3;
  return kind === 'I' ? 4 : 5;
}

export function aiBuild(w, sim, opts = {}) {
  const rng = mulberry32((w.seed * 31 + sim.day * 2654435761) >>> 0), st = sim.stats, done = [];
  const all = [...w.buildings.values()], homes = all.filter((b) => !b.svc && b.hh > 0), has = (k) => all.some((b) => b.svc === k && !b.abandoned);
  const inner = [...w.net.nodes.values()].filter((n) => !n.outside);
  const cx = inner.length ? inner.reduce((s, n) => s + n.x, 0) / inner.length : 150, cz = inner.length ? inner.reduce((s, n) => s + n.z, 0) / inner.length : 262;
  const away = (d) => { const a = rng() * Math.PI * 2; return [cx + Math.cos(a) * d, cz + Math.sin(a) * d]; };
  // the nearest shore; if no road reaches it yet, build one out there in steps
  // (away from the waterworks already there, so a pump and an outlet each get their own spot)
  const works = all.filter((b) => b.svc === 'pump' || b.svc === 'outlet');
  const shore = () => {
    let best = null, bd = Infinity;
    for (let z = 4; z < N - 4; z += 4) for (let x = 4; x < N - 4; x += 4) {
      const c = z * N + x; if (w.water[c] || w.wdist[c] <= 2 || w.wdist[c] >= 6 || works.some((b) => Math.hypot(b.cx - x, b.cz - z) < 22)) continue;
      const d = Math.hypot(x - cx, z - cz); if (d < bd) { bd = d; best = [x, z]; }
    }
    if (!best || bd > 260) return null;
    if (w.accEdge[w.cellAt(best[0], best[1])] >= 0) return best;
    const from = inner.reduce((b, q) => (!b || Math.hypot(q.x - best[0], q.z - best[1]) < Math.hypot(b.x - best[0], b.z - best[1]) ? q : b), null); if (!from) return null;
    let ax = from.x, az = from.z;
    for (let k = 0; k < 5; k++) {
      const d = Math.hypot(best[0] - ax, best[1] - az); if (d < 10) break;
      const step = Math.min(55, d), bx = ax + (best[0] - ax) * step / d, bz = az + (best[1] - az) * step / d;
      if (!tryRoad(w, sim, ax, az, bx, bz, 'street', 5000)) break;   // reaching water is essential
      ax = bx; az = bz; done.push('shore road');
    }
    return best;
  };
  // 1. utilities ahead of demand
  const [pS, pD] = st.power || [0, 0], [wS, wD] = st.water || [0, 0], [sS, sD] = st.sewage || [0, 0];
  if ((!has('coal') && !has('wind')) || pD > pS * 0.8) { for (let k = 0; k < 6; k++) if (tryService(w, sim, 'coal', ...away(70 + rng() * 60), 12)) { done.push('power'); break; } }
  if ((!has('pump') && !has('tower')) || wD > wS * 0.8) { const s = shore(); if ((s && tryService(w, sim, 'pump', s[0], s[1], 14)) || tryService(w, sim, 'tower', ...away(25), 30)) done.push('water'); }
  if (!has('outlet') || sD > sS * 0.8) { const s = shore(); if (s && tryService(w, sim, 'outlet', s[0], s[1], 32)) done.push('sewage'); }
  if (homes.length > 25 && !has('landfill')) { for (let k = 0; k < 4 && !tryService(w, sim, 'landfill', ...away(90 + rng() * 60), 16); k++); done.push('landfill'); }
  // 2. services where homes go without
  // services come as the town can afford them: fire first, then police, a school, a clinic
  const need = { fire: 25, police: 45, school: 60, clinic: 80 }, surplus = (st.incomeM || 0) - (st.expenseM || 0);
  for (const k of ['fire', 'police', 'school', 'clinic']) {
    if (homes.length < need[k] || (has(k) ? false : surplus < SERVICES[k].upkeep * 0.5 && homes.length < need[k] * 2)) continue;
    const sample = homes.filter((_, i) => i % Math.max(1, Math.floor(homes.length / 30)) === 0), lacking = sample.filter((b) => sim.bcov(k, b) < 0.1);
    if (lacking.length > sample.length * 0.3 && sim.money > SERVICES[k].cost * 2) {
      const x = lacking.reduce((s, b) => s + b.cx, 0) / lacking.length, z = lacking.reduce((s, b) => s + b.cz, 0) / lacking.length;
      if (tryService(w, sim, k, x, z, 36)) done.push(k);
    }
  }
  if (homes.length > 40 && rng() < 0.25) { const b = homes[Math.floor(rng() * homes.length)]; if (tryService(w, sim, 'parkS', b.cx, b.cz, 20)) done.push('park'); }
  // 3. streets and zoning when land runs short
  // only land zoned for something in demand counts as room to grow
  const wanted = (z) => { const k = { 1: 'R', 2: 'R', 3: 'C', 4: 'I', 5: 'O', 6: 'C' }[z]; return sim.demand[k] > 5; };
  let free = 0; for (let i = 0; i < w.zone.length; i += 3) if (w.zone[i] && w.free(i) && w.accEdge[i] >= 0 && wanted(w.zone[i])) free++;
  const want = free * 3 < 900 ? 1 + (sim.money > 40000 ? 2 : 0) : 0, grid = hash2(w.seed, 7, 3) * Math.PI / 2;
  for (let n = 0, tries = 0; n < want && tries < 24; tries++) {
    const cand = inner.filter((q) => q.edges.size < 4); if (!cand.length) break;
    cand.sort((p, q) => Math.hypot(p.x - cx, p.z - cz) - Math.hypot(q.x - cx, q.z - cz));
    const node = cand[Math.floor((rng() ** 1.6) * cand.length)];
    const used = [...node.edges].map((id) => { const e = w.net.edges.get(id), p = w.net.sampleAt(e, e.a === node.id ? Math.min(4, e.len) : Math.max(0, e.len - 4)); return Math.atan2(p.z - node.z, p.x - node.x); });
    const a = grid + Math.floor(rng() * 4) * Math.PI / 2 + (rng() - 0.5) * 0.25;
    if (used.some((u) => Math.abs(Math.atan2(Math.sin(u - a), Math.cos(u - a))) < 0.7)) continue;
    const len = 36 + rng() * 22, res = tryRoad(w, sim, node.x, node.z, node.x + Math.cos(a) * len, node.z + Math.sin(a) * len);
    if (!res) continue;
    n++; done.push('street');
    const zone = pickZone(sim, rng, opts.dev, Math.hypot(node.x - cx, node.z - cz) > 70);
    for (const id of res.edges) {
      const e = w.net.edges.get(id); if (!e) continue;
      for (let s = 4; s < e.len; s += 12) { const p = w.net.sampleAt(e, s); for (const sg of [-1, 1]) w.paintZone(p.x - p.tz * 9 * sg, p.z + p.tx * 9 * sg, 9, zone); }
    }
  }
  return done;
}
