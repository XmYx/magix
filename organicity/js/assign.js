// Organicity — deterministic traffic assignment.
// Trips are aggregated between clusters of buildings (CLUSTER × CLUSTER units),
// distributed with a gravity model on current travel times, and loaded onto the
// network in increments; after each increment directional flows update link and
// junction costs (BPR-style), so later trips avoid what earlier ones congested.
// Bus lines take a share of trips whose ends both sit near stops of the same line.
// A weighted sample of the assigned routes is returned for the visible vehicles.
import { ROADS, JUNCTIONS } from './config.js';
import { transitMode, trackLength } from './transit.js';
import { RoadNet } from './roads.js';

// Rebuild a road network from core.js netSnapshot() data (used by both workers).
export function netFromSnapshot(snap) {
  const net = new RoadNet();
  for (const [id, x, z, o, ctl] of snap.nodes) net.addNode(x, z, !!o, id).control = ctl || 'auto';
  for (const [id, a, b, cx, cz, type, cond, ow, flow, layer, lane, fab, fba, heights, hazardSpeed, speedF] of snap.edges) {
    const e = net.addEdge(net.nodes.get(a), net.nodes.get(b), { x: cx, z: cz }, type, cond, id);
    e.heights=heights; e.snapshotSpeed=speedF; e.hazardSpeed=hazardSpeed ?? 1; e.oneway = ow; e.layer = layer || 0; e.busLane = !!lane;
    e.fAB = fab ?? flow / 2; e.fBA = fba ?? flow / 2;
  }
  updateCosts(net);
  for(const e of net.edges.values())if(e.snapshotSpeed!=null){e.speedF=e.snapshotSpeed;e.cost=e.len/(ROADS[e.type].speed*e.speedF);}
  return net;
}

export const CLUSTER = 40;
export const STOP_WALK = 45;          // walking catchment of a bus stop (units)
const INCREMENTS = [0.4, 0.35, 0.25];
const SAMPLE_TARGET = 260;

// car capacity per direction of travel
export function dirCapacity(e) {
  return ROADS[e.type].capacity * (e.oneway ? 1 : 0.5) * (e.busLane ? 0.75 : 1);
}

// seconds added when entering a junction, from its control and through-traffic
export function junctionDelay(n, through) {
  if (n.edges.size < 3 && (n.control || 'auto') === 'auto') return 0;
  const J = JUNCTIONS[n.control] || JUNCTIONS.auto, x = through / J.capacity;
  return Math.min(40, J.delay + 12 * x * x * x * x);
}

// Refresh link costs and junction delays from directional flows (fAB / fBA).
export function updateCosts(net, weatherSpeed = 1) {
  for (const e of net.edges.values()) {
    e.flow = (e.fAB || 0) + (e.fBA || 0);
    e.cong = Math.max(e.fAB || 0, e.fBA || 0) / dirCapacity(e);
    e.speedF = Math.max(0.2, 1 / (1 + 0.8 * Math.pow(e.cong, 4))) * (0.65 + 0.35 * (e.cond ?? 1)) * weatherSpeed * (e.hazardSpeed ?? 1);
    e.cost = e.len / (ROADS[e.type].speed * e.speedF);
  }
  for (const n of net.nodes.values()) {
    let through = 0;
    for (const id of n.edges) { const e = net.edges.get(id); if (e) through += e.a === n.id ? e.fBA || 0 : e.fAB || 0; }
    n.through = through; n.delay = junctionDelay(n, through);
  }
}

// Follow predecessor edges from a point back to the search source, adding
// directional flow; optionally returns the route as {edge, from, to} segments.
function walk(net, res, origin, dest, amount, fAB, fBA, record) {
  const e = net.edges.get(dest.edge); if (!e) return null;
  const g = res.g, ia = g.idx.get(e.a), ib = g.idx.get(e.b), ow = e.oneway || 0;
  if (ia === undefined || ib === undefined) return null;
  const f = e.cost / e.len;
  const ca = ow >= 0 ? res.dist[ia] + dest.s * f : Infinity, cb = ow <= 0 ? res.dist[ib] + (e.len - dest.s) * f : Infinity;
  if (!isFinite(Math.min(ca, cb))) return null;
  const add = (m, id, v) => m.set(id, (m.get(id) || 0) + v);
  const viaA = ca <= cb;
  add(viaA ? fAB : fBA, e.id, amount);
  const segs = record ? [{ edge: e.id, from: viaA ? 0 : e.len, to: dest.s }] : null;
  let k = viaA ? ia : ib;
  for (let guard = 0; guard < 4000 && res.prev[k] >= 0; guard++) {
    const eid = res.prev[k], pe = net.edges.get(eid), nodeId = g.ids[k], forward = pe.b === nodeId;
    add(forward ? fAB : fBA, eid, amount);
    if (segs) segs.push({ edge: eid, from: forward ? 0 : pe.len, to: forward ? pe.len : 0 });
    k = g.idx.get(forward ? pe.a : pe.b);
  }
  // first leg: from the origin's arc position to the source node the search used
  if (origin && origin.edge >= 0) {
    const oe = net.edges.get(origin.edge), src = g.ids[k];
    if (oe && (src === oe.a || src === oe.b)) {
      add(src === oe.a ? fBA : fAB, oe.id, amount);
      if (segs) segs.push({ edge: oe.id, from: origin.s, to: src === oe.a ? 0 : oe.len });
    }
  }
  return segs ? segs.reverse().filter((s) => Math.abs(s.to - s.from) > 1e-3) : true;
}

function clusters(net, blds) {
  const map = new Map();
  for (const b of blds) {
    if (b.svc || b.ab || b.construction || b.edge < 0 || !net.edges.has(b.edge)) continue;
    const key = `${Math.floor(b.cx / CLUSTER)},${Math.floor(b.cz / CLUSTER)}`;
    let c = map.get(key);
    if (!c) map.set(key, (c = { key, prod: 0, jobs: 0, shops: 0, ind: 0, anchor: null, best: -1, sky: 0, carFree: 0, x: 0, z: 0, n: 0 }));
    c.prod += b.occ || 0; c.jobs += b.workers || 0;
    if (b.kind === 'C' || b.kind === 'M') c.shops += (b.workers || 0) + 1;
    if (b.kind === 'I') c.ind += (b.workers || 0) + 1;
    if (b.sky) c.sky += b.occ || 0;
    if (b.carFree) c.carFree++;
    c.x += b.cx; c.z += b.cz; c.n++;
    const wgt = (b.occ || 0) + (b.workers || 0) + 0.1;
    if (wgt > c.best) { c.best = wgt; c.anchor = b; }
  }
  for (const c of map.values()) { c.x /= c.n; c.z /= c.n; c.carFree /= c.n; }
  return [...map.values()];
}

// lines: [{ id, stops: [{ edge, s, x, z }], busLaneShare }]
function lineServing(lines, a, b, boost = 1, carTime = 30) {
  let best = null;
  for (const l of lines) {
    const mode=transitMode(l); let ia = -1, ib = -1;
    l.stops.forEach((st, i) => {
      if (ia < 0 && Math.hypot(st.x - a.x, st.z - a.z) <= mode.walk) ia = i;
      if (Math.hypot(st.x - b.x, st.z - b.z) <= mode.walk) ib = i;
    });
    if (ia >= 0 && ib >= 0 && ia !== ib) {
      let ride=0;for(let i=ia;i!==ib;i=(i+1)%l.stops.length){const p=l.stops[i],q=l.stops[(i+1)%l.stops.length];ride+=l.legs?.[i] ?? Math.hypot(p.x-q.x,p.z-q.z);}
      const walk=(Math.hypot(l.stops[ia].x-a.x,l.stops[ia].z-a.z)+Math.hypot(l.stops[ib].x-b.x,l.stops[ib].z-b.z))/1.4;
      const time=walk+6+ride/(mode.speed*(l.speedF||1));
      const share=Math.min(.8,Math.max(.08,carTime/(carTime+time))*(.75+.15*(l.busLaneShare||0))*boost);
      if(!best||time<best.time)best={line:l,share,time};
    }
  }
  return best;
}

// nearest sky hub within walking reach of a point
const HUB_WALK = 150;
function nearHub(hubs, p) {
  let best = null, bd = HUB_WALK;
  for (const h of hubs) { const d = Math.hypot(h.x - p.x, h.z - p.z); if (d < bd) { bd = d; best = h; } }
  return best;
}

// opts: { total, commuters, weatherSpeed, skyShare, hubs: [{ id, x, z, cap }], lines, transitBoost, rng }
export function* assignTraffic(net, blds, opts) {
  const fAB = new Map(), fBA = new Map(), riders = new Map(), samples = [], airOD = new Map(), hubLoad = new Map();
  const out = { fAB, fBA, riders, samples, airOD, hubLoad, car: 0, transit: 0, bus: 0, tram: 0, rail: 0, metro: 0, air: 0, walk: 0, unserved: 0 };
  const hubs = opts.hubs || [];
  const cl = clusters(net, blds);
  const origins = cl.filter((c) => c.prod > 0), jobs = cl.filter((c) => c.jobs > 0.5), shops = cl.filter((c) => c.shops > 0), ind = cl.filter((c) => c.ind > 0);
  const P = origins.reduce((s, c) => s + c.prod, 0), I = ind.reduce((s, c) => s + c.ind, 0);
  const total = opts.total || 0; if (!total || !net.edges.size) return out;
  const commute = total * 0.62, shopping = total * 0.24, freight = total * 0.14;
  const outside = [...net.nodes.values()].filter((n) => n.outside && n.edges.size);
  const lines = opts.lines || [], rng = opts.rng || Math.random, ws = opts.weatherSpeed || 1;
  for (const e of net.edges.values()) { e.fAB = 0; e.fBA = 0; }
  const sampleK = SAMPLE_TARGET / Math.max(1, total * INCREMENTS[INCREMENTS.length - 1]);
  const apply = () => { for (const e of net.edges.values()) { e.fAB = fAB.get(e.id) || 0; e.fBA = fBA.get(e.id) || 0; } updateCosts(net, ws); };
  for (let inc = 0; inc < INCREMENTS.length; inc++) {
    const share = INCREMENTS[inc], last = inc === INCREMENTS.length - 1, incLoad = new Map();
    // air trips fly hub to hub while both hubs have capacity left this increment; the rest drive
    const fly = (o, d, amount) => {
      const ha = nearHub(hubs, o), hb = ha && nearHub(hubs, d);
      if (!hb || ha === hb) return 0;
      const room = (h) => h.cap * share - (incLoad.get(h.id) || 0);
      const f = Math.max(0, Math.min(amount, room(ha), room(hb))); if (!f) return 0;
      for (const h of [ha, hb]) { incLoad.set(h.id, (incLoad.get(h.id) || 0) + f); hubLoad.set(h.id, (hubLoad.get(h.id) || 0) + f); }
      const k = ha.id < hb.id ? `${ha.id}-${hb.id}` : `${hb.id}-${ha.id}`; airOD.set(k, (airOD.get(k) || 0) + f); out.air += f;
      return f;
    };
    const load = (res, o, d, amount, kind) => {
      if (!(amount > 1e-4)) return;
      const rec = last && rng() < amount * sampleK;
      const segs = walk(net, res, o && o.anchor, d.anchor || d, amount, fAB, fBA, rec);
      if (segs) { out.car += amount; if (rec && segs.length) samples.push({ segs, kind }); }
    };
    for (const o of origins) {
      const oe = net.edges.get(o.anchor.edge);
      const res = net.dijkstra(net.sourcesAt(oe, o.anchor.s), 'time', Infinity, true);
      const sky = o.prod ? 1 - (opts.skyShare || 0) * (o.sky / o.prod) : 1;
      for (const [dests, weightOf, decay, budget] of [[jobs, (c) => c.jobs, 90, commute], [shops, (c) => c.shops, 45, shopping]]) {
        const amounts = []; let norm = 0;
        for (const d of dests) {
          if (d === o && dests.length > 1) continue;
          let t = net.costTo(res, net.edges.get(d.anchor.edge), d.anchor.s);
          if (!isFinite(t)) {const alternative=lineServing(lines,o,d,opts.transitBoost||1,60);if(!alternative)continue;t=alternative.time;}
          const wgt = weightOf(d) * Math.exp(-t / decay); amounts.push([d, wgt]); norm += wgt;
        }
        if (!norm) continue;
        const trips = budget * share * (o.prod / P);
        for (const [d, wgt] of amounts) {
          let amount = trips * wgt / norm;
          // car-free centres: a third of the trips touching them walk or cycle instead
          const cf = 0.35 * Math.max(o.carFree, d.carFree || 0); if (cf) { out.walk += amount * cf; amount -= amount * cf; }
          const carTime=net.costTo(res,net.edges.get(d.anchor.edge),d.anchor.s);
          const bus = lines.length && lineServing(lines.filter(l=>(riders.get(l.id)||0)<transitMode(l).capacity), o, d, opts.transitBoost || 1, isFinite(carTime)?carTime:60);
          if (bus) { const moved = Math.min(amount * (isFinite(carTime)?bus.share:1),Math.max(0,transitMode(bus.line).capacity-(riders.get(bus.line.id)||0))); amount -= moved; out.transit += moved; out[bus.line.mode || 'bus'] += moved; riders.set(bus.line.id, (riders.get(bus.line.id) || 0) + moved); }
          const air = amount * (1 - sky), flown = air > 1e-4 ? fly(o, d, air) : 0;
          if(isFinite(carTime))load(res, o, d, amount - flown, 'car');else out.unserved+=amount-flown;
        }
      }
      yield;
    }
    // freight: industry → the highway and → shops
    for (const o of ind) {
      const oe = net.edges.get(o.anchor.edge);
      const res = net.dijkstra(net.sourcesAt(oe, o.anchor.s), 'time', Infinity, true);
      const trips = freight * share * (o.ind / Math.max(1, I));
      let bestNode = null, bt = Infinity;
      for (const n of outside) { const t = res.dist[res.g.idx.get(n.id)]; if (t < bt) { bt = t; bestNode = n; } }
      if (bestNode) {
        const e = net.edges.get([...bestNode.edges][0]);
        load(res, o, { edge: e.id, s: e.a === bestNode.id ? 0 : e.len }, trips * 0.6, 'truck');
      }
      let norm = 0; const am = [];
      for (const d of shops) { const t = net.costTo(res, net.edges.get(d.anchor.edge), d.anchor.s); if (!isFinite(t)) continue; const wgt = d.shops * Math.exp(-t / 70); am.push([d, wgt]); norm += wgt; }
      for (const [d, wgt] of am) load(res, o, d, trips * (bestNode ? 0.4 : 1) * wgt / norm, 'truck');
      yield;
    }
    // inbound commuters enter at the highway
    if (outside.length && opts.commuters > 1 && jobs.length) {
      const res = net.dijkstra(outside.map((n) => [n.id, 0]), 'time', Infinity, true);
      const trips = opts.commuters * 0.9 * 0.4 * share, J = jobs.reduce((s, c) => s + c.jobs, 0);
      for (const d of jobs) load(res, null, d, trips * d.jobs / J, 'car');
    }
    apply();
    yield;
  }
  return out;
}

// Route each bus line stop → stop and back to the first stop, for buses and line length.
export function routeLines(net, lines) {
  const out = [];
  for (const l of lines) {
    if(l.mode==='rail'||l.mode==='metro') {
      const ok=l.stops.length>=2, track=ok?[...l.stops,l.stops[0]]:[];
      out.push({id:l.id,mode:l.mode,ok,track,segs:[],len:trackLength(l.stops),busLaneShare:0});continue;
    }
    const segs = [], legs=[]; let len = 0, ok = l.stops.length >= 2;
    for (let i = 0; ok && i < l.stops.length; i++) {
      const a = l.stops[i], b = l.stops[(i + 1) % l.stops.length];
      const ae = net.edges.get(a.edge), be = net.edges.get(b.edge);
      if (!ae || !be) { ok = false; break; }
      let leg;
      if (ae.id === be.id && (!ae.oneway || Math.sign(b.s - a.s) === ae.oneway)) leg = [{ edge: ae.id, from: a.s, to: b.s }];
      else leg = walk(net, net.dijkstra(net.sourcesAt(ae, a.s), 'time', Infinity, true), a, b, 0, new Map(), new Map(), true);
      if (!leg) { ok = false; break; }
      legs.push(leg.reduce((n,s)=>n+Math.abs(s.to-s.from),0));
      for (const s of leg) { segs.push(s); len += Math.abs(s.to - s.from); }
    }
    let lane = 0; for (const s of segs) if (net.edges.get(s.edge)?.busLane) lane += Math.abs(s.to - s.from);
    out.push({ id: l.id, mode:l.mode || 'bus', legs, ok, segs: ok ? segs : [], len, busLaneShare: len ? lane / len : 0 });
  }
  return out;
}
