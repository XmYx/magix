// Organicity — math, noise, geometry and raster helpers (no three.js dependency).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

// ---------- deterministic randomness ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}
export function fbm(x, y, s = 0, oct = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { v += vnoise(x * f, y * f, s + i * 17) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return v / norm;
}

// ---------- binary min-heap keyed by float ----------
export class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0]; const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let l = 2 * i + 1; if (l >= n) break;
        if (l + 1 < n && k[l + 1] < k[l]) l++;
        if (k[l] >= lk) break; k[i] = k[l]; v[i] = v[l]; i = l;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// ---------- 2D geometry (x, z) ----------
export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az; const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = clamp(t, 0, 1);
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return { d: Math.sqrt(x * x + z * z), t };
}
// segment intersection → {t, u} params or null
export function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) return null;
  const qx = cx - ax, qz = cz - az;
  const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}
export function bezier(p0, c, p2, t) {
  const mt = 1 - t;
  return { x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p2.x, z: mt * mt * p0.z + 2 * mt * t * c.z + t * t * p2.z };
}
// split quadratic bezier at t → [left, right] as {p0,c,p2}
export function splitBezier(p0, c, p2, t) {
  const q0 = { x: lerp(p0.x, c.x, t), z: lerp(p0.z, c.z, t) };
  const q1 = { x: lerp(c.x, p2.x, t), z: lerp(c.z, p2.z, t) };
  const m = { x: lerp(q0.x, q1.x, t), z: lerp(q0.z, q1.z, t) };
  return [{ p0, c: q0, p2: m }, { p0: m, c: q1, p2 }];
}
export function polyArea(loop) { // loop = [x0,z0,x1,z1,...]
  let a = 0; const n = loop.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += loop[2 * i] * loop[2 * j + 1] - loop[2 * j] * loop[2 * i + 1]; }
  return a / 2;
}

// ---------- raster mask → polygon loops ----------
// mask: Uint8Array w*h (1 inside). Returns loops in local cell-corner coords.
// Outer loops have positive polyArea, holes negative.
export function traceMask(mask, w, h) {
  const out = new Map();
  const key = (x, z) => z * (w + 2) + x;
  const addE = (x0, z0, x1, z1) => {
    const k = key(x0, z0); let a = out.get(k); if (!a) out.set(k, (a = []));
    a.push({ x0, z0, x1, z1, used: false });
  };
  const at = (x, z) => (x < 0 || z < 0 || x >= w || z >= h ? 0 : mask[z * w + x]);
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    if (!mask[z * w + x]) continue;
    if (!at(x, z - 1)) addE(x, z, x + 1, z);
    if (!at(x + 1, z)) addE(x + 1, z, x + 1, z + 1);
    if (!at(x, z + 1)) addE(x + 1, z + 1, x, z + 1);
    if (!at(x - 1, z)) addE(x, z + 1, x, z);
  }
  const loops = [];
  for (const list of out.values()) for (const e0 of list) {
    if (e0.used) continue;
    const pts = []; let e = e0;
    while (e && !e.used) {
      e.used = true; pts.push(e.x0, e.z0);
      const cands = out.get(key(e.x1, e.z1)); let next = null;
      if (cands) {
        const dx = e.x1 - e.x0, dz = e.z1 - e.z0; let best = -9;
        for (const c of cands) {
          if (c.used) continue;
          const cr = dx * (c.z1 - c.z0) - dz * (c.x1 - c.x0);
          const score = cr > 0 ? 2 : cr === 0 ? 1 : 0; // prefer left turns → diagonal pixels stay separate
          if (score > best) { best = score; next = c; }
        }
      }
      e = next;
    }
    if (pts.length >= 6) loops.push(pts);
  }
  return loops;
}

// Douglas–Peucker on a closed loop [x,z,...]
export function simplifyLoop(loop, eps) {
  const n = loop.length / 2; if (n <= 4) return loop.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = (loop[2 * i] - loop[0]) ** 2 + (loop[2 * i + 1] - loop[1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n); keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop(); if (b - a < 2) continue;
    const ax = loop[2 * a], az = loop[2 * a + 1], bi = b % n, bx = loop[2 * bi], bz = loop[2 * bi + 1];
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = distToSeg(loop[2 * i], loop[2 * i + 1], ax, az, bx, bz).d; if (d > md) { md = d; mi = i; } }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const res = [];
  for (let i = 0; i < n; i++) if (keep[i]) res.push(loop[2 * i], loop[2 * i + 1]);
  return res;
}

// chamfer distance-to-outside for a mask; returns Float32Array
export function maskDistance(mask, w, h, edgeInside = false) {
  const d = new Float32Array(w * h), O = edgeInside ? 1e9 : 0;
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 1e9 : 0;
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    const i = z * w + x; if (!d[i]) continue;
    const up = z > 0 ? d[i - w] : O, lf = x > 0 ? d[i - 1] : O;
    const ul = z > 0 && x > 0 ? d[i - w - 1] : O, ur = z > 0 && x < w - 1 ? d[i - w + 1] : O;
    d[i] = Math.min(d[i], up + 1, lf + 1, ul + 1.414, ur + 1.414);
  }
  for (let z = h - 1; z >= 0; z--) for (let x = w - 1; x >= 0; x--) {
    const i = z * w + x; if (!d[i]) continue;
    const dn = z < h - 1 ? d[i + w] : O, rt = x < w - 1 ? d[i + 1] : O;
    const dl = z < h - 1 && x > 0 ? d[i + w - 1] : O, dr = z < h - 1 && x < w - 1 ? d[i + w + 1] : O;
    d[i] = Math.min(d[i], dn + 1, rt + 1, dl + 1.414, dr + 1.414);
  }
  return d;
}
export function erodeMask(mask, w, h, r) {
  const d = maskDistance(mask, w, h); const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = d[i] > r ? 1 : 0;
  return m;
}

// ---------- RLE helpers for saves ----------
export function rleEncode(arr) {
  const out = []; let i = 0;
  while (i < arr.length) { const v = arr[i]; let n = 1; while (i + n < arr.length && arr[i + n] === v) n++; out.push(v, n); i += n; }
  return out;
}
export function rleDecode(rle, Type, len) {
  const a = new Type(len); let p = 0;
  for (let i = 0; i < rle.length; i += 2) { a.fill(rle[i], p, p + rle[i + 1]); p += rle[i + 1]; }
  return a;
}

export const fmtMoney = (v) => (v < 0 ? '-' : '') + '₵' + Math.abs(Math.round(v)).toLocaleString('en-US');
export const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
