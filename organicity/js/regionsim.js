import { holdElection } from './citizens.js';
// Organicity — the regional economy. Every city tile of the region (yours and the AI's) has
// a president, a treasury, housing blocks with rents and job blocks with salaries. Families
// live in the housing, work in the jobs (in their own tile or a linked neighbour), pay rent,
// commuting costs and tolls, and move — within a tile or to another — when clearly better off.
//
// Tiles are simulated at three levels:
//   full — the tile you are playing: real buildings, traffic and families;
//   near — tiles next to it: families and full economic and migration logic, no traffic;
//   far  — the rest: aggregate population, jobs, housing, treasury and migration flows.
// AI cities have no map; their housing and jobs are synthetic blocks, handled in aggregate.
//
// Each month, in this order: president policy → rents, taxes, tolls and services → jobs and
// housing conditions → family decisions → migration and commuting → traffic through the
// portals → population and treasury → (yearly) presidential decisions, annual statistics and,
// every ten years, the end of a presidential term.
import { N, ZONES } from './config.js';
import { hash2, clamp } from './util.js';
import { OPPOSITE, neighbours, tileKey, exitsOf } from './region.js';
import { newPresident, clampPolicy, applyPolicy, aiDecide, predict, POLICY_DEFAULT } from './presidents.js';
import { cityBlocks } from './tileview.js';
import { commute, rentOf, salaryOf, newFamily, reconsider, settle, bestJob, utility, sampleHomes, THRESHOLD, WORKDAYS } from './families.js';

export const TERM_YEARS = 10;
const edgePoint = (side, pos) => (side === 'west' ? [0.5, pos] : side === 'east' ? [N - 0.5, pos] : side === 'north' ? [pos, 0.5] : [pos, N - 0.5]);
const F_KEYS = ['id', 'tile', 'home', 'wt', 'wid', 'size', 'earners', 'savings', 'income', 'rent', 'commute', 'toll', 'happy', 'moved', 'next'];
const packF = (f) => F_KEYS.map((k) => f[k] ?? null);
const unpackF = (a) => Object.fromEntries(F_KEYS.map((k, i) => [k, a[i]]));
const H_KEYS = ['id', 'units', 'occ', 'quality', 'x', 'z', 'appeal', 'pollution', 'crime', 'services'];
const J_KEYS = ['id', 'slots', 'filled', 'kind', 'level', 'x', 'z'];
const packRows = (map, keys) => [...map.values()].map((o) => keys.map((k) => (typeof o[k] === 'number' ? +o[k].toFixed(3) : o[k])));
const unpackRows = (rows, keys) => new Map((rows || []).map((a) => { const o = Object.fromEntries(keys.map((k, i) => [k, a[i]])); return [o.id, o]; }));

export class RegionSim {
  constructor(region) {
    this.r = region;
    this.e = region.econ ||= { tiles: {}, families: [], nextFamily: 1, history: {}, terms: [], termStart: null, lastYear: null };
    this.families = new Map((this.e.families || []).map((a) => { const f = unpackF(a); return [f.id, f]; }));
    this.tiles = new Map();
    for (const [k, t] of Object.entries(region.tiles)) if (t.kind === 'city' || t.kind === 'ai') this.tiles.set(k, this.loadTile(k, t));
    this.events = []; this.day = 0; this.active = null; this.portals = []; this.between = new Map(); this.reach = new Map();
  }

  // ---------------------------------------------------------------- tiles
  loadTile(k, t) {
    const s = this.e.tiles[k] ||= {};
    const st = {
      key: k, kind: t.kind, level: 'far',
      president: s.president || newPresident(this.r.seed, k, t.kind === 'city' ? 'player' : 'ai', 0),
      policy: clampPolicy(s.policy || POLICY_DEFAULT),
      treasury: s.treasury ?? (t.kind === 'city' ? t.summary?.money ?? 0 : Math.round((t.pop || 20000) * 6)),
      housing: unpackRows(s.housing, H_KEYS), jobs: unpackRows(s.jobs, J_KEYS),
      acc: s.acc || { income: 0, expense: 0, tolls: 0, migIn: 0, migOut: 0, crossings: 0 },
      month: { tolls: 0, crossings: 0, migIn: 0, migOut: 0 }, predicted: s.predicted || null, pendingTolls: s.pendingTolls || 0,
    };
    if (t.kind === 'ai' && !st.housing.size) this.synthesize(st, t);
    this.govern(st, t);
    return st;
  }
  // an AI city as 24 housing blocks and 16 job blocks spread over its tile
  synthesize(st, t) {
    const pop = t.pop || 30000, hh = pop / 2.6, h = (i, s) => hash2(i, (t.x * 7 + t.z) * 13 + 5, s);
    for (let i = 0; i < 24; i++) {
      const units = Math.ceil(hh / 24 / 0.93);
      st.housing.set(i + 1, { id: i + 1, units, occ: Math.round(units * 0.93), quality: 0.3 + h(i, 1) * 0.5, x: 40 + h(i, 2) * 430, z: 40 + h(i, 3) * 430, appeal: 0.4 + h(i, 4) * 0.4, pollution: h(i, 5) * 0.3, crime: h(i, 6) * 0.3, services: 0.5 + h(i, 7) * 0.4 });
    }
    for (let i = 0; i < 16; i++) {
      const slots = Math.ceil(pop * 0.45 / 16);
      st.jobs.set(i + 1, { id: i + 1, slots, filled: Math.round(slots * 0.9), kind: ['C', 'I', 'O', 'C'][i % 4], level: 2 + Math.floor(h(i, 8) * 3), x: 40 + h(i, 9) * 430, z: 40 + h(i, 10) * 430 });
    }
  }
  tile(k) { return this.tiles.get(k); }

  // ---------------------------------------------------------------- attaching the played tile
  attach(sim, world, active) {
    this.sim = sim; this.world = world; this.active = active; this.day = sim.day;
    for (const st of this.tiles.values()) st.level = 'far';
    const act = this.tiles.get(active); act.level = 'full';
    for (const { t } of neighbours(this.r, active)) { const st = this.tiles.get(tileKey(t.x, t.z)); if (st) st.level = 'near'; }
    for (const st of this.tiles.values()) if (!st.president.since) st.president.since = sim.year;
    this.e.termStart ??= sim.year; this.e.lastYear ??= sim.year;
    // returning to a city: its treasury kept evolving in the background
    if (this.e.tiles[active]?.left != null) sim.money = act.treasury;
    applyPolicy(sim, act.policy);
    sim.regionSim = this; this.netVersion = world.net.version;
    this.buildPortals(); this.refreshActive(); this.conditions(); this.index();
    return this;
  }
  setPolicy(k, patch) {
    const st = this.tiles.get(k); if (!st) return null;
    st.policy = clampPolicy({ ...st.policy, ...patch });
    if (k === this.active && this.sim) applyPolicy(this.sim, st.policy);
    return st.policy;
  }

  // ---------------------------------------------------------------- 1. portals
  // Road exits become portals: an exit on a shared side links to the neighbour's exit at the
  // same place (within 16 cells). AI cities accept any exit facing them. Unmatched exits are
  // dead ends (the border posts show where the neighbour's road arrives).
  exitsFor(k) {
    const st = this.tiles.get(k);
    if (k === this.active) return exitsOf(this.world);
    if (st.kind === 'ai') return neighbours(this.r, k).map(({ dir }) => ({ side: dir, pos: N / 2, virtual: true }));
    return this.r.tiles[k].summary?.exits || [];
  }
  buildPortals() {
    this.portals = []; this.between = new Map();
    for (const [k] of this.tiles) for (const { dir, t } of neighbours(this.r, k)) {
      const nk = tileKey(t.x, t.z), nst = this.tiles.get(nk); if (!nst) continue;
      const mine = this.exitsFor(k).filter((x) => x.side === dir), theirs = this.exitsFor(nk).filter((x) => x.side === OPPOSITE[dir]);
      for (const x of mine) {
        let peer = null;
        if (nst.kind === 'ai') peer = { side: OPPOSITE[dir], pos: x.virtual ? N / 2 : x.pos };
        else for (const y of theirs) if ((x.virtual || Math.abs(y.pos - x.pos) < 16) && (!peer || Math.abs(y.pos - x.pos) < Math.abs(peer.pos - x.pos))) peer = y;
        if (!peer) continue;
        const [ax, az] = edgePoint(dir, x.pos), [bx, bz] = edgePoint(OPPOSITE[dir], peer.pos);
        const p = { id: `${k}|${dir}|${Math.round(x.pos)}`, tile: k, to: nk, side: dir, pos: x.pos, node: k === this.active ? x.id : null, ax, az, bx, bz, flow: { out: 0, in: 0, freight: 0, migrants: 0 } };
        this.portals.push(p);
        const key = `${k}>${nk}`; if (!this.between.has(key)) this.between.set(key, []); this.between.get(key).push(p);
      }
    }
    // where a family of each tile can live or work: its own tile and neighbours linked both ways
    this.reach = new Map([...this.tiles.keys()].map((k) => [k, [k, ...new Set(this.portals.filter((p) => p.tile === k && this.between.has(`${p.to}>${k}`)).map((p) => p.to))]]));
  }
  portalBetween(a, b, x, z) {
    let best = null, bd = Infinity;
    for (const p of this.between.get(`${a}>${b}`) || []) { const d = Math.hypot(p.ax - x, p.az - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  // ---------------------------------------------------------------- the played tile's buildings as blocks
  // Families are the residents: each month their number per building is reconciled with the
  // city's occupancy (arrivals from outside the region, or departures), and moves between
  // buildings change occupancy directly.
  refreshActive() {
    const blocks = cityBlocks(this.world, this.sim), st = this.tiles.get(this.active);
    st.housing = new Map(blocks.housing.map((h) => [h.id, h])); st.jobs = new Map(blocks.jobs.map((j) => [j.id, j]));
    this.reconcile(this.active);
    this.recountJobs();
  }
  // Families in a tile follow its buildings: a building's occupancy is how many families live
  // there, so extra families leave the region and missing ones arrive from outside it.
  reconcile(k) {
    const st = this.tiles.get(k), H = st.housing, byHome = new Map();
    for (const f of [...this.families.values()]) if (f.tile === k) { if (!H.has(f.home)) { this.leave(f); continue; } if (!byHome.has(f.home)) byHome.set(f.home, []); byHome.get(f.home).push(f); }
    // newcomers settle in for a year before looking around
    for (const [id, h] of H) {
      const target = Math.max(0, Math.min(h.units, Math.round(h.occ || 0))), list = byHome.get(id) || [];
      list.sort((p, q) => p.happy - q.happy);
      while (list.length > target) { const f = list.shift(); this.families.delete(f.id); const j = f.wt != null ? this.tiles.get(f.wt)?.jobs.get(f.wid) : null; if (j) j.filled = Math.max(0, j.filled - f.earners); }
      for (let n = list.length; n < target; n++) { const id2 = this.e.nextFamily++, f = newFamily(id2, k, id, this.r.seed, { next: this.day + 360 + Math.floor(hash2(id2, 3, 7) * 360) }); this.families.set(f.id, f); list.push(f); }
      h.occ = list.length;
    }
  }
  // a background city's latest run: its homes and jobs replace the tile's blocks
  updateTile(k, blocks, summary) {
    const t = this.r.tiles[k]; let st = this.tiles.get(k);
    if (!st) { st = this.loadTile(k, t); this.tiles.set(k, st); }
    st.kind = 'city'; this.govern(st, t);
    st.housing = new Map(blocks.housing.map((h) => [h.id, h])); st.jobs = new Map(blocks.jobs.map((j) => [j.id, j]));
    st.treasury = summary.money; st.pop = summary.pop;
    if (st.level !== 'far') this.reconcile(k);
    this.buildPortals(); this.recountJobs(); this.conditions(); this.index();
  }
  // families per building of a tile, to carry the region's moves into its own simulation
  occupancy(k) {
    const st = this.tiles.get(k); if (!st || st.level === 'far' || st.kind !== 'city') return [];
    const n = new Map(); for (const f of this.families.values()) if (f.tile === k) n.set(f.home, (n.get(f.home) || 0) + 1);
    return [...st.housing.keys()].map((id) => [id, n.get(id) || 0]);
  }
  // who governs a tile: you, or an AI president with a priority
  govern(st, t) {
    const ai = t.kind === 'ai' || t.gov === 'ai';
    st.president.controller = ai ? 'ai' : 'player';
    if (ai && !st.president.priority) st.president.priority = newPresident(this.r.seed, st.key, 'ai', 0).priority;
  }
  recountJobs() {
    for (const st of this.tiles.values()) if (st.kind === 'city') for (const j of st.jobs.values()) j.filled = 0;
    for (const f of this.families.values()) {
      if (f.wt == null) continue;
      const st = this.tiles.get(f.wt), j = st?.jobs.get(f.wid);
      if (!j) { f.wt = null; f.wid = null; continue; }
      if (st.kind === 'ai') continue;                                        // AI jobs keep their aggregate fill
      if (j.filled + f.earners > j.slots) { f.wt = null; f.wid = null; continue; }   // the job went (building shrank or closed)
      j.filled += f.earners;
    }
  }
  // a family leaves the region (moves away, or dissolves)
  leave(f) {
    const j = f.wt != null ? this.tiles.get(f.wt)?.jobs.get(f.wid) : null; if (j) j.filled = Math.max(0, j.filled - f.earners);
    const h = this.tiles.get(f.tile)?.housing.get(f.home); if (h) h.occ = Math.max(0, h.occ - 1);
    this.families.delete(f.id);
  }

  // ---------------------------------------------------------------- 2–3. rents, salaries, services
  conditions() {
    for (const [k, st] of this.tiles) {
      let units = 0, occ = 0, slots = 0, filled = 0;
      for (const h of st.housing.values()) { units += h.units; occ += h.occ; }
      for (const j of st.jobs.values()) { slots += j.slots; filled += j.filled; }
      const occRate = units ? occ / units : 0.9, fillRate = slots ? filled / slots : 0.8;
      for (const h of st.housing.values()) h.rent = rentOf(h.quality, occRate, st.policy.rentTarget);
      for (const j of st.jobs.values()) j.salary = salaryOf(j.kind, j.level, fillRate);
      if (k !== this.active) for (const h of st.housing.values()) h.services = clamp((h.baseServices ??= h.services) * st.policy.services, 0, 1);
      Object.assign(st, { units, occ, slots, filled });
    }
  }
  index() {
    this.vacant = new Map(); this.open = new Map();
    for (const [k, st] of this.tiles) {
      this.vacant.set(k, [...st.housing.values()].filter((h) => h.occ < h.units));
      this.open.set(k, [...st.jobs.values()].filter((j) => j.filled < j.slots).sort((a, b) => b.salary - a.salary).slice(0, 12));
    }
  }
  ctx() {
    const self = this;
    return this._ctx ||= {
      get day() { return self.day; },
      portal: (a, b, x, z) => self.portalBetween(a, b, x, z),
      toll: (k) => self.tiles.get(k)?.policy.toll ?? 0,
      reachable: (k) => self.reach.get(k) || [k],
      openJobs: (k) => self.open.get(k) || [],
      vacantHomes: (k) => self.vacant.get(k) || [],
      home: (k, id) => self.tiles.get(k)?.housing.get(id),
      job: (k, id) => self.tiles.get(k)?.jobs.get(id),
    };
  }

  // ---------------------------------------------------------------- the month
  month(sim) {
    this.day = sim.day; const ctx = this.ctx();
    for (const st of this.tiles.values()) st.month = { tolls: 0, crossings: 0, migIn: 0, migOut: 0 };
    // 1–3. policy is in force; the played city's blocks refresh; rents, salaries and services follow policy
    if (this.world.net.version !== this.netVersion) { this.netVersion = this.world.net.version; this.buildPortals(); }
    for (const p of this.portals) p.flow = { out: 0, in: 0, freight: 0, migrants: 0 };
    this.refreshActive(); this.conditions(); this.index();
    // 4–5. family decisions: job hunting every month, housing reconsidered about once a year
    for (const f of [...this.families.values()]) {
      if (!this.families.has(f.id) || this.tiles.get(f.tile)?.level === 'far') continue;
      const home = ctx.home(f.tile, f.home); if (!home) { this.leave(f); continue; }
      if (f.wt == null) { const j = bestJob(ctx, f, f.tile, home); if (j) { this.takeJob(f, j); if (j.job.filled >= j.job.slots) this.index(); } }
      if (f.next <= this.day) {
        f.next = this.day + 300 + Math.floor(hash2(f.id, this.day, 5) * 120);
        const d = reconsider(ctx, f);
        if (d && d.home.occ < d.home.units) this.move(f, d);
      }
    }
    this.aiMigration(ctx); this.growAI(); this.farTiles();
    for (const f of this.families.values()) if (this.tiles.get(f.tile)?.level !== 'far') settle(ctx, f);
    // 6. traffic through the portals, and the tolls it pays
    this.portalTraffic(sim);
    // 7. population and treasuries
    this.books(sim);
    // 8. presidents and the record
    if (sim.year !== this.e.lastYear) this.annual(sim);
    this.conditions(); this.index();
  }

  takeJob(f, j) {
    const old = f.wt != null ? this.tiles.get(f.wt)?.jobs.get(f.wid) : null; if (old) old.filled = Math.max(0, old.filled - f.earners);
    f.wt = j.tile; f.wid = j.job.id; j.job.filled += f.earners;
  }
  move(f, d) {
    if (this.sim && this.storyDay !== this.day && (f.tile === this.active || d.tile === this.active)) {
      const future = commute(this.ctx(), d.tile, d.home, d.job?.tile, d.job?.job);
      const reason = f.toll > 0 && future.toll < f.toll ? 'lower border tolls' : future.cost < f.commute ? 'a cheaper commute' : d.home.rent < f.rent ? 'lower rent' : 'a better home and job';
      this.sim.headline(`Family ${f.id} (${f.size} people) ${d.tile === f.tile ? 'moves to a new home in town' : d.tile === this.active ? 'moves into town' : 'moves away'} after finding ${reason}.`, d.tile === this.active ? 'good' : 'warn'); this.storyDay = this.day;
    }
    const from = f.tile, fromHome = this.tiles.get(from).housing.get(f.home);
    if (fromHome) fromHome.occ = Math.max(0, fromHome.occ - 1);
    if (from === this.active) { const b = this.world.buildings.get(f.home); if (b) b.occ = Math.max(0, (b.occ || 0) - 1); }
    if (d.job && (d.job.tile !== f.wt || d.job.job.id !== f.wid)) this.takeJob(f, d.job);
    else if (!d.job && f.wt != null) { const j = this.tiles.get(f.wt)?.jobs.get(f.wid); if (j) j.filled = Math.max(0, j.filled - f.earners); f.wt = null; f.wid = null; }
    f.savings -= d.cost; f.moved = this.day;
    d.home.occ++;
    if (d.tile !== from) {
      this.tiles.get(from).month.migOut++; this.tiles.get(d.tile).month.migIn++;
      const p = this.portalBetween(from, d.tile, fromHome?.x ?? N / 2, fromHome?.z ?? N / 2);
      if (p) { p.flow.migrants++; this.toll(d.tile, 1); }
      if (from === this.active) this.events.push({ type: 'move', out: true, building: f.home, node: p?.node, from, to: d.tile });
      else if (d.tile === this.active) this.events.push({ type: 'move', out: false, building: d.home.id, node: this.portalBetween(this.active, from, d.home.x, d.home.z)?.node, from, to: d.tile });
    }
    if (this.tiles.get(d.tile).kind === 'ai') { this.families.delete(f.id); return; }   // absorbed into the AI city's households
    f.tile = d.tile; f.home = d.home.id;
    if (d.tile === this.active) { const b = this.world.buildings.get(d.home.id); if (b) b.occ = Math.min(b.hh, (b.occ || 0) + 1); }
  }
  toll(k, crossings) { const st = this.tiles.get(k); if (!st) return; st.month.crossings += crossings; st.month.tolls += crossings * st.policy.toll; }

  // AI cities send migrants to a linked tile of yours when an ordinary family would be
  // clearly better off there (aggregate flow; each migrant becomes a family agent).
  aiMigration(ctx) {
    const probe = { id: 1, size: 3, earners: 1, savings: 6000, moved: -9999 };
    const score = (tile) => { let u = -Infinity; for (const h of sampleHomes(ctx, tile, probe, 6)) { const j = bestJob(ctx, probe, tile, h); u = Math.max(u, utility(ctx, probe, tile, h, j?.tile ?? null, j?.job ?? null)); } return u; };
    for (const [k, st] of this.tiles) {
      if (st.kind !== 'ai') continue;
      for (const to of this.reach.get(k) || []) {
        const dst = this.tiles.get(to); if (to === k || dst.kind !== 'city' || dst.level === 'far') continue;
        const gain = score(to) - score(k) - THRESHOLD; if (!(gain > 0)) continue;
        const n = Math.min(25, Math.max(1, Math.round(st.occ * 0.0006 * gain * 10)));
        for (let i = 0; i < n; i++) {
          const src = [...st.housing.values()].find((h) => h.occ > 0), dest = (this.vacant.get(to) || []).filter((h) => h.occ < h.units).sort((a, b) => a.rent - b.rent)[i % 3];
          if (!src || !dest) break;
          src.occ--; dest.occ++;
          const f = newFamily(this.e.nextFamily++, to, dest.id, this.r.seed, { moved: this.day, next: this.day + 360 }); this.families.set(f.id, f);
          const j = bestJob(ctx, f, to, dest); if (j) this.takeJob(f, j);
          st.month.migOut++; dst.month.migIn++;
          const p = this.portalBetween(k, to, N / 2, N / 2); if (p) { p.flow.migrants++; this.toll(to, 1); }
          if (to === this.active) { const b = this.world.buildings.get(dest.id); if (b) b.occ = Math.min(b.hh, (b.occ || 0) + 1); this.events.push({ type: 'move', out: false, building: dest.id, node: this.portalBetween(to, k, dest.x, dest.z)?.node, from: k, to }); }
        }
        this.vacant.set(to, [...dst.housing.values()].filter((h) => h.occ < h.units));
      }
    }
  }
  // AI cities grow or shrink along their president's expected growth, adding housing and jobs as they go
  growAI() {
    for (const st of this.tiles.values()) {
      if (st.kind !== 'ai') continue;
      const g = clamp(st.predicted?.growth ?? 0, -0.03, 0.04) / 12;
      for (const h of st.housing.values()) { h.occ = clamp(Math.round(h.occ * (1 + g) + (g > 0 && hash2(h.id, this.day, 9) < 0.3 ? 1 : 0)), 0, h.units); if (h.occ > h.units * 0.97) h.units = Math.ceil(h.units * 1.02); }
      const pop = [...st.housing.values()].reduce((s, h) => s + h.occ, 0) * 2.6;
      for (const j of st.jobs.values()) { j.slots = Math.max(1, Math.round(pop * 0.45 / st.jobs.size)); j.filled = Math.min(j.filled, j.slots); }
    }
  }
  // far tiles of yours: families rest, the city follows its recent trend (reduced detail)
  farTiles() {
    for (const [k, st] of this.tiles) {
      if (st.kind !== 'city' || st.level !== 'far' || this.background?.has(k)) continue;
      const s = this.r.tiles[k].summary; if (!s) continue;
      s.pop = Math.max(0, Math.round((s.pop || 0) * (1 + (s.growth || 0)))); s.growth = +((s.growth || 0) * 0.96).toFixed(5);
    }
  }

  // ---------------------------------------------------------------- 6. portals
  // Commuters cross twice every workday (paying the toll of the tile they enter), migrants
  // once, freight by the truckload. The played city's exits get these flows for traffic.
  portalTraffic(sim) {
    for (const f of this.families.values()) {
      if (f.wt == null || f.wt === f.tile) continue;
      const home = this.tiles.get(f.tile)?.housing.get(f.home), p = home && this.portalBetween(f.tile, f.wt, home.x, home.z); if (!p) continue;
      p.flow.out += 1;
      this.toll(f.wt, WORKDAYS); this.toll(f.tile, WORKDAYS);
    }
    // freight: each tile's industry ships to linked neighbours, favouring low tolls and big markets
    for (const [k, st] of this.tiles) {
      const out = k === this.active ? sim.stats.filled?.I || 0 : [...st.jobs.values()].filter((j) => j.kind === 'I').reduce((s, j) => s + j.filled, 0);
      const trucks = out / 8; if (trucks < 0.5) continue;
      const opts = (this.reach.get(k) || []).filter((to) => to !== k).map((to) => [to, ((this.tiles.get(to).occ || 0) + 50) * Math.exp(-this.tiles.get(to).policy.toll / 10)]);
      const tot = opts.reduce((s, [, wgt]) => s + wgt, 0); if (!tot) continue;
      for (const [to, wgt] of opts) {
        const n = trucks * wgt / tot, ps = this.between.get(`${k}>${to}`) || [];
        for (const p of ps) p.flow.freight += n / ps.length;
        this.toll(to, n);
      }
    }
    // the played city's exits: commuters out and in, freight, migrants
    const flows = new Map(), perDay = 1 / WORKDAYS;
    for (const p of this.portals) {
      if (p.tile !== this.active || p.node == null) continue;
      const f = flows.get(p.node) || { in: 0, out: 0, freight: 0, migrants: 0, to: p.to, toll: this.tiles.get(p.to).policy.toll };
      f.out += p.flow.out; f.freight += p.flow.freight * perDay; f.migrants += p.flow.migrants;
      flows.set(p.node, f);
    }
    for (const p of this.portals) if (p.to === this.active && p.flow.out) { const q = this.portalBetween(this.active, p.tile, p.bx, p.bz); if (q?.node != null && flows.get(q.node)) flows.get(q.node).in += p.flow.out; }
    sim.portalFlows = flows;
    let cin = 0, cout = 0;
    for (const f of this.families.values()) { if (f.wt == null || f.wt === f.tile) continue; if (f.tile === this.active) cout += f.earners; else if (f.wt === this.active) cin += f.earners; }
    sim.regionCommute = { in: cin, out: cout };
  }

  // ---------------------------------------------------------------- 7. population and treasuries
  books(sim) {
    const byTile = new Map(); for (const f of this.families.values()) { if (!byTile.has(f.tile)) byTile.set(f.tile, []); byTile.get(f.tile).push(f); }
    for (const [k, st] of this.tiles) {
      const fams = byTile.get(k) || [];
      st.pop = k === this.active ? Math.round(sim.stats.pop) : this.background?.has(k) && st.kind === 'city' ? this.r.tiles[k].summary?.pop ?? 0 : st.kind === 'ai' ? Math.round([...st.housing.values()].reduce((s, h) => s + h.occ, 0) * 2.6)
        : st.level === 'far' ? this.r.tiles[k].summary?.pop ?? fams.reduce((s, f) => s + f.size, 0) : fams.reduce((s, f) => s + f.size, 0);
      if (st.kind === 'ai') this.r.tiles[k].pop = st.pop; else if (this.r.tiles[k].summary && k !== this.active && !this.background?.has(k)) this.r.tiles[k].summary.pop = st.pop;
      st.stats = this.snapshot(st, fams);
      if (k === this.active) { sim.tollIncome = st.month.tolls; st.treasury = sim.money; st.acc.income += sim.month.income; st.acc.expense += sim.month.expense; }
      else if (st.kind === 'city' && this.background?.has(k)) {   // simulated in the background: its own city keeps the books; tolls are credited on its next run
        st.pendingTolls = (st.pendingTolls || 0) + st.month.tolls; st.treasury = (this.r.tiles[k].summary?.money ?? st.treasury) + st.pendingTolls;
        st.pop = this.r.tiles[k].summary?.pop ?? st.pop;
      }
      else {
        const p = st.policy, hh = st.kind === 'ai' ? st.occ : fams.length;
        // scaled so a tile earns and spends per resident about what a played city does
        const income = st.stats.rentAvg * hh * p.tax / 100 * 0.05 + (st.filled || 0) * st.stats.salary * p.tax / 100 * 0.012 + st.month.tolls;
        const expense = st.pop * (1.6 * p.services + 0.8 * p.infra) + 1500 + (p.rentTarget < 1 ? hh * 2 * (1 - p.rentTarget) : 0);
        st.treasury = Math.round(st.treasury + income - expense); st.acc.income += income; st.acc.expense += expense;
      }
      st.acc.tolls += st.month.tolls; st.acc.migIn += st.month.migIn; st.acc.migOut += st.month.migOut; st.acc.crossings += st.month.crossings;
    }
  }
  snapshot(st, fams) {
    const occ = [...st.housing.values()].filter((h) => h.occ > 0), n = occ.reduce((s, h) => s + h.occ, 0);
    const rentAvg = n ? occ.reduce((s, h) => s + h.rent * h.occ, 0) / n : 0;
    const salary = st.jobs.size ? [...st.jobs.values()].reduce((s, j) => s + (j.salary || 0), 0) / st.jobs.size : 2000;
    const employed = fams.length ? fams.filter((f) => f.wt != null).length / fams.length : st.kind === 'ai' ? clamp((st.filled || 0) / Math.max(1, (st.occ || 0) * 1.3), 0, 1) : 0;
    const quality = occ.length ? occ.reduce((s, h) => s + h.quality, 0) / occ.length : 0.5;
    const appeal = occ.length ? occ.reduce((s, h) => s + h.appeal, 0) / occ.length : 0.5;
    const income = fams.length ? fams.reduce((s, f) => s + f.income, 0) / fams.length : salary * 1.3;
    return { rentAvg, salary, employed, quality, appeal, income, families: fams.length || st.occ || 0, savings: fams.length ? fams.reduce((s, f) => s + f.savings, 0) / fams.length : 0, happy: fams.length ? fams.reduce((s, f) => s + f.happy, 0) / fams.length : 0.6 };
  }
  // what a president knows about a tile when deciding
  state(st) {
    const s = st.stats || {};
    return { pop: st.pop || 0, units: st.units || 0, occ: st.occ || 0, jobs: st.slots || 0, filled: st.filled || 0, baseRent: (s.rentAvg || 900) / (st.policy.rentTarget || 1), income: s.income || 2500, salary: s.salary || 2000,
      crossings: (st.acc.crossings || 0) / 12, appeal: s.appeal ?? 0.5, unemp: 1 - (s.employed ?? 0.9), treasury: st.treasury };
  }

  // ---------------------------------------------------------------- 8. presidents, statistics, terms
  annual(sim) {
    const year = sim.year;
    for (const [k, st] of this.tiles) {
      const s = st.stats || this.snapshot(st, []), h = (this.e.history[k] ||= []);
      h.push({ year, president: st.president.name, pop: st.pop || 0, treasury: Math.round(st.treasury), income: Math.round(st.acc.income), expenses: Math.round(st.acc.expense), rent: Math.round(s.rentAvg || 0),
        employment: +(s.employed || 0).toFixed(3), migIn: st.acc.migIn, migOut: st.acc.migOut, landValue: +(s.quality || 0).toFixed(3), tolls: Math.round(st.acc.tolls) });
      // AI presidents review their policy once a year (after the year's numbers are in)
      if (st.president.controller === 'ai') { const before = JSON.stringify(st.policy); st.policy = aiDecide(this.state(st), st.president, st.policy); if (JSON.stringify(st.policy) !== before) st.changed = year; }
      st.predicted = { growth: predict(this.state(st), st.policy).growth };
      st.acc = { income: 0, expense: 0, tolls: 0, migIn: 0, migOut: 0, crossings: 0 };
    }
    this.e.lastYear = year;
    if (year - this.e.termStart >= TERM_YEARS) this.closeTerm(year);
  }
  // End of a ten-year term: record it, hold elections (an AI president whose tile lost both
  // residents and money is voted out), and tell the interface to show the comparison.
  closeTerm(year) {
    const election = this.sim ? holdElection(this.sim, year) : null;
    const term = { start: this.e.termStart, end: year, tiles: {} };
    for (const [k, st] of this.tiles) {
      const h = (this.e.history[k] || []).filter((r) => r.year >= term.start && r.year <= year), a = h[0], b = h[h.length - 1];
      term.tiles[k] = { president: st.president.name, controller: st.president.controller, priority: st.president.priority, pop: [a?.pop ?? 0, b?.pop ?? 0], treasury: [a?.treasury ?? 0, b?.treasury ?? 0] };
      if (k === this.active && election) Object.assign(term.tiles[k], { approval: election.approval, won: election.won });
      if (st.president.controller === 'ai' && a && b && b.pop < a.pop && b.treasury < a.treasury) {
        st.president = { ...newPresident(this.r.seed, k, 'ai', year, this.e.terms.length + 1), since: year }; term.tiles[k].replacedBy = st.president.name;
      }
    }
    this.e.terms.push(term); this.e.termStart = year;
    this.events.push({ type: 'term', term });
  }

  // ---------------------------------------------------------------- saving and queries
  pack() {
    for (const [k, st] of this.tiles) {
      if (k === this.active && this.sim) st.treasury = this.sim.money;
      Object.assign(this.e.tiles[k] ||= {}, { president: st.president, policy: st.policy, treasury: Math.round(st.treasury), acc: st.acc, predicted: st.predicted, pendingTolls: st.pendingTolls || 0,
        left: k === this.active ? this.day : this.e.tiles[k].left ?? null, housing: packRows(st.housing, H_KEYS), jobs: packRows(st.jobs, J_KEYS) });
    }
    this.e.families = [...this.families.values()].map(packF);
    return this.e;
  }
  familiesAt(buildingId) { return [...this.families.values()].filter((f) => f.tile === this.active && f.home === buildingId).sort((a, b) => a.id - b.id); }
  presidents() { return [...this.tiles.entries()].map(([k, st]) => ({ key: k, name: this.r.tiles[k].name, kind: st.kind, president: st.president, policy: st.policy, pop: st.pop || 0, treasury: st.treasury, stats: st.stats || null, level: st.level })); }
}
