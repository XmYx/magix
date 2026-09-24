// Organicity — heavy, read-only simulation systems: service coverage, land value
// & nuisance fields, and traffic assignment. They work on plain snapshots
// (road network + packed buildings) so the same code runs inside a Web Worker,
// on the main thread as a fallback, or headless in Node tests.
import { FC, FN, SERVICES, ROADS } from './config.js';
import { commuteRoutes } from './routes.js';
import { assignTraffic, routeLines, updateCosts, dirCapacity, netFromSnapshot } from './assign.js';
import { RoadNet } from './roads.js';
import { clamp, mulberry32 } from './util.js';

export const F2 = FN * FN;
export const HH = 2.6;               // people per household
export const COVER = ['fire', 'police', 'clinic', 'school', 'college', 'university', 'landfill', 'depot', 'busstop', 'tramstop', 'railstation', 'metrostation'];
const PRIO = [null, ['fire', 'police'], ['clinic'], ['school']]; // district priority codes 1..3

export function sampleField(arr, x, z) {
  const gx = clamp(x / FC - 0.5, 0, FN - 1.001), gz = clamp(z / FC - 0.5, 0, FN - 1.001);
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz, k = iz * FN + ix;
  return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fz) + (arr[k + FN] * (1 - fx) + arr[k + FN + 1] * fx) * fz;
}

export function splat(arr, x, z, r, v) {
  const g0x = Math.max(0, Math.floor((x - r) / FC)), g1x = Math.min(FN - 1, Math.floor((x + r) / FC));
  const g0z = Math.max(0, Math.floor((z - r) / FC)), g1z = Math.min(FN - 1, Math.floor((z + r) / FC));
  for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) {
    const d = Math.hypot(gx * FC + FC / 2 - x, gz * FC + FC / 2 - z); if (d > r) continue;
    arr[gz * FN + gx] += v * (1 - d / r);
  }
}

function blur(arr) {
  const out = new Float32Array(F2);
  for (let gz = 0; gz < FN; gz++) for (let gx = 0; gx < FN; gx++) {
    let s = 0, n = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx, z = gz + dz; if (x < 0 || z < 0 || x >= FN || z >= FN) continue;
      const wgt = dx || dz ? 1 : 2; s += arr[z * FN + x] * wgt; n += wgt;
    }
    out[gz * FN + gx] = s / n;
  }
  return out;
}

export function netSnapshot(net) {
  return {
    nodes: [...net.nodes.values()].map((n) => [n.id, n.x, n.z, n.outside ? 1 : 0, n.control || 'auto']),
    edges: [...net.edges.values()].map((e) => [e.id, e.a, e.b, e.c.x, e.c.z, e.type, e.cond, e.oneway || 0, e.flow || 0, e.layer || 0, e.busLane ? 1 : 0, e.fAB || 0, e.fBA || 0, e.heights || null, e.hazardSpeed ?? 1, e.speedF ?? 1]),
  };
}

export class Core {
  constructor(seed = 1) {
    const z = () => new Float32Array(F2);
    this.rng = mulberry32(seed + 7);
    this.net = new RoadNet();
    this.cov = {}; for (const k of COVER) this.cov[k] = z(); this.cov.park = z();
    this.f = { lv: z().fill(0.3), pollution: z(), noise: z(), crime: z(), access: z().fill(0.3), dens: z(), dev: z(), infra: z(), waterfront: z(), view: z() };
    this.cs = { edge: new Int32Array(F2).fill(-1), s: z(), d: z() };
    this.lastT = 0;
  }

  // non-run messages: static terrain fields, road network, coarse road-access samples
  handle(m) {
    if (m.type === 'static') { this.f.waterfront = m.waterfront; this.f.view = m.view; }
    if (m.type === 'net') this.net = netFromSnapshot(m.net);
    if (m.type === 'cs') this.cs = m.cs;
  }

  // req: { t, doCoverage, blds, prio (Uint8Array per coarse cell), busComps, stats }
  *run(req) {
    const out = { msgs: [], cov: null };
    const dt = clamp(req.t - this.lastT, 0, 4); this.lastT = req.t;
    if (req.doCoverage) { yield* this.coverage(req); out.cov = this.cov; }
    yield* this.fields(req);
    yield* this.traffic(req, dt, out);
    out.f = this.f;
    out.edges = [...this.net.edges.values()].map((e) => [e.id, e.flow, e.cong, e.cond, e.speedF, e.cost, e.fAB || 0, e.fBA || 0]);
    out.blds = req.blds.map((b) => [b.id, b.tOut, b.tJob, b.cong, b.prod]);
    out.nodes = [...this.net.nodes.values()].filter((n) => n.edges.size >= 3).map((n) => [n.id, n.delay || 0, n.through || 0]);
    out.routeRevision = req.routeRevision; out.netVersion = req.netVersion; out.bldVersion = req.bldVersion;
    out.routes = req.routeOrigin != null ? { origin: req.routeOrigin, netVersion: req.netVersion, bldVersion: req.bldVersion, ...commuteRoutes(this.net, req.blds, req.routeOrigin) } : null;
    this.result = out;
  }

  // ---------------------------------------------------------------- coverage
  *coverage(req) {
    const net = this.net, cs = this.cs, busComps = new Set(req.busComps || []);
    const bySvc = {}; for (const k of COVER) bySvc[k] = [];
    const parks = [];
    for (const b of req.blds) {
      if (!b.svc || b.ab) continue;
      if (bySvc[b.svc]) bySvc[b.svc].push(b);
      if (SERVICES[b.svc].park) parks.push(b);
    }
    const cov = {};
    for (const type of COVER) {
      const arr = new Float32Array(F2), R = SERVICES[type].radius * Math.sqrt(req.budgets?.[type] ?? 1);
      for (const b of bySvc[type]) {
        const e = b.edge >= 0 && net.edges.get(b.edge); if (!e) continue;
        if (type === 'busstop' && !busComps.has(b.comp)) continue;
        if(['tramstop','railstation','metrostation'].includes(type)&&(!b.power||!(req.lines||[]).some(l=>l.stops.some(st=>Math.hypot(st.x-b.cx,st.z-b.cz)<1))))continue;
        const res = net.dijkstra(net.sourcesAt(e, b.s, 'len'), 'len', R);
        for (let k = 0; k < F2; k++) {
          const ek = cs.edge[k]; if (ek < 0) continue;
          const e2 = net.edges.get(ek); if (!e2) continue;
          let d = net.costTo(res, e2, cs.s[k], 'len');
          if (ek === b.edge) d = Math.min(d, Math.abs(cs.s[k] - b.s));
          const v = Math.min(1, (1 - (d + cs.d[k]) / R) * (req.budgets?.[type] ?? 1));
          if (v > arr[k]) arr[k] = v;
        }
        yield;
      }
      if (req.prio) for (let k = 0; k < F2; k++) {
        const p = PRIO[req.prio[k]];
        if (arr[k] && p && p.includes(type)) arr[k] = Math.min(1, arr[k] * 1.3 + 0.05);
      }
      cov[type] = arr;
    }
    for(let k=0;k<F2;k++)cov.busstop[k]=Math.max(cov.busstop[k],cov.tramstop[k],cov.railstation[k],cov.metrostation[k]);
    const park = new Float32Array(F2);
    for (const b of parks) splat(park, b.cx, b.cz, SERVICES[b.svc].park * Math.sqrt(req.budgets?.[b.svc] ?? 1), (b.svc === 'parkL' ? 1 : 0.75) * (req.budgets?.[b.svc] ?? 1));
    for (const e of net.edges.values()) {
      if (e.type !== 'boulevard') continue;
      for (let s = 0; s < e.len; s += 10) { const p = net.sampleAt(e, s); splat(park, p.x, p.z, 20, 0.12); }
    }
    for (let k = 0; k < F2; k++) park[k] = Math.min(1, park[k]);
    cov.park = park;
    this.cov = cov;
  }

  // ---------------------------------------------------------------- land value & nuisances
  *fields(req) {
    const net = this.net;
    const pol = new Float32Array(F2), noi = new Float32Array(F2), dens = new Float32Array(F2), lvl = new Float32Array(F2);
    const cnt = new Float32Array(F2), ab = new Float32Array(F2), infS = new Float32Array(F2), wpol = new Float32Array(F2);
    // air pollution drifts downwind: a plume is the source splat plus a weaker, wider one shifted with the wind
    const wd = req.weather?.direction ?? 0, ws = req.weather?.wind ?? 0.5, wx = Math.sin(wd) * ws, wz = Math.cos(wd) * ws;
    const plume = (x, z, r, v) => { splat(pol, x + wx * r * 0.25, z + wz * r * 0.25, r, v * 0.7); splat(pol, x + wx * r * 0.9, z + wz * r * 0.9, r * 1.2, v * 0.45); };
    const nearWater = (x, z, r) => sampleField(this.f.waterfront, x, z) > 1 - r / 28;
    for (const b of req.blds) {
      const k = Math.min(FN - 1, (b.cz / FC) | 0) * FN + Math.min(FN - 1, (b.cx / FC) | 0);
      if (b.svc) {
        const S = SERVICES[b.svc];
        if (S.pollution && b.svc !== 'outlet') plume(b.cx, b.cz, 50 * S.pollution, S.pollution * 0.8);
        if (b.svc === 'outlet') { splat(pol, b.cx, b.cz, 30, 0.4); splat(wpol, b.cx, b.cz, 90, 1.1); }   // sewage fouls the water
        if (b.svc === 'coal' && nearWater(b.cx, b.cz, 20)) splat(wpol, b.cx, b.cz, 50, 0.4);
        if (S.noise) splat(noi, b.cx, b.cz, 36, S.noise);
        continue;
      }
      if (b.zk === 'i') {
        const v = (0.22 + 0.12 * b.level) * (b.green ? 0.45 : 1) * (b.spec === 'forestry' ? 0.4 : 1);
        plume(b.cx, b.cz, 30 + b.level * 10, v); splat(noi, b.cx, b.cz, 26, 0.22);
        if (nearWater(b.cx, b.cz, 18)) splat(wpol, b.cx, b.cz, 45, v * 1.2);
      }
      if (b.zk === 'c' || b.zk === 'm') splat(noi, b.cx, b.cz, 16, 0.05 * b.level);
      dens[k] += b.occ * HH + b.workers; lvl[k] += b.level; cnt[k]++;
      if (b.ab) ab[k]++;
      infS[k] += (b.power ? 0.5 : 0) + (b.water ? 0.3 : 0) + (b.sewage ? 0.2 : 0);
    }
    yield;
    for (const e of net.edges.values()) {
      const R = ROADS[e.type], v = Math.min(1, e.flow / R.capacity) * 0.35 + (e.type === 'highway' ? 0.3 : e.type === 'alley' ? 0 : 0.03);
      if (v < 0.01) continue;
      for (let s = 4; s < e.len; s += 8) { const p = net.sampleAt(e, s); splat(noi, p.x, p.z, e.hw + 14, v); splat(pol, p.x, p.z, e.hw + 10, v * 0.3); }
    }
    yield;
    const { lv, access, waterfront, view } = this.f, cov = this.cov;
    for (let k = 0; k < F2; k++) wpol[k] = waterfront[k] > 0 ? clamp(wpol[k], 0, 1) : 0; // only shores carry water pollution
    const dev = new Float32Array(F2), crm = new Float32Array(F2), infra = new Float32Array(F2), crime = new Float32Array(F2);
    for (let k = 0; k < F2; k++) {
      pol[k] = clamp(pol[k], 0, 1); noi[k] = clamp(noi[k], 0, 1);
      dev[k] = cnt[k] ? lvl[k] / cnt[k] : 0;
      infra[k] = cnt[k] ? infS[k] / cnt[k] : 0.5;
      crm[k] = clamp(0.04 + Math.min(1, dens[k] / 300) * 0.6 * (1 - 0.85 * cov.police[k]) * (1 - 0.25 * cov.school[k]) + ab[k] * 0.18, 0, 1);
    }
    // ordinances and car-free centres
    const ord = req.ord || {};
    for (const b of req.blds) if (b.carFree) { const k = Math.min(FN - 1, (b.cz / FC) | 0) * FN + Math.min(FN - 1, (b.cx / FC) | 0); noi[k] *= 0.6; pol[k] *= 0.8; }
    for (let k = 0; k < F2; k++) {
      if (ord.curfew) crm[k] *= 0.75;
      if (ord.noise) noi[k] *= 0.7;
      if (ord.greenRoofs) pol[k] *= 0.85;
    }
    const devB = blur(dev), abB = blur(ab), crimeB = blur(crm);
    for (let k = 0; k < F2; k++) {
      const raw = 0.2 + 0.22 * cov.park[k] + 0.2 * waterfront[k] * (1 - 0.8 * wpol[k]) + 0.06 * (cov.fire[k] + cov.police[k] + cov.clinic[k] + cov.school[k]) +
        0.14 * access[k] + 0.06 * view[k] + 0.09 * Math.min(1, devB[k] / 3.5) + 0.05 * infra[k] -
        0.4 * pol[k] - 0.18 * noi[k] - 0.22 * crimeB[k] - 0.12 * Math.min(1, abB[k]) +
        (ord.greenRoofs ? 0.02 : 0) + (ord.highrise && devB[k] < 3 ? 0.03 : 0) + 0.04 * (cov.college?.[k] || 0) + 0.05 * (cov.university?.[k] || 0);
      lv[k] = lv[k] * 0.65 + clamp(raw, 0, 1) * 0.35;
      crime[k] = crimeB[k];
    }
    Object.assign(this.f, { pollution: pol, noise: noi, dens, dev: devB, infra, crime, waterPol: wpol });
  }

  // ---------------------------------------------------------------- traffic
  *traffic(req, dt, out) {
    const net = this.net, rng = this.rng;
    updateCosts(net, req.weather?.speed ?? 1);
    for (const b of req.blds) { b.tOut = b.tJob = Infinity; b.cong = 0; b.prod = 1; }
    if (!net.edges.size) return;
    const outs = [...net.nodes.values()].filter((n) => n.outside).map((n) => [n.id, 0]);
    const rOut = net.dijkstra(outs, 'time', Infinity, true); yield;
    const jobSrc = [];
    for (const b of req.blds) {
      if (b.svc || b.ab || b.edge < 0 || !(b.workers > 0.5)) continue;
      const e = net.edges.get(b.edge); if (e) jobSrc.push(...net.sourcesAt(e, b.s));
    }
    const rJob = jobSrc.length ? net.dijkstra(jobSrc, 'time') : null; yield;
    for (const b of req.blds) {
      const e = b.edge >= 0 && net.edges.get(b.edge); if (!e) continue;
      b.tOut = net.costTo(rOut, e, b.s); b.tJob = rJob ? net.costTo(rJob, e, b.s) : Infinity;
      b.cong = e.cong || 0;
      b.prod = clamp(1 - 0.4 * Math.max(0, b.cong - 0.7) - (b.kind === 'I' && b.tOut > 90 ? 0.25 : 0), 0.4, 1.1);
    }
    const cs = this.cs, acc = this.f.access;
    for (let k = 0; k < F2; k++) {
      const ek = cs.edge[k], e = ek >= 0 && net.edges.get(ek);
      if (!e) { acc[k] *= 0.9; continue; }
      const to = net.costTo(rOut, e, cs.s[k]), tj = rJob ? net.costTo(rJob, e, cs.s[k]) : 200;
      const a = 0.5 * (1 - clamp(to / 160, 0, 1)) + 0.4 * (1 - clamp(tj / 60, 0, 1)) + 0.15 * this.cov.busstop[k];
      acc[k] = acc[k] * 0.5 + clamp(a, 0, 1) * 0.5;
    }
    yield;
    // deterministic assignment (clusters → gravity → incremental loading); see assign.js
    const st = req.stats;
    const total = (st.employed * 0.9 + st.pop * 0.2 + st.filledI * 0.3) * 0.4;
    const old = new Map([...net.edges.values()].map((e) => [e.id, [e.fAB || 0, e.fBA || 0, e.heights || null, e.hazardSpeed ?? 1, e.speedF ?? 1]]));
    const lineRoutes = routeLines(net, req.lines || []);
    const lines = (req.lines || []).map((l, i) => ({ ...l, legs:lineRoutes[i].legs, speedF: l.mode==='rail'||l.mode==='metro'?1:lineRoutes[i].segs.reduce((n,s)=>n+(net.edges.get(s.edge)?.speedF||1)*Math.abs(s.to-s.from),0)/Math.max(1,lineRoutes[i].len), busLaneShare: lineRoutes[i].busLaneShare })).filter((l, i) => lineRoutes[i].ok);
    const asg = yield* assignTraffic(net, req.blds, { total, commuters: st.commuters, weatherSpeed: req.weather?.speed ?? 1, skyShare: req.skyShare || 0, hubs: req.hubs || [], lines, transitBoost: req.ord?.freeTransit ? 1.5 : 1, rng });
    let jam = 0;
    for (const e of net.edges.values()) {   // blend with last pass so flows settle rather than flicker
      const [a0, b0] = old.get(e.id) || [0, 0];
      e.fAB = a0 * 0.5 + (asg.fAB.get(e.id) || 0) * 0.5; e.fBA = b0 * 0.5 + (asg.fBA.get(e.id) || 0) * 0.5;
      const cong = Math.max(e.fAB, e.fBA) / dirCapacity(e);
      if (cong > 1 && e.len > 20) jam++;
      const dep = sampleField(this.cov.depot, (e.bb[0] + e.bb[2]) / 2, (e.bb[1] + e.bb[3]) / 2);
      e.cond = clamp(e.cond - 0.0012 * dt * (1 + cong) * (req.weather?.wear ?? 1) + (dep > 0.05 ? 0.03 * dt : 0), 0.2, 1);
    }
    updateCosts(net, req.weather?.speed ?? 1);
    out.lines = lineRoutes.map((r) => ({ ...r, riders: asg.riders.get(r.id) || 0 }));
    out.samples = asg.samples;
    out.modal = { car: asg.car, transit: asg.transit, bus: asg.bus, tram: asg.tram, rail: asg.rail, metro: asg.metro, air: asg.air, walk: asg.walk, unserved:asg.unserved };
    out.air = { od: [...asg.airOD].map(([k, v]) => [...k.split('-').map(Number), v]), load: [...asg.hubLoad] };
    out.jam = jam;
    if (jam > 3) out.msgs.push([`Traffic jams on ${jam} roads — add avenues or alternate routes.`, 'warn', 'jam']);
  }
}
