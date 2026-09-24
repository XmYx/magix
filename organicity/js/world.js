// Organicity — the land model. A fine cell grid carries water, roads, zoning,
// districts and building occupancy. Each cell also remembers its nearest road
// (edge, arc position, side, kerb distance). Lots are carved from that
// "road Voronoi": cells that share a road, a side and a frontage slot form a lot,
// so plot boundaries run perpendicular to curved streets and meet at the
// bisector of angled junctions — wedges, triangles and slivers fall out naturally.
import { N, DEPTH, FLOOR_H, ZONES, SERVICES, ROADS, MAX_AREA, DISTRICT_COLORS, BRIDGE_COST_MULT, LAYERS, RAMP_LEN, JUNCTIONS } from './config.js';
import { generateHeights, roadProfile } from './terrain.js';
import { transitMode } from './transit.js';
import { RoadNet } from './roads.js';
import { buildingFloors, technology, TERRACE_SERVICES } from './eras.js';
import { fbm, hash2, mulberry32, maskDistance, clamp, rleEncode, rleDecode } from './util.js';

export const CH = 64;                 // render chunk size
export const CHN = N / CH;
const SYL = ['ash', 'bel', 'cor', 'dun', 'el', 'fen', 'gar', 'hol', 'ive', 'kel', 'lin', 'mor', 'nor', 'oak', 'pen', 'quar', 'ros', 'sil', 'tor', 'vale', 'wick', 'yar'];
const SUF = [' Heights', ' Park', ' Quarter', ' Row', ' Gardens', ' Point', ' End', ' Hill', ' Docks', ' Commons'];

export class World {
  constructor(seed = 1234, mapPreset = 'river') {
    this.seed = seed; this.year = 2000; this.platforms = new Map(); this.platformId = 1; this.platformVersion = 0;
    const S = N * N;
    this.mapPreset = mapPreset; this.elevation = new Float32Array(S); this.levees = new Uint8Array(S); this.flood = new Float32Array(S); this.hazards = { snow: 0, surge: 0 };
    this.water = new Uint8Array(S);
    this.wdist = new Float32Array(S);
    this.road = new Uint8Array(S);
    this.zone = new Uint8Array(S);
    this.district = new Uint8Array(S);
    this.tree = new Uint8Array(S);
    this.bld = new Int32Array(S);
    this.accEdge = new Int32Array(S).fill(-1);
    this.accDist = new Float32Array(S).fill(1e9);
    this.accS = new Float32Array(S);
    this.accSide = new Int8Array(S);
    this.net = new RoadNet();
    this.buildings = new Map();
    this.bid = 1;
    this.districts = [null];
    this.lines = []; this.lineId = 1; this.lineVersion = 0;   // bus lines: { id, name, color, stops: [busstop building ids] }
    this.day = 0;
    this.zoneVersion = 0;
    this.bldVersion = 0;
    this.svcVersion = 0;
    this.districtVersion = 0;
    this.terrainVersion = 0;
    this.terrainEdited = false;
    this.tx = null; this.txMute = false; this.undoStack = [];
    this.dirty = { ground: [0, 0, N, N], chunks: new Set(), trees: true, extras: true };
    for (let i = 0; i < CHN * CHN; i++) this.dirty.chunks.add(i);
    this.rng = mulberry32(seed ^ 0x9e3779b9);
  }

  inside(x, z) { return x >= 0 && z >= 0 && x < N && z < N; }
  cellAt(x, z) { const cx = Math.floor(x), cz = Math.floor(z); return this.inside(cx, cz) ? cz * N + cx : -1; }

  heightAt(x,z) { const i=this.cellAt(Math.min(N-1,Math.max(0,x)),Math.min(N-1,Math.max(0,z))); return this.water[i]?0:this.elevation[i] || 0; }

  markGround(x0, z0, x1, z1) {
    x0 = clamp(Math.floor(x0), 0, N); z0 = clamp(Math.floor(z0), 0, N); x1 = clamp(Math.ceil(x1), 0, N); z1 = clamp(Math.ceil(z1), 0, N);
    const g = this.dirty.ground;
    this.dirty.ground = g ? [Math.min(g[0], x0), Math.min(g[1], z0), Math.max(g[2], x1), Math.max(g[3], z1)] : [x0, z0, x1, z1];
  }

  // ------------------------------------------------------------------ terrain
  genTerrain() {
    const s = this.seed, W = this.water;
    const phase = hash2(1, 2, s) * 6.28;
    for (let z = 0; z < N; z++) {
      const rx = N * 0.64 + 34 * Math.sin(z * 0.011 + phase) + (fbm(z * 0.008, 3.3, s) - 0.5) * 90;
      const rw = 7 + 6 * fbm(z * 0.02, 7.7, s + 1);
      const seaX = N * 0.9 + (fbm(z * 0.01, 1.1, s + 2) - 0.5) * 70;
      for (let x = 0; x < N; x++) {
        let w = x > seaX || Math.abs(x - rx) < rw;
        const lx = x - N * 0.22, lz = z - N * 0.82;
        if (Math.hypot(lx * 1.3, lz) < 26 + fbm(x * 0.03, z * 0.03, s + 3) * 34) w = true;
        if(this.mapPreset==='coast')w=x>seaX-90;
        if(this.mapPreset==='islands' && x>170)w=fbm(x*.012,z*.012,s+54)<.48;
        W[z * N + x] = w ? 1 : 0;
      }
    }
    this.recomputeWaterDistance(); generateHeights(this);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x; if (W[i] || this.wdist[i] < 2) continue;
      const f = fbm(x * 0.018, z * 0.018, s + 9);
      const h = hash2(x, z, s + 11);
      if ((f > 0.6 && h < 0.3 + (f - 0.6) * 2) || h < 0.01) this.tree[i] = 1;
    }
  }

  recomputeWaterDistance() {
    const W = this.water, land = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) land[i] = W[i] ? 0 : 1;
    const dl = maskDistance(land, N, N, true), dw = maskDistance(W, N, N, true);
    for (let i = 0; i < N * N; i++) this.wdist[i] = W[i] ? -Math.min(dw[i], 40) : Math.min(dl[i], 200);
  }

  // Sandbox terrain brush: val 1 = water, 0 = land. Roads over new water become bridges.
  paintWater(x, z, r, val) {
    const kill = new Set(); let n = 0;
    for (let zz = Math.floor(z - r); zz <= Math.ceil(z + r); zz++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (!this.inside(xx, zz) || Math.hypot(xx + 0.5 - x, zz + 0.5 - z) > r) continue;
      const i = zz * N + xx; if (this.water[i] === val) continue;
      if (this.tx && !this.tx.water.has(i)) this.tx.water.set(i, this.water[i]);
      this.water[i] = val; n++;
      if (val) {
        if (this.bld[i]) kill.add(this.bld[i]);
        if (this.tx && this.zone[i] && !this.tx.zone.has(i)) this.tx.zone.set(i, this.zone[i]);
        this.zone[i] = 0; this.tree[i] = 0;
      }
    }
    for (const id of kill) this.removeBuilding(id);
    if (n) { this.terrainEdited = true; this.pendingTerrain = true; this.markGround(x - r - 1, z - r - 1, x + r + 1, z + r + 1); }
    return n;
  }

  paintLevee(x,z,r,on) {
    let n=0;
    for(let zz=Math.max(0,Math.floor(z-r));zz<Math.min(N,z+r);zz++)for(let xx=Math.max(0,Math.floor(x-r));xx<Math.min(N,x+r);xx++) {
      const i=zz*N+xx;if(Math.hypot(xx+.5-x,zz+.5-z)>r||this.water[i]||this.road[i]||this.bld[i]||this.levees[i]===on)continue;
      if(this.tx&&!this.tx.levees.has(i))this.tx.levees.set(i,this.levees[i]);this.levees[i]=on;n++;
    }
    if(n){this.leveeVersion=(this.leveeVersion||0)+1;this.markGround(x-r,z-r,x+r+1,z+r+1);}return n;
  }

  // Recompute everything derived from the water mask (after a brush stroke).
  finishTerrain() {
    if (!this.pendingTerrain) return;
    this.pendingTerrain = false;
    this.recomputeWaterDistance();roadProfile(this);this.net.version++;
    this.rasterRegion(0, 0, N - 1, N - 1);
    for (const b of this.buildings.values()) this.refreshAccess(b);
    this.terrainVersion++; this.zoneVersion++;
    this.markGround(0, 0, N, N);
    this.dirty.trees = true;
  }

  newGame() {
    this.genTerrain();
    const A = this.net.addNode(0, 252, true);
    const B = this.net.addNode(150, 262);
    this.net.addEdge(A, B, { x: 75, z: 238 }, 'highway');
    this.onRoadsChanged([0, 230, 160, 280]);
  }

  // ------------------------------------------------------------------ roads → land
  rasterRegion(x0, z0, x1, z1) {
    x0 = clamp(Math.floor(x0), 0, N - 1); z0 = clamp(Math.floor(z0), 0, N - 1);
    x1 = clamp(Math.ceil(x1), 0, N - 1); z1 = clamp(Math.ceil(z1), 0, N - 1);
    const { road, accEdge, accDist, accS, accSide, water, bld } = this;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * N + x; road[i] = 0; accEdge[i] = -1; accDist[i] = 1e9;
    }
    const kill = new Set();
    for (const e of this.net.edges.values()) {
      const m = e.hw + DEPTH + 1;
      if (e.bb[2] + m < x0 || e.bb[0] - m > x1 || e.bb[3] + m < z0 || e.bb[1] - m > z1) continue;
      const lay = e.layer || 0, noAcc = !!ROADS[e.type].noAccess || lay !== 0, hw = e.hw, rr = hw + 0.4;
      for (let k = 0; k < e.n; k++) {
        if (lay !== 0 && e.cum[k] > RAMP_LEN * 0.6 && e.cum[k + 1] < e.len - RAMP_LEN * 0.6) continue; // deck/bore: land below stays free
        const ax = e.pts[2 * k], az = e.pts[2 * k + 1], bx = e.pts[2 * k + 2], bz = e.pts[2 * k + 3];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-6, segL = e.cum[k + 1] - e.cum[k];
        const mm = noAcc ? rr + 1 : m;
        const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - mm)), sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + mm));
        const sz0 = Math.max(z0, Math.floor(Math.min(az, bz) - mm)), sz1 = Math.min(z1, Math.ceil(Math.max(az, bz) + mm));
        for (let z = sz0; z <= sz1; z++) for (let x = sx0; x <= sx1; x++) {
          const px = x + 0.5, pz = z + 0.5;
          let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + dx * t - px, qz = az + dz * t - pz, d = Math.sqrt(qx * qx + qz * qz);
          const i = z * N + x;
          if (d <= hw + 2.6) this.tree[i] = 0; // verge — keeps canopies off the asphalt
          if (d <= rr) { road[i] = 1; if(this.levees[i]){if(this.tx&&!this.tx.levees.has(i))this.tx.levees.set(i,1);this.levees[i]=0;this.leveeVersion=(this.leveeVersion||0)+1;} if (bld[i]) kill.add(bld[i]); continue; }
          if (noAcc || water[i]) continue;
          const kd = d - hw;
          if (kd <= DEPTH && kd < accDist[i]) {
            accDist[i] = kd; accEdge[i] = e.id; accS[i] = e.cum[k] + t * segL;
            accSide[i] = dx * (pz - az) - dz * (px - ax) >= 0 ? 1 : -1;
          }
        }
      }
    }
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * N + x;
      if (road[i]) { accEdge[i] = -1; this.zone[i] = 0; this.tree[i] = 0; }
    }
    for (const id of kill) this.removeBuilding(id);
    return [x0, z0, x1, z1];
  }

  onRoadsChanged(bb) {
    roadProfile(this);
    const m = 8 + DEPTH + 2;
    const r = this.rasterRegion(bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m);
    for (const b of this.buildings.values()) {
      if (b.x1 < r[0] || b.x0 > r[2] || b.z1 < r[1] || b.z0 > r[3]) continue;
      this.refreshAccess(b);
    }
    this.markGround(r[0], r[1], r[2] + 1, r[3] + 1);
    this.dirty.trees = true;
    this.zoneVersion++;
  }

  roadCost(sA, c, sB, type, layer = 0) {
    const len = this.net.curveLength(sA, c, sB);
    let wet = 0, climb = 0, previous = this.heightAt(sA.x,sA.z); const steps = Math.max(2, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, mt = 1 - t;
      const x = mt * mt * sA.x + 2 * mt * t * c.x + t * t * sB.x, z = mt * mt * sA.z + 2 * mt * t * c.z + t * t * sB.z;
      const height=this.heightAt(x,z);climb+=Math.abs(height-previous);previous=height;
      const ci = this.cellAt(x, z); if (ci >= 0 && this.water[ci]) wet++;
    }
    const wetLen = (wet / (steps + 1)) * len;
    const mult = LAYERS[layer]?.cost ?? 1;
    // elevated & tunnel roads already span water, so no extra bridge premium
    return { cost: Math.round(ROADS[type].cost * (climb * 6 + (layer ? len * mult : len - wetLen + wetLen * BRIDGE_COST_MULT))), climb, len, wetLen: layer ? 0 : wetLen };
  }

  buildRoad(sA, c, sB, type, oneway = 0, layer = 0) {
    this.net.tbb = null;
    const res = this.net.build(sA, c, sB, type, oneway, layer);
    if (this.net.tbb) this.onRoadsChanged(this.net.tbb);
    return res;
  }

  retypeRoad(id, type) {
    const e = this.net.edges.get(id); if (!e) return null;
    this.net.tbb = null;
    this.net.touch(e.bb);
    e.type = type; this.net.tess(e); this.net.touch(e.bb); this.net.version++;
    this.onRoadsChanged(this.net.tbb);
    return e;
  }

  // 0 = two-way, 1 = only a→b, -1 = only b→a
  setOneway(id, ow) {
    const e = this.net.edges.get(id); if (!e || e.oneway === ow) return null;
    e.oneway = ow; this.net.version++;
    return e;
  }

  setBusLane(id, on) {
    const e = this.net.edges.get(id); if (!e || !!e.busLane === !!on) return null;
    e.busLane = !!on; this.net.version++;
    return e;
  }

  setJunction(nodeId, control) {
    const n = this.net.nodes.get(nodeId);
    if (!n || !JUNCTIONS[control] || n.control === control) return null;
    if (control !== 'auto' && n.edges.size < 3) return null;
    n.control = control; this.net.version++;
    return n;
  }

  // ------------------------------------------------------------------ bus lines
  addLine(stops, name, mode = 'bus') {
    const palette = [0xe84a3a, 0x3a8ae8, 0x2ab86a, 0xe8b030, 0xa050e8, 0xe86aa8, 0x30c8c8];
    const l = { mode, id: this.lineId++, name: name || `Line ${this.lineId - 1}`, color: palette[(this.lineId - 2) % palette.length], stops: [...stops] };
    this.lines.push(l); this.lineVersion++;
    return l;
  }
  removeLine(id) { const n = this.lines.length; this.lines = this.lines.filter((l) => l.id !== id); if (n !== this.lines.length) this.lineVersion++; }
  // drop stops that were demolished; lines with fewer than two stops disappear
  pruneLines() {
    let changed = false;
    for (const l of this.lines) { const k = l.stops.filter((id) => this.buildings.get(id)?.svc === transitMode(l).stop); if (k.length !== l.stops.length) { l.stops = k; changed = true; } }
    const n = this.lines.length; this.lines = this.lines.filter((l) => l.stops.length >= 2);
    if (changed || n !== this.lines.length) this.lineVersion++;
  }

  removeRoad(id) {
    const e = this.net.removeEdge(id); if (!e) return null;
    this.onRoadsChanged(e.bb);
    return e;
  }

  // ------------------------------------------------------------------ buildings
  chunkOf(x, z) { return clamp(Math.floor(z / CH), 0, CHN - 1) * CHN + clamp(Math.floor(x / CH), 0, CHN - 1); }

  refreshAccess(b) {
    if(b.platformId){
      const p=this.platforms.get(b.platformId),host=p && this.buildings.get(p.host);
      b.edge=host?.edge ?? -1;b.s=host?.s || 0;b.side=host?.side || 1;b.baseY=p?.y || 0;return;
    }
    let best = 1e9, be = -1, bs = 0, side = 1;
    for (const c of b.cells) if (this.accEdge[c] >= 0 && this.accDist[c] < best) { best = this.accDist[c]; be = this.accEdge[c]; bs = this.accS[c]; side = this.accSide[c]; }
    if (b.svc && be < 0) { // services may sit a little further back
      const h = this.net.nearestEdge(b.cx, b.cz, DEPTH + 12, (e) => !ROADS[e.type].noAccess);
      if (h) { be = h.e.id; bs = h.s; side = h.side; }
    }
    b.baseY = this.heightAt(b.cx,b.cz); b.edge = be; b.s = bs; b.side = side;
  }

  computeDerived(b, keepCenter = false) {
    let x0 = N, z0 = N, x1 = 0, z1 = 0, sx = 0, sz = 0;
    for (const c of b.cells) {
      const x = c % N, z = (c / N) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      sx += x + 0.5; sz += z + 0.5;
    }
    b.x0 = x0; b.z0 = z0; b.x1 = x1 + 1; b.z1 = z1 + 1; b.area = b.cells.length;
    if (!keepCenter) { b.cx = sx / b.area; b.cz = sz / b.area; }
    this.refreshAccess(b);
    const ci = this.cellAt(b.cx, b.cz);
    b.district = ci >= 0 ? this.district[ci] : 0;
    if (!keepCenter) {
      if (b.edge >= 0) {
        const e = this.net.edges.get(b.edge), p = this.net.sampleAt(e, b.s);
        const nx = -p.tz, nz = p.tx, sgn = (p.x - b.cx) * nx + (p.z - b.cz) * nz >= 0 ? 1 : -1;
        b.fx = nx * sgn; b.fz = nz * sgn; // front faces the street squarely
      } else { b.fx = 0; b.fz = 1; }
    }
    const ch = this.chunkOf(b.cx, b.cz);
    if (b.chunk !== undefined && b.chunk !== ch) this.dirty.chunks.add(b.chunk);
    b.chunk = ch;
  }

  createBuilding(p, id = 0) {
    if (id) this.bid = Math.max(this.bid, id + 1);
    const b = {
      id: id || this.bid++, platformId: p.platformId || 0, heightYear: p.heightYear ?? this.year, baseY: 0, zone: p.zone || 0, svc: p.svc || null, level: p.level || 1,
      cells: Int32Array.from(p.cells), seed: p.seed ?? ((this.rng() * 1e9) | 0),
      occ: p.occ || 0, cap: 0, happy: 0.6, appeal: 0.5, neglect: 0, low: 0,
      abandoned: !!p.abandoned, abDays: p.abDays || 0, fire: 0, built: p.built ?? this.day, spec: p.spec || null,
      power: true, water: true, sewage: true, garb: p.garb || 0, garbOk: true, geoVersion: 0,
    };
    for (const c of b.cells) {
      if(b.platformId) continue;
      this.bld[c] = b.id; this.tree[c] = 0;
      if (b.svc) { if (this.tx && this.zone[c] && !this.tx.zone.has(c)) this.tx.zone.set(c, this.zone[c]); this.zone[c] = 0; }
    }
    b.locked = !!p.locked; b.constructionUntil = p.constructionUntil || 0;
    if (this.tx && !this.txMute) this.tx.created.add(b.id);
    if (p.cx !== undefined) { b.cx = p.cx; b.cz = p.cz; b.fx = p.fx; b.fz = p.fz; }
    this.computeDerived(b, p.cx !== undefined);
    this.buildings.set(b.id, b);
    this.touchBuilding(b);
    this.dirty.trees = true;
    if (b.svc) { this.dirty.extras = true; this.svcVersion++; }
    return b;
  }

  touchBuilding(b) {
    b.geoVersion++;
    this.dirty.chunks.add(b.chunk);
    this.markGround(b.x0, b.z0, b.x1, b.z1);
    this.bldVersion++; this.zoneVersion++;
  }

  removeBuilding(id) {
    const b = this.buildings.get(id); if (!b) return null;
    for(const p of [...this.platforms.values()]) if(p.host===id){
      for(const service of [...this.buildings.values()])if(service.platformId===p.id)this.removeBuilding(service.id);
      this.platforms.delete(p.id);this.platformVersion++;
    }
    if (this.tx && !this.txMute) {
      if (this.tx.created.has(id)) this.tx.created.delete(id);
      else if (!this.tx.removed.has(id)) this.tx.removed.set(id, this.packBuilding(b, false));
    }
    for (const c of b.cells) if (this.bld[c] === id) this.bld[c] = 0;
    this.buildings.delete(id);
    this.dirty.chunks.add(b.chunk);
    this.markGround(b.x0, b.z0, b.x1, b.z1);
    this.bldVersion++; this.zoneVersion++;
    if (b.svc) { this.dirty.extras = true; this.svcVersion++; }
    b.removed = true;
    return b;
  }

  setCells(b, cells) {
    for (const c of b.cells) if (this.bld[c] === b.id) this.bld[c] = 0;
    this.markGround(b.x0, b.z0, b.x1, b.z1);
    b.cells = Int32Array.from(cells);
    for (const c of b.cells) { this.bld[c] = b.id; this.tree[c] = 0; }
    this.computeDerived(b);
    this.touchBuilding(b);
    this.dirty.trees = true;
  }

  free(c) { return !this.bld[c] && !this.road[c] && !this.water[c]; }

  neighbors4(c) {
    const x = c % N, z = (c / N) | 0, r = [];
    if (x > 0) r.push(c - 1); if (x < N - 1) r.push(c + 1); if (z > 0) r.push(c - N); if (z < N - 1) r.push(c + N);
    return r;
  }

  // Grow a lot from a seed cell following the road-Voronoi slot it sits in.
  formLot(seed, zoneId) {
    const Z = ZONES[zoneId], e = this.accEdge[seed];
    if (e < 0 || !this.free(seed) || this.zone[seed] !== zoneId) return null;
    const side = this.accSide[seed], F = Z.frontage;
    const off = hash2(e, side + 3, 7) * F;
    const slot = Math.floor((this.accS[seed] + off) / F);
    const ok = (c) => this.zone[c] === zoneId && this.free(c) && this.accEdge[c] === e && this.accSide[c] === side &&
      this.accDist[c] <= Z.depth && Math.floor((this.accS[c] + off) / F) === slot;
    const cells = [seed], seen = new Set(cells);
    for (let q = 0; q < cells.length; q++) for (const n of this.neighbors4(cells[q])) {
      if (!seen.has(n) && ok(n)) { seen.add(n); cells.push(n); }
    }
    if (cells.length < 36) this.absorb(cells, zoneId, 70, Z.depth + 2);
    if (cells.length < 10) return null;
    return cells;
  }

  // Swallow adjacent free cells of the same zone — leftover triangles, slivers, corners.
  absorb(cells, zoneId, maxArea, depth) {
    const inSet = new Set(cells);
    for (let q = 0; q < cells.length && cells.length < maxArea; q++) for (const n of this.neighbors4(cells[q])) {
      if (cells.length >= maxArea) break;
      if (inSet.has(n) || !this.free(n) || this.zone[n] !== zoneId || this.accEdge[n] < 0 || this.accDist[n] > depth) continue;
      inSet.add(n); cells.push(n);
    }
    return cells;
  }

  adjacentBuildings(b) {
    const out = new Map();
    for (const c of b.cells) for (const n of this.neighbors4(c)) {
      const id = this.bld[n]; if (id && id !== b.id && !out.has(id)) out.set(id, this.buildings.get(id));
    }
    return out;
  }

  // Level a building up, merging compatible neighbours and leftover space.
  growBuilding(b, level) {
    const Z = ZONES[b.zone], maxA = MAX_AREA[Z.key][level];
    const cells = Array.from(b.cells); let occ = b.occ; const merged = [];
    const canMerge = level >= 3;
    if (canMerge) {
      const cands = [...this.adjacentBuildings(b).values()]
        .filter((n) => n && !n.svc && n.zone === b.zone && n.level <= b.level && n.district === b.district && !n.fire && !n.locked && ![...this.platforms.values()].some(p=>p.host===n.id) && !(n.constructionUntil > this.day))
        .sort((p, q) => p.area - q.area);
      for (const n of cands) {
        if (cells.length + n.area > maxA || this.rng() > 0.4) continue;
        for (const c of n.cells) cells.push(c);
        occ += n.abandoned ? 0 : n.occ; merged.push(n);
      }
    }
    for (const n of merged) this.removeBuilding(n.id);
    this.absorb(cells, b.zone, Math.min(maxA, cells.length + 50), Z.depth + 3);
    b.level = level; b.occ = occ; b.seed = (this.rng() * 1e9) | 0; b.built = this.day; b.low = 0;
    this.setCells(b, cells);
    return merged.length;
  }

  // natural woodland (from the terrain seed), used for forestry industry
  forestAt(x, z) { return fbm(x * 0.018, z * 0.018, this.seed + 9) > 0.55; }

  // A declining merged block breaks back into ordinary lots on its old cells.
  splitBuilding(b, level) {
    const key = ZONES[b.zone].key;
    if (b.svc || b.area <= MAX_AREA[key][Math.max(1, level)] * 1.2) return null;
    const cells = [...b.cells], occ = b.occ || 0, zone = b.zone;
    this.removeBuilding(b.id);
    const made = [];
    for (const c of cells) {
      if (!this.free(c) || this.zone[c] !== zone) continue;
      const lot = this.formLot(c, zone); if (!lot) continue;
      made.push(this.createBuilding({ zone, level: Math.max(1, level), cells: lot }));
    }
    for (const n of made) n.occ = Math.floor(occ / Math.max(1, made.length));
    return made;
  }

  // Sandbox: stamp a finished, level-locked building onto the zoned lot at (x, z).
  placeGrowable(x, z, level) {
    const c = Math.floor(z) * N + Math.floor(x), zone = this.zone[c];
    if (x < 0 || z < 0 || x >= N || z >= N || !zone) return { ok: false, err: 'Zone the ground first' };
    if (!this.free(c)) return { ok: false, err: 'Already built on' };
    if (this.accEdge[c] < 0) return { ok: false, err: 'No road access here' };
    const Z = ZONES[zone], lvl = Math.max(1, Math.min(level, Z.maxLevel));
    const cells = this.formLot(c, zone); if (!cells) return { ok: false, err: 'Not enough zoned space for a lot' };
    if (lvl >= 3) this.absorb(cells, zone, MAX_AREA[Z.key][lvl], Z.depth + 3);
    const b = this.createBuilding({ zone, level: lvl, cells, locked: true });
    return { ok: true, b, capped: lvl < level };
  }

  rebuildAt(b, level) {
    b.level = level; b.seed = (this.rng() * 1e9) | 0; b.built = this.day; b.low = 0;
    this.touchBuilding(b);
  }

  // ------------------------------------------------------------------ services
  // deck height: a chosen floor of the host, or just above its roof (level null)
  deckY(host, level) {
    const floors = buildingFloors(host, this);
    return level ? Math.min(level, floors) * FLOOR_H : floors * FLOOR_H + 8;
  }
  updatePlatforms() {
    for(const p of this.platforms.values()) {
      const host=this.buildings.get(p.host);if(!host)continue;
      const y=this.deckY(host, p.level);
      if(y!==p.y){p.y=y;this.platformVersion++;for(const b of this.buildings.values())if(b.platformId===p.id){b.baseY=y;this.touchBuilding(b);}}
    }
  }
  // expand: a deck id to widen (true = the host's first deck); level: host floor (null = above the roof)
  planPlatform(hostId, expand = false, level = null) {
    const host=this.buildings.get(hostId), decks=[...this.platforms.values()].filter(p=>p.host===hostId);
    const old = expand === true ? decks[0] : expand ? this.platforms.get(expand) : null;
    if(!technology(this.year).terraces)return {ok:false,err:'Terrace platforms unlock in 2025'};
    if(!host || host.svc || host.abandoned || host.constructionUntil>this.day)return {ok:false,err:'Select a completed, occupied-site building'};
    if(expand && !old)return {ok:false,err:'No terrace to expand'};
    const lvl = old ? old.level ?? null : level, floors = buildingFloors(host, this);
    if(lvl && (lvl < 1 || lvl > floors))return {ok:false,err:`Choose a floor between 1 and ${floors}`};
    const y=this.deckY(host, lvl);
    if(!old && decks.some(p=>Math.abs(p.y-y)<8))return {ok:false,err:'Another terrace is within five floors of this level'};
    const margin=(old?.margin || 0)+(old?4:3), x0=Math.floor(host.x0-margin),z0=Math.floor(host.z0-margin),x1=Math.ceil(host.x1+margin),z1=Math.ceil(host.z1+margin);
    if(margin>23)return {ok:false,err:'Maximum cantilever reached; start another terrace'};
    if(x0<0||z0<0||x1>N||z1>N)return {ok:false,err:'Platform would leave the map'};
    for(const p of this.platforms.values())if(p.id!==old?.id && p.host!==hostId && Math.abs(p.y-y)<8 && p.x0<x1&&p.x1>x0&&p.z0<z1&&p.z1>z0)return {ok:false,err:'Overlaps another terrace'};
    for(const b of this.buildings.values())if(b.id!==hostId&&!b.platformId&&b.x0<x1&&b.x1>x0&&b.z0<z1&&b.z1>z0 && (b.svc?12:buildingFloors(b,this)*FLOOR_H+5)>y)return {ok:false,err:'A neighbouring building blocks the platform at this height'};
    const area=(x1-x0)*(z1-z0),previous=old?(old.x1-old.x0)*(old.z1-old.z0):0;
    // lower decks need more structure per square metre than roof decks
    const perCell = lvl ? 12 + Math.max(0, floors - lvl) * 0.6 : 12;
    return {ok:true,host:hostId,id:old?.id,level:lvl,margin,x0,z0,x1,z1,y,cost:Math.round((area-previous)*perCell+(old?0:1500))};
  }
  buildPlatform(plan) {
    if(!plan?.ok)return null;
    const p={...plan,id:plan.id || this.platformId++};delete p.ok;delete p.cost;
    this.platforms.set(p.id,p);this.platformVersion++;return p;
  }
  planPlatformService(key,x,z,id) {
    const p=this.platforms.get(id),S=SERVICES[key];
    if(!p || !this.buildings.has(p.host))return {ok:false,err:'Platform no longer exists'};
    if(!TERRACE_SERVICES.includes(key))return {ok:false,err:'This service requires ground-level infrastructure'};
    const cx=Math.round(x),cz=Math.round(z),cells=[],x0=Math.floor(cx-S.w/2),x1=Math.ceil(cx+S.w/2),z0=Math.floor(cz-S.d/2),z1=Math.ceil(cz+S.d/2);
    if(x0<p.x0||x1>p.x1||z0<p.z0||z1>p.z1)return {ok:false,err:'Service must fit entirely on the platform'};
    for(let zz=z0;zz<z1;zz++)for(let xx=x0;xx<x1;xx++)cells.push(zz*N+xx);
    const occupied=new Set();for(const b of this.buildings.values())if(b.platformId===id)for(const c of b.cells)occupied.add(c);
    if(cells.some(c=>occupied.has(c)))return {ok:false,err:'Platform service already occupies this space'};
    return {ok:true,cells,cx,cz,fx:0,fz:1,tx:1,tz:0,platformId:id,y:p.y,cost:S.cost};
  }
  planService(key, x, z, platformId = 0) {
    if(platformId)return this.planPlatformService(key,x,z,platformId);
    const S = SERVICES[key];
    if (S.landmark && [...this.buildings.values()].some((b) => b.svc === key)) return { ok: false, err: 'Only one per city' };
    const h = this.net.nearestEdge(x, z, DEPTH + 8, (e) => !ROADS[e.type].noAccess);
    if (!h) return { ok: false, err: 'Needs a road nearby' };
    const e = h.e, p = this.net.sampleAt(e, h.s);
    const tx = p.tx, tz = p.tz; let fx = -tz, fz = tx;
    if ((x - p.x) * fx + (z - p.z) * fz < 0) { fx = -fx; fz = -fz; }
    const back = e.hw + 1 + S.d / 2;
    const cx = p.x + fx * back, cz = p.z + fz * back;
    const R = Math.hypot(S.w, S.d) / 2 + 1, cells = [];
    let bad = 0, minW = 1e9, wet = 0;
    for (let zz = Math.floor(cz - R); zz <= Math.ceil(cz + R); zz++) for (let xx = Math.floor(cx - R); xx <= Math.ceil(cx + R); xx++) {
      const px = xx + 0.5 - cx, pz = zz + 0.5 - cz;
      const u = px * tx + pz * tz, v = px * fx + pz * fz;
      if (Math.abs(u) > S.w / 2 || Math.abs(v) > S.d / 2) continue;
      if (!this.inside(xx, zz)) { bad++; continue; }
      const i = zz * N + xx;
      if (this.water[i]) wet++;
      if (this.road[i]) bad++;
      const ob = this.bld[i] && this.buildings.get(this.bld[i]);
      if (ob && ob.svc) bad++;
      minW = Math.min(minW, this.wdist[i]);
      cells.push(i);
    }
    let err = null;
    if (wet) err = 'Cannot build on water';
    else if (bad) err = 'Blocked by roads or buildings';
    else if (S.nearWater && minW > 9) err = 'Must touch the shoreline';
    return { ok: !err, err, cells, cx, cz, fx, fz, tx, tz, cost: S.cost };
  }

  placeService(key, plan) {
    if(plan.platformId)return this.createBuilding({svc:key,cells:plan.cells,cx:plan.cx,cz:plan.cz,fx:0,fz:1,platformId:plan.platformId});
    const kill = new Set();
    for (const c of plan.cells) if (this.bld[c]) kill.add(this.bld[c]);
    for (const id of kill) this.removeBuilding(id);
    // stored front vector points toward the street, same as growables
    return this.createBuilding({ svc: key, cells: plan.cells, cx: plan.cx, cz: plan.cz, fx: -plan.fx, fz: -plan.fz });
  }

  // ------------------------------------------------------------------ zoning
  canZone(i) { return !this.road[i] && !this.water[i] && this.accEdge[i] >= 0; }

  paintZone(x, z, r, zoneId) {
    const kill = new Set(); let n = 0;
    for (let zz = Math.floor(z - r); zz <= Math.ceil(z + r); zz++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (!this.inside(xx, zz) || Math.hypot(xx + 0.5 - x, zz + 0.5 - z) > r) continue;
      n += this.setZone(zz * N + xx, zoneId, kill);
    }
    for (const id of kill) this.removeBuilding(id);
    if (n) { this.markGround(x - r - 1, z - r - 1, x + r + 1, z + r + 1); this.zoneVersion++; }
    return n;
  }

  setZone(i, zoneId, kill) {
    if (zoneId && !this.canZone(i)) return 0;
    const b = this.bld[i] && this.buildings.get(this.bld[i]);
    if (b && b.svc) return 0;
    if (this.zone[i] === zoneId) return 0;
    if (this.tx && !this.tx.zone.has(i)) this.tx.zone.set(i, this.zone[i]);
    this.zone[i] = zoneId;
    if (b && b.zone !== zoneId) kill.add(b.id);
    return 1;
  }

  // Paint-bucket: fill the closed, road-bounded block under the cursor. If the
  // land is open (not enclosed by roads), fill just that street frontage.
  fillZone(x, z, zoneId) {
    const s = this.cellAt(x, z); if (s < 0 || this.road[s] || this.water[s]) return 0;
    const LIM = 30000, flood = (pass) => {
      const q = [s], seen = new Set(q);
      for (let k = 0; k < q.length && q.length < LIM; k++) for (const nb of this.neighbors4(q[k])) if (!seen.has(nb) && pass(nb)) { seen.add(nb); q.push(nb); }
      return q;
    };
    let cells = flood((i) => !this.road[i] && !this.water[i]);
    if (cells.length >= LIM) {
      const e = this.accEdge[s], side = this.accSide[s]; if (e < 0) return 0;
      cells = flood((i) => this.accEdge[i] === e && this.accSide[i] === side);
    }
    const kill = new Set();
    let x0 = N, z0 = N, x1 = 0, z1 = 0, n = 0;
    for (const i of cells) {
      if (zoneId ? this.accEdge[i] < 0 : !this.zone[i]) continue;
      n += this.setZone(i, zoneId, kill);
      const xx = i % N, zz = (i / N) | 0; x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); z0 = Math.min(z0, zz); z1 = Math.max(z1, zz);
    }
    for (const id of kill) this.removeBuilding(id);
    if (n) { this.markGround(x0, z0, x1 + 1, z1 + 1); this.zoneVersion++; }
    return n;
  }

  // ------------------------------------------------------------------ districts
  newDistrict() {
    const id = this.districts.length; if (id >= DISTRICT_COLORS.length) return null;
    const r = this.rng;
    const nm = SYL[(r() * SYL.length) | 0] + SYL[(r() * SYL.length) | 0] + SUF[(r() * SUF.length) | 0];
    const d = { id, name: nm[0].toUpperCase() + nm.slice(1), policy: { tax: { R: 0, C: 0, I: 0, O: 0 }, maxLevel: 5, maxFloors: 0, priority: 'balanced', green: false, historic: false, carFree: false } };
    this.districts.push(d);
    return d;
  }

  paintDistrict(x, z, r, id) {
    for (let zz = Math.floor(z - r); zz <= Math.ceil(z + r); zz++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (!this.inside(xx, zz) || Math.hypot(xx + 0.5 - x, zz + 0.5 - z) > r) continue;
      const i = zz * N + xx; if (this.water[i] || this.district[i] === id) continue;
      if (this.tx && !this.tx.district.has(i)) this.tx.district.set(i, this.district[i]);
      this.district[i] = id;
    }
    this.districtVersion++;
    this.markGround(x - r - 2, z - r - 2, x + r + 2, z + r + 2);
    for (const b of this.buildings.values()) {
      if (b.x1 < x - r || b.x0 > x + r || b.z1 < z - r || b.z0 > z + r) continue;
      const ci = this.cellAt(b.cx, b.cz); b.district = ci >= 0 ? this.district[ci] : 0;
    }
  }

  policyAt(b) { return (b.district && this.districts[b.district]?.policy) || null; }

  // ------------------------------------------------------------------ undo
  // A transaction records what a single player action changed: the road network
  // (as a compact snapshot), zone / district / water cells, buildings removed and
  // created. Simulation changes run with txMute set and are never recorded.
  beginTx(label, { net = false } = {}) {
    this.tx = { label, platforms: JSON.stringify([...this.platforms.values()]), lines: JSON.stringify(this.lines), zone: new Map(), district: new Map(), water: new Map(), levees: new Map(), removed: new Map(), created: new Set(), net: net ? this.netState() : null, money: 0 };
  }
  commitTx(money = 0) {
    const t = this.tx; this.tx = null;
    if (!t) return null;
    t.money = money;
    const netChanged = t.net && t.net.version !== this.net.version;
    if (t.platforms === JSON.stringify([...this.platforms.values()]) && t.lines === JSON.stringify(this.lines) && !netChanged && !t.zone.size && !t.district.size && !t.water.size && !t.levees.size && !t.removed.size && !t.created.size) return null;
    this.undoStack.push(t);
    if (this.undoStack.length > 40) this.undoStack.shift();
    return t;
  }

  netState() {
    const net = this.net;
    return {
      version: net.version, nid: net.nid, eid: net.eid,
      nodes: [...net.nodes.values()].map((n) => [n.id, n.x, n.z, n.outside, n.control]),
      edges: [...net.edges.values()].map((e) => [e.id, e.a, e.b, e.c.x, e.c.z, e.type, e.cond, e.oneway || 0, e.flow || 0, e.layer || 0, e.busLane ? 1 : 0]),
    };
  }

  restoreNet(st) {
    const net = this.net, keep = new Set(st.edges.map((e) => e[0]));
    net.tbb = null;
    for (const e of [...net.edges.values()]) if (!keep.has(e.id)) net.removeEdge(e.id);
    for (const e of net.edges.values()) {
      const o = st.edges.find((x) => x[0] === e.id);
      e.busLane = !!o[10];
      if (o[5] !== e.type || o[7] !== e.oneway || o[9] !== (e.layer || 0)) { net.touch(e.bb); e.type = o[5]; e.oneway = o[7]; e.layer = o[9]; net.tess(e); net.touch(e.bb); }
    }
    for (const [id, x, z, out, ctl] of st.nodes) { if (!net.nodes.has(id)) net.addNode(x, z, out, id); net.nodes.get(id).control = ctl || 'auto'; }
    for (const [id, a, b, cx, cz, type, cond, ow, flow, layer, lane] of st.edges) {
      if (net.edges.has(id)) continue;
      const e = net.addEdge(net.nodes.get(a), net.nodes.get(b), { x: cx, z: cz }, type, cond, id);
      e.oneway = ow; e.flow = flow; e.layer = layer || 0; e.busLane = !!lane;
    }
    for (const n of [...net.nodes.values()]) if (!n.edges.size && !n.outside) net.nodes.delete(n.id);
    net.nid = Math.max(net.nid, st.nid); net.eid = Math.max(net.eid, st.eid); net.version++;
    if (net.tbb) this.onRoadsChanged(net.tbb);
  }

  undo() {
    const t = this.undoStack.pop(); if (!t) return null;
    const prevMute = this.txMute; this.txMute = true;
    for (const id of t.created) this.removeBuilding(id);
    if(t.levees?.size){for(const [i,v] of t.levees)this.levees[i]=v;this.leveeVersion=(this.leveeVersion||0)+1;this.markGround(0,0,N,N);}
    if (t.water.size) { for (const [i, v] of t.water) this.water[i] = v; this.pendingTerrain = true; }
    if (t.net) this.restoreNet(t.net);
    if (t.water.size) this.finishTerrain();
    this.platforms=new Map(JSON.parse(t.platforms || '[]').map(p=>[p.id,p]));this.platformVersion++;
    if (t.lines) { this.lines = JSON.parse(t.lines); this.lineVersion++; }
    let x0 = N, z0 = N, x1 = 0, z1 = 0;
    const grow = (i) => { const x = i % N, z = (i / N) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; };
    for (const [i, v] of t.zone) { if (!this.road[i] && !this.water[i]) this.zone[i] = v; grow(i); }
    for (const [i, v] of t.district) { this.district[i] = v; grow(i); }
    if (t.district.size) { this.districtVersion++; for (const b of this.buildings.values()) { const ci = this.cellAt(b.cx, b.cz); b.district = ci >= 0 ? this.district[ci] : 0; } }
    // growables that now sit on a different zone go, as they would when rezoning
    const bad = new Set();
    for (const i of t.zone.keys()) { const b = this.bld[i] && this.buildings.get(this.bld[i]); if (b && !b.svc && b.zone !== this.zone[i]) bad.add(b.id); }
    for (const id of bad) this.removeBuilding(id);
    for (const p of t.removed.values()) {
      if(p.platformId){this.createBuilding(p,p.id);continue;}
      if (p.cells.some((c) => this.road[c] || this.water[c])) continue;
      const clash = new Set(); for (const c of p.cells) if (this.bld[c]) clash.add(this.bld[c]);
      for (const id of clash) { const o = this.buildings.get(id); if (o && !o.svc) this.removeBuilding(id); }
      if (p.cells.some((c) => this.bld[c])) continue;
      this.createBuilding(p, p.id);
      for (const c of p.cells) grow(c);
    }
    if (x1 >= x0) this.markGround(x0, z0, x1 + 1, z1 + 1);
    this.zoneVersion++;
    for(const b of this.buildings.values())if(b.platformId)this.refreshAccess(b);
    this.txMute = prevMute;
    return t;
  }

  packBuilding(b, compact = true) {
    const enc = (cells) => { const s = Array.from(cells).sort((a, b2) => a - b2), d = []; let p = 0; for (const c of s) { d.push(c - p); p = c; } return rleEncode(d); };
    return {
      id: b.id, platformId: b.platformId || 0, heightYear: b.heightYear, zone: b.zone, svc: b.svc, level: b.level, seed: b.seed, occ: Math.round(b.occ), built: b.built,
      abandoned: b.abandoned, abDays: b.abDays, garb: Math.round(b.garb), locked: !!b.locked, constructionUntil: b.constructionUntil || 0, spec: b.spec || null,
      cells: compact ? enc(b.cells) : Array.from(b.cells),
      ...(b.svc ? { cx: b.cx, cz: b.cz, fx: b.fx, fz: b.fz } : {}),
    };
  }

  // ------------------------------------------------------------------ save / load
  serialize() {
    return {
      mapPreset: this.mapPreset, levees: rleEncode(this.levees), hazards: this.hazards, seed: this.seed, bid: this.bid, year: this.year, platformId: this.platformId, platforms: [...this.platforms.values()],
      nodes: [...this.net.nodes.values()].map((n) => [n.id, +n.x.toFixed(2), +n.z.toFixed(2), n.outside ? 1 : 0, n.control || 'auto']),
      edges: [...this.net.edges.values()].map((e) => [e.id, e.a, e.b, +e.c.x.toFixed(2), +e.c.z.toFixed(2), e.type, +e.cond.toFixed(3), e.oneway || 0, e.layer || 0, e.busLane ? 1 : 0]),
      lines: this.lines, lineId: this.lineId,
      zone: rleEncode(this.zone), district: rleEncode(this.district),
      ...(this.terrainEdited ? { water: rleEncode(this.water) } : {}),
      districts: this.districts,
      buildings: [...this.buildings.values()].map((b) => this.packBuilding(b)),
    };
  }

  static load(d) {
    const w = new World(d.seed, d.mapPreset || 'river');
    w.year=d.year || 2000;w.platforms=new Map((d.platforms || []).map(p=>[p.id,p]));w.platformId=d.platformId || 1;
    w.genTerrain();
    if(d.levees)w.levees=rleDecode(d.levees,Uint8Array,N*N);
    if(d.hazards)w.hazards={...w.hazards,...d.hazards};
    if (d.water) {
      w.water = rleDecode(d.water, Uint8Array, N * N);
      for (let i = 0; i < N * N; i++) if (w.water[i]) w.tree[i] = 0;
      w.recomputeWaterDistance(); w.terrainEdited = true;
    }
    for (const [id, x, z, o, ctl] of d.nodes) w.net.addNode(x, z, !!o, id).control = ctl || 'auto';
    for (const [id, a, b, cx, cz, type, cond, ow, layer, lane] of d.edges) {
      const e = w.net.addEdge(w.net.nodes.get(a), w.net.nodes.get(b), { x: cx, z: cz }, type, cond, id);
      e.oneway = ow || 0; e.layer = layer || 0; e.busLane = !!lane;
    }
    roadProfile(w);
    w.lines = d.lines || []; w.lineId = d.lineId || 1;
    w.rasterRegion(0, 0, N - 1, N - 1);
    w.zone = rleDecode(d.zone, Uint8Array, N * N);
    w.district = rleDecode(d.district, Uint8Array, N * N);
    w.districts = d.districts;
    for (const b of d.buildings) {
      let len = 0; for (let i = 1; i < b.cells.length; i += 2) len += b.cells[i];
      const deltas = rleDecode(b.cells, Int32Array, len);
      const cells = []; let p = 0; for (const dd of deltas) { p += dd; cells.push(p); }
      w.createBuilding({ ...b, cells }, b.id);
    }
    for(const b of w.buildings.values())if(b.platformId)w.refreshAccess(b);
    w.bid = Math.max(w.bid, d.bid);
    return w;
  }
}
