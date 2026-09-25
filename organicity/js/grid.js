// Organicity — utility grids. Roads carry power, water and sewage along them as before; the
// power lines, water pipes and drains a player draws join separate road networks (and each
// other) into one grid per utility, so a plant, pump or outlet out of town can serve it.
// Under the strict grid rule a building must also sit within reach of a line of each kind.
// Pure: no DOM, no three.js; cached per road-network and line version.
import { ULINES, N } from './config.js';
import { segNearest } from './world.js';

export const UKINDS = { p: 'power', w: 'water', s: 'sewer' };

function unionFind() {
  const P = new Map();
  const find = (k) => { if (!P.has(k)) { P.set(k, k); return k; } let r = k; while (P.get(r) !== r) r = P.get(r); let q = k; while (P.get(q) !== r) { const n = P.get(q); P.set(q, r); q = n; } return r; };
  return { find, join: (a, b) => { a = find(a); b = find(b); if (a !== b) P.set(a, b); } };
}

export function utilityGrid(w) {
  const key = `${w.net.version}:${w.ulineVersion || 0}`;
  if (w._grid?.key === key) return w._grid;
  const net = w.net, compNear = (x, z, r) => { const h = net.nearestEdge(x, z, r); return h ? net.compOf(h.e) : -1; };
  const uf = {}, lines = {}, touch = { power: new Map(), water: new Map(), sewer: new Map() };
  for (const kind of Object.values(UKINDS)) {
    const u = (uf[kind] = unionFind()), ls = (lines[kind] = (w.ulines || []).filter((l) => l.kind === kind));
    for (const l of ls) {
      u.find('l' + l.id);
      const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), n = Math.max(1, Math.ceil(len / 6));
      for (let k = 0; k <= n; k++) {   // any road the line reaches or crosses (its ends reach a little further)
        const t = k / n, end = k === 0 || k === n, c = compNear(l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t, end ? 8 : 3);
        if (c >= 0) { u.join('l' + l.id, 'c' + c); const t = touch[kind].get(c) || new Set(); t.add(l.id); touch[kind].set(c, t); }
      }
    }
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {   // runs that meet join up
      const A = ls[i], B = ls[j];
      if (segNearest(A, ...B.a).d < 2.5 || segNearest(A, ...B.b).d < 2.5 || segNearest(B, ...A.a).d < 2.5 || segNearest(B, ...A.b).d < 2.5) u.join('l' + A.id, 'l' + B.id);
    }
  }
  const served = new Map();
  w._grid = {
    key,
    root: (kind, k) => uf[kind].find(k),
    // the line of this kind that serves a building (strict rule), or null
    line(kind, b) {
      const ck = kind + b.id; if (served.has(ck)) return served.get(ck);
      let best = null, bd = ULINES[kind].reach;
      for (const l of lines[kind]) { const d = segNearest(l, b.cx, b.cz).d; if (d <= bd) { bd = d; best = l.id; } }
      served.set(ck, best); return best;
    },
    // where a building draws from: its road network, or under the strict rule the line beside it
    node(kind, b, strict) {
      if (!strict || b.svc) return b.comp < 0 ? null : 'c' + b.comp;
      const id = this.line(kind, b); return id == null ? null : 'l' + id;
    },
    // lines of a kind touching a road network, and how much a node can import through them
    touching: (kind, comp) => touch[kind].get(comp) || new Set(),
    capacity(kind, key, boost = 0) {
      if (key[0] === 'l') return ULINES[kind].cap;
      return [...(touch[kind].get(+key.slice(1)) || [])].length * ULINES[kind].cap + boost;
    },
  };
  return w._grid;
}

// monthly upkeep of every line, and total length per kind
export function lineStats(w) {
  const len = { power: 0, water: 0, sewer: 0 }; let upkeep = 0;
  for (const l of w.ulines || []) { const d = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]); len[l.kind] += d; upkeep += d * ULINES[l.kind].upkeep; }
  return { len, upkeep };
}

// cells within reach of a pipe or drain (for the underground view), cached per line version
export function coverageMask(w, kind) {
  const key = `${kind}:${w.ulineVersion || 0}`; w._cov ||= {};
  if (w._cov[kind]?.key === key) return w._cov[kind].m;
  const m = new Uint8Array(N * N), r = ULINES[kind].reach;
  for (const l of w.ulines || []) {
    if (l.kind !== kind) continue;
    const x0 = Math.max(0, Math.floor(Math.min(l.a[0], l.b[0]) - r)), x1 = Math.min(N - 1, Math.ceil(Math.max(l.a[0], l.b[0]) + r));
    const z0 = Math.max(0, Math.floor(Math.min(l.a[1], l.b[1]) - r)), z1 = Math.min(N - 1, Math.ceil(Math.max(l.a[1], l.b[1]) + r));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (!m[z * N + x] && segNearest(l, x + 0.5, z + 0.5).d <= r) m[z * N + x] = 1;
  }
  w._cov[kind] = { key, m }; return m;
}
// the flat level of the underground network: below the lowest ground on the map
export function undergroundY(w) {
  if (w._underY?.v === (w.gradeVersion || 0) + ':' + (w.terrainVersion || 0)) return w._underY.y;
  let lo = 0; for (let i = 0; i < w.elevation.length; i += 7) if (w.elevation[i] < lo) lo = w.elevation[i];
  const y = Math.min(-3, lo - 6); w._underY = { v: (w.gradeVersion || 0) + ':' + (w.terrainVersion || 0), y }; return y;
}
