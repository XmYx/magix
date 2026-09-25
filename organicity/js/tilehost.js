// Organicity — runs the region's other cities in the background (tile-worker.js), one job at
// a time: neighbours first, then tiles two steps away, each kept in step with the region's
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

export class TileHost {
  constructor(region, econ, sim, hooks = {}) {
    this.r = region; this.econ = econ; this.sim = sim; this.hooks = hooks; this.busy = false; this.id = 0; this.worker = null; this.jobs = 0;
    try {
      this.worker = new Worker(new URL('./tile-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.done(e.data).catch((err) => { console.warn('Tile job failed', err); this.busy = false; });
      this.worker.onerror = (e) => { console.warn('Tile worker failed', e.message); this.worker = null; };
    } catch { this.worker = null; }
    region.day ??= 0;
    econ.background = this.background();
  }
  dist(t) { const a = this.r.tiles[this.r.active]; return Math.abs(t.x - a.x) + Math.abs(t.z - a.z); }
  // which tiles run in the background (the regional economy leaves their treasuries to their own simulation)
  running() { return Object.entries(this.r.tiles).filter(([k, t]) => k !== this.r.active && (t.kind === 'city' || t.kind === 'ai') && t.gov !== 'remote' && this.dist(t) <= 2 && !t.failed).map(([k]) => k); }
  // tiles whose numbers come from elsewhere (this runner, another player, or in multiplayer the host), which the regional economy must not project
  background() {
    if (this.disabled) return new Set(Object.keys(this.r.tiles).filter((k) => k !== this.r.active));
    return new Set([...this.running(), ...Object.keys(this.r.tiles).filter((k) => this.r.tiles[k].gov === 'remote')]);
  }
  pick() {
    const day = this.r.day; let best = null, bs = 0;
    for (const k of this.running()) {
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
    let best = null, bd = Infinity;
    for (const [k, t] of Object.entries(this.r.tiles)) {
      if (k === this.r.active || (t.edges && t.tv === VIEW_V) || t.failed || (t.kind === 'city' && localStorage.getItem(cityKey(this.r, k)))) continue;
      if (t.kind === 'ai' && this.dist(t) <= 2) continue;   // its governor founds a real city there
      const d = this.dist(t); if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  async tick() {
    this.econ.background = this.background();
    if (!this.worker || this.busy || this.disabled) return;   // a multiplayer guest: the host runs the region
    const k = this.pick();
    if (!k) {
      const tk = this.pickTerrain(); if (!tk) return;
      const t = this.r.tiles[tk], em = t.edges ? t.em ?? null : edgeMatchFor(this.r, tk);   // a redrawn view keeps its land
      this.busy = true; this.job = { k: tk, terrain: true, em };
      this.worker.postMessage({ id: ++this.id, key: tk, terrain: { seed: t.seed, preset: t.preset, edgeMatch: em } });
      return;
    }
    this.busy = true;
    try {
      const r = this.r, t = r.tiles[k], st = this.econ.tile(k), sim = this.sim, code = localStorage.getItem(cityKey(r, k));
      const msg = { id: ++this.id, key: k, gov: t.gov || (t.kind === 'ai' ? 'ai' : 'player'), policy: st?.policy, credit: Math.round(st?.pendingTolls || 0), occ: this.econ.occupancy(k), days: 0 };
      if (!code) msg.generate = { seed: t.seed, preset: t.preset, edgeMatch: edgeMatchFor(r, k), stubs: stubsFor(r, k), startYear: [...START_ERAS].reverse().find((y) => y <= sim.year) || 2000, eraPace: sim.eraPace, year: sim.year };
      else { msg.save = await decodeSave(code); msg.days = Math.min(MAX_DAYS, Math.max(0, r.day - t.simDay)); }
      if (st) st.pendingTolls = 0;
      this.job = { k, days: msg.days, generated: !code };
      this.worker.postMessage(msg);
    } catch (e) { console.warn('Could not start a tile job', e); this.busy = false; }
  }
  async done(res) {
    const job = this.job; this.busy = false; this.job = null;
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
