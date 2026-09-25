// Organicity — families. Households are agents with a home, maybe a job, income, savings,
// rent, commute and toll costs and happiness. Housing blocks (a residential building's
// units, or a block of an AI city) have units, quality, occupancy and rent; job blocks have
// slots, a kind, a level and a salary. Families score where they could live and work and
// move when an option is clearly better and they can afford the move. Pure logic: the
// region model (regionsim.js) supplies the tiles, portals and tolls through `ctx`.
import { hash2, clamp } from './util.js';

export const LIVING = 260;                  // monthly living costs per person
export const BENEFIT = 420;                 // monthly support for a household without work
export const MOVE_LOCAL = 600, MOVE_REGION = 1800;
export const THRESHOLD = 0.06;              // how much better a new home must be
export const REGION_EXTRA = 0.05;           // ...plus this to leave the tile
export const COOLDOWN = 360;                // days before a family considers moving again
export const WORKDAYS = 22;

// rent of one unit: quality sets the base, a tight market pushes it up, the president's target scales it
export function rentOf(quality, occupancyRate, rentTarget = 1) {
  const pressure = clamp(0.8 + 0.55 * occupancyRate, 0.75, 1.4);
  return Math.round((450 + 1100 * quality) * pressure * rentTarget);
}
// salary per earner: by kind and level, higher where employers struggle to fill jobs
export function salaryOf(kind, level, fillRate = 0.8) {
  const base = { C: 1700, I: 1900, O: 2500, M: 1700 }[kind] || 1800;
  return Math.round((base + 350 * (Math.max(1, level) - 1)) * (0.95 + 0.25 * (1 - clamp(fillRate, 0, 1))));
}

export function newFamily(id, tile, home, seed, extra = {}) {
  const h = (s) => hash2(id, seed % 9973, s), size = 1 + Math.floor(h(1) * 4.2);   // 1–5 people
  return {
    id, tile, home, wt: null, wid: null, size, earners: size === 1 ? 1 : h(2) < 0.55 ? 2 : 1,
    savings: Math.round(1500 + h(3) * 6000), income: BENEFIT, rent: 0, commute: 0, toll: 0, happy: 0.6,
    moved: -9999, next: Math.floor(h(4) * 360), ...extra,
  };
}

// commute between a home block and a job block, possibly through the portals of two tiles
export function commute(ctx, homeTile, home, jobTile, job) {
  if (!job) return { minutes: 0, cost: 0, toll: 0 };
  if (homeTile === jobTile) { const d = Math.hypot(home.x - job.x, home.z - job.z); return { minutes: 5 + d / 6, cost: d * 1.1, toll: 0 }; }
  const p = ctx.portal(homeTile, jobTile, home.x, home.z); if (!p) return { minutes: Infinity, cost: Infinity, toll: Infinity };
  const d = Math.hypot(home.x - p.ax, home.z - p.az) + Math.hypot(p.bx - job.x, p.bz - job.z) + 20;
  // a toll every morning entering the job's tile and every evening coming home
  return { minutes: 8 + d / 6, cost: d * 1.1, toll: WORKDAYS * (ctx.toll(jobTile, homeTile) + ctx.toll(homeTile, jobTile)) };
}

export function incomeOf(fam, job) { return job ? fam.earners * job.salary : BENEFIT; }

// how good a home-and-job combination is for a family (roughly −0.5 … 1)
export function utility(ctx, fam, homeTile, home, jobTile, job) {
  const c = commute(ctx, homeTile, home, jobTile, job); if (!Number.isFinite(c.cost)) return -Infinity;
  const inc = incomeOf(fam, job), disp = inc - home.rent - c.cost - c.toll - fam.size * LIVING;
  return 0.45 * Math.tanh(disp / 1500) + 0.14 * home.quality + 0.1 * home.services + 0.1 * home.appeal - 0.08 * home.pollution - 0.08 * home.crime
    - 0.05 * Math.min(1, c.minutes / 60) - (home.rent > 0.45 * inc ? 0.15 : 0);
}

// the best job a family can reach from a home: in its tile or a linked neighbour, net of commute and tolls
export function bestJob(ctx, fam, homeTile, home, keep = null) {
  const value = (tile, job) => { const c = commute(ctx, homeTile, home, tile, job); return Number.isFinite(c.cost) ? fam.earners * job.salary - c.cost - c.toll : -Infinity; };
  let best = keep, bv = keep ? value(keep.tile, keep.job) : -Infinity;
  for (const tile of ctx.reachable(homeTile)) for (const job of ctx.openJobs(tile)) {
    const v = value(tile, job); if (v > bv) { bv = v; best = { tile, job }; }
  }
  return best;
}

// A sample of vacant homes in a tile (rotated by family so families spread out).
export function sampleHomes(ctx, tile, fam, n) {
  const all = ctx.vacantHomes(tile); if (all.length <= n) return all;
  const out = [], start = Math.floor(hash2(fam.id, ctx.day, 17) * all.length), step = Math.max(1, Math.floor(all.length / n));
  for (let k = 0; k < n; k++) out.push(all[(start + k * step) % all.length]);
  return out;
}

// Regional choice, as specified: first score each reachable tile, then search housing in the
// best one. Returns { tile, home, job, gain, cost } for a worthwhile move, or null to stay.
export function reconsider(ctx, fam) {
  const curHome = ctx.home(fam.tile, fam.home); if (!curHome) return null;
  const curJob = fam.wt != null ? ctx.job(fam.wt, fam.wid) : null;
  const uCur = utility(ctx, fam, fam.tile, curHome, fam.wt, curJob);
  const option = (tile, home) => {
    const keep = curJob && Number.isFinite(commute(ctx, tile, home, fam.wt, curJob).cost) ? { tile: fam.wt, job: curJob } : null;
    const j = bestJob(ctx, fam, tile, home, keep);
    return { tile, home, job: j, u: utility(ctx, fam, tile, home, j?.tile ?? null, j?.job ?? null) };
  };
  // 1. tile scores from a small sample of each reachable tile's vacant homes
  let bestTile = fam.tile, bestTileU = -Infinity;
  for (const tile of ctx.reachable(fam.tile)) {
    let u = -Infinity; for (const h of sampleHomes(ctx, tile, fam, 4)) u = Math.max(u, option(tile, h).u);
    if (tile !== fam.tile) u -= REGION_EXTRA;
    if (u > bestTileU) { bestTileU = u; bestTile = tile; }
  }
  // 2. housing search inside the chosen tile
  let best = null;
  for (const h of sampleHomes(ctx, bestTile, fam, 12)) { if (bestTile === fam.tile && h === curHome) continue; const o = option(bestTile, h); if (!best || o.u > best.u) best = o; }
  if (!best) return null;
  const cost = best.tile === fam.tile ? MOVE_LOCAL : MOVE_REGION;
  const gain = best.u - uCur - (best.tile === fam.tile ? 0 : REGION_EXTRA);
  if (gain < THRESHOLD || fam.savings < cost || ctx.day - fam.moved < COOLDOWN) return null;
  return { ...best, gain, cost };
}

// monthly household budget; happiness follows how comfortable it is
export function settle(ctx, fam) {
  const home = ctx.home(fam.tile, fam.home), job = fam.wt != null ? ctx.job(fam.wt, fam.wid) : null;
  if (!home) return;
  const c = commute(ctx, fam.tile, home, fam.wt, job), ok = Number.isFinite(c.cost);
  fam.income = incomeOf(fam, ok ? job : null); fam.rent = home.rent; fam.commute = ok ? Math.round(c.cost) : 0; fam.toll = ok ? Math.round(c.toll) : 0;
  const disp = fam.income - fam.rent - fam.commute - fam.toll - fam.size * LIVING;
  fam.savings = Math.max(0, Math.round(fam.savings + disp * 0.5));
  fam.happy = +clamp(0.5 + utility(ctx, fam, fam.tile, home, ok ? fam.wt : null, ok ? job : null), 0, 1).toFixed(3);
}
