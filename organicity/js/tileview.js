// Organicity — what a city looks like from next door, and what it offers the region.
//  • cityBlocks: its homes and workplaces as the regional economy's housing and job blocks
//  • viewSnapshot: a compact picture for drawing it beyond the map edge — a 128×128 grid of
//    ground classes and heights, plus a box per building (base, height, class)
// Used by the background tile worker and by the played city; no DOM, no three.js.
import { N, ZONES, FLOOR_H } from './config.js';
import { clamp } from './util.js';
import { buildingFloors } from './eras.js';

export function cityBlocks(world, sim) {
  const H = [], J = [];
  const at = (f, b) => (f ? sim.at(f, b.cx, b.cz) : 0);
  for (const b of world.buildings.values()) {
    if (b.svc || b.abandoned || b.rubble > 0) continue;
    if (b.hh > 0) {
      const services = (sim.bcov('clinic', b) + sim.bcov('school', b) + sim.bcov('police', b) + sim.bcov('fire', b)) / 4;
      H.push({ id: b.id, units: b.hh, occ: Math.max(0, Math.min(b.hh, Math.round(b.occ || 0))), quality: clamp(0.35 * b.level / 5 + 0.4 * (b.lv ?? 0.3) + 0.25 * (b.happy ?? 0.5), 0, 1), x: b.cx, z: b.cz, appeal: b.lv ?? 0.3, pollution: at(sim.f.pollution, b), crime: at(sim.f.crime, b), services });
    }
    if (b.jobs > 0) J.push({ id: b.id, slots: Math.max(1, Math.round(b.jobs)), filled: 0, kind: ZONES[b.zone].kind, level: b.level, x: b.cx, z: b.cz });
  }
  return { housing: H, jobs: J };
}

// ground classes: 0 land, 1 water, 2 road, 3–8 zones 1–6, 9 service lot
export const VIEW_S = 128;
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (str, Type = Uint8Array) => { const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Type(u.buffer); };

export function viewSnapshot(world) {
  const S = VIEW_S, k = N / S, cls = new Uint8Array(S * S), hgt = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = Math.min(N - 1, Math.floor(i * k + k / 2)), z = Math.min(N - 1, Math.floor(j * k + k / 2)), c = z * N + x, o = j * S + i;
    const bid = world.bld[c], b = bid && world.buildings.get(bid);
    cls[o] = world.water[c] ? 1 : world.road[c] ? 2 : b ? (b.svc ? 9 : 2 + b.zone) : world.zone[c] ? 2 + world.zone[c] : 0;
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
