// Organicity — natural resources and the industry chain.
//  • deposits: forest, coal, stone, iron and ore, laid out from the map seed (forest where the
//    woods are, minerals in seams that favour the hills); shown by the resources overlay
//  • extractors (lumber camp, mines, quarry) must sit by a deposit and slowly work it out;
//    timber regrows
//  • processors turn inputs into products in chain order (sawmill → furniture, stone + coal →
//    cement, iron + coal → steel, ore + coal → metals, steel + metals → machinery …)
//  • the market: leftovers sell at drifting prices if they can leave town (a highway link or a
//    freight terminal); the commodity exchange pays better and imports missing inputs; the
//    warehouse keeps stock between days
//  • local effects: coal fuels the power plants (cheaper upkeep), furniture and paper stock the
//    shops, cement and steel cut road upkeep, machinery raises factory productivity
// Every building needs road, power, water and workers to run. Pure: no DOM, no three.js.
import { N, SERVICES, MONTH_DAYS } from './config.js';
import { fbm, clamp, hash2 } from './util.js';

export const DEPOSITS = {
  timber: { id: 1, name: 'Forest', color: [40, 112, 50] },
  coal:   { id: 2, name: 'Coal',   color: [34, 34, 38] },
  stone:  { id: 3, name: 'Stone',  color: [178, 172, 156] },
  iron:   { id: 4, name: 'Iron',   color: [164, 78, 52] },
  ore:    { id: 5, name: 'Ore',    color: [214, 162, 52] },
};
export const DEP_BY_ID = Object.keys(DEPOSITS).reduce((a, k) => { a[DEPOSITS[k].id] = k; return a; }, []);

// base price per unit; raw materials sell for less without an exchange
export const COMMODITIES = {
  timber: { name: 'Timber', price: 6, raw: true }, coal: { name: 'Coal', price: 8, raw: true }, stone: { name: 'Stone', price: 5, raw: true },
  iron: { name: 'Iron ore', price: 10, raw: true }, ore: { name: 'Copper & tin ore', price: 12, raw: true },
  lumber: { name: 'Lumber', price: 15 }, paper: { name: 'Paper', price: 19 }, cement: { name: 'Cement', price: 17 },
  steel: { name: 'Steel', price: 32 }, metals: { name: 'Metals', price: 36 }, furniture: { name: 'Furniture', price: 42 }, machinery: { name: 'Machinery', price: 85 },
};
// processors run in this order, so each product is there for the next step the same day
// district industry policies (set per district)
export const IND_POLICIES = {
  none: { name: 'No industrial policy', desc: 'Plants run at their normal pace.', cost: 0 },
  park: { name: 'Industrial park', desc: 'Processing plants +15% output and factories +10% productivity; ₵150/month.', cost: 150 },
  mining: { name: 'Mining district', desc: 'Mines, quarries and lumber camps +25% output, but they work their deposits out faster and pollute 30% more; ₵100/month.', cost: 100 },
};
export const CHAIN_ORDER = ['sawmill', 'papermill', 'furniture', 'cementworks', 'steelworks', 'smelter', 'machinery'];

// ---------------------------------------------------------------- deposits
export function deposits(w) {
  if (w._dep?.seed === w.seed && w._dep.v === (w.depVersion || 0)) return w._dep;
  const kind = new Uint8Array(N * N), rich = new Uint8Array(N * N), s = w.seed;
  const seams = [['ore', 0.73, 41], ['iron', 0.72, 37], ['coal', 0.71, 31], ['stone', 0.69, 43]];
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x; if (w.water[i]) continue;
    const hill = clamp((w.elevation?.[i] || 0) / 80, 0, 0.04);
    for (const [k, th, o] of seams) {
      const v = fbm(x * 0.013 + o, z * 0.013 - o, s + o, 3) + hill;
      if (v > th) { kind[i] = DEPOSITS[k].id; rich[i] = Math.round(clamp((v - th) / 0.08, 0.15, 1) * 255); break; }
    }
    if (!kind[i] && w.forestAt(x, z)) { kind[i] = 1; rich[i] = Math.round(clamp((fbm(x * 0.018, z * 0.018, s + 9) - 0.55) / 0.1, 0.2, 1) * 255); }
  }
  w._dep = { seed: s, v: w.depVersion || 0, kind, rich };
  return w._dep;
}

// how rich the deposit of this kind is around (x, z), 0..1; forest has to be standing (not built on)
export function depositNear(w, key, x, z, r = 18) {
  const D = deposits(w), id = DEPOSITS[key]?.id; if (!id) return 0;
  let sum = 0, n = 0;
  for (let zz = Math.max(0, Math.floor(z - r)); zz <= Math.min(N - 1, z + r); zz += 2) for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(N - 1, x + r); xx += 2) {
    if (Math.hypot(xx - x, zz - z) > r) continue;
    const i = zz * N + xx; n++;
    if (D.kind[i] === id && !(id === 1 && (w.road[i] || (w.bld[i] && !SERVICES[w.buildings.get(w.bld[i])?.svc]?.dep)))) sum += D.rich[i] / 255;
  }
  return n ? clamp(sum / n * 2.5, 0, 1) : 0;
}

// ---------------------------------------------------------------- the daily industry tick
const canShipTo = (w) => [...w.net.nodes.values()].some((n) => n.outside && n.edges.size);
const running = (sim, b) => !b.abandoned && b.edge >= 0 && !(b.constructionUntil > sim.day) && !b.fire && (b.flood || 0) < 1;

export function industryTick(sim) {
  const w = sim.w, ind = (sim.industry ||= { stock: {}, mined: {}, month: null, last: null });
  const all = [...w.buildings.values()].filter((b) => SERVICES[b.svc]?.chain);
  if (!all.length && !Object.keys(ind.stock).length && !(sim.deals || []).some((d) => COMMODITIES[d.kind])) { sim.industryFlow = null; return null; }
  const M = (ind.month ||= { made: {}, used: {}, sold: {}, bought: {}, sales: 0, costs: 0 }), stock = ind.stock, d = 1 / MONTH_DAYS;
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const live = all.filter((b) => running(sim, b));
  const exchange = live.some((b) => b.svc === 'exchange' && b.power), wh = live.filter((b) => b.svc === 'warehouse' && b.power).length;
  const stockCap = 40 + wh * SERVICES.warehouse.stock, premium = 1.15 - 0.03 * Math.min(4, sim.regionMarket?.exchanges || 0);   // rival exchanges in the region
  const terminals = [...w.buildings.values()].some((b) => SERVICES[b.svc]?.freight && !b.abandoned && b.edge >= 0);
  // a plant runs on its budget, its staff, and power and water (under half speed on only one of them)
  const eff = (b) => {
    const S = SERVICES[b.svc]; if (!running(sim, b)) return 0;
    const util = b.power && b.water ? 1 : b.power || b.water ? 0.4 : 0;
    const staff = S.jobs ? clamp((b.workers || 0) / S.jobs, 0, 1) : 1;
    const pol = w.districts[b.district]?.policy?.industry, S2 = SERVICES[b.svc];
    return util * staff * sim.budgetFor(b.svc) * (pol === 'park' && S2.chain === 'process' ? 1.15 : pol === 'mining' && S2.chain === 'extract' ? 1.25 : 1);
  };
  const costs0 = M.costs;
  // 1. extraction
  for (const b of live) {
    const S = SERVICES[b.svc]; if (S.chain !== 'extract') continue;
    const rich = depositNear(w, S.dep, b.cx, b.cz, S.reach), reserve = rich * (S.dep === 'timber' ? 2500 : 9000), mined = ind.mined[b.id] || 0;
    const left = reserve > 0 ? clamp(1 - mined / reserve, 0, 1) : 0, e = eff(b), q = S.rate * d * e * Math.min(1, rich * 1.5) * Math.sqrt(left);
    add(stock, S.out, q); add(M.made, S.out, q); ind.mined[b.id] = mined + q;
    if (S.dep === 'timber') ind.mined[b.id] *= 1 - 0.02 * d;   // the forest grows back
    b.indEff = e; b.indLeft = left; b.indRich = rich;
    if (left < 0.05 && S.dep !== 'timber' && !ind.warned?.[b.id]) { (ind.warned ||= {})[b.id] = 1; sim.msg?.(`The ${S.name.toLowerCase()} has nearly worked out its ${DEPOSITS[S.dep].name.toLowerCase()} seam. Build a new one on a fresh deposit.`, 'warn', 'resources'); }
  }
  // 2. processing, in chain order; the exchange imports whatever inputs are short
  for (const key of CHAIN_ORDER) for (const b of live) {
    if (b.svc !== key) continue;
    const S = SERVICES[key], e = eff(b), want = S.rate * d * e; b.indEff = e;
    if (want <= 0) continue;
    let k = 1;
    for (const [c, r] of Object.entries(S.in)) {
      const need = want * r, have = stock[c] || 0;
      if (have < need && exchange) { const buy = need - have; M.costs += buy * COMMODITIES[c].price * (sim.regionMarket?.supply[c] > buy * 30 ? 1.12 : 1.3) * priceOf(sim, c); stock[c] = need; add(M.bought, c, buy); }   // cheaper when a neighbour sells it
      k = Math.min(k, (stock[c] || 0) / need);
    }
    const q = want * clamp(k, 0, 1);
    for (const [c, r] of Object.entries(S.in)) { stock[c] -= q * r; add(M.used, c, q * r); }
    add(stock, S.out, q); add(M.made, S.out, q); b.indInputs = clamp(k, 0, 1);
  }
  // 3. local use: coal for the power plants, goods for shops, materials for roads, machines for factories
  const use = (c, per) => { const u = Math.min(stock[c] || 0, per * d); if (u > 0) { stock[c] -= u; add(M.used, c, u); } return u; };
  const plants = [...w.buildings.values()].filter((b) => b.svc === 'coal' && !b.abandoned).length;
  const burn = use('coal', plants * 20), goods = use('furniture', 40) + use('paper', 40), mats = use('cement', 40) + use('steel', 25), mach = use('machinery', 10);
  // 3b. commodity contracts with other governors: deliveries out of stock, or supplies into it
  let contractIn = 0, contractOut = 0;
  for (const dl of sim.deals || []) {
    if (!COMMODITIES[dl.kind] || !canShipTo(w)) continue;
    const q = dl.amount * d;
    if (dl.role === 'sell') { const u = Math.min(stock[dl.kind] || 0, q); stock[dl.kind] = (stock[dl.kind] || 0) - u; contractIn += u * dl.price; add(M.sold, dl.kind, u); dl.delivered = (dl.delivered || 0) + u; }
    else { add(stock, dl.kind, q); contractOut += q * dl.price; add(M.bought, dl.kind, q); }
  }
  M.sales += contractIn; M.costs += contractOut;
  // 4. the market: sell what nobody here needs (inputs of plants you run stay in stock up to the cap)
  const canShip = terminals || [...w.net.nodes.values()].some((n) => n.outside && n.edges.size);
  // plants keep ten days of their inputs; a warehouse holds products back while prices are low
  const buffer = {};
  for (const b of live) for (const [c, r] of Object.entries(SERVICES[b.svc].in || {})) buffer[c] = (buffer[c] || 0) + SERVICES[b.svc].rate * r * d * 10;
  let sales = 0;
  for (const c of Object.keys(stock)) {
    const keep = buffer[c] ? Math.min(stock[c], buffer[c], stockCap) : wh && priceOf(sim, c) < 0.95 ? Math.min(stock[c], stockCap) : 0, spare = Math.max(0, stock[c] - keep);
    if (canShip && spare > 0) {
      const v = spare * COMMODITIES[c].price * priceOf(sim, c) * (exchange ? premium : COMMODITIES[c].raw ? 0.6 : 0.85) * (terminals ? 1.08 : 1);
      sales += v; add(M.sold, c, spare); stock[c] -= spare;
    }
    stock[c] = Math.max(0, Math.min(stock[c], stockCap));   // what can't be stored or shipped is lost
  }
  M.sales += sales;
  sim.industryFlow = {
    sales: sales + contractIn, costs: M.costs - costs0,          // today's money
    fuel: plants ? clamp(burn / (plants * 20 * d), 0, 1) : 0,
    goods: goods * MONTH_DAYS * 6,                          // shop goods (as goods units)
    materials: clamp(mats / (65 * d), 0, 1),
    machinery: clamp(mach / (10 * d), 0, 1),
    exchange, warehouses: wh, stockCap, canShip,
  };
  return sim.industryFlow;
}
// start a new month of industry statistics
export function industryMonth(sim) { const ind = sim.industry; if (!ind) return; ind.last = ind.month; ind.month = null; }

// commodity prices drift on their own cycles, times the regional market's supply and demand
export function priceOf(sim, c) {
  const t = sim.day / 75, ph = hash2(sim.w.seed, c.length * 13 + c.charCodeAt(0), 23) * 6.283;
  return clamp(0.9 + 0.22 * Math.sin(t + ph) + 0.08 * Math.sin(t * 2.7 + ph * 2), 0.6, 1.5) * (sim.regionMarket?.price[c] ?? 1);
}

// Offers from AI governors next door (monthly, deterministic): a city that wants what you sold
// last month offers to buy a share of it at a premium; a city that sells what your plants lack
// offers to supply it. Each offer lasts a month; accepted offers become commodity contracts.
export function aiOffers(region, activeKey, sim, nbKeys) {
  const mine = sim.industry?.last || {}, out = [], month = Math.floor(sim.day / 30);
  const inputs = new Set([...sim.w.buildings.values()].flatMap((b) => Object.keys(SERVICES[b.svc]?.in || {})));
  for (const k of nbKeys) {
    const t = region.tiles[k]; if (!t || t.gov !== 'ai' || !(t.kind === 'city' || t.kind === 'ai')) continue;
    if ((region.deals || []).some((d) => (d.seller === k || d.buyer === k) && COMMODITIES[d.kind])) continue;   // one contract per neighbour
    const pop = t.summary?.pop ?? t.pop ?? 0, theirs = t.summary?.industry?.sold || {}, h = (n) => hash2(month, k.length * 7 + n, 311);
    const sells = Object.entries(mine.sold || {}).filter(([c, v]) => v > 15 && (APPETITE[c] || 0) * pop > 5).sort((a, b) => b[1] - a[1]);
    const buys = [...inputs].filter((c) => (theirs[c] || 0) > 10);
    if (sells.length && (h(1) < 0.6 || !buys.length)) {
      const [c, v] = sells[Math.floor(h(2) * Math.min(3, sells.length))], amount = Math.max(10, Math.round(Math.min(v * 0.6, APPETITE[c] * pop * 1.5) / 5) * 5);
      out.push({ partner: k, name: t.name, role: 'sell', kind: c, amount, price: +(COMMODITIES[c].price * priceOf(sim, c) * 1.12).toFixed(1), month });
    } else if (buys.length) {
      const c = buys[Math.floor(h(3) * buys.length)], amount = Math.max(10, Math.round(theirs[c] * 0.5 / 5) * 5);
      out.push({ partner: k, name: t.name, role: 'buy', kind: c, amount, price: +(COMMODITIES[c].price * priceOf(sim, c) * 1.05).toFixed(1), month });
    }
  }
  return out;
}

// The regional market (monthly): every other tile's commodity sales are supply, its purchases
// and its people's appetite for goods and materials are demand. Scarce goods fetch more, gluts
// less; rival exchanges in other tiles shave the premium of yours.
const APPETITE = { furniture: 1 / 400, paper: 1 / 500, cement: 1 / 800, steel: 1 / 900, lumber: 1 / 700, metals: 1 / 1500, machinery: 1 / 3000, coal: 1 / 1200 };
export function regionMarket(region, activeKey) {
  const supply = {}, demand = {}; let exchanges = 0, tiles = 0;
  for (const [k, t] of Object.entries(region.tiles)) {
    if (k === activeKey || (t.kind !== 'city' && t.kind !== 'ai')) continue;
    const ind = t.summary?.industry, pop = t.kind === 'ai' && !t.summary ? t.pop || 0 : t.summary?.pop || 0;
    tiles++; if (ind?.exchange) exchanges++;
    for (const [c, v] of Object.entries(ind?.sold || {})) supply[c] = (supply[c] || 0) + v;
    for (const [c, v] of Object.entries(ind?.bought || {})) demand[c] = (demand[c] || 0) + v;
    for (const [c, a] of Object.entries(APPETITE)) demand[c] = (demand[c] || 0) + pop * a;
  }
  const price = {};
  for (const c of Object.keys(COMMODITIES)) { const S = supply[c] || 0, D = demand[c] || 0; price[c] = +clamp(1 + 0.5 * (D - S) / (D + S + 40), 0.7, 1.45).toFixed(3); }
  return { price, supply, demand, exchanges, tiles };
}
