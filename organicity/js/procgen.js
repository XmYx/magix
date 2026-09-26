import { wasteCapacity } from './waste.js';
// Organicity — procedural buildings. Every growable building is generated from
// the exact cells of its lot: the mask is traced into polygons (with holes for
// courtyards), simplified so staircase edges become true diagonals/curves, and
// extruded into chunky modular masses. Output is raw per-material vertex arrays
// that the renderer merges per chunk.
import { buildingFloors, technology, massPlan } from './eras.js';
import * as THREE from 'three';
import { N, FLOOR_H, BAY_W, ZONES, FLOORS, SERVICES, STYLES } from './config.js';
import { traceMask, simplifyLoop, erodeMask, polyArea, mulberry32 } from './util.js';

export const TEX_U = BAY_W * 2, TEX_V = FLOOR_H * 2;
const L = (v) => Math.pow(v / 255, 2.2);
export const rgb = (r, g, b) => [L(r), L(g), L(b)];
export const hex = (h) => rgb((h >> 16) & 255, (h >> 8) & 255, h & 255);
const pick = (r, a) => a[(r() * a.length) | 0];

const PAL = {
  rl:   [0xf2e6cf, 0xe9d3b0, 0xd9e4ea, 0xf0d7d0, 0xdfe8cf, 0xf5f0e6, 0xc9d6e3],
  rl3:  [0xb8674d, 0xc98a5e, 0xd9b48a, 0x9c5a44, 0xcfc2a8],
  rh:   [0xc47a5a, 0xd8b58c, 0xe8dcc4, 0xa9b8c4, 0xcf9f7a, 0xbfae9a, 0xe0c8a0],
  c:    [0xf4f1ea, 0xd7e8f0, 0xf2e3b8, 0xbfe0da, 0xe8d0d8],
  o:    [0x9fb8d0, 0x7f9fb8, 0xb8c8d0, 0x8fb0b0, 0xc8b89a],
  m:    [0xc98262, 0xe0bd96, 0xd8a08a, 0xbca48c, 0xe8d6b8],
  i:    [0xb0b0a8, 0xc8c4b8, 0x9aa89a, 0xb89a80, 0xa8b4bc],
  roof: [0xa24a3a, 0x7a4a3a, 0x5a6a7a, 0x8a3a30, 0x6a5a4a, 0x4a5a6a],
  flat: [0xb8b4ac, 0xa8a49c, 0xc4c0b4, 0x989890],
  shop: [0xd84a3a, 0x3a8ad8, 0x2aa86a, 0xe8a030, 0x9a4ad8, 0xe06a9a],
  leaf: [0x4f9a3a, 0x3f8a3a, 0x68a83e, 0x2f7a3a, 0x7ab04a],
};

class Parts {
  constructor() { this.g = {}; this.emit = []; this.extras = []; this.top = 0; }
  get(k) { return this.g[k] || (this.g[k] = { p: [], n: [], u: [], c: [] }); }
}

function vtx(P, a, n, uv, c) { P.p.push(a[0], a[1], a[2]); P.n.push(n[0], n[1], n[2]); P.u.push(uv[0], uv[1]); P.c.push(c[0], c[1], c[2]); }
function normal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
const Z2 = [0, 0];
// triangle, flipped if needed so it faces away from `ref`
function triOut(P, a, b, c, ref, col, ua = Z2, ub = Z2, uc = Z2) {
  let n = normal(a, b, c);
  if (n[0] * (a[0] - ref[0]) + n[1] * (a[1] - ref[1]) + n[2] * (a[2] - ref[2]) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; n = [-n[0], -n[1], -n[2]]; }
  vtx(P, a, n, ua, col); vtx(P, b, n, ub, col); vtx(P, c, n, uc, col);
}
function quadOut(P, a, b, c, d, ref, col, ua, ub, uc, ud) {
  triOut(P, a, b, c, ref, col, ua, ub, uc); triOut(P, a, c, d, ref, col, ua, uc, ud);
}

// oriented box in a (t, f) frame. `key` material gets facade UVs.
function box(P, key, F, u, v, y0, hu, hv, h, col, topCol) {
  const G = P.get(key), T = P.get('plain');
  const pt = (uu, vv) => [F.cx + F.tx * uu + F.fx * vv, 0, F.cz + F.tz * uu + F.fz * vv];
  const y1 = y0 + h, ctr = pt(u, v), ref = [ctr[0], y0 + h / 2, ctr[2]];
  const c = [pt(u - hu, v - hv), pt(u + hu, v - hv), pt(u + hu, v + hv), pt(u - hu, v + hv)];
  const wu = [2 * hu, 2 * hv, 2 * hu, 2 * hv];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], U = wu[i] / TEX_U, V0 = y0 / TEX_V, V1 = y1 / TEX_V;
    quadOut(G, [a[0], y0, a[2]], [b[0], y0, b[2]], [b[0], y1, b[2]], [a[0], y1, a[2]], ref, col, [0, V0], [U, V0], [U, V1], [0, V1]);
  }
  quadOut(T, [c[0][0], y1, c[0][2]], [c[1][0], y1, c[1][2]], [c[2][0], y1, c[2][2]], [c[3][0], y1, c[3][2]], ref, topCol || col, Z2, Z2, Z2, Z2);
  P.top = Math.max(P.top, y1);
}
// pitched roofs on a box (u across, v along the frame): gable (ridge along the longer side),
// hip, pyramid, dome and spire
function roofShape(P, F, u, v, y0, hu, hv, h, shape, col) {
  const G = P.get('plain'), pt = (uu, vv, y) => [F.cx + F.tx * (u + uu) + F.fx * (v + vv), y, F.cz + F.tz * (u + uu) + F.fz * (v + vv)], ref = pt(0, 0, y0 - 1);
  const a = pt(-hu, -hv, y0), b = pt(hu, -hv, y0), c = pt(hu, hv, y0), d = pt(-hu, hv, y0), top = y0 + h;
  if (shape === 'dome' || shape === 'spire') {
    const rings = shape === 'dome' ? 5 : 4, r0 = Math.min(hu, hv);
    for (let i = 0; i < rings; i++) { const t = i / rings, r = shape === 'dome' ? r0 * Math.cos(t * Math.PI / 2) : r0 * (1 - t) * 0.9 + 0.1; cyl(P, F, u, v, y0 + (shape === 'dome' ? Math.sin(t * Math.PI / 2) * h : t * h), r, h / rings + 0.05, 10, col, col); }
    return;
  }
  const alongU = hu >= hv;
  if (shape === 'gable') {
    const r1 = alongU ? pt(-hu, 0, top) : pt(0, -hv, top), r2 = alongU ? pt(hu, 0, top) : pt(0, hv, top);
    if (alongU) { quadOut(G, a, b, r2, r1, ref, col, Z2, Z2, Z2, Z2); quadOut(G, d, c, r2, r1, ref, col, Z2, Z2, Z2, Z2); triOut(G, a, d, r1, ref, col); triOut(G, b, c, r2, ref, col); }
    else { quadOut(G, a, d, r2, r1, ref, col, Z2, Z2, Z2, Z2); quadOut(G, b, c, r2, r1, ref, col, Z2, Z2, Z2, Z2); triOut(G, a, b, r1, ref, col); triOut(G, d, c, r2, ref, col); }
  } else {   // hip and pyramid
    const k = shape === 'pyramid' ? 0 : Math.abs(hu - hv), r1 = alongU ? pt(-k, 0, top) : pt(0, -k, top), r2 = alongU ? pt(k, 0, top) : pt(0, k, top);
    if (alongU) { quadOut(G, a, b, r2, r1, ref, col, Z2, Z2, Z2, Z2); quadOut(G, d, c, r2, r1, ref, col, Z2, Z2, Z2, Z2); triOut(G, a, d, r1, ref, col); triOut(G, b, c, r2, ref, col); }
    else { quadOut(G, a, d, r2, r1, ref, col, Z2, Z2, Z2, Z2); quadOut(G, b, c, r2, r1, ref, col, Z2, Z2, Z2, Z2); triOut(G, a, b, r1, ref, col); triOut(G, d, c, r2, ref, col); }
  }
  P.top = Math.max(P.top, top);
}
function cyl(P, F, u, v, y0, r, h, seg, col, topCol) {
  const G = P.get('plain');
  const cx = F.cx + F.tx * u + F.fx * v, cz = F.cz + F.tz * u + F.fz * v, y1 = y0 + h, ref = [cx, y0 + h / 2, cz];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const A = [cx + Math.cos(a0) * r, 0, cz + Math.sin(a0) * r], B = [cx + Math.cos(a1) * r, 0, cz + Math.sin(a1) * r];
    quadOut(G, [A[0], y0, A[2]], [B[0], y0, B[2]], [B[0], y1, B[2]], [A[0], y1, A[2]], ref, col, Z2, Z2, Z2, Z2);
    triOut(G, [cx, y1, cz], [A[0], y1, A[2]], [B[0], y1, B[2]], [cx, y0, cz], topCol || col);
  }
  P.top = Math.max(P.top, y1);
}
function gable(P, F, u, v, y, hu, hv, rh, col, gcol, alongU = true) {
  const G = P.get('plain'), o = 0.35;
  const pt = (uu, vv, yy) => [F.cx + F.tx * (u + uu) + F.fx * (v + vv), yy, F.cz + F.tz * (u + uu) + F.fz * (v + vv)];
  const ref = pt(0, 0, y + rh * 0.3);
  const U = hu + o, V = hv + o;
  if (alongU) {
    const e1 = pt(-U, -V, y), e2 = pt(U, -V, y), e3 = pt(U, V, y), e4 = pt(-U, V, y), r1 = pt(-U, 0, y + rh), r2 = pt(U, 0, y + rh);
    quadOut(G, e1, e2, r2, r1, ref, col, Z2, Z2, Z2, Z2); quadOut(G, e4, e3, r2, r1, ref, col, Z2, Z2, Z2, Z2);
    triOut(G, pt(-hu, -hv, y), pt(-hu, hv, y), pt(-hu, 0, y + rh - 0.2), ref, gcol);
    triOut(G, pt(hu, -hv, y), pt(hu, hv, y), pt(hu, 0, y + rh - 0.2), ref, gcol);
  } else {
    const e1 = pt(-U, -V, y), e2 = pt(-U, V, y), e3 = pt(U, V, y), e4 = pt(U, -V, y), r1 = pt(0, -V, y + rh), r2 = pt(0, V, y + rh);
    quadOut(G, e1, e2, r2, r1, ref, col, Z2, Z2, Z2, Z2); quadOut(G, e4, e3, r2, r1, ref, col, Z2, Z2, Z2, Z2);
    triOut(G, pt(-hu, -hv, y), pt(hu, -hv, y), pt(0, -hv, y + rh - 0.2), ref, gcol);
    triOut(G, pt(-hu, hv, y), pt(hu, hv, y), pt(0, hv, y + rh - 0.2), ref, gcol);
  }
  P.top = Math.max(P.top, y + rh);
}
export function voxelTree(P, x, z, s, r) {
  const F = { cx: x, cz: z, tx: 1, tz: 0, fx: 0, fz: 1 };
  const leaf = hex(pick(r, PAL.leaf));
  box(P, 'plain', F, 0, 0, 0, 0.18 * s, 0.18 * s, 1.1 * s, hex(0x6a4a30));
  box(P, 'plain', F, 0, 0, 1.0 * s, 0.85 * s, 0.85 * s, 1.1 * s, leaf);
  box(P, 'plain', F, 0, 0, 2.1 * s, 0.5 * s, 0.5 * s, 0.6 * s, leaf.map((c) => c * 1.25));
}

// ---------------------------------------------------------------- footprints
function lotMask(cells) {
  let x0 = N, z0 = N, x1 = 0, z1 = 0;
  for (const c of cells) { const x = c % N, z = (c / N) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const w = x1 - x0 + 1, h = z1 - z0 + 1, m = new Uint8Array(w * h);
  for (const c of cells) m[(((c / N) | 0) - z0) * w + (c % N) - x0] = 1;
  return { m, w, h, x0, z0 };
}
function count(m) { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; }
function pointInLoop(x, z, L) {
  let ins = false; const n = L.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = L[2 * i], zi = L[2 * i + 1], xj = L[2 * j], zj = L[2 * j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
// lot-local mask → world-space shapes [{outer, holes}]
function shapesOf(M, mask) {
  const loops = traceMask(mask, M.w, M.h), outers = [], holes = [];
  for (const raw of loops) {
    const s = simplifyLoop(raw, 1.05); if (s.length < 6) continue;
    for (let i = 0; i < s.length; i += 2) { s[i] += M.x0; s[i + 1] += M.z0; }
    const a = polyArea(s); if (Math.abs(a) < 2) continue;
    (a > 0 ? outers : holes).push(s);
  }
  const shapes = outers.map((o) => ({ outer: o, holes: [] }));
  for (const h of holes) {
    let cx = 0, cz = 0; const n = h.length / 2; for (let i = 0; i < n; i++) { cx += h[2 * i]; cz += h[2 * i + 1]; }
    const sh = shapes.find((s) => pointInLoop(cx / n, cz / n, s.outer)); if (sh) sh.holes.push(h);
  }
  return shapes;
}
function extrude(P, wallKey, shapes, y0, y1, wallCol, capCol, opts = {}) {
  const G = P.get(wallKey), C = P.get('plain');
  for (const sh of shapes) {
    if (y1 > y0) for (const Lp of [sh.outer, ...sh.holes]) {
      const n = Lp.length / 2; let u = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = Lp[2 * i], az = Lp[2 * i + 1], bx = Lp[2 * j], bz = Lp[2 * j + 1];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 1e-3) continue;
        const nn = [dz / len, 0, -dx / len];
        const u0 = u / TEX_U, u1 = (u + len) / TEX_U; u += len;
        const v0 = opts.vOnce ? 0 : y0 / TEX_V, v1 = opts.vOnce ? 1 : y1 / TEX_V;
        const a0 = [ax, y0, az], a1 = [ax, y1, az], b0 = [bx, y0, bz], b1 = [bx, y1, bz];
        vtx(G, b0, nn, [u0, v0], wallCol); vtx(G, a0, nn, [u1, v0], wallCol); vtx(G, a1, nn, [u1, v1], wallCol);
        vtx(G, b0, nn, [u0, v0], wallCol); vtx(G, a1, nn, [u1, v1], wallCol); vtx(G, b1, nn, [u0, v1], wallCol);
      }
    }
    if (capCol) {
      const contour = [], hl = [];
      for (let i = 0; i < sh.outer.length; i += 2) contour.push(new THREE.Vector2(sh.outer[i], sh.outer[i + 1]));
      for (const h of sh.holes) { const a = []; for (let i = 0; i < h.length; i += 2) a.push(new THREE.Vector2(h[i], h[i + 1])); hl.push(a); }
      const all = contour.concat(...hl);
      let faces = [];
      try { faces = THREE.ShapeUtils.triangulateShape(contour, hl); } catch { faces = []; }
      const up = [0, 1, 0];
      for (const [a, b, c] of faces) {
        const A = all[a], B = all[b], Cc = all[c];
        const pa = [A.x, y1, A.y], pb = [B.x, y1, B.y], pc = [Cc.x, y1, Cc.y];
        // (b-a)×(c-a) has y = dz_u*dx_v - dx_u*dz_v; positive → faces up
        const ny = (B.y - A.y) * (Cc.x - A.x) - (B.x - A.x) * (Cc.y - A.y);
        if (ny > 0) { vtx(C, pa, up, Z2, capCol); vtx(C, pb, up, Z2, capCol); vtx(C, pc, up, Z2, capCol); }
        else { vtx(C, pa, up, Z2, capCol); vtx(C, pc, up, Z2, capCol); vtx(C, pb, up, Z2, capCol); }
      }
    }
  }
  P.top = Math.max(P.top, y1);
}
function rimWalls(P, shapes, y, h, col) { extrude(P, 'plain', shapes, y, y + h, col, null); }
function cellsOfMask(M, mask) {
  const out = [];
  for (let z = 0; z < M.h; z++) for (let x = 0; x < M.w; x++) if (mask[z * M.w + x]) out.push([M.x0 + x + 0.5, M.z0 + z + 0.5]);
  return out;
}

// ---------------------------------------------------------------- growables
function frameOf(b) { return { cx: b.cx, cz: b.cz, fx: b.fx, fz: b.fz, tx: -b.fz, tz: b.fx }; }

function genHouse(P, b, r, world) {
  const F = frameOf(b), set = new Set(b.cells);
  const inLot = (u, v) => { const x = F.cx + F.tx * u + F.fx * v, z = F.cz + F.tz * u + F.fz * v; return set.has(Math.floor(z) * N + Math.floor(x)); };
  const fits = (u, v, hu, hv) => {
    const su = Math.max(0.6, hu / 4), sv = Math.max(0.6, hv / 4);
    for (let a = -hu; a <= hu + 1e-6; a += su) for (let c = -hv; c <= hv + 1e-6; c += sv) if (!inLot(u + a, v + c)) return false;
    return true;
  };
  let umin = 1e9, umax = -1e9, vmax = -1e9;
  for (const c of b.cells) {
    const px = (c % N) + 0.5 - F.cx, pz = ((c / N) | 0) + 0.5 - F.cz;
    const u = px * F.tx + pz * F.tz, v = px * F.fx + pz * F.fz;
    umin = Math.min(umin, u); umax = Math.max(umax, u); vmax = Math.max(vmax, v);
  }
  let hu = b.level === 2 ? 3.4 + r() * 0.8 : 2.4 + r() * 0.9, hv = b.level === 2 ? 3 + r() * 0.6 : 2.3 + r() * 0.8;
  let found = null;
  for (let k = 0; k < 8 && !found; k++) {
    const v = vmax - 1.6 - hv;
    for (const du of [0, 1.5, -1.5, 3, -3]) {
      const u = (umin + umax) / 2 + du;
      if (fits(u, v, hu, hv)) { found = { u, v }; break; }
      if (fits(u, v - 1, hu, hv)) { found = { u, v: v - 1 }; break; }
    }
    if (!found) { hu *= 0.87; hv *= 0.87; if (hu < 1.6) break; }
  }
  if (!found) return genMass(P, b, r, 'rl', world.policyAt(b), world);
  const st = STYLES[world.policyAt(b)?.style];
  const wall = hex(pick(r, st?.walls || PAL.rl)), roof = hex(pick(r, st?.roof || PAL.roof));
  const h = b.level * FLOOR_H + 0.3;
  box(P, 'res', F, found.u, found.v, 0, hu, hv, h, wall);
  gable(P, F, found.u, found.v, h, hu, hv, Math.min(hu, hv) * 0.9 + 0.4, roof, wall, hu >= hv);
  box(P, 'plain', F, found.u + (r() - 0.5) * hu, found.v + hv + 0.02, 0, 0.45, 0.06, 1.25, hex(0x6a4a3a));
  if (r() < 0.4) box(P, 'plain', F, found.u + hu * 0.5, found.v - hv * 0.3, h, 0.25, 0.25, Math.min(hu, hv) * 0.9 + 0.8, hex(0x8a5a4a));
  if (b.level === 2 && fits(found.u + hu + 1.6, found.v + 0.5, 1.4, hv * 0.7)) {
    box(P, 'plain', F, found.u + hu + 1.6, found.v + 0.5, 0, 1.4, hv * 0.7, 1.9, wall.map((c) => c * 0.92), hex(0x7a7a78));
  }
  for (let k = 0; k < 3; k++) {
    const c = b.cells[(r() * b.cells.length) | 0], x = (c % N) + 0.5, z = ((c / N) | 0) + 0.5;
    const pu = (x - F.cx) * F.tx + (z - F.cz) * F.tz - found.u, pv = (x - F.cx) * F.fx + (z - F.cz) * F.fz - found.v;
    if (Math.abs(pu) < hu + 1.2 && Math.abs(pv) < hv + 1.2) continue;
    voxelTree(P, x, z, 0.8 + r() * 0.5, r);
  }
}

function genMass(P, b, r, key, pol, world) {
  const M = lotMask(b.cells);
  let floors = buildingFloors(b,world);
  let mask = b.level >= 4 ? M.m : erodeMask(M.m, M.w, M.h, 1);
  if (count(mask) < 8) mask = M.m;
  const area = count(mask);
  let body = mask;
  if (area > 360 && b.level >= 3 && (key === 'rh' || key === 'm' || key === 'o') && floors <= 12 && r() < 0.75) {
    const inner = erodeMask(mask, M.w, M.h, 5);
    if (count(inner) >= 24) { body = new Uint8Array(mask.length); for (let i = 0; i < mask.length; i++) body[i] = mask[i] && !inner[i] ? 1 : 0; }
  }
  const st = STYLES[pol?.style];
  let pal = st?.walls || (key === 'rl' ? PAL.rl3 : PAL[key]);
  if (b.spec === 'tech') pal = [0x5ab8d0, 0x4aa0c8, 0x6ac8d8];
  const wall = hex(pick(r, pal)), roof = hex(pick(r, st?.roof || PAL.flat)), rim = roof.map((c) => c * 0.8);
  const wallKey = key === 'o' ? 'off' : key === 'c' ? 'com' : 'res';
  const shapes = shapesOf(M, body);
  if (!shapes.length) return;
  let yb = 0;
  if (key === 'c' || key === 'm') {
    const gh = FLOOR_H * 1.25;
    extrude(P, 'shop', shapes, 0, gh, hex(b.spec === 'leisure' ? pick(r, [0x2ab8a8, 0x3ac8d8, 0xf0a030]) : pick(r, PAL.shop)), null, { vOnce: true });
    yb = gh; floors = Math.max(0, floors - 1);
    if (!floors) { extrude(P, 'plain', shapes, gh, gh + 0.25, wall, roof); rimWalls(P, shapes, gh + 0.25, 0.3, rim); roofDetails(P, M, erodeMask(body, M.w, M.h, 1.5), gh + 0.55, r, key, b.level, b.spec); return; }
  }
  const H = yb + floors * FLOOR_H;
  let towerShapes = null, podH = 0;
  if (b.level >= 4 && floors > 6) {
    const tm = erodeMask(mask, M.w, M.h, 3 + (area > 500 ? 2 : 0));
    if (count(tm) >= 28) { towerShapes = shapesOf(M, tm); podH = yb + (2 + (r() < 0.5 ? 1 : 0)) * FLOOR_H; }
  }
  if (towerShapes && towerShapes.length) {
    extrude(P, wallKey, shapes, yb, podH, wall, roof);
    rimWalls(P, shapes, podH, 0.35, rim);
    const tw = key === 'o' ? hex(pick(r, PAL.o)) : wall;
    let top = towerShapes;
    if (key === 'o' && floors > 18) {
      const t2 = erodeMask(mask, M.w, M.h, 7 + (area > 500 ? 2 : 0));
      const s2 = count(t2) >= 16 ? shapesOf(M, t2) : [];
      if (s2.length) {
        const mid = podH + Math.round(((H - podH) * 0.62) / FLOOR_H) * FLOOR_H;
        extrude(P, wallKey, towerShapes, podH, mid, tw, roof);
        rimWalls(P, towerShapes, mid, 0.3, rim);
        extrude(P, wallKey, s2, mid, H, tw, roof);
        top = s2;
      } else extrude(P, wallKey, towerShapes, podH, H, tw, roof);
    } else extrude(P, wallKey, towerShapes, podH, H, tw, roof);
    rimWalls(P, top, H, 0.4, rim);
    roofDetails(P, M, erodeMask(mask, M.w, M.h, 5), H + 0.4, r, key, b.level, b.spec);
    massAccents(P, massPlan(b, world), M, erodeMask(mask, M.w, M.h, 3), top, yb, H, wallKey, wall, roof, rim);
  } else {
    extrude(P, wallKey, shapes, yb, H, wall, roof);
    rimWalls(P, shapes, H, 0.35, rim);
    roofDetails(P, M, erodeMask(body, M.w, M.h, 1.5), H + 0.35, r, key, b.level, b.spec);
    massAccents(P, massPlan(b, world), M, body, shapes, yb, H, wallKey, wall, roof, rim);
  }
}

// Break up the box: an annex rising above part of the footprint (cut by a line
// through the centre) and cantilevered volumes jutting out of long facades. The
// sizes come from massPlan so the simulation counts the same storeys.
function massAccents(P, plan, M, mask, shapes, yb, H, wallKey, wall, roof, rim) {
  if (plan.annex) {
    let cx = 0, cz = 0, n = 0;
    for (let z = 0; z < M.h; z++) for (let x = 0; x < M.w; x++) if (mask[z * M.w + x]) { cx += x; cz += z; n++; }
    if (n > 30) {
      cx /= n; cz /= n;
      const dx = Math.cos(plan.annex.angle), dz = Math.sin(plan.annex.angle), half = new Uint8Array(mask.length);
      for (let z = 0; z < M.h; z++) for (let x = 0; x < M.w; x++) { const i = z * M.w + x; half[i] = mask[i] && (x - cx) * dx + (z - cz) * dz > 0 ? 1 : 0; }
      const annex = erodeMask(half, M.w, M.h, 1.2);
      if (count(annex) >= 12) {
        const sh = shapesOf(M, annex), top = H + plan.annex.extra * FLOOR_H;
        extrude(P, wallKey, sh, H, top, wall.map((c) => c * 0.94), roof);
        rimWalls(P, sh, top, 0.35, rim);
      }
    }
  }
  if (!plan.canti.length) return;
  const edges = [];
  for (const shp of shapes) {
    const Lp = shp.outer, k = Lp.length / 2;
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k, ax = Lp[2 * i], az = Lp[2 * i + 1], bx = Lp[2 * j], bz = Lp[2 * j + 1], len = Math.hypot(bx - ax, bz - az);
      if (len >= 5) edges.push({ ax, az, bx, bz, len });
    }
  }
  if (!edges.length) return;
  for (const c of plan.canti) {
    const e = edges[Math.floor(c.edge * edges.length)], dxe = (e.bx - e.ax) / e.len, dze = (e.bz - e.az) / e.len;
    const width = Math.min(e.len * 0.6, c.width), y0 = yb + c.start * FLOOR_H;
    const mx = e.ax + (e.bx - e.ax) * c.t, mz = e.az + (e.bz - e.az) * c.t;
    const F = { cx: mx + dze * c.depth / 2, cz: mz - dxe * c.depth / 2, tx: dxe, tz: dze, fx: dze, fz: -dxe };  // outward = right of the CCW edge
    box(P, wallKey, F, 0, 0, y0, width / 2, c.depth / 2, c.storeys * FLOOR_H, wall.map((c) => c * 0.9), roof);
  }
}

function roofDetails(P, M, mask, y, r, key, level, spec = null) {
  const cells = cellsOfMask(M, mask); if (!cells.length) return;
  const F0 = (x, z) => ({ cx: x, cz: z, tx: 1, tz: 0, fx: 0, fz: 1 });
  const n = Math.min(4, 1 + ((cells.length / 40) | 0));
  for (let k = 0; k < n; k++) { const [x, z] = pick(r, cells); box(P, 'plain', F0(x, z), 0, 0, y - 0.35, 0.5 + r() * 0.4, 0.4 + r() * 0.4, 0.8, hex(0xd0d0cc)); }
  if (key === 'rh' && level >= 3 && r() < 0.7) { const [x, z] = pick(r, cells); const F = F0(x, z); box(P, 'plain', F, 0, 0, y - 0.35, 0.8, 0.8, 1.2, hex(0x7a5a40)); cyl(P, F, 0, 0, y + 0.8, 0.9, 1.4, 8, hex(0x8a6a48), hex(0x6a4a30)); }
  if (key === 'o' && level >= 4) { const [x, z] = pick(r, cells); box(P, 'plain', F0(x, z), 0, 0, y - 0.35, 0.12, 0.12, 5 + r() * 5, hex(0xdddddd)); }
  if (spec === 'leisure') for (let k = 0; k < 3; k++) { const [x, z] = pick(r, cells), F = F0(x, z); cyl(P, F, 0, 0, y - 0.35, 0.06, 1.4, 4, hex(0xdddddd)); cyl(P, F, 0, 0, y + 1.0, 1.1, 0.2, 6, hex(pick(r, [0xf05a4a, 0xf0c040, 0x3ab8e8]))); }
  if (spec === 'tech') { const [x, z] = pick(r, cells); cyl(P, F0(x, z), 0, 0, y - 0.35, 1.3, 0.3, 8, hex(0xe8eef4)); box(P, 'plain', F0(x, z), 0, 0, y - 0.1, 0.1, 0.1, 1.2, hex(0xcccccc)); }
  if (key === 'c' && level <= 3 && r() < 0.5) { const [x, z] = pick(r, cells); box(P, 'plain', F0(x, z), 0, 0, y + 0.6, 1.6, 0.12, 1.1, hex(pick(r, PAL.shop))); }
}

function genIndustry(P, b, r) {
  const M = lotMask(b.cells);
  let shed = erodeMask(M.m, M.w, M.h, 2);
  if (count(shed) < 10) shed = erodeMask(M.m, M.w, M.h, 1);
  if (count(shed) < 6) shed = M.m;
  const [fmin, fmax] = FLOORS.i[b.level];
  const h = (fmin + Math.floor(r() * (fmax - fmin + 1))) * 2.4;
  const wall = hex(pick(r, b.spec === 'forestry' ? [0x8a6a4a, 0x7a5a3a, 0x9a7a52] : PAL.i)), roof = hex(pick(r, [0x9aa0a4, 0x8a8f94, 0xb0aca0, 0x6f7a80]));
  extrude(P, 'ind', shapesOf(M, shed), 0, h, wall, roof);
  const top = cellsOfMask(M, erodeMask(shed, M.w, M.h, 1.5));
  const F0 = (x, z) => ({ cx: x, cz: z, tx: 1, tz: 0, fx: 0, fz: 1 });
  for (let k = 0; k < Math.min(5, 1 + top.length / 30); k++) { if (!top.length) break; const [x, z] = pick(r, top); box(P, 'plain', F0(x, z), 0, 0, h, 0.6, 0.6, 0.7, hex(0xc8c8c0)); }
  const yardMask = new Uint8Array(M.m.length);
  for (let i = 0; i < M.m.length; i++) yardMask[i] = M.m[i] && !shed[i] ? 1 : 0;
  const yard = cellsOfMask(M, erodeMask(yardMask, M.w, M.h, 0.9));
  if (top.length && r() < 0.6 + b.level * 0.1) {
    const [x, z] = pick(r, top), F = F0(x, z), ch = h + 5 + b.level * 2 + r() * 3;
    cyl(P, F, 0, 0, 0, 0.7, ch, 6, hex(0xb8b0a8));
    cyl(P, F, 0, 0, ch - 1.2, 0.75, 1.2, 6, hex(0xc84a3a));
    P.emit.push([x, ch + 0.3, z]);
  }
  for (let k = 0; k < Math.min(3, yard.length / 12); k++) {
    const [x, z] = pick(r, yard);
    if (b.spec === 'forestry') { for (let j = 0; j < 3; j++) box(P, 'plain', F0(x, z), 0, (j - 1) * 0.5, j * 0.45, 1.6, 0.24, 0.24, hex(0x8a5a32)); continue; }
    if (r() < 0.5) cyl(P, F0(x, z), 0, 0, 0, 1.0 + r() * 0.5, 3 + r() * 3, 8, hex(pick(r, [0xd8d4c8, 0xa8b4bc, 0xc8b89a])), hex(0x9a9a94));
    else box(P, 'plain', F0(x, z), 0, 0, 0, 0.55, 1.25, 1.2, hex(pick(r, [0xc84a3a, 0x3a6ab8, 0x3a9a5a, 0xd89a30])));
  }
}

// ---------------------------------------------------------------- services
function genService(P, b, r) {
  const S = SERVICES[b.svc], F = frameOf(b), hw = S.w / 2, hd = S.d / 2;
  // v > 0 is toward the road
  const B = (key, u, v, y0, hu, hv, h, c, top) => box(P, key, F, u, v, y0, hu, hv, h, hex(c), top !== undefined ? hex(top) : undefined);
  const C = (u, v, y0, rad, h, seg, c, top) => cyl(P, F, u, v, y0, rad, h, seg, hex(c), top !== undefined ? hex(top) : undefined);
  const pos = (u, v) => [F.cx + F.tx * u + F.fx * v, F.cz + F.tz * u + F.fz * v];
  const T = (u, v, s = 1) => { const [x, z] = pos(u, v); voxelTree(P, x, z, s, r); };
  switch (b.svc) {
    case 'coal':
      B('ind', -1, -1, 0, hw * 0.55, hd * 0.5, 7, 0x8a8a86, 0x6a6a68);
      B('ind', hw * 0.5, 0, 0, hw * 0.3, hd * 0.45, 11, 0x9a948c, 0x5a5a58);
      for (const u of [-hw * 0.55, -hw * 0.2]) { C(u, -hd * 0.6, 0, 1.3, 22, 8, 0xc8c0b8); C(u, -hd * 0.6, 19, 1.35, 2, 8, 0xc84a3a); const [x, z] = pos(u, -hd * 0.6); P.emit.push([x, 22.5, z], [x, 22.5, z]); }
      B('plain', hw * 0.55, hd * 0.6, 0, 2.2, 1.6, 1.2, 0x2a2a2a); B('plain', hw * 0.2, hd * 0.65, 0, 1.4, 1.2, 0.8, 0x333333);
      break;
    case 'wind':
      B('plain', 0, 0, 0, 1.2, 1.2, 0.5, 0xb0b0a8); C(0, 0, 0.5, 0.35, 15.5, 6, 0xf2f2f0); B('plain', 0, 0, 15.6, 0.45, 0.9, 0.8, 0xe8e8e4);
      { const [x, z] = pos(0, 0.95); P.extras.push({ type: 'rotor', x, y: 16, z, fx: F.fx, fz: F.fz }); }
      break;
    case 'pump':
      B('plain', 0, 0.5, 0, hw * 0.6, hd * 0.35, 3, 0xe8ecf0, 0x7a8a9a); C(-hw * 0.4, -hd * 0.5, 0, 1.3, 2.6, 8, 0x4a8ac8, 0x3a6a9a); C(hw * 0.4, -hd * 0.5, 0, 1.3, 2.6, 8, 0x4a8ac8, 0x3a6a9a);
      B('plain', 0, -hd * 0.8, 0, 0.35, hd * 0.4, 0.7, 0x5a5a5a);
      break;
    case 'tower':
      for (const [u, v] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) B('plain', u, v, 0, 0.2, 0.2, 8.5, 0x8a8a8a);
      C(0, 0, 8, 2.1, 3.2, 10, 0x9ad0f0, 0xe8f4fa); C(0, 0, 11.2, 1.2, 0.8, 10, 0xe8f4fa);
      break;
    case 'outlet':
      B('plain', 0, hd * 0.2, 0, 2, 1.5, 1.6, 0x9a9a92, 0x7a7a72); B('plain', 0, -hd * 0.45, 0, 0.5, hd * 0.55, 0.9, 0x4a4a46);
      break;
    case 'landfillzone': {
      const fill=Math.min(1,(b.garb||0)/(wasteCapacity(b)||1));
      if(!b.cells.length) B('plain',0,0,0,2,2,1,0x8a7050);
      for(let j=0;j<b.cells.length;j+=4){const i=b.cells[j],x=i%N+0.5,z=Math.floor(i/N)+0.5;box(P,'plain',{cx:x,cz:z,tx:1,tz:0,fx:0,fz:1},0,0,0,0.48,0.48,0.15+fill*(1.5+r()*2.5),hex(fill>0?0x8a7050:0x6a5a40));}
      break;
    }
    case 'incinerator':
      B('ind',0,0,0,hw*0.8,hd*0.7,8,0x7a858b);C(-hw*0.6,-hd*0.6,0,1.2,20,8,0xb8ada0);B('plain',hw*0.5,hd*0.6,0,2,1,3,0xd89135);break;
    case 'landfill': {
      const fill=Math.min(1,(b.garb||0)/wasteCapacity(b));
      B('plain', 0, -1, 0, hw * 0.8, hd * 0.6, 0.15+fill*3.4, 0x7a6448);
      B('plain', hw * 0.7, hd * 0.6, 0, 1.6, 1.2, 2.2, 0xb8b0a0, 0x8a6a4a); B('plain', hw * 0.2, hd * 0.55, 0, 0.8, 1.3, 1.1, 0xe8b830);
      break; }
    case 'fire':
      B('res', 0, -0.5, 0, hw * 0.8, hd * 0.65, 4.4, 0xc83a32, 0x8a8a86);
      for (const u of [-hw * 0.5, 0, hw * 0.5]) B('plain', u, -0.5 + hd * 0.65 + 0.05, 0, 1.1, 0.08, 2.6, 0x3a3a3a);
      B('plain', -hw * 0.75, -hd * 0.6, 0, 1, 1, 8, 0xb8322a, 0x6a6a66);
      break;
    case 'police':
      B('res', 0, -0.4, 0, hw * 0.8, hd * 0.65, 5, 0x6a88b8, 0x5a5a60);
      B('plain', 0, hd * 0.3, 0, 1.6, 0.8, 2.6, 0xdde4f0, 0x3a4a8a); B('plain', -0.4, -0.4, 5, 0.35, 0.2, 0.3, 0x3a5ae8); B('plain', 0.4, -0.4, 5, 0.35, 0.2, 0.3, 0xe83a3a);
      B('plain', hw * 0.8, hd * 0.8, 0, 0.08, 0.08, 6, 0xdddddd); B('plain', hw * 0.8 + 0.5, hd * 0.8, 5, 0.5, 0.04, 0.6, 0x3a6ae8);
      break;
    case 'clinic':
      B('res', 0, -0.4, 0, hw * 0.8, hd * 0.65, 5.2, 0xf4f6f8, 0xc8ccd0);
      B('plain', 0, -0.4, 5.2, 1.5, 0.4, 0.2, 0xd83a3a); B('plain', 0, -0.4, 5.2, 0.4, 1.5, 0.2, 0xd83a3a);
      B('plain', 0, hd * 0.35, 2.4, 1.8, 0.9, 0.2, 0xd83a3a);
      break;
    case 'school':
      B('res', -hw * 0.25, -hd * 0.35, 0, hw * 0.7, hd * 0.3, 4.6, 0xc8784a, 0x8a4a3a);
      B('res', hw * 0.55, 0.3, 0, hw * 0.25, hd * 0.55, 4.6, 0xd08a5a, 0x8a4a3a);
      B('plain', -hw * 0.25, hd * 0.45, 0, hw * 0.55, hd * 0.35, 0.06, 0x4aa04a); B('plain', -hw * 0.25, hd * 0.45, 0.05, 0.08, hd * 0.35, 0.03, 0xf0f0f0);
      B('plain', -hw * 0.9, hd * 0.85, 0, 0.07, 0.07, 6, 0xdddddd);
      break;
    case 'cargorail':   // sidings, a long shed, stacked containers and a gantry
      for (const v of [-hd * 0.55, -hd * 0.2]) { B('plain', 0, v, 0, hw * 0.95, 0.5, 0.12, 0x6a6258); for (const o of [-0.35, 0.35]) B('plain', 0, v + o, 0.12, hw * 0.95, 0.06, 0.08, 0xb8b8b0); }
      B('ind', -hw * 0.35, hd * 0.45, 0, hw * 0.55, hd * 0.4, 5, 0x8a9aa8, 0x5a6670);
      for (let k = 0; k < 8; k++) B('plain', hw * 0.25 + (k % 4) * 2.4, hd * 0.25 + Math.floor(k / 4) * 1.4, (k % 3 === 0 ? 1.3 : 0), 1.1, 0.6, 1.3, [0xd84a3a, 0x3a6ac8, 0xe8c040, 0x3aa86a][k % 4]);
      for (const u of [-hw * 0.5, hw * 0.5]) B('plain', u, -hd * 0.37, 0, 0.3, 0.3, 6, 0xe8a030); B('plain', 0, -hd * 0.37, 6, hw * 0.55, 0.35, 0.6, 0xe8a030);
      break;
    case 'harbour':   // quay, warehouse, container stacks and two cranes
      B('plain', 0, 0, 0, hw * 0.95, hd * 0.95, 0.3, 0xa8a49a);
      B('ind', -hw * 0.45, -hd * 0.45, 0.3, hw * 0.45, hd * 0.35, 6, 0x9aa8b0, 0x6a7478);
      for (let k = 0; k < 18; k++) B('plain', hw * 0.1 + (k % 6) * 2.3, -hd * 0.1 + Math.floor(k / 6) * 1.4, 0.3 + (k % 2) * 1.3, 1.05, 0.6, 1.3, [0xd84a3a, 0x3a6ac8, 0xe8c040, 0x3aa86a, 0xe07a30][k % 5]);
      for (const u of [-hw * 0.2, hw * 0.45]) { B('plain', u, hd * 0.7, 0.3, 0.4, 0.4, 14, 0xd84a3a); B('plain', u, hd * 0.9, 14, 0.35, hd * 0.45, 0.6, 0xd84a3a); }
      break;
    case 'airfield':
    case 'airport':   // runway with markings, terminal, control tower and a parked plane
      B('plain', 0, -hd * 0.35, 0, hw * 0.98, hd * 0.3, 0.08, 0x4a4a4e);
      for (let u = -hw * 0.85; u < hw * 0.85; u += 5) B('plain', u, -hd * 0.35, 0.08, 1.4, 0.15, 0.02, 0xf0f0f0);
      B('res', -hw * 0.3, hd * 0.5, 0, hw * 0.4, hd * 0.35, 5, 0xd8dde2, 0x8a9aa8);
      C(hw * 0.45, hd * 0.55, 0, 1.1, 12, 8, 0xe8e8e8); B('plain', hw * 0.45, hd * 0.55, 12, 1.8, 1.8, 2, 0x5a8ab8, 0x3a4a5a);
      B('plain', hw * 0.1, hd * 0.2, 1, 5, 0.6, 0.8, 0xf4f4f4); B('plain', hw * 0.1, hd * 0.2, 1.3, 0.8, 4, 0.2, 0xf4f4f4); B('plain', hw * 0.1 - 4.5, hd * 0.2, 1.4, 0.4, 1.4, 0.9, 0x3a6ac8);
      break;
    case 'college':   // a brick hall with a clock turret and a lawn
      B('res', 0, -hd * 0.35, 0, hw * 0.8, hd * 0.35, 7, 0xa85a42, 0x6a3a30);
      B('res', -hw * 0.6, hd * 0.2, 0, hw * 0.25, hd * 0.3, 5.5, 0xb86a4a, 0x6a3a30);
      B('plain', 0, -hd * 0.35, 7, 1.4, 1.4, 4, 0xc8a878, 0x5a4a3a); B('plain', 0, -hd * 0.35 + 1.45, 9, 0.7, 0.05, 0.7, 0xf0f0e0);
      B('plain', hw * 0.3, hd * 0.45, 0, hw * 0.5, hd * 0.4, 0.06, 0x4aa04a);
      T(hw * 0.6, hd * 0.6, 1.1); T(hw * 0.05, hd * 0.65, 1);
      break;
    case 'university':   // a quad: hall with a dome, two wings, library tower and green
      B('res', 0, -hd * 0.55, 0, hw * 0.75, hd * 0.25, 9, 0xe8dcc0, 0x8a8478);
      C(0, -hd * 0.55, 9, 3.2, 2.6, 12, 0x6a9a8a, 0x5a8a7a);
      B('res', -hw * 0.75, 0.2, 0, hw * 0.18, hd * 0.5, 7.5, 0xe0d4b8, 0x8a8478); B('res', hw * 0.75, 0.2, 0, hw * 0.18, hd * 0.5, 7.5, 0xe0d4b8, 0x8a8478);
      B('res', hw * 0.45, hd * 0.65, 0, 2.2, 2.2, 16, 0xd8ccb0, 0x7a5a48);
      B('plain', 0, hd * 0.15, 0, hw * 0.5, hd * 0.4, 0.06, 0x4aa04a); B('plain', 0, hd * 0.15, 0.05, 0.4, hd * 0.4, 0.03, 0xd8c89a);
      for (const [u, v] of [[-hw * 0.35, hd * 0.4], [hw * 0.2, 0], [-hw * 0.2, -hd * 0.1]]) T(u, v, 1.2);
      break;
    case 'parkS':
      B('plain', 0, 0, 0, 0.6, hd * 0.95, 0.05, 0xd8c89a); B('plain', 0, 0, 0, hw * 0.95, 0.6, 0.05, 0xd8c89a);
      T(-hw * 0.5, -hd * 0.5, 1.1); T(hw * 0.5, hd * 0.45, 1.2); T(hw * 0.55, -hd * 0.5, 0.9); T(-hw * 0.45, hd * 0.5, 1);
      B('plain', 1.2, 1.2, 0, 0.7, 0.2, 0.5, 0x8a5a3a);
      break;
    case 'parkL':
      B('plain', 0, 0, 0, hw * 0.95, 0.7, 0.05, 0xd8c89a); B('plain', 0, 0, 0, 0.7, hd * 0.95, 0.05, 0xd8c89a);
      C(0, 0, 0, 2.2, 0.5, 10, 0xb8b8b0, 0x5a9ad8); C(0, 0, 0.5, 0.3, 1.2, 6, 0xd8d8d0);
      B('plain', -hw * 0.5, hd * 0.5, 0, hw * 0.3, hd * 0.25, 0.08, 0x4a8ac8);
      for (let k = 0; k < 16; k++) { const u = (r() - 0.5) * S.w * 0.9, v = (r() - 0.5) * S.d * 0.9; if (Math.abs(u) < 1.8 || Math.abs(v) < 1.8) continue; if (u < -hw * 0.1 && v > hd * 0.2) continue; if (u > hw * 0.2 && v < -hd * 0.2) continue; T(u, v, 0.9 + r() * 0.6); }
      B('plain', hw * 0.5, -hd * 0.5, 0, 1.4, 1.4, 0.3, 0xe8e0d0); B('plain', hw * 0.5, -hd * 0.5, 2.4, 1.7, 1.7, 0.3, 0xa24a3a);
      for (const [u, v] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) B('plain', hw * 0.5 + u, -hd * 0.5 + v, 0.3, 0.12, 0.12, 2.1, 0xe8e0d0);
      break;
    case 'depot':
      B('ind', -hw * 0.2, -hd * 0.3, 0, hw * 0.7, hd * 0.4, 5, 0xe88a3a, 0x7a7a74);
      for (const u of [-2.5, 0.5]) B('plain', u, hd * 0.55, 0, 0.9, 1.8, 1.4, 0xe8c030, 0x3a3a3a);
      B('plain', hw * 0.65, hd * 0.4, 0, 1.4, 1.4, 1.1, 0xd8d8d0);
      break;
    case 'busdepot':
      B('ind', 0, -hd * 0.3, 0, hw * 0.85, hd * 0.45, 5.5, 0x9aa8b0, 0x6a7478);
      for (const u of [-hw * 0.5, 0, hw * 0.5]) B('plain', u, -hd * 0.3 + hd * 0.45 + 0.05, 0, 1.3, 0.08, 3.4, 0x3a3a3a);
      for (const u of [-3, 0, 3]) B('plain', u, hd * 0.55, 0, 0.7, 2.2, 1.5, 0x3aa86a, 0xe8e8e8);
      break;
    case 'plaza':
      B('plain', 0, 0, 0, hw * 0.95, hd * 0.95, 0.12, 0xd8ccb0);
      C(0, 0, 0.12, 3.2, 0.6, 12, 0xb8b0a0, 0x5aa8e0); C(0, 0, 0.7, 0.9, 1.4, 8, 0xe8e0d0); C(0, 0, 2.1, 1.4, 0.3, 8, 0xe8e0d0, 0x8ac8f0);
      for (const [u, v] of [[-hw * 0.7, -hd * 0.7], [hw * 0.7, -hd * 0.7], [-hw * 0.7, hd * 0.7], [hw * 0.7, hd * 0.7]]) T(u, v, 1.1);
      B('plain', 0, -hd * 0.8, 0.12, 0.35, 0.35, 5, 0xa8a090); B('plain', 0, -hd * 0.8, 5.1, 0.9, 0.9, 1.2, 0xc8a84a);
      break;
    case 'museum':
      B('res', 0, -1, 0, hw * 0.85, hd * 0.6, 6, 0xe8e0cc, 0xb8b0a0);
      for (let u = -hw * 0.7; u <= hw * 0.7 + 0.01; u += hw * 0.35) C(u, hd * 0.55, 0, 0.45, 5.4, 8, 0xf0ead8);
      B('plain', 0, hd * 0.4, 5.4, hw * 0.85, 1.2, 0.6, 0xe8e0cc); gable(P, F, 0, -1, 6, hw * 0.85, hd * 0.6, 2.2, hex(0x8a8478), hex(0xe8e0cc), true);
      break;
    case 'stadium':
      for (const [rx, h, c] of [[1, 4, 0xb8b8b4], [0.8, 6.5, 0xa8aab0]]) for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2; B('plain', Math.cos(a) * hw * 0.8 * rx, Math.sin(a) * hd * 0.8 * rx, 0, 2.6, 1.6, h, c);
      }
      B('plain', 0, 0, 0, hw * 0.5, hd * 0.45, 0.1, 0x4aa84a); B('plain', 0, 0, 0.1, 0.1, hd * 0.45, 0.02, 0xf0f0f0);
      for (const [u, v] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) { B('plain', u * 0.85, v * 0.85, 0, 0.3, 0.3, 14, 0x8a8a8a); B('plain', u * 0.85, v * 0.85, 14, 1.2, 0.3, 0.8, 0xfff2b0); }
      break;
    case 'spire':
      C(0, 0, 0, 3.5, 2, 12, 0xc8ccd0); C(0, 0, 2, 1.2, 40, 8, 0xd8dde2); C(0, 0, 42, 3.2, 3, 12, 0x5a8ab8, 0x2a4a6a); C(0, 0, 45, 0.25, 14, 6, 0xeeeeee);
      break;
    case 'stormdrain':
      B('plain',0,0,0,hw,hd,.25,0x78858a);
      for(let u=-1.5;u<=1.5;u+=.5)B('plain',u,0,.26,.08,1.4,.08,0x263943);
      B('plain',1,1,.3,.4,.4,1.2,0x43a9b9);break;
    case 'snowdepot':
      B('ind',0,-1,0,hw*.9,hd*.6,4,0xe9aa45,0x626b74);
      for(const u of [-3,0,3]) {B('plain',u,2,0,.6,1.3,1.4,0xeaa02e);B('plain',u,3.4,0,1,.2,.5,0xd4e3e7);}break;
    case 'railstation':
      B('plain',0,0,0,hw,hd,1,0x77828d);B('com',0,-1,1,hw*.7,hd*.5,5,0xc3b294,0x40516d);
      B('plain',0,2,7,hw,.7,.3,0x708691);break;
    case 'metrostation':
      B('plain',0,0,0,hw,hd,.3,0x797f87);B('plain',0,0,.3,hw*.65,hd*.7,.15,0x263743);
      B('plain',-hw*.7,0,0,.15,.15,3.5,0x778c99);B('plain',-hw*.7,0,3,.6,.2,.6,0x4ca6e8);break;
    case 'tramstop':
    default:   // content-pack buildings describe themselves: boxes (with windows), cylinders, glowing signs and roofs
      for (const m of S.model || []) {
        const u = (m.u ?? 0) * hw, v = (m.v ?? 0) * hd, hu = (m.w ?? 0.2) * hw, hv = (m.d ?? 0.2) * hd;
        if (m.kind === 'cyl') C(u, v, m.y ?? 0, m.r, m.h, 10, m.color, m.roof ?? undefined);
        else if (m.kind === 'sign') B('neon', u, v, m.y ?? 0, hu, hv, m.h, m.color);
        else B(m.windows || 'plain', u, v, m.y ?? 0, hu, hv, m.h, m.color, m.roof ?? undefined);
        if (m.roofShape && m.roofShape !== 'flat') roofShape(P, F, m.kind === 'cyl' ? u : u, v, m.y + m.h, m.kind === 'cyl' ? m.r : hu, m.kind === 'cyl' ? m.r : hv, m.roofH, m.roofShape, hex(m.roofColor ?? m.roof ?? 0x8a4a3a));
      }
      break;
    case 'ferry':   // a timber pier running out over the water, a ticket hut and bollards
      B('plain', 0, -hd * 0.35, 0, hw * 0.45, hd * 0.75, 0.6, 0x8a6a4a);
      B('plain', 0, hd * 0.55, 0, hw * 0.55, hd * 0.25, 2.6, 0xe8e4dc, 0x3a6ac8);
      for (const u of [-hw * 0.4, hw * 0.4]) for (const v of [-hd * 0.9, -hd * 0.4]) C(u, v, 0.6, 0.2, 0.6, 6, 0x3a3a3a);
      break;
    case 'substation':
      B('plain', 0, 0, 0, hw * 0.9, hd * 0.9, 0.2, 0x9a9a94);
      for (const u of [-1.4, 1.4]) { B('plain', u, -0.6, 0.2, 0.9, 0.7, 1.6, 0x7a8a94, 0x5a6a74); C(u, -0.6, 1.8, 0.25, 0.9, 6, 0xd8d0c0); }
      for (const u of [-2.4, 0, 2.4]) B('plain', u, 1.4, 0, 0.1, 0.1, 3.2, 0x6a6e72);
      B('plain', 0, 1.4, 3.1, 2.6, 0.1, 0.1, 0x6a6e72);
      for (const [u, v] of [[-hw * 0.9, 0], [hw * 0.9, 0]]) B('plain', u, v, 0, 0.05, hd * 0.9, 1.2, 0x8a8e90);   // fence
      break;
    // ---- resource industry
    case 'lumbercamp':
      B('ind', -hw * 0.4, -hd * 0.2, 0, hw * 0.35, hd * 0.35, 3.2, 0x8a6a4a, 0x5a4a3a);
      for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) B('plain', hw * 0.35, -hd * 0.5 + k * 1.6, j * 0.5, 2.4, 0.3, 0.3, 0x8a5a32);
      T(-hw * 0.7, -hd * 0.8, 1); T(hw * 0.8, -hd * 0.8, 1.1); T(0, -hd * 0.9, 0.9);
      break;
    case 'coalmine': case 'ironmine': case 'oremine': {
      const heap = b.svc === 'coalmine' ? 0x2a2a2c : b.svc === 'ironmine' ? 0x8a4a32 : 0xb88a3a;
      for (const [u, v] of [[-2.2, -2.2], [2.2, -2.2], [2.2, 2.2], [-2.2, 2.2]]) B('plain', -hw * 0.35 + u * 0.5, -hd * 0.2 + v * 0.5, 0, 0.2, 0.2, 12, 0x6a3a2a);
      B('plain', -hw * 0.35, -hd * 0.2, 12, 1.6, 1.6, 0.5, 0x6a3a2a); C(-hw * 0.35, -hd * 0.2, 12.5, 1.1, 0.4, 10, 0x3a3a3a);
      B('ind', hw * 0.35, hd * 0.25, 0, hw * 0.35, hd * 0.3, 4, 0x9a8a78, 0x6a6a68);
      B('plain', hw * 0.3, -hd * 0.45, 0, hw * 0.4, hd * 0.3, 1.4, heap); B('plain', hw * 0.3, -hd * 0.45, 1.4, hw * 0.25, hd * 0.18, 1.2, heap); B('plain', hw * 0.3, -hd * 0.45, 2.6, hw * 0.1, hd * 0.08, 0.8, heap);
      break;
    }
    case 'quarry':
      for (let k = 0; k < 3; k++) B('plain', -hw * 0.1, -hd * 0.15, 0, hw * (0.8 - k * 0.2), hd * (0.6 - k * 0.15), 0.35 + k * 0.3, [0xb8b2a0, 0xa8a290, 0x98927e][k]);
      B('ind', hw * 0.7, hd * 0.6, 0, 2, 1.5, 3, 0xc8c0a8, 0x7a7a72); B('plain', -hw * 0.6, hd * 0.6, 0, 1.2, 0.8, 1.1, 0xe8b830);
      break;
    case 'sawmill': case 'papermill': case 'furniture': {
      const wall = b.svc === 'papermill' ? 0xd8d4c8 : b.svc === 'furniture' ? 0xb8845a : 0x9a7a52;
      B('ind', 0, -hd * 0.1, 0, hw * 0.8, hd * 0.45, b.svc === 'furniture' ? 5 : 6, wall, 0x7a7a74);
      if (b.svc === 'papermill') { C(-hw * 0.5, -hd * 0.65, 0, 1.4, 9, 10, 0xe8e4d8); C(-hw * 0.2, -hd * 0.65, 0, 1.4, 9, 10, 0xe8e4d8); C(hw * 0.6, -hd * 0.6, 0, 0.7, 16, 6, 0xb8b0a8); const [x, z] = pos(hw * 0.6, -hd * 0.6); P.emit.push([x, 16.5, z]); }
      else for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) B('plain', -hw * 0.5 + k * 3, hd * 0.6, j * 0.5, 1.2, 0.8, 0.45, b.svc === 'furniture' ? 0xc8a070 : 0x8a5a32);
      break;
    }
    case 'cementworks':
      B('ind', -hw * 0.3, 0, 0, hw * 0.4, hd * 0.4, 7, 0xb8b4ac, 0x8a8a86);
      for (const u of [hw * 0.25, hw * 0.55]) C(u, -hd * 0.3, 0, 1.8, 13, 10, 0xd8d4cc, 0xa8a49c);
      B('plain', 0, hd * 0.55, 3, hw * 0.8, 0.8, 0.8, 0x9a948c);   // the kiln
      C(-hw * 0.7, -hd * 0.6, 0, 0.8, 18, 6, 0xb8b0a8); { const [x, z] = pos(-hw * 0.7, -hd * 0.6); P.emit.push([x, 18.5, z]); }
      break;
    case 'steelworks': case 'smelter': {
      const big = b.svc === 'steelworks';
      B('ind', hw * 0.25, 0, 0, hw * 0.55, hd * 0.45, big ? 10 : 7, 0x7a6a62, 0x4a4a4a);
      C(-hw * 0.5, -hd * 0.2, 0, big ? 2.6 : 2, big ? 20 : 14, 10, 0x5a4a44, 0x3a2a24);   // furnace
      for (const u of big ? [-hw * 0.75, -hw * 0.2, hw * 0.5] : [-hw * 0.75, hw * 0.5]) { C(u, -hd * 0.7, 0, 0.8, big ? 26 : 20, 6, 0xb8b0a8); C(u, -hd * 0.7, (big ? 26 : 20) - 1.2, 0.85, 1.2, 6, 0xc84a3a); const [x, z] = pos(u, -hd * 0.7); P.emit.push([x, big ? 26.5 : 20.5, z], [x, big ? 26.5 : 20.5, z]); }
      B('plain', -hw * 0.5, hd * 0.6, 0, 2.5, 1.5, 1.6, big ? 0x8a4a32 : 0xb88a3a);
      break;
    }
    case 'machinery':
      B('ind', 0, -hd * 0.1, 0, hw * 0.85, hd * 0.55, 7, 0x8a9aa8, 0x5a6a78);
      for (let k = -2; k <= 2; k++) B('plain', k * hw * 0.3, -hd * 0.1, 7, hw * 0.12, hd * 0.55, 1.4, 0xa8c0d0);   // sawtooth roof lights
      B('plain', hw * 0.6, hd * 0.65, 0, 1.4, 1.2, 1.4, 0xe8a030); B('plain', -hw * 0.6, hd * 0.65, 0, 1.4, 1.2, 1.4, 0x3a6ab8);
      break;
    case 'exchange':
      B('off', 0, -0.4, 0, hw * 0.75, hd * 0.6, 8, 0xe8e0cc, 0x8a8a86);
      for (let k = -2; k <= 2; k++) C(k * hw * 0.3, hd * 0.25, 0, 0.45, 7.5, 8, 0xf2ecd8);
      B('plain', 0, hd * 0.25, 7.5, hw * 0.75, 0.9, 1.2, 0xe8e0cc);
      break;
    case 'warehouse':
      B('ind', 0, -hd * 0.1, 0, hw * 0.85, hd * 0.6, 6.5, 0xa8908a, 0x6a6a68);
      for (let k = -2; k <= 2; k++) B('plain', k * hw * 0.32, hd * 0.52, 0, 1.3, 0.1, 3.2, 0x5a5a5a);
      break;
    case 'busstop':
      B('plain', 0, -0.3, 2.1, 1.3, 0.6, 0.12, 0x3a6ac8); B('plain', 0, -0.8, 0, 1.2, 0.05, 2.1, 0xa8d0e8);
      B('plain', -1.1, -0.3, 0, 0.06, 0.06, 2.1, 0x777777); B('plain', 1.1, -0.3, 0, 0.06, 0.06, 2.1, 0x777777);
      break;
  }
}

// plain facade boxes (another tile's buildings seen from next door), with window UVs:
// list of { x, z, w, d, y0, h, key, col, roof } → parts by material
export function genBoxes(list) {
  const P = new Parts();
  for (const b of list) box(P, b.key, { cx: b.x, cz: b.z, tx: 1, tz: 0, fx: 0, fz: 1 }, 0, 0, b.y0, b.w / 2, b.d / 2, b.h, hex(b.col), hex(b.roof));
  return P.g;
}

// ---------------------------------------------------------------- entry
export function genBuilding(b, world) {
  const P = new Parts(), r = mulberry32(b.seed);
  if (b.svc) genService(P, b, r);
  else {
    const key = ZONES[b.zone].key, pol = world.policyAt(b);
    if (key === 'rl' && b.level <= 2) genHouse(P, b, r, world);
    else if (key === 'i') genIndustry(P, b, r);
    else genMass(P, b, r, key, pol, world);
  }
  const tech=technology(world.year);
  if(!b.svc && tech.style==='heritage') {
    for(const g of Object.values(P.g))for(let i=0;i<g.c.length;i+=3){const l=(g.c[i]+g.c[i+1]+g.c[i+2])/3;g.c[i]=l*1.1;g.c[i+1]=l*0.74;g.c[i+2]=l*0.52;}
  }
  if(!b.svc && tech.style==='cyberpunk' && b.level>=3){
    const F=frameOf(b),y=P.top;
    for(const sign of [-1,1])box(P,'neon',F,sign*2,0,y,0.2,0.2,3+b.level,hex(sign<0?0x24f1ff:0xfa39df));
    box(P,'neon',F,0,0,Math.max(2,y-2),2.5,0.15,0.4,hex(0x27f3df));
  }
  if (b.constructionUntil > world.day) {
    for (const g of Object.values(P.g)) {
      for (let i = 1; i < g.p.length; i += 3) g.p[i] *= 0.4;
      for (let i = 0; i < g.c.length; i += 3) { g.c[i] = 0.4; g.c[i + 1] = 0.36; g.c[i + 2] = 0.28; }
    }
    P.emit = []; P.extras = []; P.top *= 0.4;
    const F = frameOf(b), height = Math.max(4, P.top + 2);
    for (let i = 0; i < b.cells.length; i += Math.max(1, Math.floor(b.cells.length / 10))) {
      const c = b.cells[i], dx = c % N + 0.5 - F.cx, dz = Math.floor(c / N) + 0.5 - F.cz;
      box(P, 'plain', F, dx * F.tx + dz * F.tz, dx * F.fx + dz * F.fz, 0, 0.12, 0.12, height, hex(0xe5b842));
    }
  }
  // rubble: the building collapses into low, dusty heaps with a few leaning beams
  if (b.rubble > 0) {
    for (const g of Object.values(P.g)) { g.p.length = 0; g.n.length = 0; g.c.length = 0; g.u.length = 0; }
    P.emit = []; P.extras = []; P.top = 0;
    const F = frameOf(b);
    for (let i = 0; i < b.cells.length; i += Math.max(1, Math.floor(b.cells.length / 18))) {
      const c = b.cells[i], dx = c % N + 0.5 - F.cx, dz = Math.floor(c / N) + 0.5 - F.cz, h = 0.5 + r() * (1 + b.level * 0.6);
      box(P, 'plain', F, dx * F.tx + dz * F.tz, dx * F.fx + dz * F.fz, 0, 0.8 + r(), 0.8 + r(), h, hex(pick(r, [0x9a948a, 0x8a8478, 0xa8a090, 0x6f6a62])));
      if (r() < 0.25) box(P, 'plain', F, dx * F.tx + dz * F.tz, dx * F.fx + dz * F.fz, h, 0.12, 0.12, 1.5 + r() * 2, hex(0x5a4a3a));
      P.top = Math.max(P.top, h);
    }
  }
  if (b.abandoned) for (const k in P.g) {
    const c = P.g[k].c;
    for (let i = 0; i < c.length; i += 3) { const l = ((c[i] + c[i + 1] + c[i + 2]) / 3) * 0.55; c[i] = l * 1.05; c[i + 1] = l; c[i + 2] = l * 0.9; }
  }
  if(b.baseY){for(const g of Object.values(P.g))for(let i=1;i<g.p.length;i+=3)g.p[i]+=b.baseY;P.top+=b.baseY;}
  return { g: P.g, emit: P.emit, extras: P.extras, top: P.top };
}
