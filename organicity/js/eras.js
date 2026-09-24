// Shared progression rules keep visible storeys and simulated capacity identical.
import { FLOORS, ZONES, FLOOR_H } from './config.js';
import { hash2 } from './util.js';
export const START_ERAS = [1800, 1900, 2000];
export const TERRACE_SERVICES = ['parkS', 'parkL', 'plaza', 'clinic', 'school', 'fire', 'police', 'busstop', 'busdepot', 'depot', 'tower', 'wind'];
export function technology(year = 2000) {
  const heightLimit = year < 1900 ? 3 + Math.floor(Math.max(0, year - 1800) / 15)
    : year < 2000 ? 10 + Math.floor((year - 1900) * 0.3) : 40 + Math.floor((year - 2000) * 0.8);
  return { year, heightLimit, style: year < 1900 ? 'heritage' : year < 2000 ? 'industrial' : year < 2050 ? 'modern' : 'cyberpunk', terraces: year >= 2025, flying: year >= 2050 };
}
export function buildingFloors(b, world) {
  if (b.svc) return 1;
  const zone = ZONES[b.zone], table = FLOORS[zone.key], range = table[Math.min(b.level, table.length-1)];
  const policy = world.policyAt(b), year = (b.locked || policy?.historic) ? b.heightYear ?? world.year ?? 2000 : world.year ?? 2000;
  const tech = technology(year), base = Math.round((range[0] + range[1])/2);
  const tall = ['rh','o','m','c'].includes(zone.key);
  const extra = tall && b.level >= 3 ? Math.floor(Math.max(0, year-2000) * (b.level-2) * 0.28) : 0;
  // a stable per-building factor (0.6–1.6×) gives dense blocks a ragged, real-city skyline
  const vary = tall && b.level >= 2 ? 0.6 + hash2(b.id, b.level, 97) : 1;
  return Math.max(1, Math.min(Math.round((base+extra) * vary), tech.heightLimit, policy?.maxFloors > 0 ? policy.maxFloors : Infinity));
}

// Automatic aerial trunk links join dense, road-connected hubs. They never grant
// ground utility access across disconnected networks. Rebuilt from city state.
export function skyNetwork(world) {
  if (!technology(world.year).flying) return { hubs: [], links: [], share: 0 };
  const hubs = [...world.buildings.values()].filter(b => !b.svc && !b.abandoned && !b.fire && !(b.constructionUntil > world.day) && b.level >= 3 && buildingFloors(b,world) >= 12 && b.edge >= 0)
    .sort((a,b) => buildingFloors(b,world)-buildingFloors(a,world) || a.id-b.id).slice(0,32);
  const links=[];
  const altitude=Math.max(30,...[...world.buildings.values()].filter(b=>!b.svc).map(b=>buildingFloors(b,world)*1.6+18));
  for(let i=1;i<hubs.length;i++) {
    const b=hubs[i];let nearest=null,dist=Infinity;
    for(let j=0;j<i;j++) {
      const a=hubs[j], ea=world.net.edges.get(a.edge), eb=world.net.edges.get(b.edge);
      if(!ea || !eb || world.net.compOf(ea)!==world.net.compOf(eb))continue;
      const d=Math.hypot(a.cx-b.cx,a.cz-b.cz);if(d<dist){dist=d;nearest=a;}
    }
    if(nearest)links.push({a:nearest.id,b:b.id,x0:nearest.cx,z0:nearest.cz,x1:b.cx,z1:b.cz,y:altitude,len:dist});
  }
  return { hubs: hubs.map(b=>b.id), links, share: links.length ? Math.min(0.35,0.1+links.length*0.015) : 0 };
}

// Annex and cantilever volumes are decided here, not in the mesh generator, so the
// storeys they add to the skyline also add to capacity (bonus, in whole-footprint floors).
export function massPlan(b, world) {
  const none = { annex: null, canti: [], bonus: 0 };
  if (b.svc) return none;
  const key = ZONES[b.zone].key; if (key === 'i') return none;
  const floors = buildingFloors(b, world) - (key === 'c' || key === 'm' ? 1 : 0);
  const h = (s) => hash2(b.id, b.level * 131 + floors, s);
  const annex = floors >= 5 && (b.area || 0) >= 60 && h(1) < 0.6 ? { angle: h(2) * Math.PI, extra: Math.round(floors * (0.15 + h(3) * 0.45)) + 1 } : null;
  const canti = [];
  if (floors >= 8) for (let k = 0, n = 1 + Math.floor(h(4) * 3); k < n; k++) {
    const storeys = 2 + Math.floor(h(10 + k) * 4), start = Math.round(floors * (0.3 + h(20 + k) * 0.5));
    if (start + storeys <= floors) canti.push({ start, storeys, depth: 1.5 + h(30 + k) * 2.5, width: 3 + h(40 + k) * 4, t: 0.25 + h(50 + k) * 0.5, edge: h(60 + k) });
  }
  // an annex covers roughly half the footprint; a cantilever about a tenth of a floor plate
  return { floors, annex, canti, bonus: (annex ? annex.extra * 0.45 : 0) + canti.reduce((s, c) => s + c.storeys * 0.1, 0) };
}

// Glass skybridges join nearby towers from the modern era on. Linked towers share
// service coverage and earn a small land-value bonus. Rebuilt from city state.
export function skyBridges(world) {
  const style = technology(world.year).style;
  if (style !== 'modern' && style !== 'cyberpunk') return [];
  const towers = [...world.buildings.values()].map((b) => [b, b.svc || b.abandoned || b.level < 4 ? 0 : buildingFloors(b, world) * FLOOR_H])
    .filter(([, h]) => h > 16).sort((p, q) => p[0].id - q[0].id);
  const out = [], used = new Map();
  for (let i = 0; i < towers.length && out.length < 40; i++) for (let j = i + 1; j < towers.length && out.length < 40; j++) {
    const [a, ha] = towers[i], [b, hb] = towers[j], d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
    if (d < 8 || d > 34 || hash2(a.id, b.id, 61) > 0.45 || (used.get(a.id) || 0) >= 2 || (used.get(b.id) || 0) >= 2) continue;
    const y = Math.round(Math.min(ha, hb) * (0.45 + hash2(a.id, b.id, 62) * 0.35) / FLOOR_H) * FLOOR_H;
    out.push({ a: a.id, b: b.id, x0: a.cx, z0: a.cz, x1: b.cx, z1: b.cz, y, len: d });
    used.set(a.id, (used.get(a.id) || 0) + 1); used.set(b.id, (used.get(b.id) || 0) + 1);
  }
  return out;
}
