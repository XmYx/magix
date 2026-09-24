// field.js — procedural bodies described by signed distance functions.
// The same SDFs drive collision (hard min) and gravity (smooth min), and each
// body has a matching mesh so what you see is exactly what you stand on.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V3 = THREE.Vector3;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* zones: colour + growth direction from the hub */
export const ZONES = {
  hub:  { color: 0xffb54d, glow: 0xffd89a, label: 'Home' },
  code: { color: 0x6b4dff, glow: 0xb09aff, label: 'Open source', dir: [1, 0.2, 0.15], count: 10 },
  film: { color: 0xff4f9a, glow: 0xffa3d0, label: 'Film & VFX', dir: [-1, 0.15, 0.25], count: 6 },
  lab:  { color: 0x19c3e0, glow: 0x86f2ff, label: 'Lab', dir: [0.15, 0.1, -1], count: 8 },
  wild: { color: 0x2fcf8f, glow: 0xa5ffcf, label: 'Archive', dir: [-0.25, -0.55, 1], count: 8 },
};

/* local-space SDFs (q may be mutated) */
const SDF = {
  sphere: (q, p) => q.length() - p.r,
  box: (q, p) => {
    const x = Math.abs(q.x) - p.hx + p.rr, y = Math.abs(q.y) - p.hy + p.rr, z = Math.abs(q.z) - p.hz + p.rr;
    return Math.hypot(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)) + Math.min(Math.max(x, y, z), 0) - p.rr;
  },
  torus: (q, p) => Math.hypot(Math.hypot(q.x, q.y) - p.R, q.z) - p.r, // ring in local XY, like TorusGeometry
  capsule: (q, p) => Math.hypot(q.x, q.y - Math.max(-p.h, Math.min(p.h, q.y)), q.z) - p.r,
};
const BOUND = {
  sphere: p => p.r,
  box: p => Math.hypot(p.hx, p.hy, p.hz),
  torus: p => p.R + p.r,
  capsule: p => p.h + p.r,
};
const GEOM = {
  sphere: p => new THREE.SphereGeometry(p.r, 64, 40),
  box: p => new RoundedBoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2, 6, p.rr),
  torus: p => new THREE.TorusGeometry(p.R, p.r, 32, 110),
  capsule: p => new THREE.CapsuleGeometry(p.r, p.h * 2, 12, 36),
};

const TETRA = [new V3(1, -1, -1), new V3(-1, -1, 1), new V3(-1, 1, -1), new V3(1, 1, 1)];
const _t = new V3();
const _q = new V3();

/** Normalised gradient of a scalar field (tetrahedral differences, 4 taps). */
export function gradient(fn, p, out, e = 0.01) {
  out.set(0, 0, 0);
  for (const k of TETRA) out.addScaledVector(k, fn(_t.copy(k).multiplyScalar(e).add(p)));
  const l = out.length();
  return l > 1e-9 ? out.divideScalar(l) : out.set(0, 1, 0);
}

export class Body {
  constructor(type, params, pos, quat, zone) {
    this.type = type;
    this.params = params;
    this.pos = pos.clone();
    this.quat = quat.clone();
    this.inv = quat.clone().invert();
    this.zone = zone;
    this.bound = BOUND[type](params);
    this.sdfFn = p => this.sdf(p);
  }
  sdf(p) {
    _q.copy(p).sub(this.pos).applyQuaternion(this.inv);
    return SDF[this.type](_q, this.params);
  }
  normal(p, out) { return gradient(this.sdfFn, p, out); }
  /** Project a point from outside, along `dir` from the centre, onto the surface. */
  surfacePoint(dir, out) {
    const n = new V3();
    out.copy(dir).multiplyScalar(this.bound + 1).add(this.pos);
    for (let i = 0; i < 48; i++) {
      const d = this.sdf(out);
      if (Math.abs(d) < 1e-4) break;
      out.addScaledVector(this.normal(out, n), -d);
    }
    return out;
  }
  geometry() { return GEOM[this.type](this.params); }
}

export class Field {
  constructor(bodies, k = 2.5) {
    this.bodies = bodies;
    this.k = k;
    this.hardFn = p => this.hard(p);
    this.softFn = p => this.soft(p);
  }
  /** exact union — used for collision */
  hard(p) {
    let d = Infinity;
    for (const b of this.bodies) {
      if (b.pos.distanceTo(p) - b.bound > d) continue; // cannot beat current best
      const s = b.sdf(p);
      if (s < d) d = s;
    }
    return d;
  }
  /** polynomial smooth-min union — used for the gravity direction */
  soft(p) {
    const k = this.k;
    let d = Infinity;
    for (const b of this.bodies) {
      if (b.pos.distanceTo(p) - b.bound > d + k) continue;
      const s = b.sdf(p);
      if (d === Infinity) { d = s; continue; }
      const h = Math.max(k - Math.abs(d - s), 0) / k;
      d = Math.min(d, s) - h * h * k * 0.25;
    }
    return d;
  }
  gradHard(p, out) { return gradient(this.hardFn, p, out); }
  gradSoft(p, out) { return gradient(this.softFn, p, out); }
}

/** Build a seeded world: a hub plus one archipelago per zone. */
export function generateWorld(seed) {
  const rand = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rand();
  const randUnit = v => {
    const u = R(-1, 1), th = R(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
    return v.set(s * Math.cos(th), u, s * Math.sin(th));
  };
  const randQuat = () => new THREE.Quaternion().setFromEuler(new THREE.Euler(R(0, 6.28), R(0, 6.28), R(0, 6.28)));
  const alignQuat = m => {
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), m);
    return q.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), R(0, 6.28)));
  };

  const hub = new Body('box', { hx: 9, hy: 9, hz: 9, rr: 2.6 }, new V3(), new THREE.Quaternion(), 'hub');
  const bodies = [hub];
  const spawn = { pos: new V3(0, 9 + 0.55, 4), up: new V3(0, 1, 0), forward: new V3(0, 0, -1) };

  const randomBody = (zone, m) => {
    const r = rand();
    if (r < 0.5) {
      const hx = R(2.5, 8), hy = R(2.5, 8), hz = R(2.5, 8);
      const rr = Math.min(2.2, Math.max(0.9, Math.min(hx, hy, hz) * 0.38));
      return new Body('box', { hx, hy, hz, rr }, new V3(), rand() < 0.6 ? alignQuat(m) : randQuat(), zone);
    }
    if (r < 0.72) return new Body('sphere', { r: R(3, 8) }, new V3(), randQuat(), zone);
    if (r < 0.87) return new Body('capsule', { r: R(1.8, 3.4), h: R(3, 9) }, new V3(), randQuat(), zone);
    // torus arch: ring plane contains m, so it stands on the parent like a gateway
    const side = new V3().crossVectors(m, randUnit(new V3())).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), side);
    return new Body('torus', { R: R(6, 10), r: R(1.5, 2.4) }, new V3(), q, zone);
  };

  for (const [zone, z] of Object.entries(ZONES)) {
    if (zone === 'hub') continue;
    const zdir = new V3(...z.dir).normalize();
    const mine = [];
    let prev = hub, placed = 0, tries = 0;
    while (placed < z.count && tries++ < z.count * 40) {
      const parent = mine.length && rand() < 0.35 ? mine[Math.floor(rand() * mine.length)] : prev;
      const dir = randUnit(new V3()).multiplyScalar(0.8).add(zdir).normalize();
      const sp = parent.surfacePoint(dir, new V3());
      const n = parent.normal(sp, new V3());
      const m = n.clone().lerp(dir, 0.35).normalize();
      const body = randomBody(zone, m);

      if (body.type === 'torus') {
        if (parent === hub) continue; // keep the hub clean
        body.pos.copy(sp).addScaledVector(m, -body.params.R * 0.35);
      } else {
        // slide outwards along m until the gap to the parent's surface point is right
        const gap = R(1.0, 3.4);
        let lo = 0, hi = body.bound * 2 + gap + 2;
        for (let i = 0; i < 32; i++) {
          const t = (lo + hi) / 2;
          body.pos.copy(sp).addScaledVector(m, t);
          if (body.sdf(sp) < gap) lo = t; else hi = t;
        }
        body.pos.copy(sp).addScaledVector(m, hi);
        if (parent.sdf(body.pos) < 0.5) continue;
      }
      if (body.sdf(spawn.pos) < 6) continue;
      if (bodies.some(o => o !== parent && o.pos.distanceTo(body.pos) < 0.8 * (o.bound + body.bound))) continue;

      bodies.push(body);
      mine.push(body);
      if (body.type !== 'torus') prev = body;
      placed++;
    }
  }

  return { field: new Field(bodies), bodies, hub, spawn, rand };
}
