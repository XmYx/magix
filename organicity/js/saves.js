// Organicity — saved games. A saved game is the whole region at one moment: the city being
// played, the region file, and every other city and view on its tiles, gzipped into one record
// in IndexedDB (far more room than localStorage). Games can be saved, loaded, overwritten,
// renamed, deleted, exported to a .organicity-game file and imported again. The desktop app keeps
// them in its own profile the same way. Without IndexedDB (tests, locked-down browsers) the
// records live in memory for the session.
import { SAVE_KEY } from './save.js';
import { REGION_KEY } from './region.js';
import { encodeSave, decodeSave } from './share.js';

const DB = 'organicity', STORE = 'games', SLOT_KEY = 'organicity-slot';
export const AUTOSAVE_ID = 'autosave';
const mem = new Map();
let dbp = null;

function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return (dbp ||= new Promise((ok) => {
    try {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
      rq.onsuccess = () => ok(rq.result); rq.onerror = () => ok(null);
    } catch { ok(null); }
  }));
}
const req = (r) => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
async function store(mode) { const db = await open(); return db ? db.transaction(STORE, mode).objectStore(STORE) : null; }
const put = async (rec) => { const st = await store('readwrite'); return st ? req(st.put(rec)) : mem.set(rec.id, rec); };
const get = async (id) => { const st = await store('readonly'); return st ? req(st.get(id)) : mem.get(id); };
const all = async () => { const st = await store('readonly'); return st ? req(st.getAll()) : [...mem.values()]; };
const del = async (id) => { const st = await store('readwrite'); return st ? req(st.delete(id)) : mem.delete(id); };

// every stored key that belongs to the game being played
function gameKeys(ls) {
  let rid = null; try { rid = JSON.parse(ls.getItem(REGION_KEY) || 'null')?.id; } catch { rid = null; }
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k === SAVE_KEY || k === REGION_KEY || (rid && (k.startsWith(`organicity-city:${rid}:`) || k.startsWith(`organicity-view:${rid}:`)))) out.push(k);
  }
  return out;
}
export async function gatherBundle(ls = localStorage) {
  const keys = {}; for (const k of gameKeys(ls)) keys[k] = ls.getItem(k);
  return { v: 1, keys };
}
// replace the game in storage with a bundle (the caller then reloads into it)
export function restoreBundle(bundle, ls = localStorage) {
  const drop = []; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k === SAVE_KEY || k === REGION_KEY || k.startsWith('organicity-city:') || k.startsWith('organicity-view:')) drop.push(k); }
  for (const k of drop) ls.removeItem(k);
  for (const [k, v] of Object.entries(bundle.keys || {})) if (typeof v === 'string') ls.setItem(k, v);
}

const newId = () => 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
export async function listGames() {
  const list = await all();
  return list.map(({ data, ...meta }) => meta).sort((a, b) => (b.id === AUTOSAVE_ID) - (a.id === AUTOSAVE_ID) || b.updated - a.updated);
}
export async function saveGame({ id = null, name, meta = {}, thumb = null }, ls = localStorage) {
  const data = await encodeSave(await gatherBundle(ls)), old = id ? await get(id) : null, now = Date.now();
  const rec = { id: id || newId(), name: String(name || old?.name || meta.city || 'City').slice(0, 48), created: old?.created || now, updated: now, meta, thumb, size: data.length, data };
  await put(rec);
  if (rec.id !== AUTOSAVE_ID) try { ls.setItem(SLOT_KEY, rec.id); } catch { /* storage full */ }
  return rec.id;
}
export async function loadGame(id, ls = localStorage) {
  const rec = await get(id); if (!rec) throw new Error('That saved game is gone.');
  restoreBundle(await decodeSave(rec.data), ls);
  if (id !== AUTOSAVE_ID) try { ls.setItem(SLOT_KEY, id); } catch { /* ignore */ }
  return rec;
}
export async function renameGame(id, name) { const rec = await get(id); if (rec && name?.trim()) { rec.name = name.trim().slice(0, 48); await put(rec); } }
export async function deleteGame(id) { await del(id); }
export function currentSlot(ls = localStorage) { try { return ls.getItem(SLOT_KEY); } catch { return null; } }
// a file holding one saved game, and reading one back as a new saved game
export async function exportGame(id) {
  const rec = await get(id); if (!rec) throw new Error('That saved game is gone.');
  return JSON.stringify({ format: 'organicity-game', v: 1, name: rec.name, meta: rec.meta, thumb: rec.thumb, created: rec.created, data: rec.data });
}
export async function importGame(text) {
  const f = JSON.parse(text);
  if (f.format !== 'organicity-game' || typeof f.data !== 'string') throw new Error('Not an Organicity saved game.');
  const b = await decodeSave(f.data); if (!b || typeof b.keys !== 'object') throw new Error('The saved game is damaged.');
  const now = Date.now(), rec = { id: newId(), name: String(f.name || 'Imported city').slice(0, 48), created: f.created || now, updated: now, meta: f.meta || {}, thumb: typeof f.thumb === 'string' && f.thumb.startsWith('data:image/') ? f.thumb : null, size: f.data.length, data: f.data };
  await put(rec); return rec.id;
}
