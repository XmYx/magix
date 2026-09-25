// Organicity — free-form road graph. Edges are quadratic béziers between nodes,
// tessellated to polylines. New roads split existing ones wherever they cross,
// at any angle, so blocks take whatever shape the player draws.
import { ROADS, JUNCTIONS } from './config.js';
import { bezier, splitBezier, segIntersect, distToSeg, clamp, Heap } from './util.js';

export class RoadNet {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.nid = 1; this.eid = 1; this.version = 0;
    this._g = null;
    this.tbb = null; // bbox of every edge added/removed since last reset
  }

  touch(bb) {
    const t = this.tbb;
    this.tbb = t ? [Math.min(t[0], bb[0]), Math.min(t[1], bb[1]), Math.max(t[2], bb[2]), Math.max(t[3], bb[3])] : bb.slice();
  }

  addNode(x, z, outside = false, id = 0) {
    if (id) this.nid = Math.max(this.nid, id + 1);
    const n = { id: id || this.nid++, x, z, edges: new Set(), outside, control: 'auto', delay: 0 };
    this.nodes.set(n.id, n); this.version++;
    return n;
  }

  addEdge(a, b, c, type, cond = 1, id = 0) {
    if (id) this.eid = Math.max(this.eid, id + 1);
    const e = { id: id || this.eid++, a: a.id, b: b.id, c: { x: c.x, z: c.z }, type, cond, oneway: ROADS[type].oneway || 0, layer: 0, busLane: false, flow: 0, fAB: 0, fBA: 0, cong: 0, speedF: 1 };
    this.tess(e);
    this.edges.set(e.id, e); a.edges.add(e.id); b.edges.add(e.id); this.version++;
    this.touch(e.bb);
    return e;
  }

  tess(e) {
    const A = this.nodes.get(e.a), B = this.nodes.get(e.b);
    const est = Math.hypot(e.c.x - A.x, e.c.z - A.z) + Math.hypot(B.x - e.c.x, B.z - e.c.z);
    const n = clamp(Math.ceil(est / 3), 1, 80);
    const pts = new Float32Array((n + 1) * 2), cum = new Float32Array(n + 1);
    let len = 0, x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i <= n; i++) {
      const p = bezier(A, e.c, B, i / n); pts[2 * i] = p.x; pts[2 * i + 1] = p.z;
      if (i) len += Math.hypot(p.x - pts[2 * i - 2], p.z - pts[2 * i - 1]);
      cum[i] = len;
      x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z);
    }
    e.n = n; e.pts = pts; e.cum = cum; e.len = Math.max(len, 0.01);
    e.bb = [x0, z0, x1, z1];
    e.hw = ROADS[e.type].width / 2;
    e.cost = e.len / ROADS[e.type].speed;
  }

  removeEdge(id) {
    const e = this.edges.get(id); if (!e) return null;
    this.edges.delete(id); this.touch(e.bb);
    for (const nid of [e.a, e.b]) {
      const n = this.nodes.get(nid); if (!n) continue;
      n.edges.delete(id);
      if (!n.edges.size && !n.outside) this.nodes.delete(nid);
    }
    this.version++;
    return e;
  }

  // point + unit tangent at arc length s
  sampleAt(e, s) {
    s = clamp(s, 0, e.len);
    let lo = 0, hi = e.n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= s) lo = m; else hi = m; }
    const seg = e.cum[hi] - e.cum[lo] || 1, t = (s - e.cum[lo]) / seg;
    const ax = e.pts[2 * lo], az = e.pts[2 * lo + 1], bx = e.pts[2 * hi], bz = e.pts[2 * hi + 1];
    const dx = bx - ax, dz = bz - az, dl = Math.hypot(dx, dz) || 1;
    return { x: ax + dx * t, z: az + dz * t, tx: dx / dl, tz: dz / dl };
  }

  project(e, x, z) {
    let best = { d: 1e9, s: 0, t: 0, side: 1, px: 0, pz: 0 };
    for (let i = 0; i < e.n; i++) {
      const ax = e.pts[2 * i], az = e.pts[2 * i + 1], bx = e.pts[2 * i + 2], bz = e.pts[2 * i + 3];
      const r = distToSeg(x, z, ax, az, bx, bz);
      if (r.d < best.d) {
        const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax);
        best = { d: r.d, s: e.cum[i] + r.t * (e.cum[i + 1] - e.cum[i]), t: (i + r.t) / e.n, side: cr >= 0 ? 1 : -1, px: ax + (bx - ax) * r.t, pz: az + (bz - az) * r.t };
      }
    }
    return best;
  }

  nearestNode(x, z, r) {
    let best = null, bd = r;
    for (const n of this.nodes.values()) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } }
    return best;
  }

  nearestEdge(x, z, r, filter) {
    let best = null, bd = 1e9;
    for (const e of this.edges.values()) {
      if (filter && !filter(e)) continue;
      const [x0, z0, x1, z1] = e.bb, m = r + e.hw;
      if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) continue;
      const p = this.project(e, x, z);
      if (p.d - e.hw < bd && p.d <= r + e.hw) { bd = p.d - e.hw; best = { e, ...p }; }
    }
    return best;
  }

  // Snap a cursor point: to a node, onto an edge, or free.
  snap(x, z, hw, layer = 0) {
    const n = this.nearestNode(x, z, 3 + hw);
    if (n) return { x: n.x, z: n.z, node: n.id };
    const h = this.nearestEdge(x, z, 1.5, (e) => (e.layer || 0) === layer);
    if (h) {
      const A = this.nodes.get(h.e.a), B = this.nodes.get(h.e.b);
      if (h.s < 4) return { x: A.x, z: A.z, node: A.id };
      if (h.e.len - h.s < 4) return { x: B.x, z: B.z, node: B.id };
      return { x: h.px, z: h.pz, edge: h.e.id };
    }
    return { x, z };
  }

  // Split edge e at the point closest to (x,z). Returns the node there.
  splitAt(e, x, z) {
    const p = this.project(e, x, z);
    const A = this.nodes.get(e.a), B = this.nodes.get(e.b);
    if (p.s < 3) return A;
    if (e.len - p.s < 3) return B;
    const [L, R] = splitBezier(A, e.c, B, p.t);
    this.removeEdge(e.id);
    if (!this.nodes.has(A.id)) this.nodes.set(A.id, A);
    if (!this.nodes.has(B.id)) this.nodes.set(B.id, B);
    const M = this.addNode(L.p2.x, L.p2.z);
    const e1 = this.addEdge(A, M, L.c, e.type, e.cond), e2 = this.addEdge(M, B, R.c, e.type, e.cond);
    for (const x of [e1, e2]) { x.flow = e.flow; x.fAB = e.fAB; x.fBA = e.fBA; x.oneway = e.oneway; x.layer = e.layer; x.busLane = e.busLane; x.bridgeStyle=e.bridgeStyle; }
    return M;
  }

  resolve(s) {
    if (s.node && this.nodes.has(s.node)) return this.nodes.get(s.node);
    if (s.edge) {
      const e = this.edges.get(s.edge) || this.nearestEdge(s.x, s.z, 1.5)?.e;
      if (e) return this.splitAt(e, s.x, s.z);
    }
    return this.nearestNode(s.x, s.z, 0.5) || this.addNode(s.x, s.z);
  }

  curveLength(p0, c, p2) {
    let len = 0, prev = p0;
    for (let i = 1; i <= 24; i++) { const p = bezier(p0, c, p2, i / 24); len += Math.hypot(p.x - prev.x, p.z - prev.z); prev = p; }
    return len;
  }

  // Validation for previews: returns {ok, err, len}
  check(sA, c, sB, type, layer = 0) {
    const len = this.curveLength(sA, c, sB);
    if (len < 6) return { ok: false, err: 'Too short', len };
    if (sA.node && sA.node === sB.node) return { ok: false, err: 'Loops back to the same junction', len };
    let close = 0; const hw = ROADS[type].width / 2;
    for (let i = 1; i < 12; i++) {
      const p = bezier(sA, c, sB, i / 12);
      const h = this.nearestEdge(p.x, p.z, 0.6, (e) => (e.layer || 0) === layer);
      if (h && h.d < Math.min(h.e.hw, hw) * 0.8) close++;
    }
    if (close > 3) return { ok: false, err: 'Overlaps an existing road', len };
    const d0 = { x: c.x - sA.x, z: c.z - sA.z }, d1 = { x: sB.x - c.x, z: sB.z - c.z };
    const dot = (d0.x * d1.x + d0.z * d1.z) / ((Math.hypot(d0.x, d0.z) * Math.hypot(d1.x, d1.z)) || 1);
    if (dot < -0.6) return { ok: false, err: 'Curve too sharp', len };
    return { ok: true, len };
  }

  // Commit a road. Returns { edges: [new edge ids], bb: [x0,z0,x1,z1] }
  // Where an elevated road or tunnel meets only roads of its own level, it keeps its height through
  // the joint; it ramps to the ground only where it meets another level or ends.
  levels() {
    const keep = (id, L) => { const n = this.nodes.get(id); if (!n || n.edges.size < 2) return false; for (const x of n.edges) if ((this.edges.get(x)?.layer || 0) !== L) return false; return true; };
    for (const e of this.edges.values()) { const L = e.layer || 0; e.noRampA = !!L && keep(e.a, L); e.noRampB = !!L && keep(e.b, L); }
  }
  // layer: 0 ground, 1–3 elevated levels, -1 tunnel. Roads only join others on the same layer;
  // elevated and tunnel roads pass over / under everything between their end ramps.
  build(sA, c, sB, type, oneway = 0, layer = 0) {
    oneway = oneway || ROADS[type].oneway || 0;
    const nA = this.resolve(sA);
    const nB = this.resolve(sB.edge && !this.edges.has(sB.edge) ? { x: sB.x, z: sB.z, edge: -1 } : sB);
    if (nA === nB) return { edges: [], bb: null };
    const ctrl = c || { x: (nA.x + nB.x) / 2, z: (nA.z + nB.z) / 2 };
    const K = 64, P = [];
    for (let i = 0; i <= K; i++) P.push(bezier(nA, ctrl, nB, i / K));

    let hits = [];
    let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
    for (const p of P) { bx0 = Math.min(bx0, p.x); bz0 = Math.min(bz0, p.z); bx1 = Math.max(bx1, p.x); bz1 = Math.max(bz1, p.z); }
    for (const e of this.edges.values()) {
      const [x0, z0, x1, z1] = e.bb;
      if ((e.layer || 0) !== layer) continue;
      if (x1 < bx0 - 1 || x0 > bx1 + 1 || z1 < bz0 - 1 || z0 > bz1 + 1) continue;
      for (let i = 0; i < K; i++) {
        const a = P[i], b = P[i + 1];
        for (let j = 0; j < e.n; j++) {
          const r = segIntersect(a.x, a.z, b.x, b.z, e.pts[2 * j], e.pts[2 * j + 1], e.pts[2 * j + 2], e.pts[2 * j + 3]);
          if (!r) continue;
          const x = a.x + (b.x - a.x) * r.t, z = a.z + (b.z - a.z) * r.t;
          if (Math.hypot(x - nA.x, z - nA.z) < 3 || Math.hypot(x - nB.x, z - nB.z) < 3) continue;
          hits.push({ tn: (i + r.t) / K, x, z, eid: e.id });
        }
      }
    }
    hits.sort((p, q) => p.tn - q.tn);
    const merged = [];
    for (const h of hits) {
      const last = merged[merged.length - 1];
      if (last && Math.hypot(h.x - last.x, h.z - last.z) < 4) continue;
      merged.push(h);
    }
    hits = merged;

    const mids = [];
    for (const h of hits) {
      let e = this.edges.get(h.eid);
      if (!e) e = this.nearestEdge(h.x, h.z, 1)?.e;
      if (!e) continue;
      const node = this.splitAt(e, h.x, h.z);
      if (node === nA || node === nB || mids.some((m) => m.node === node)) continue;
      mids.push({ node, tn: h.tn });
    }

    const chain = [{ node: nA, tn: 0 }, ...mids, { node: nB, tn: 1 }];
    const added = [];
    let cur = { p0: nA, c: ctrl, p2: nB }, tPrev = 0;
    for (let k = 1; k < chain.length; k++) {
      const tk = chain[k].tn; let piece;
      if (k < chain.length - 1) {
        const [L, R] = splitBezier(cur.p0, cur.c, cur.p2, clamp((tk - tPrev) / (1 - tPrev), 0.001, 0.999));
        piece = L; cur = R; tPrev = tk;
      } else piece = cur;
      const a = chain[k - 1].node, b = chain[k].node;
      if (a === b) continue;
      const dup = [...a.edges].some((id) => { const e = this.edges.get(id); return e && (e.a === b.id || e.b === b.id) && Math.hypot(e.c.x - piece.c.x, e.c.z - piece.c.z) < 2; });
      if (dup) continue;
      const ne = this.addEdge(a, b, piece.c, type); ne.oneway = oneway; ne.layer = layer; added.push(ne.id);
    }
    return { edges: added, bb: [bx0, bz0, bx1, bz1] };
  }

  // ---------------- graph / pathfinding ----------------
  // Directed adjacency (one-way edges contribute a single arc) plus undirected
  // connected components, which is what utilities and "reaches the highway" use.
  graph() {
    if (this._g && this._g.version === this.version) return this._g;
    const ids = [...this.nodes.keys()], idx = new Map();
    ids.forEach((id, k) => idx.set(id, k));
    const n = ids.length, deg = new Int32Array(n + 1);
    const fwd = (e) => (e.oneway || 0) >= 0, back = (e) => (e.oneway || 0) <= 0;
    for (const e of this.edges.values()) { if (fwd(e)) deg[idx.get(e.a)]++; if (back(e)) deg[idx.get(e.b)]++; }
    const start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
    const fill = start.slice(0, n), adjN = new Int32Array(start[n]), adjE = new Int32Array(start[n]);
    const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
    const find = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    for (const e of this.edges.values()) {
      const a = idx.get(e.a), b = idx.get(e.b);
      if (fwd(e)) { adjN[fill[a]] = b; adjE[fill[a]++] = e.id; }
      if (back(e)) { adjN[fill[b]] = a; adjE[fill[b]++] = e.id; }
      par[find(a)] = find(b);
    }
    const comp = new Int32Array(n), root = new Map(), compOut = [];
    for (let i = 0; i < n; i++) {
      const r = find(i); let c = root.get(r);
      if (c === undefined) { c = compOut.length; root.set(r, c); compOut.push(false); }
      comp[i] = c;
      if (this.nodes.get(ids[i]).outside) compOut[c] = true;
    }
    const nodeObj = ids.map((id) => this.nodes.get(id));
    this._g = { version: this.version, ids, idx, start, adjN, adjE, comp, compOut, n, nodeObj };
    return this._g;
  }

  // Dijkstra sources for a point on edge e at arc s, honouring one-way direction.
  sourcesAt(e, s, weight = 'time') {
    const f = weight === 'len' ? 1 : e.cost / e.len, ow = e.oneway || 0, out = [];
    if (ow <= 0) out.push([e.a, s * f]);           // drive toward a
    if (ow >= 0) out.push([e.b, (e.len - s) * f]); // drive toward b
    return out;
  }

  compOf(e) { const g = this.graph(); const k = g.idx.get(e.a); return k === undefined ? -1 : g.comp[k]; }

  // sources: [[nodeId, initialCost]]. weight: 'len' or 'time'.
  dijkstra(sources, weight = 'time', maxCost = Infinity, wantPrev = false) {
    const g = this.graph();
    const dist = new Float32Array(g.n).fill(Infinity);
    const prev = wantPrev ? new Int32Array(g.n).fill(-1) : null;
    const h = new Heap();
    for (const [id, c0] of sources) {
      const k = g.idx.get(id); if (k === undefined) continue;
      if (c0 < dist[k]) { dist[k] = c0; h.push(c0, k); }
    }
    while (h.size) {
      const u = h.pop(), du = dist[u];
      if (du > maxCost) break;
      for (let j = g.start[u]; j < g.start[u + 1]; j++) {
        const e = this.edges.get(g.adjE[j]);
        const v = g.adjN[j], nd = du + (weight === 'len' ? e.len : e.cost + (g.nodeObj[v].delay || 0)); // junction delay on entry
        if (nd < dist[v]) { dist[v] = nd; if (prev) prev[v] = g.adjE[j]; h.push(nd, v); }
      }
    }
    return { dist, prev, g };
  }

  // cost to reach a point (edge e, arc s) from a dijkstra result, honouring one-way
  costTo(res, e, s, weight = 'time') {
    const g = res.g, a = g.idx.get(e.a), b = g.idx.get(e.b);
    if (a === undefined || b === undefined) return Infinity;
    const f = weight === 'len' ? 1 : e.cost / e.len, ow = e.oneway || 0;
    return Math.min(ow >= 0 ? res.dist[a] + s * f : Infinity, ow <= 0 ? res.dist[b] + (e.len - s) * f : Infinity);
  }
}
