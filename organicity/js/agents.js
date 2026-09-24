// Organicity — visible traffic. Vehicles follow routes sampled from the traffic
// assignment (plus buses, fire engines, garbage trucks and patrols) and queue in
// per-direction lanes: each keeps a gap to the vehicle ahead, stops at red
// signals and stop signs, and waits when the next road is backed up, so jams
// and spillback emerge. Aggregate flows and travel times still come from the
// assignment; these vehicles are its moving picture.
import { ROADS, LAYERS, RAMP_LEN } from './config.js';
import { RoadNet } from './roads.js';
import { netFromSnapshot } from './assign.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const AGENT_TYPES = {
  car:     { len: 2.2, speed: 1,    signals: true },
  truck:   { len: 3.8, speed: 0.8,  signals: true },
  bus:     { len: 4.6, speed: 0.85, signals: true, lane: 'bus' },
  fire:    { len: 3.6, speed: 1.35, signals: false, flash: true },
  garbage: { len: 3.4, speed: 0.75, signals: true },
  police:  { len: 2.2, speed: 1.1,  signals: true, flash: true },
};
const GAP = 1.2, ACCEL = 7, SPILL = 3.5, SIGNAL_PERIOD = 7;

// height of the deck above ground at arc s (ramps ease in over RAMP_LEN)
export function deckHeight(e, s) {
  const L = e.layer || 0; if (!L) return 0;
  const t = clamp(Math.min(s, e.len - s) / RAMP_LEN, 0, 1);
  return LAYERS[L].y * t * t * (3 - 2 * t);
}

export class Traffic {
  constructor() { this.agents = []; this.clock = 0; this.axisCache = new Map(); this.netVer = -1; this.id = 1; }

  // Signals alternate between two approach axes; nodes are offset so they don't all switch together.
  phase(nodeId) { return Math.floor(this.clock / SIGNAL_PERIOD + nodeId * 0.37) % 2; }

  // Approach axis of edge at node: roughly east–west (0) or north–south (1).
  axis(net, nodeId, e) {
    if (this.netVer !== net.version) { this.axisCache.clear(); this.netVer = net.version; }
    const key = nodeId * 1e6 + e.id; let a = this.axisCache.get(key);
    if (a === undefined) {
      const p = net.sampleAt(e, e.a === nodeId ? 0.5 : e.len - 0.5);
      const ang = ((Math.atan2(p.tz, p.tx) + Math.PI / 4) % Math.PI + Math.PI) % Math.PI;
      a = ang < Math.PI / 2 ? 0 : 1;
      this.axisCache.set(key, a);
    }
    return a;
  }

  // Is there room to put a vehicle at the start of this route?
  canSpawn(segs) {
    if (!segs || !segs.length) return false;
    const g = segs[0], dir = g.to >= g.from ? 1 : -1;
    for (const a of this.agents) {
      const h = a.segs[a.i];
      if (h.edge === g.edge && (h.to >= h.from ? 1 : -1) === dir && Math.abs(a.s - g.from) < 7) return false;
    }
    return true;
  }

  // segs: [{edge, from, to}]. extra.loop restarts the route at the end (bus lines).
  spawn(segs, type = 'car', extra = {}) {
    if (!segs || !segs.length) return null;
    const a = { id: this.id++, segs, i: 0, s: segs[0].from, v: 0, type, vm: 0.8 + Math.random() * 0.35, wait: 0, ...extra };
    this.agents.push(a);
    return a;
  }

  step(net, dt) {
    this.clock += dt;
    const A = this.agents, lanes = new Map();
    for (let i = A.length - 1; i >= 0; i--) if (!net.edges.has(A[i].segs[A[i].i].edge)) A.splice(i, 1); // road vanished
    for (const a of A) {
      const g = a.segs[a.i], dir = g.to >= g.from ? 1 : -1, key = g.edge * 2 + (dir > 0 ? 1 : 0);
      a.dir = dir; a.prog = a.s * dir;
      let l = lanes.get(key); if (!l) lanes.set(key, (l = [])); l.push(a);
    }
    for (const l of lanes.values()) l.sort((p, q) => q.prog - p.prog); // front of the queue first
    const tailFree = (edgeId, dir, from) => {                            // room at the start of the next road?
      const l = lanes.get(edgeId * 2 + (dir > 0 ? 1 : 0)); if (!l || !l.length) return true;
      const last = l[l.length - 1]; return Math.abs(last.s - from) > SPILL + AGENT_TYPES[last.type].len;
    };
    for (const l of lanes.values()) {
      for (let k = 0; k < l.length; k++) {
        const a = l[k], T = AGENT_TYPES[a.type], g = a.segs[a.i], e = net.edges.get(g.edge);
        const busLane = T.lane === 'bus' && e.busLane;
        let vmax = ROADS[e.type].speed * (busLane ? 1 : e.speedF || 1) * a.vm * T.speed;
        if (k > 0) { const lead = l[k - 1], gap = Math.abs(lead.s - a.s) - AGENT_TYPES[lead.type].len; vmax = Math.min(vmax, Math.max(0, (gap - GAP) * 1.8)); }
        const endsAtNode = g.to <= 1e-3 || g.to >= e.len - 1e-3, dist = Math.abs(g.to - a.s);
        if (endsAtNode && dist < 14) {
          const nodeId = g.to <= 1e-3 ? e.a : e.b, node = net.nodes.get(nodeId), next = a.segs[a.i + 1] || (a.loop ? a.segs[0] : null);
          let hold = false;
          if (node && node.edges.size >= 3 && T.signals) {
            if (node.control === 'signal' && this.phase(nodeId) !== this.axis(net, nodeId, e)) hold = true;
            if (node.control === 'stop' && a.wait < 0.6) { if (dist < 2.5) { hold = true; if (a.v < 0.3) a.wait += dt; } }
          }
          // wait for room on the next road — unless held so long that the junction is gridlocked
          if (next && next.edge !== g.edge && (a.held || 0) < 5 && !tailFree(next.edge, next.to >= next.from ? 1 : -1, next.from)) hold = true;
          if (hold) vmax = Math.min(vmax, Math.max(0, (dist - 1.5) * 1.8));
          if (node && node.control === 'roundabout') vmax = Math.min(vmax, 5);
        }
        a.v = Math.min(vmax, a.v + ACCEL * dt);
        a.held = a.v < 0.2 ? (a.held || 0) + dt : 0;
        a.s += a.dir * a.v * dt;
        if ((a.dir > 0 && a.s >= g.to) || (a.dir < 0 && a.s <= g.to)) {
          const over = Math.abs(a.s - g.to);
          a.i++; a.wait = 0;
          if (a.i >= a.segs.length) { if (!a.loop) { a.done = true; continue; } a.i = 0; }
          const n = a.segs[a.i]; a.s = n.from + Math.sign(n.to - n.from || 1) * Math.min(over, Math.abs(n.to - n.from));
        }
      }
    }
    for (let i = A.length - 1; i >= 0; i--) if (A[i].done) A.splice(i, 1);
  }

  // world position, heading and height of an agent
  pose(net, a) {
    const g = a.segs[a.i], e = net.edges.get(g.edge); if (!e) return null;
    const f = net.sampleAt(e, a.s), dir = g.to >= g.from ? 1 : -1, hx = f.tx * dir, hz = f.tz * dir;
    let lane = e.oneway ? (a.lane ??= (a.id % 2 ? -1 : 1) * e.hw * 0.4) : Math.max(0.9, e.hw * 0.45);
    if (AGENT_TYPES[a.type].lane === 'bus' && e.busLane) lane = e.hw - 1.2;
    return { x: f.x + hz * lane, z: f.z - hx * lane, y: deckHeight(e, a.s), heading: Math.atan2(hx, hz) };
  }
}

// ------------------------------------------------------------------ worker-side host
export const TYPE_IDS = Object.keys(AGENT_TYPES);   // car, truck, bus, fire, garbage, police
export const POSE_STRIDE = 8;                         // x, y, z, heading, type, colour, flashing, id
const CAR_PAL = [0xd84a3a, 0x3a6ac8, 0xf2f2f2, 0x2a2a2a, 0xe8c040, 0x5ab86a, 0x9a9aa8, 0xe07a30];
const TRUCK_PAL = [0xe8e0d0, 0xd84a3a, 0x3a6ac8, 0xf0c040];

// Everything the visible traffic needs, driven by messages so it can live in a
// Web Worker (agent-worker.js) or run in-thread with the same code.
export class AgentSim {
  constructor() { this.T = new Traffic(); this.net = new RoadNet(); this.samples = []; this.target = 0; this.lines = new Map(); this.heritage = false; }

  handle(m) {
    const T = this.T;
    if (m.type === 'net') this.net = netFromSnapshot(m.net);
    else if (m.type === 'samples') { this.samples = m.samples; this.target = m.target; }
    else if (m.type === 'era') this.heritage = m.heritage;
    else if (m.type === 'spawn') { for (const s of m.list) if (T.canSpawn(s.segs)) T.spawn(s.segs, s.kind, { col: s.col }); }
    else if (m.type === 'lines') {       // reconcile buses: keep lines whose route is unchanged
      const want = new Map(m.lines.map((l) => [l.id, l]));
      for (const [id, sig] of this.lines) if (want.get(id)?.sig !== sig) { T.agents = T.agents.filter((a) => a.line !== id); this.lines.delete(id); }
      for (const l of m.lines) {
        if (this.lines.get(l.id) === l.sig || !l.segs?.length) continue;
        const n = Math.max(1, Math.min(6, Math.round(l.len / 140)));
        for (let k = 0; k < n; k++) { const b = T.spawn(l.segs, 'bus', { loop: true, col: l.color, line: l.id }); b.i = Math.floor((k / n) * l.segs.length); b.s = l.segs[b.i].from; }
        this.lines.set(l.id, l.sig);
      }
    }
  }

  // advance dt seconds and pack every vehicle pose into a transferable buffer
  step(dt) {
    const T = this.T, net = this.net;
    let general = 0; for (const a of T.agents) if (a.type === 'car' || a.type === 'truck') general++;
    for (let k = 0; k < 10 && general < this.target && this.samples.length; k++, general++) {
      const smp = this.samples[(Math.random() * this.samples.length) | 0];
      if (!smp.segs?.length || !smp.segs.every((g) => net.edges.has(g.edge)) || !T.canSpawn(smp.segs)) continue;
      const pal = smp.kind === 'truck' ? TRUCK_PAL : CAR_PAL;
      T.spawn(smp.segs, this.heritage ? 'car' : smp.kind, { col: pal[(Math.random() * pal.length) | 0] });
    }
    if (dt > 0) for (let left = dt; left > 1e-4; left -= 0.1) T.step(net, Math.min(left, 0.1));
    const buf = new Float32Array(T.agents.length * POSE_STRIDE); let n = 0;
    for (const a of T.agents) {
      const p = T.pose(net, a); if (!p || p.y < -2) continue;   // hidden inside tunnels
      buf.set([p.x, p.y, p.z, p.heading, TYPE_IDS.indexOf(a.type), a.col ?? 0xffffff, AGENT_TYPES[a.type].flash && a.v > 0.5 ? 1 : 0, a.id], n * POSE_STRIDE); n++;
    }
    return { buf, n, clock: T.clock, count: T.agents.length };
  }
}
