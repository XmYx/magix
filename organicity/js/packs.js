// Organicity — content packs: JSON files that add district architecture styles, landmarks,
// general buildables (services, utilities, industry) and scenarios. Models are boxes (with
// window facades), cylinders, glowing signs and pitched roofs. Packs listed in
// packs/index.json load at start; players can add their own from Settings (kept in this
// browser). Every value is validated and every string sanitised before it reaches the game.
// The format is documented in packs/README.md.
import { STYLES, SERVICES, ROADS, ZONES } from './config.js';
import { SCENARIOS } from './scenarios.js';

const KEY = 'organicity-packs';
const clean = (s, n = 60) => String(s ?? '').replace(/[<>&"'`]/g, '').trim().slice(0, n);
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const col = (v) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v) ? parseInt(v.replace('#', ''), 16) : 0x999999);

export const loaded = [];

// A validated landmark definition; also used for definitions carried inside saves
// (which may come from shared links), so nothing unchecked reaches the interface.
export function landmarkDef(L, pack, key) {
  return {
    cat: 'svc', pack: clean(pack) || 'Pack', name: clean(L.name) || key, w: num(L.w, 4, 40, 12), d: num(L.d, 4, 40, 12), cost: num(L.cost, 0, 500000, 20000), upkeep: num(L.upkeep, 0, 20000, 400),
    park: num(L.park, 0, 200, 60), landmark: num(L.unlock ?? L.landmark, 0, 1e6, 1000), tourism: num(L.tourism, 0, 20000, 1000), noise: num(L.noise, 0, 1, 0), desc: clean(L.desc, 160),
    model: model(L.model),
  };
}
const ROOFS = ['flat', 'gable', 'hip', 'pyramid', 'dome', 'spire'], WINDOWS = { true: 'res', res: 'res', off: 'off', office: 'off', com: 'com', shop: 'shop' };
function model(parts) {
  return (Array.isArray(parts) ? parts : []).slice(0, 60).map((p) => ({
    kind: p?.kind === 'sign' ? 'sign' : p?.cyl || p?.kind === 'cyl' ? 'cyl' : 'box',
    u: num(p?.u, -1, 1, 0), v: num(p?.v, -1, 1, 0), y: num(p?.y, 0, 120, 0), w: num(p?.w, 0.02, 1, 0.2), d: num(p?.d, 0.02, 1, 0.2), h: num(p?.h, 0.05, 120, 4), r: num(p?.r, 0.1, 20, 1),
    color: col(p?.color), roof: p?.roof != null ? col(p.roof) : null,
    roofShape: ROOFS.includes(p?.roofShape) ? p.roofShape : null, roofH: num(p?.roofH, 0.2, 60, 3), roofColor: p?.roofColor != null ? col(p.roofColor) : null,
    windows: WINDOWS[String(p?.windows)] || null,
  }));
}
// a general buildable: a service, utility or industry building with effects the game understands
const COVERS = ['fire', 'police', 'clinic', 'school'];
export function buildableDef(B, pack, key) {
  const e = B?.effects || {}, cat = ['svc', 'util', 'ind'].includes(B?.cat) ? B.cat : 'svc';
  const def = { cat, pack: clean(pack) || 'Pack', name: clean(B?.name) || key, w: num(B?.w, 4, 40, 10), d: num(B?.d, 4, 40, 10), cost: num(B?.cost, 0, 500000, 10000), upkeep: num(B?.upkeep, 0, 20000, 200), desc: clean(B?.desc, 200), model: model(B?.model) };
  if (B?.unlock) def.unlock = num(B.unlock, 0, 1e6, 0);
  if (B?.nearWater) def.nearWater = true;
  for (const [k, lo, hi] of [['park', 0, 200], ['tourism', 0, 20000], ['noise', 0, 1], ['pollution', 0, 1], ['jobs', 0, 500], ['power', 0, 2000], ['water', 0, 5000], ['sewage', 0, 5000], ['radius', 0, 120], ['seats', 0, 5000], ['patients', 0, 5000]]) if (e[k] != null) def[k] = num(e[k], lo, hi, 0);
  if (COVERS.includes(e.covers)) { def.covers = e.covers; def.radius ??= 30; }
  return def;
}
// a scenario: a map, a scripted start and goals to reach, optionally by a deadline
const STATS = ['pop', 'money', 'surplus', 'happiness', 'unemployment', 'jobs', 'buildings', 'transit', 'pollution', 'year'];
export function scenarioDef(S, pack) {
  const pt = (a) => (Array.isArray(a) ? a.map((v) => num(v, 0, 512, 0)) : []);
  const set = S?.setup || {};
  return {
    name: clean(S?.name) || 'Pack scenario', desc: clean(S?.desc, 240), pack: clean(pack) || 'Pack', seed: num(S?.seed, 0, 1e9, 1234) | 0,
    map: ['river', 'hills', 'coast', 'islands'].includes(S?.map) ? S.map : 'river', startYear: [1800, 1900, 2000].includes(S?.startYear) ? S.startYear : 2000,
    money: num(S?.money, -1e6, 1e7, 60000), deadlineDays: S?.deadlineDays != null ? num(S.deadlineDays, 30, 36000, 720) : null,
    goals: (Array.isArray(S?.goals) ? S.goals : []).slice(0, 8).filter((g) => STATS.includes(g?.stat)).map((g) => ({ label: clean(g.label, 60) || `${g.stat} ${g.op || '>='} ${g.value}`, stat: g.stat, op: g.op === '<=' ? '<=' : '>=', value: num(g.value, -1e9, 1e9, 0) })),
    setup: {
      roads: (Array.isArray(set.roads) ? set.roads : []).slice(0, 80).map((r) => ({ a: pt(r?.from).slice(0, 2), b: pt(r?.to).slice(0, 2), type: ROADS[r?.type] ? r.type : 'street' })).filter((r) => r.a.length === 2 && r.b.length === 2),
      zones: (Array.isArray(set.zones) ? set.zones : []).slice(0, 80).map((z) => ({ at: pt(z?.at).slice(0, 2), zone: num(z?.zone, 1, ZONES.length - 1, 1) | 0 })).filter((z) => z.at.length === 2),
      services: (Array.isArray(set.services) ? set.services : []).slice(0, 60).map((s) => ({ key: String(s?.key || ''), at: pt(s?.at).slice(0, 2) })).filter((s) => s.at.length === 2 && /^[a-z_0-9]{2,30}$/.test(s.key)),
      populate: num(set.populate, 0, 5, 0) | 0,
    },
  };
}

export function registerPack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('not a pack');
  const name = clean(pack.name) || 'Unnamed pack', out = { name, styles: [], landmarks: [], buildables: [], scenarios: [] };
  for (const [k, s] of Object.entries(pack.styles || {}).slice(0, 20)) {
    const key = `pk_${slug(k)}`; if (key === 'pk_') continue;
    STYLES[key] = { name: clean(s?.name) || key, walls: (s?.walls || []).slice(0, 8).map(col), roof: (s?.roof || []).slice(0, 6).map(col), pack: name };
    out.styles.push(key);
  }
  for (const [k, L] of Object.entries(pack.landmarks || {}).slice(0, 20)) {
    const key = `pk_${slug(k)}`; if (key === 'pk_' || !L) continue;
    SERVICES[key] = landmarkDef(L, name, key);
    out.landmarks.push(key);
  }
  for (const [k, B] of Object.entries(pack.buildables || {}).slice(0, 30)) {
    const key = `pk_${slug(k)}`; if (key === 'pk_' || !B || (SERVICES[key] && !SERVICES[key].pack)) continue;
    SERVICES[key] = buildableDef(B, name, key);
    out.buildables.push(key);
  }
  for (const [k, S] of Object.entries(pack.scenarios || {}).slice(0, 10)) {
    const key = `pk_${slug(k)}`; if (key === 'pk_' || !S) continue;
    const def = scenarioDef(S, name); SCENARIOS[key] = { name: def.name, desc: def.desc, seed: def.seed, map: def.map, startYear: def.startYear, def };
    out.scenarios.push(key);
  }
  loaded.push(out);
  return out;
}

export function userPacks() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function addUserPack(text) {
  const pack = JSON.parse(text), info = registerPack(pack);
  const list = userPacks().filter((p) => clean(p.name) !== info.name); list.push(pack);
  localStorage.setItem(KEY, JSON.stringify(list)); return info;
}
export function removeUserPack(name) { localStorage.setItem(KEY, JSON.stringify(userPacks().filter((p) => clean(p.name) !== name))); }

// the bundled packs (packs/index.json) and the player's own
export async function loadPacks(base = 'packs/') {
  try {
    const index = await (await fetch(`${base}index.json`)).json();
    for (const f of (index.packs || []).slice(0, 20)) { try { registerPack(await (await fetch(base + f)).json()); } catch (e) { console.warn('Pack failed:', f, e.message); } }
  } catch { /* no bundled packs (offline first run) */ }
  for (const p of userPacks()) { try { registerPack(p); } catch { /* skip broken */ } }
  return loaded;
}
