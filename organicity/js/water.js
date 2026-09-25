// Organicity — moving water. Which way the water flows and how fast (rivers run toward the
// sea, a lake or the downstream map edge, open water barely drifts), and routes for boats
// over a coarse water grid. Pure: no DOM, no three.js. Used by the renderer's water shader,
// the river boats, harbour ships and ferries.
import { N } from './config.js';
import { clamp, hash2 } from './util.js';

// ---------------------------------------------------------------- the flow field
// On a S×S grid: a unit flow direction (fx, fz) and a speed 0..1 per water cell.
export function flowField(w, S = 128) {
  const k = N / S, n = S * S, wet = new Uint8Array(n), open = new Uint8Array(n);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) wet[j * S + i] = w.water[Math.min(N - 1, (j * k + k / 2) | 0) * N + Math.min(N - 1, (i * k + k / 2) | 0)];
  // open water: most of the 9×9 cells around are water (sea, lakes); channels are rivers
  const frac = new Float32Array(n);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    if (!wet[j * S + i]) continue; let c = 0, t = 0;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= S || b >= S) continue; t++; c += wet[b * S + a]; }
    frac[j * S + i] = c / t; open[j * S + i] = c / t > 0.8 ? 1 : 0;
  }
  // where the water goes, per connected body of water: its open water if it has any, else the
  // map edge it leaves by (one side, chosen from the seed); a lake with neither stays still
  const comp = new Int32Array(n).fill(-1), outlets = [], stack = [];
  for (let c0 = 0; c0 < n; c0++) {
    if (!wet[c0] || comp[c0] >= 0) continue;
    const id = c0, cells = []; comp[c0] = id; stack.push(c0);
    while (stack.length) { const c = stack.pop(); cells.push(c); const i = c % S, j = (c / S) | 0; for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) { if (a < 0 || b < 0 || a >= S || b >= S) continue; const d = b * S + a; if (wet[d] && comp[d] < 0) { comp[d] = id; stack.push(d); } } }
    const opens = cells.filter((c) => open[c]);
    if (opens.length) { outlets.push(...opens); continue; }
    const sides = { west: [], east: [], north: [], south: [] };
    for (const c of cells) { const i = c % S, j = (c / S) | 0; if (i === 0) sides.west.push(c); if (i === S - 1) sides.east.push(c); if (j === 0) sides.north.push(c); if (j === S - 1) sides.south.push(c); }
    const cand = Object.entries(sides).filter(([, v]) => v.length);
    if (cand.length) { cand.sort(([a], [b]) => hash2(w.seed + id, b.length, 71) - hash2(w.seed + id, a.length, 71)); outlets.push(...cand[0][1]); }
  }
  // distance along the water to an outlet; the flow runs down that distance
  const D = new Float32Array(n).fill(Infinity), q = new Int32Array(n); let h = 0, tl = 0;
  for (const c of outlets) { D[c] = 0; q[tl++] = c; }
  while (h < tl) {
    const c = q[h++], i = c % S, j = (c / S) | 0;
    for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      if (a < 0 || b < 0 || a >= S || b >= S) continue; const d = b * S + a;
      if (!wet[d] || D[d] <= D[c] + 1) continue; D[d] = D[c] + 1; q[tl++] = d;
    }
  }
  let fx = new Float32Array(n), fz = new Float32Array(n);
  const speed = new Float32Array(n);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const c = j * S + i; if (!wet[c] || !Number.isFinite(D[c])) continue;
    let gx = 0, gz = 0;
    for (const [a, b, dx, dz] of [[i - 1, j, -1, 0], [i + 1, j, 1, 0], [i, j - 1, 0, -1], [i, j + 1, 0, 1]]) {
      const d = a < 0 || b < 0 || a >= S || b >= S ? c : b * S + a, v = wet[d] && Number.isFinite(D[d]) ? D[d] : D[c] + 1;
      gx += (D[c] - v) * dx; gz += (D[c] - v) * dz;
    }
    const l = Math.hypot(gx, gz) || 1; fx[c] = gx / l; fz[c] = gz / l;
    speed[c] = open[c] ? 0.1 : clamp(1.35 - frac[c] * 1.3, 0.25, 1);
  }
  // smooth the directions so the current bends with the banks
  for (let pass = 0; pass < 3; pass++) {
    const nx = new Float32Array(n), nz = new Float32Array(n);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const c = j * S + i; if (!wet[c]) continue; let sx = 0, sz = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= S || b >= S) continue; const d = b * S + a; if (wet[d]) { sx += fx[d]; sz += fz[d]; } }
      const l = Math.hypot(sx, sz) || 1; nx[c] = sx / l; nz[c] = sz / l;
    }
    fx = nx; fz = nz;
  }
  return { S, fx, fz, speed, wet, open };
}
// the current at a world point
export function flowAt(F, x, z) {
  const i = clamp((x / N * F.S) | 0, 0, F.S - 1), j = clamp((z / N * F.S) | 0, 0, F.S - 1), c = j * F.S + i;
  return F.wet[c] ? { x: F.fx[c], z: F.fz[c], speed: F.speed[c], open: !!F.open[c] } : null;
}
// RGBA bytes for the shader: direction in R/G, speed in B
export function flowTexture(F) {
  const out = new Uint8Array(F.S * F.S * 4);
  for (let c = 0; c < F.S * F.S; c++) { out[c * 4] = (F.fx[c] * 0.5 + 0.5) * 255; out[c * 4 + 1] = (F.fz[c] * 0.5 + 0.5) * 255; out[c * 4 + 2] = F.speed[c] * 255; out[c * 4 + 3] = F.wet[c] * 255; }
  return out;
}

// ---------------------------------------------------------------- routes for boats
// Breadth-first search over a 4-cell water grid (fine enough for narrow rivers), from (ax, az) to the nearest of the targets
// (points, or 'edge' for water at the map edge). Returns world points, or null.
export function waterRoute(w, ax, az, target, G = 4) {
  const S = N / G, n = S * S;
  if (w._boatGrid?.v !== w.terrainVersion) {
    const g = new Uint8Array(n);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { let c = 0, t = 0; for (let dz = 1; dz < G; dz += 2) for (let dx = 1; dx < G; dx += 2) { c += w.water[(j * G + dz) * N + i * G + dx]; t++; } g[j * S + i] = c * 2 > t ? 1 : 0; }
    w._boatGrid = { v: w.terrainVersion, wet: g };
  }
  const grid = w._boatGrid.wet;
  // start from the nearest water cell to a point
  const near = (x, z) => { let best = -1, bd = 1e9; const ci = clamp((x / G) | 0, 0, S - 1), cj = clamp((z / G) | 0, 0, S - 1); for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) { const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= S || b >= S || !grid[b * S + a]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = b * S + a; } } return best; };
  const s = near(ax, az); if (s < 0) return null;
  const goal = new Set();
  if (target === 'edge') { for (let t = 0; t < S; t++) for (const c of [t * S, t * S + S - 1, t, (S - 1) * S + t]) if (grid[c]) goal.add(c); }
  else for (const p of target) { const c = near(p.x, p.z); if (c >= 0) goal.add(c); }
  if (!goal.size) return null;
  const prev = new Int32Array(n).fill(-2); prev[s] = -1; const q = [s];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (goal.has(c)) { const path = []; for (let x = c; x >= 0; x = prev[x]) path.push({ x: (x % S) * G + G / 2, z: ((x / S) | 0) * G + G / 2 }); path.reverse(); return smooth(path); }
    const i = c % S, j = (c / S) | 0;
    for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1], [i - 1, j - 1], [i + 1, j + 1], [i - 1, j + 1], [i + 1, j - 1]]) {
      if (a < 0 || b < 0 || a >= S || b >= S) continue; const d = b * S + a;
      if (!grid[d] || prev[d] !== -2) continue;
      if (a !== i && b !== j && (!grid[j * S + a] || !grid[b * S + i])) continue;   // no cutting corners across land
      prev[d] = c; q.push(d);
    }
  }
  return null;
}
function smooth(p) {
  if (p.length < 3) return p;
  let out = p;
  for (let k = 0; k < 3; k++) { const s = [out[0]]; for (let i = 1; i < out.length - 1; i++) s.push({ x: (out[i - 1].x + out[i].x * 2 + out[i + 1].x) / 4, z: (out[i - 1].z + out[i].z * 2 + out[i + 1].z) / 4 }); s.push(out[out.length - 1]); out = s; }
  return out;
}
// length of a route, and a point and heading along it
export function routeLen(r) { let L = 0; for (let i = 1; i < r.length; i++) L += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z); return L; }
export function routeAt(r, s) {
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i], l = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= l || i === r.length - 1) { const t = l ? clamp(s / l, 0, 1) : 0; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, hx: (b.x - a.x) / (l || 1), hz: (b.z - a.z) / (l || 1) }; }
    s -= l;
  }
  return { x: r[0].x, z: r[0].z, hx: 1, hz: 0 };
}
// ferry piers pair up with the nearest other pier they can reach by water
export function ferryPairs(w, piers) {
  const pairs = [], used = new Set();
  for (const a of piers) {
    if (used.has(a.id)) continue;
    const others = piers.filter((b) => b.id !== a.id && !used.has(b.id) && Math.hypot(b.cx - a.cx, b.cz - a.cz) < 320).sort((p, q) => Math.hypot(p.cx - a.cx, p.cz - a.cz) - Math.hypot(q.cx - a.cx, q.cz - a.cz));
    for (const b of others) { const r = waterRoute(w, a.cx, a.cz, [{ x: b.cx, z: b.cz }]); if (r && r.length > 1) { pairs.push({ a: a.id, b: b.id, route: r }); used.add(a.id); used.add(b.id); break; } }
  }
  return pairs;
}
