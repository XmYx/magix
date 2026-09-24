// Organicity — disasters and events. Earthquakes, tornadoes and industrial accidents
// follow a seeded schedule (the same city gets the same fate); wrecked buildings turn
// to rubble, ambulances and fire engines respond, and the site is cleared and rebuilt
// a level lower. Landmarks host festivals that draw crowds, traffic and tourist money.
import { N, SERVICES, ZONES, MONTH_DAYS } from './config.js';
import { hash2, clamp } from './util.js';
import { fastestRoute } from './routes.js';

export const DISASTERS = {
  quake:    { name: 'Earthquake', rate: 1 / 1500 },
  tornado:  { name: 'Tornado', rate: 1 / 700 },
  accident: { name: 'Industrial accident', rate: 1 / 5000 },   // per industrial building a day
};
export const VENUES = { plaza: 'Street festival', museum: 'Night at the museum', stadium: 'Championship final', spire: 'Skyline light show', parkL: 'Summer concert' };

// disaster preparedness (0–150% funding) cuts damage by up to a third
const prepared = (sim) => 1 - 0.35 * Math.min(1, sim.preparedness || 0);
const roll = (sim, k) => hash2(sim.day, sim.w.seed % 99991, 700 + k);

// Send an ambulance from the nearest clinic that can reach the site.
function respond(sim, b) {
  let best = null;
  for (const c of sim.w.buildings.values()) {
    if (c.svc !== 'clinic' || c.abandoned || c.edge < 0 || b.edge < 0 || c.comp !== b.comp) continue;
    const r = fastestRoute(sim.w.net, { edge: c.edge, s: c.s }, [{ id: b.id, edge: b.edge, s: b.s }]);
    if (r && (!best || r.seconds < best.seconds)) best = r;
  }
  if (best) (sim.dispatches ||= []).push({ kind: 'ambulance', target: b.id, segs: best.segments, t: performance.now() });
  return !!best;
}

export function wreck(sim, b, days = 30) {
  if (!b || b.svc || b.rubble || b.platformId) return false;
  b.rubble = days; b.occ = 0; b.workers = 0; b.fire = 0; sim.claim?.(b);
  for (const d of [...sim.w.buildings.values()]) if (d.platformId && sim.w.platforms.get(d.platformId)?.host === b.id) sim.w.removeBuilding(d.id);   // decks fall with their host
  sim.w.touchBuilding(b);
  return true;
}

function damageRoads(sim, x, z, r, f) {
  for (const e of sim.w.net.edges.values()) {
    const p = sim.w.net.sampleAt(e, e.len / 2);
    if (Math.hypot(p.x - x, p.z - z) < r) e.cond = Math.max(0.2, (e.cond ?? 1) * f);
  }
}

export function quake(sim, x, z, mag = 6) {
  const R = 40 + (mag - 5) * 55; let n = 0;
  for (const b of [...sim.w.buildings.values()]) {
    const d = Math.hypot(b.cx - x, b.cz - z); if (d > R || b.svc) continue;
    const age = clamp((sim.day - (b.built ?? 0)) / 3000, 0, 1), p = (1 - d / R) * (0.25 + 0.08 * b.level + 0.25 * age) * (mag - 4.5) / 2 * prepared(sim);
    if (hash2(b.id, sim.day, 711) < p && wreck(sim, b, 25 + Math.round(hash2(b.id, sim.day, 712) * 25))) { n++; if (n <= 6) respond(sim, b); }
  }
  damageRoads(sim, x, z, R, 0.55);
  sim.quake = { x, z, r: R, mag, t: performance.now() }; sim.shock = Math.max(sim.shock || 0, 45);
  sim.msg(`Earthquake! Magnitude ${mag.toFixed(1)} near ${sim.streetName(sim.w.net.nearestEdge(x, z, 80)?.e.id)}: ${n} buildings collapsed. Clinics, fire stations and depots speed recovery.`, 'bad', 'quake');
  return n;
}

export function tornado(sim, x, z, heading = hash2(sim.day, 3, 713) * Math.PI * 2) {
  const len = 140 + hash2(sim.day, 4, 713) * 120, W = 9, dx = Math.cos(heading), dz = Math.sin(heading);
  const x0 = x - dx * len / 2, z0 = z - dz * len / 2, x1 = x + dx * len / 2, z1 = z + dz * len / 2;
  let n = 0;
  for (const b of [...sim.w.buildings.values()]) {
    if (b.svc) continue;
    const t = clamp(((b.cx - x0) * dx + (b.cz - z0) * dz) / len, 0, 1), d = Math.hypot(b.cx - x0 - dx * len * t, b.cz - z0 - dz * len * t);
    if (d < W + Math.sqrt(b.area || 0) / 2 && hash2(b.id, sim.day, 714) < 0.8 * prepared(sim) && wreck(sim, b, 20 + Math.round(hash2(b.id, 1, 715) * 20))) { n++; if (n <= 6) respond(sim, b); }
  }
  for (let s = 0; s < len; s += 1) for (let o = -W; o <= W; o++) {
    const cx = Math.floor(x0 + dx * s - dz * o), cz = Math.floor(z0 + dz * s + dx * o);
    if (cx >= 0 && cz >= 0 && cx < N && cz < N) sim.w.tree[cz * N + cx] = 0;
  }
  sim.w.dirty.trees = true;
  damageRoads(sim, x, z, len / 2, 0.8);
  sim.tornado = { x0, z0, x1, z1, t: performance.now() }; sim.shock = Math.max(sim.shock || 0, 30);
  sim.msg(`A tornado tore through the city, wrecking ${n} buildings.`, 'bad', 'tornado');
  return n;
}

export function accident(sim, b) {
  if (!b) return false;
  b.spill = 25; sim.igniteBuilding(b);
  sim.msg(`Industrial accident at a plant near ${sim.streetName(b.edge)}: fire and a chemical spill. Pollution will linger for weeks.`, 'bad', 'accident');
  return true;
}

export function festival(sim, venue) {
  if (!venue) return false;
  const name = VENUES[venue.svc] || 'Festival';
  sim.event = { venue: venue.id, name, until: sim.day + 3 };
  sim.msg(`${name} at the ${SERVICES[venue.svc].name.toLowerCase()} this weekend: crowds, traffic and tourist spending.`, 'good', 'festival');
  return true;
}

// Daily: recovery first, then the seeded schedule (never in the first years of a small town).
export function disasterTick(sim) {
  const w = sim.w, sb = sim.sandbox;
  for (const b of w.buildings.values()) {
    if (b.spill > 0) b.spill--;
    if (!(b.rubble > 0)) continue;
    const speed = 1 + (sim.bcov('fire', b) > 0.1 ? 1 : 0) + (sim.bcov('depot', b) > 0.05 ? 1 : 0) + ((sim.preparedness || 0) >= 0.75 ? 1 : 0) + (sb?.instant ? 10 : 0);
    b.rubble = Math.max(0, b.rubble - speed);
    if (!b.rubble) { b.level = Math.max(1, b.level - 1); b.constructionUntil = sim.day + (sb?.instant ? 0 : 8); b.built = sim.day; w.touchBuilding(b); }
  }
  if (sim.shock > 0) sim.shock--;
  if (sim.event && sim.day > sim.event.until) sim.event = null;
  if (sb?.noDisasters || sim.stats.pop < 400) return;
  const blds = [...w.buildings.values()], homes = blds.filter((b) => !b.svc);
  const at = (k) => homes[Math.floor(roll(sim, k) * homes.length)];
  if (homes.length && roll(sim, 1) < DISASTERS.quake.rate) { const b = at(11); quake(sim, b.cx, b.cz, 5.2 + roll(sim, 12) * 2); }
  const season = sim.weather.season, stormy = sim.weather.type === 'storm' ? 4 : 1;
  if (homes.length && (season === 'Spring' || season === 'Summer') && roll(sim, 2) < DISASTERS.tornado.rate * stormy) { const b = at(21); tornado(sim, b.cx, b.cz); }
  const plants = blds.filter((b) => !b.svc && ZONES[b.zone].kind === 'I' && !b.rubble && !b.fire);
  const green = (b) => (w.policyAt(b)?.green ? 0.5 : 1);
  if (plants.length && roll(sim, 3) < DISASTERS.accident.rate * plants.reduce((s, b) => s + b.level * green(b), 0)) accident(sim, plants[Math.floor(roll(sim, 31) * plants.length)]);
  if (!sim.event && sim.day % MONTH_DAYS === 15) {
    const venues = blds.filter((b) => VENUES[b.svc] && !b.abandoned);
    if (venues.length && roll(sim, 4) < 0.45) festival(sim, venues[Math.floor(roll(sim, 41) * venues.length)]);
  }
}
