// Organicity — content packs: JSON files that add district architecture styles and
// landmarks (with a simple box/cylinder model). Packs listed in packs/index.json load
// at start; players can add their own from Settings (kept in this browser). Every
// value is validated and every string sanitised before it reaches the game.
import { STYLES, SERVICES } from './config.js';

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
    model: (Array.isArray(L.model) ? L.model : []).slice(0, 40).map((p) => ({ kind: p?.cyl || p?.kind === 'cyl' ? 'cyl' : 'box', u: num(p?.u, -1, 1, 0), v: num(p?.v, -1, 1, 0), y: num(p?.y, 0, 120, 0), w: num(p?.w, 0.05, 1, 0.2), d: num(p?.d, 0.05, 1, 0.2), h: num(p?.h, 0.1, 120, 4), r: num(p?.r, 0.1, 20, 1), color: col(p?.color), roof: p?.roof != null ? col(p.roof) : null })),
  };
}

export function registerPack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('not a pack');
  const name = clean(pack.name) || 'Unnamed pack', out = { name, styles: [], landmarks: [] };
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
