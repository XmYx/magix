// Organicity — what a city looks like from next door, and what it offers the region.
//  • cityBlocks: its homes and workplaces as the regional economy's housing and job blocks
//  • viewSnapshot: a compact picture for drawing it beyond the map edge — a 128×128 grid of
//    ground classes and heights, plus a box per building (base, height, class)
// Used by the background tile worker and by the played city; no DOM, no three.js.
import { N, ZONES, FLOOR_H } from './config.js';
import { clamp, hash2 } from './util.js';
import { buildingFloors } from './eras.js';

export function cityBlocks(world, sim) {
  const H = [], J = [];
  const at = (f, b) => (f ? sim.at(f, b.cx, b.cz) : 0);
  for (const b of world.buildings.values()) {
    if (b.svc && b.jobs > 0 && !b.abandoned) J.push({ id: b.id, slots: Math.max(1, Math.round(b.jobs)), filled: 0, kind: 'I', level: 2, x: b.cx, z: b.cz });   // mines and plants
    if (b.svc || b.abandoned || b.rubble > 0) continue;
    if (b.hh > 0) {
      const services = (sim.bcov('clinic', b) + sim.bcov('school', b) + sim.bcov('police', b) + sim.bcov('fire', b)) / 4;
      H.push({ id: b.id, units: b.hh, occ: Math.max(0, Math.min(b.hh, Math.round(b.occ || 0))), quality: clamp(0.35 * b.level / 5 + 0.4 * (b.lv ?? 0.3) + 0.25 * (b.happy ?? 0.5), 0, 1), x: b.cx, z: b.cz, appeal: b.lv ?? 0.3, pollution: at(sim.f.pollution, b), crime: at(sim.f.crime, b), services });
    }
    if (b.jobs > 0) J.push({ id: b.id, slots: Math.max(1, Math.round(b.jobs)), filled: 0, kind: ZONES[b.zone].kind, level: b.level, x: b.cx, z: b.cz });
  }
  return { housing: H, jobs: J };
}

// ground classes: 0 land, 1 water, 2 road, 3–8 zones 1–6, 9 service lot, 10 woods
export const VIEW_S = 128;
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (str, Type = Uint8Array) => { const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Type(u.buffer); };

export function viewSnapshot(world) {
  const S = VIEW_S, k = N / S, cls = new Uint8Array(S * S), hgt = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = Math.min(N - 1, Math.floor(i * k + k / 2)), z = Math.min(N - 1, Math.floor(j * k + k / 2)), c = z * N + x, o = j * S + i;
    const bid = world.bld[c], b = bid && world.buildings.get(bid);
    cls[o] = world.water[c] ? 1 : world.road[c] ? 2 : b ? (b.svc ? 9 : 2 + b.zone) : world.zone[c] ? 2 + world.zone[c] : world.tree?.[c] || world.tree?.[c + 1] || world.tree?.[c + N] ? 10 : 0;
    hgt[o] = clamp(Math.round(world.heightAt(x + 0.5, z + 0.5) * 3), 0, 255);
  }
  const boxes = [];
  for (const b of world.buildings.values()) {
    if (b.platformId) continue;
    const h = b.svc ? 4 : b.rubble > 0 ? 1 : buildingFloors(b, world) * FLOOR_H + (b.zone === 1 && b.level <= 2 ? 1.5 : 0.4);
    boxes.push(Math.round(b.x0), Math.round(b.z0), Math.round(b.x1), Math.round(b.z1), Math.round((b.baseY || 0) * 4), Math.min(32000, Math.round(h * 4)), b.svc ? 9 : 2 + b.zone);
  }
  return { S, cls: b64(cls), hgt: b64(hgt), boxes: b64(new Uint8Array(new Int16Array(boxes).buffer)), n: boxes.length / 7 };
}

// ---------------------------------------------------------------- neighbours up close
// The procedural details that turn a neighbour's building boxes (a view's Int16 run of
// x0 z0 x1 z1 base×4 height×4 class) into recognisable kinds of building when the camera comes
// near: gable roofs on houses, crowns and masts on towers, chimneys and sheds on industry,
// awnings on shops. Three shared shapes, drawn instanced: a prism (a roof, its ridge along x),
// a box and a cylinder; each part is [x, y, z, sx, sy, sz, turn, colour].
const ROOFS = [0x9a4a3a, 0x7a5a48, 0x5a5e66, 0xa0643e], AWNINGS = [0xc8423a, 0x3a7ac8, 0x3aa05a, 0xd8a038];
export function archetypes(bx) {
  const out = { prism: [], box: [], cyl: [] };
  for (let i = 0; i + 6 < bx.length; i += 7) {
    const x0 = bx[i], z0 = bx[i + 1], x1 = bx[i + 2], z1 = bx[i + 3], y0 = bx[i + 4] / 4, h = Math.max(0.6, bx[i + 5] / 4), cls = bx[i + 6];
    const w = Math.max(1, (x1 - x0) * 0.8), d = Math.max(1, (z1 - z0) * 0.8), x = (x0 + x1) / 2, z = (z0 + z1) / 2, top = y0 + h, r = hash2(x0, z0, 431);
    const turn = d > w ? Math.PI / 2 : 0, long = Math.max(w, d), short = Math.min(w, d);
    if (cls === 3 && h <= 10) out.prism.push([x, top, z, long, Math.min(4, short * 0.45), short, turn, ROOFS[(r * ROOFS.length) | 0]]);   // houses: a pitched roof
    else if (cls === 6) {   // industry: a low shed roof and a chimney
      out.prism.push([x, top, z, long, 1.4, short, turn, 0x8a8e92]);
      out.cyl.push([x + w * 0.3, y0, z + d * 0.3, 1.3, h + 4 + r * 5, 1.3, 0, 0x9a6a58]);
    } else if (h >= 18) {   // towers: a set-back crown, the tallest a mast
      out.box.push([x, top, z, w * 0.62, Math.max(1.2, h * 0.07), d * 0.62, 0, 0xb8bcc4]);
      if (h >= 30) out.box.push([x, top + Math.max(1.2, h * 0.07), z, 0.35, h * 0.14, 0.35, 0, 0xd0d0d0]);
    } else if ((cls === 5 || cls === 8) && h <= 12) out.box.push([x, y0 + 2.4, z + d / 2 + 0.55, w * 0.9, 0.25, 1.1, 0, AWNINGS[(r * AWNINGS.length) | 0]]);   // shops: an awning over the street side
    else if (cls !== 9 && h > 3) out.box.push([x, top, z, w * 0.3, 1.2, d * 0.3, 0, 0x9aa0a8]);   // flat roofs: a plant room
  }
  return out;
}
