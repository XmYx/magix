// Organicity — tile presidents. Every city tile has a president who sets local policy:
// rent target, taxes, the toll for entering the tile, development priority, infrastructure
// spending and service funding. You are president of your own tiles; AI presidents run
// the rest. Both use the same policy object and the same application code; AI presidents
// just choose their levers with a small, deterministic utility model.
import { SERVICES } from './config.js';
import { hash2, clamp } from './util.js';

export const POLICY_DEFAULT = { rentTarget: 1, tax: 9, toll: 2, dev: 'balanced', infra: 1, services: 1 };
// [min, max, step] of each numeric lever
export const LEVERS = { rentTarget: [0.6, 1.4, 0.05], tax: [3, 20, 1], toll: [0, 20, 1], infra: [0.5, 1.5, 0.1], services: [0.5, 1.5, 0.1] };
export const DEV = { balanced: 'Balanced', housing: 'Housing', commerce: 'Commerce', industry: 'Industry', offices: 'Offices' };
// a development priority lowers that zone's tax and raises its demand
const DEV_TAX = { balanced: {}, housing: { R: -2 }, commerce: { C: -2 }, industry: { I: -2 }, offices: { O: -2 } };
const DEV_KIND = { housing: 'R', commerce: 'C', industry: 'I', offices: 'O' };
export const PRIORITIES = { growth: 'Growth', treasury: 'Treasury', employment: 'Employment', affordability: 'Housing affordability', appeal: 'City appeal' };

const FIRST = ['Alma', 'Bruno', 'Clara', 'Dezső', 'Elena', 'Felix', 'Gizella', 'Henrik', 'Irén', 'József', 'Katalin', 'Lajos', 'Magda', 'Nándor', 'Olga', 'Péter', 'Rita', 'Sándor', 'Teréz', 'Viktor'];
const LAST = ['Arany', 'Balogh', 'Csizmadia', 'Deák', 'Erdős', 'Fodor', 'Gál', 'Hegedűs', 'Illés', 'Juhász', 'Kerekes', 'Lengyel', 'Molnár', 'Novák', 'Orbán', 'Pintér', 'Rácz', 'Szalai', 'Takács', 'Varga'];

export function newPresident(seed, key, controller, year, term = 0) {
  const [x, z] = key.split(',').map(Number), h = (s) => hash2(x * 7 + z * 131 + term * 977, seed % 99991, s);
  const keys = Object.keys(PRIORITIES);
  return { name: `${FIRST[Math.floor(h(1) * FIRST.length)]} ${LAST[Math.floor(h(2) * LAST.length)]}`, controller, priority: controller === 'ai' ? keys[Math.floor(h(3) * keys.length)] : null, since: year };
}

export function clampPolicy(p) {
  const out = { ...POLICY_DEFAULT, ...p };
  for (const [k, [lo, hi]] of Object.entries(LEVERS)) out[k] = +clamp(Number.isFinite(+out[k]) ? +out[k] : POLICY_DEFAULT[k], lo, hi).toFixed(2);
  if (!DEV[out.dev]) out.dev = 'balanced';
  return out;
}

// The full-fidelity city takes its taxes, service funding, road spending and development
// priority from its president's policy (rent target and toll are read by the region model).
export function applyPolicy(sim, p) {
  p = clampPolicy(p);
  const off = DEV_TAX[p.dev] || {};
  sim.tax = { R: p.tax + (off.R || 0), C: p.tax + (off.C || 0), I: p.tax + (off.I || 0), O: p.tax + (off.O || 0) };
  for (const k of new Set([...sim.w.buildings.values()].filter((b) => b.svc).map((b) => b.svc))) if (SERVICES[k]) sim.setBudget(k, p.services);
  sim.infra = p.infra; sim.devPriority = DEV_KIND[p.dev] || null; sim.rentTarget = p.rentTarget; sim.toll = p.toll;
  sim.policyVersion = (sim.policyVersion || 0) + 1;
  return p;
}

// Predicted outcome of a policy for a tile, from a few plain elasticities.
// s: { pop, units, occ, jobs, filled, baseRent, income, salary, crossings, appeal, unemp }
export function predict(s, p) {
  const pop = Math.max(1, s.pop), rent = (s.baseRent || 900) * p.rentTarget, income = Math.max(400, s.income || 2500);
  const afford = rent / income;
  const attract = 0.35 * (1 - clamp(afford, 0, 1)) + 0.2 * (p.services - 0.5) + 0.15 * (1 - p.tax / 20) + 0.15 * (s.appeal ?? 0.5) + 0.1 * (p.infra - 0.5) - 0.05 * p.toll / 20
    + (DEV_KIND[p.dev] === 'R' ? 0.03 : 0);
  const growth = 0.12 * (attract - 0.45);
  const households = pop / 2.6, crossings = (s.crossings || 0) * Math.max(0, 1 - p.toll / 30);
  const revenue = households * rent * p.tax / 100 * 0.05 + (s.filled || 0) * (s.salary || 2000) * p.tax / 100 * 0.012 + crossings * p.toll;
  const cost = pop * (1.6 * p.services + 0.8 * p.infra) + (p.rentTarget < 1 ? households * 2 * (1 - p.rentTarget) : 0);   // rent control needs upkeep subsidies
  const jobsBoost = ['C', 'I', 'O'].includes(DEV_KIND[p.dev]) ? 0.03 : 0;
  const employment = clamp(1 - (s.unemp || 0) + jobsBoost - (p.tax - 9) * 0.003, 0, 1);
  const appeal = clamp((s.appeal ?? 0.5) + 0.12 * (p.services - 1) + 0.08 * (p.infra - 1) - (p.rentTarget < 0.85 ? 0.04 : 0), 0, 1);
  return { growth, treasury: Math.tanh((revenue - cost) / pop / 4), employment, affordability: 1 - clamp(afford, 0, 1.5), appeal };
}
const WEIGHTS = {
  growth:        { growth: 30, treasury: 0.2, employment: 0.5, affordability: 0.4, appeal: 0.4 },
  treasury:      { growth: 6, treasury: 1.2, employment: 0.3, affordability: 0.2, appeal: 0.3 },
  employment:    { growth: 8, treasury: 0.2, employment: 3, affordability: 0.4, appeal: 0.3 },
  affordability: { growth: 8, treasury: 0.2, employment: 0.5, affordability: 3, appeal: 0.4 },
  appeal:        { growth: 8, treasury: 0.2, employment: 0.4, affordability: 0.5, appeal: 3 },
};
// a president whose treasury is in the red weighs the budget three times as heavily
export function utility(priority, m, broke = false) { const w = WEIGHTS[priority] || WEIGHTS.growth; return Object.keys(w).reduce((u, k) => u + w[k] * m[k] * (broke && k === 'treasury' ? 3 : 1), 0); }

// One decision: try moving each lever one step either way (and each development priority),
// keep the best by the president's utility; ties keep the current policy. Deterministic.
export function aiDecide(state, president, policy) {
  const cur = clampPolicy(policy);
  const broke = (state.treasury ?? 0) < 0;
  let best = cur, bu = utility(president.priority, predict(state, cur), broke) + 1e-9;
  const tryP = (p) => { const q = clampPolicy(p), u = utility(president.priority, predict(state, q), broke); if (u > bu) { bu = u; best = q; } };
  for (const [k, [, , step]] of Object.entries(LEVERS)) { tryP({ ...cur, [k]: cur[k] + step }); tryP({ ...cur, [k]: cur[k] - step }); }
  for (const d of Object.keys(DEV)) if (d !== cur.dev) tryP({ ...cur, dev: d });
  return best;
}
