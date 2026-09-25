// Shared infrastructure geometry and simulation rules (also used by headless tiles).
import { ULINES, SERVICES } from './config.js';
import { RoadNet } from './roads.js';
import { fastestRoute } from './routes.js';
export const BRIDGE_STYLES = {
  auto: { name: 'Automatic', span: 512, mult: 3 },
  beam: { name: 'Beam', span: 60, mult: 2.5 },
  arch: { name: 'Arch', span: 140, mult: 3.5 },
  suspension: { name: 'Suspension', span: 400, mult: 5 },
  movable: { name: 'Lift bridge', span: 90, mult: 4.5 },
};
export const LINE_TIERS = {
  power: [{ name: 'Distribution', cap: 80, cost: 1 }, { name: 'High voltage', cap: 480, cost: 2.5 }],
  water: [{ name: 'Local pipe', cap: 160, cost: 1 }, { name: 'Trunk main', cap: 640, cost: 2.2 }],
  sewer: [{ name: 'Local drain', cap: 160, cost: 1 }, { name: 'Interceptor', cap: 640, cost: 2.2 }],
};
export const lineTier = l => LINE_TIERS[l.kind][l.tier === 1 ? 1 : 0];
export const linePoints = l => l.points?.length > 1 ? l.points : [l.a, l.b];
export const lineLength = l => linePoints(l).slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - linePoints(l)[i][0], p[1] - linePoints(l)[i][1]), 0);
export function lineSegments(l) { const p = linePoints(l); return p.slice(1).map((b, i) => ({ ...l, points: null, a: p[i], b })); }
export function utilityPath(net, a, b, mode = 'straight', control = null) {
  if (mode === 'road') {
    // Pipes follow physical streets, independently of one-way driving restrictions.
    if (net._utilityRouteNet?.version !== net.version) {
      const copy = new RoadNet(); for (const n of net.nodes.values()) copy.addNode(n.x,n.z,false,n.id);
      for (const e of net.edges.values()) { const road=copy.addEdge(copy.nodes.get(e.a),copy.nodes.get(e.b),e.c,e.type,e.cond,e.id);road.oneway=0;road.cost=road.len; }
      net._utilityRouteNet={version:net.version,net:copy};
    }
    net=net._utilityRouteNet.net;
    const x = net.nearestEdge(a.x, a.z, 12), y = net.nearestEdge(b.x, b.z, 12);
    if (!x || !y) return null;
    const r = fastestRoute(net, { edge: x.e.id, s: x.s }, [{ id: 0, edge: y.e.id, s: y.s }]);
    if (!r) return null;
    const pts = [[a.x, a.z]];
    for (const g of r.segments) { const e = net.edges.get(g.edge), n = Math.max(1, Math.ceil(Math.abs(g.to - g.from) / 4)); for (let i = 0; i <= n; i++) { const p = net.sampleAt(e, g.from + (g.to - g.from) * i / n); pts.push([p.x, p.z]); } }
    pts.push([b.x, b.z]); return pts;
  }
  if (mode !== 'curve' || !control) return [[a.x, a.z], [b.x, b.z]];
  const n = Math.max(4, Math.ceil((Math.hypot(a.x - control.x, a.z - control.z) + Math.hypot(b.x - control.x, b.z - control.z)) / 3));
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u*u*a.x + 2*u*t*control.x + t*t*b.x, u*u*a.z + 2*u*t*control.z + t*t*b.z]; });
}
export function parkingState(buildings) {
  let demand = 0, spaces = 0;
  for (const b of buildings) if (!b.abandoned && !b.construction) { demand += (b.occ || 0) * 0.65 + (b.workers || 0) * 0.3; spaces += SERVICES[b.svc]?.parking || 0; }
  // Kerbside provision covers half the demand; dedicated lots support additional driving.
  const supply = demand * 0.5 + spaces;
  return { demand, spaces: supply, lots: spaces, ratio: demand ? Math.min(1, supply / demand) : 1 };
}
export function maintenanceTick(sim, dt) {
  const w = sim.w, net = w.net; sim.maintenance ||= [];
  sim.maintenance = sim.maintenance.filter(v => net.edges.has(v.segs[v.i]?.edge) && w.buildings.has(v.depot));
  const clock=sim.day+(sim.acc || 0), dispatch=clock >= (sim.nextMaintenanceDispatch ?? 0);
  if(dispatch)sim.nextMaintenanceDispatch=clock+0.5;
  for (const depot of dispatch ? w.buildings.values() : []) {
    if (depot.svc !== 'depot' || depot.abandoned || depot.constructionUntil > sim.day || depot.edge < 0 || sim.maintenance.some(v => v.depot === depot.id)) continue;
    const targets = [...net.edges.values()].filter(e => e.cond < 0.95).sort((a,b) => a.cond-b.cond).slice(0, 20);
    for (const e of targets) {
      const r = fastestRoute(net, { edge: depot.edge, s: depot.s }, [{ id: e.id, edge: e.id, s: e.len }]);
      if (!r?.segments.length) continue;
      sim.maintenance.push({ depot: depot.id, segs: r.segments, i: 0, s: r.segments[0].from }); break;
    }
  }
  for (const v of sim.maintenance) {
    let distance = dt * 80 * sim.budgetFor('depot');
    while (distance > 0 && v.i < v.segs.length) {
      const g = v.segs[v.i], e = net.edges.get(g.edge); if (!e) { v.i = v.segs.length; break; }
      const moved = Math.min(distance, Math.abs(g.to-v.s));
      e.cond = Math.min(1, e.cond + moved / Math.max(1, e.len) * 0.3);
      v.s += Math.sign(g.to-g.from) * moved; distance -= moved;
      if (Math.abs(v.s-g.to) < 0.001) { v.i++; if (v.i < v.segs.length) v.s = v.segs[v.i].from; } else break;
    }
  }
  sim.maintenance = sim.maintenance.filter(v => v.i < v.segs.length);
}
export function bridgeOpen(e, hour) { return e.bridgeStyle === 'movable' && (hour % 6) >= 2 && (hour % 6) < 2.5; }
