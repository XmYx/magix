// Organicity — runs the region's other cities in the background (tile-worker.js), on a small
// pool of workers, one job per worker and never two on the same tile: neighbours first, then tiles two steps away, each kept in step with the region's
// clock. AI tiles without a city get one founded by their governor. Results update the
// city's save, its numbers on the world map, the regional economy and its view next door.
import { cityKey, saveRegion, edgeMatchFor, stubsFor } from './region.js';
import { encodeSave, decodeSave } from './share.js';
import { START_ERAS } from './eras.js';

export const viewKey = (r, k) => `organicity-view:${r.id}:${k}`;
export function hasStoredView(r, k) { try { return localStorage.getItem(viewKey(r, k)) != null; } catch { return false; } }
export function loadView(r, k) { try { return JSON.parse(localStorage.getItem(viewKey(r, k)) || 'null'); } catch { return null; } }
export function storeView(r, k, v) { try { localStorage.setItem(viewKey(r, k), JSON.stringify(v)); } catch { /* storage full: the neighbour shows as a skyline */ } }

const MAX_DAYS = 60;
const VIEW_V = 2;   // pregenerated views are redrawn when what they show changes (2: woods)

// how many tile workers run side by side: half the machine's cores, at most three
export const POOL = Math.max(1, Math.min(3, Math.floor((globalThis.navigator?.hardwareConcurrency || 2) / 2)));

export class TileHost {
  constructor(region, econ, sim, hooks = {}) {
    this.r = region; this.econ = econ; this.sim = sim; this.hooks = hooks; this.id = 0; this.jobs = 0;
    this.pool = []; this.inflight = new Map();   // job id → { k, terrain, …, w }
    for (let i = 0; i < POOL; i++) {
      try {
        const w = new Worker(new URL('./tile-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this.done(e.data).catch((err) => { console.warn('Tile job failed', err); this.inflight.delete(e.data?.id); });
        w.onerror = (e) => { console.warn('Tile worker failed', e.message); this.pool = this.pool.filter((x) => x !== w); for (const [id, j] of this.inflight) if (j.w === w) this.inflight.delete(id); };
        this.pool.push(w);
      } catch { break; }
    }
    region.day ??= 0;
    econ.background = this.background();
  }
  get worker() { return this.pool[0] || null; }
  get busy() { return !this.idle(); }
  busyKeys() { return new Set([...this.inflight.values()].map((j) => j.k)); }
  idle() { const used = new Set([...this.inflight.values()].map((j) => j.w)); return this.pool.find((w) => !used.has(w)) || null; }
  dist(t) { const a = this.r.tiles[this.r.active]; return Math.abs(t.x - a.x) + Math.abs(t.z - a.z); }
  // which tiles run in the background (the regional economy leaves their treasuries to their own simulation)
  running() { return Object.entries(this.r.tiles).filter(([k, t]) => k !== this.r.active && (t.kind === 'city' || t.kind === 'ai') && t.gov !== 'remote' && this.dist(t) <= 2 && !t.failed).map(([k]) => k); }
  // tiles whose numbers come from elsewhere (this runner, another player, or in multiplayer the host), which the regional economy must not project
  background() {
    if (this.disabled) return new Set(Object.keys(this.r.tiles).filter((k) => k !== this.r.active));
    return new Set([...this.running(), ...Object.keys(this.r.tiles).filter((k) => this.r.tiles[k].gov === 'remote')]);
  }
  pick() {
    const day = this.r.day, skip = this.busyKeys(); let best = null, bs = 0;
    for (const k of this.running()) {
      if (skip.has(k)) continue;
      const t = this.r.tiles[k], d = this.dist(t), stored = !!localStorage.getItem(cityKey(this.r, k));
      t.simDay ??= day;
      const score = !stored ? (t.kind === 'ai' ? 1e6 / d : 0) : (day - t.simDay) >= (d === 1 ? 15 : 45) ? (day - t.simDay) / d : 0;
      if (score > bs) { bs = score; best = k; }
    }
    return best;
  }
  // the next tile whose land is still unmade: nearest first, so each one continues its neighbours
  pickTerrain() {
    const here = this.r.tiles[this.r.active]; if (!here?.edges && !here?.summary?.edges) return null;
    const skip = this.busyKeys(); let best = null, bd = Infinity;
    for (const [k, t] of Object.entries(this.r.tiles)) {
      if (k === this.r.active || skip.has(k) || (t.edges && t.tv === VIEW_V) || t.failed || (t.kind === 'city' && localStorage.getItem(cityKey(this.r, k)))) continue;
      if (t.kind === 'ai' && this.dist(t) <= 2) continue;   // its governor founds a real city there
      const d = this.dist(t); if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  // start jobs on every idle worker (several tiles progress at once on a machine with the cores for it)
  async tick() {
    this.econ.background = this.background();
    if (this.disabled) return;   // a multiplayer guest: the host runs the region
    for (let w = this.idle(); w; w = this.idle()) if (!(await this.start(w))) break;
  }
  async start(w) {
    const k = this.pick(), id = ++this.id;
    if (!k) {
      const tk = this.pickTerrain(); if (!tk) return false;
      const t = this.r.tiles[tk], em = t.edges ? t.em ?? null : edgeMatchFor(this.r, tk);   // a redrawn view keeps its land
      this.inflight.set(id, { k: tk, terrain: true, em, w });
      w.postMessage({ id, key: tk, size: this.r.tileSize || 512, terrain: { seed: t.seed, preset: t.preset, edgeMatch: em } });
      return true;
    }
    const job = { k, w }; this.inflight.set(id, job);   // claimed before the save is decoded, so no other worker takes it
    try {
      const r = this.r, t = r.tiles[k], st = this.econ.tile(k), sim = this.sim, code = localStorage.getItem(cityKey(r, k));
      const msg = { id, key: k, gov: t.gov || (t.kind === 'ai' ? 'ai' : 'player'), policy: st?.policy, credit: Math.round(st?.pendingTolls || 0), occ: this.econ.occupancy(k), days: 0, size: this.r.tileSize || 512 };
      if (!code) msg.generate = { seed: t.seed, preset: t.preset, edgeMatch: edgeMatchFor(r, k), stubs: stubsFor(r, k), startYear: [...START_ERAS].reverse().find((y) => y <= sim.year) || 2000, eraPace: sim.eraPace, year: sim.year };
      else { msg.save = await decodeSave(code); msg.days = Math.min(MAX_DAYS, Math.max(0, r.day - t.simDay)); }
      if (st) st.pendingTolls = 0;
      Object.assign(job, { days: msg.days, generated: !code });
      w.postMessage(msg);
      return true;
    } catch (e) { console.warn('Could not start a tile job', e); this.inflight.delete(id); return false; }
  }
  async done(res) {
    const job = this.inflight.get(res.id); this.inflight.delete(res.id);
    const r = this.r, t = r.tiles[res.key]; if (!t || !job) return;
    if (!res.ok) { t.failed = true; console.warn('Tile simulation failed', res.key, res.err); return; }
    if (job.terrain) {   // pregenerated land: remembered with the match it was made with
      t.edges = res.edges; t.em = job.em || null; t.tv = VIEW_V; storeView(this.r, res.key, res.view);
      this.hooks.onTerrain?.(res.key); saveRegion(r); return;
    }
    localStorage.setItem(cityKey(r, res.key), await encodeSave(res.save));
    t.kind = 'city'; t.gov ??= 'ai'; t.owned = t.gov === 'player';
    t.simDay = job.generated ? r.day : t.simDay + job.days;
    t.summary = { ...res.summary, thumb: this.hooks.thumb?.(res.view) ?? t.summary?.thumb ?? null };
    storeView(r, res.key, res.view);
    this.econ.updateTile(res.key, res.blocks, res.summary);
    this.jobs++;
    this.hooks.onTile?.(res.key, res, job);
    this.econ.pack(); saveRegion(r);
  }
}
