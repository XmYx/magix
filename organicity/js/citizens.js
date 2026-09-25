// Sampled residents share assignment routes, destinations and schedules across every view.
import { SERVICES, ROADS } from './config.js';
import { fastestRoute } from './routes.js';
import { hash2, clamp } from './util.js';
export function assignResidents(net, buildings, residents, parking = 1) {
  const byId = new Map(buildings.map(b => [b.id, b])), seats = new Map(), trips = [];
  const usable = b => !b.ab && !b.construction && b.edge >= 0;
  for (const c of residents || []) {
    const home = byId.get(c.home); if (!home || !usable(home)) continue;
    const role = c.cohort === 'child' ? 'school' : c.cohort === 'student' ? 'college' : c.cohort === 'retiree' ? 'leisure' : 'work';
    const candidates = buildings.filter(b => b.id !== home.id && usable(b) && (role === 'school' ? b.svc === 'school' || SERVICES[b.svc]?.covers === 'school' : role === 'college' ? ['college', 'university'].includes(b.svc) : role === 'leisure' ? SERVICES[b.svc]?.park : !b.svc && b.workers > 0));
    const targets = candidates.filter(b => !SERVICES[b.svc]?.seats || (seats.get(b.id) || 0) < SERVICES[b.svc].seats);
    const route = fastestRoute(net, { edge: home.edge, s: home.s }, targets.map(b => ({ id: b.id, edge: b.edge, s: b.s })));
    if (!route?.segments.length) { trips.push({ ...c, role, destination: null, segments: [], returning: [], minutes: 0, mode: 'walk' }); continue; }
    const dest = byId.get(route.destination); if (!dest) continue;
    seats.set(dest.id, (seats.get(dest.id) || 0) + 1);
    const back = fastestRoute(net, { edge: dest.edge, s: dest.s }, [{ id: home.id, edge: home.edge, s: home.s }]);
    const walkable = route.segments.every(g => { const e = net.edges.get(g.edge); return e && !ROADS[e.type].noAccess && e.type !== 'highway'; });
    const distance = route.segments.reduce((n, g) => n + Math.abs(g.to-g.from), 0);
    const mode = walkable && (role !== 'work' || home.carFree || distance < 90 || hash2(home.id, c.k, 61) > parking) ? 'walk' : 'car';
    trips.push({ ...c, role, destination: dest.id, segments: route.segments, returning: back?.segments || [], minutes: Math.max(5, Math.min(90, mode === 'walk' ? distance / 4 : route.seconds / 4)), mode, depart: role === 'school' ? 7.5 : role === 'college' ? 8.5 : role === 'leisure' ? 10 : c.depart, back: role === 'school' ? 15 : role === 'college' ? 16 : role === 'leisure' ? 12 : c.back });
  }
  return trips;
}
export function residentLeg(c, hour) {
  if (c?.destination == null) return { state: 'home', segments: [], progress: 0 };
  const duration = c.minutes / 60;
  if (hour >= c.depart && hour < c.depart + duration) return { state: 'commute', segments: c.segments, progress: (hour-c.depart)/duration };
  if (hour >= c.depart+duration && hour < c.back) return { state: 'work', segments: [], progress: 1 };
  if (hour >= c.back && hour < c.back+duration && c.returning.length) return { state: 'return', segments: c.returning, progress: (hour-c.back)/duration };
  return { state: 'home', segments: [], progress: 0 };
}
export function routePosition(net, segments, progress) {
  let left = segments.reduce((n,g) => n+Math.abs(g.to-g.from),0) * clamp(progress,0,1);
  for (let i=0;i<segments.length;i++) { const g=segments[i], len=Math.abs(g.to-g.from), e=net.edges.get(g.edge); if (!e) return null; if(left<=len || i===segments.length-1) { const s=g.from+Math.sign(g.to-g.from)*Math.min(left,len); return { ...net.sampleAt(e,s), edge:e, s, dir:Math.sign(g.to-g.from) }; } left-=len; }
  return null;
}
export function approvalOf(sim) {
  const homes = [...sim.w.buildings.values()].filter(b => !b.svc && b.occ > 0 && !b.abandoned);
  let weight=0, total=0;
  for (const b of homes) { const n=b.occ; weight+=n; total+=n*clamp((b.happy ?? 0.6)*0.65 + (b.health ?? 0.5)*0.1 + (b.power && b.water && b.sewage ? 0.15 : 0) + (1-(sim.stats.unemp || 0))*0.1 - Math.max(0,(b.tJob || 0)-40)/600 - (sim.toll || 0)/200,0,1); }
  return weight ? total/weight : 0.6;
}
export function holdElection(sim, year) {
  if (sim.election?.year >= year) return sim.election;
  const approval = approvalOf(sim), won = approval >= 0.5;
  sim.approval = approval; sim.election = { year, approval, won };
  sim.headline(`Election ${year}: ${Math.round(approval*100)}% approval — ${won ? 'you are re-elected' : 'residents vote you out'}.`, won ? 'good' : 'bad');
  if (!won && sim.scenario && sim.scenario !== 'tutorial' && !sim.scenarioWon && !sim.sandbox) { sim.gameOver = true; sim.gameOverReason = 'election'; sim.paused = true; }
  return sim.election;
}
