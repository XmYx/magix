// Organicity — simulation. The main thread owns the world and runs the systems
// that change it (daily economy, utilities, growth & decline). The heavy
// read-only systems — service coverage, land value & nuisance fields, traffic —
// live in core.js and run in a Web Worker when available (in-thread time slices
// otherwise), fed with snapshots and applied when results come back.
import { N, FC, FN, DAY_SECONDS, MONTH_DAYS, ZONES, SERVICES, ROADS, LEVEL_APPEAL, FLOORS, START_MONEY, ORDINANCES, NEIGHBOUR_NAMES, STREET_NAMES, STREET_KINDS } from './config.js';
import { START_ERAS, technology, buildingFloors, skyNetwork, massPlan, skyBridges } from './eras.js';
import { hazardTick } from './terrain.js';
import { transitMode } from './transit.js';
import { weatherAt } from './weather.js';
import { clamp, mulberry32, hash2 } from './util.js';
import { dirCapacity } from './assign.js';
import { TUTORIAL } from './scenarios.js';
import { disasterTick } from './disasters.js';
import { sideOf } from './region.js';
import { Core, sampleField, splat, netSnapshot, F2, HH, COVER } from './core.js';
const AUSTERITY = 0.75;   // service funding cap while the city is bankrupt-bound
import { fastestRoute } from './routes.js';

export const PROB = { power: 1, water: 2, sewage: 4, garbage: 8, road: 16, outside: 32, abandoned: 64, fire: 128, sick: 256, rubble: 512 };
export const SANDBOX_DEFAULTS = { infinite: true, instant: false, ignoreAppeal: false, noFires: true, noIllness: true, noDisasters: true, noDecline: false, lockDemand: false, demand: { R: 50, C: 50, I: 50, O: 50 } };
const PRIO_CODE = { balanced: 0, safety: 1, health: 2, education: 3 };

// Runs Core in a worker, or in-thread under the frame budget as a fallback.
class CoreHost {
  constructor(sim, useWorker) {
    this.sim = sim; this.busy = false; this.gen = null; this.worker = null; this.local = null;
    this.ver = {};
    if (useWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => this.done(e.data);
        this.worker.onerror = (e) => { console.warn('Sim worker failed; running in-thread.', e.message); this.fallback(); };
        this.worker.postMessage({ type: 'init', seed: sim.w.seed });
      } catch (err) { console.warn('Sim worker unavailable; running in-thread.', err); this.worker = null; }
    }
    if (!this.worker) this.local = new Core(sim.w.seed);
  }
  get mode() { return this.worker ? 'worker' : 'in-thread'; }
  fallback() { if (this.worker) this.worker.terminate(); this.worker = null; this.local = new Core(this.sim.w.seed); this.busy = false; this.gen = null; this.ver = {}; }
  post(m) { if (this.worker) this.worker.postMessage(m); else this.local.handle(m); }
  // send m only when `key` changed since the last send
  sync(name, key, make) { if (this.ver[name] !== key) { this.post(make()); this.ver[name] = key; } }
  request(req) {
    this.busy = true; this.t0 = performance.now();
    if (this.worker) this.worker.postMessage({ type: 'run', req });
    else this.gen = this.local.run(req);
  }
  step(deadline) {
    if (!this.gen) return;
    while (performance.now() < deadline) {
      if (this.gen.next().done) { this.gen = null; const r = this.local.result; r.ms = performance.now() - this.t0; this.done(r); return; }
    }
  }
  done(res) { this.busy = false; this.sim.applyCore(res); }
}

export class Sim {
  constructor(world, opts = {}) {
    this.w = world;
    this.startYear = START_ERAS.includes(opts.startYear) ? opts.startYear : 2000;
    this.eraPace = [1,5,10].includes(opts.eraPace) ? opts.eraPace : 5;
    this.year = this.startYear; world.year = this.year; this.tech = technology(this.year);
    this.sky = {hubs:[],links:[],share:0}; this.skyVersion = 0;
    this.day = 0; this.acc = 0; this.speed = 1; this.paused = false;
    this.money = START_MONEY;
    this.serviceBudgets = {}; this.budgetVersion = 0; this.loans = []; this.loanId = 1;
    this.scenario = opts.scenario || null; this.scenarioWon = false; this.scenarioStart = null; this.tutorialFlags = {};
    this.ordinances = {}; world.ordinances = this.ordinances;   // shared so building heights can read the high-rise ban
    this.region = {}; this.news = []; this.milestone = 0; this.jamRoads = null;
    this.bonds = []; this.bondId = 1; this.insurance = false; this.preparedness = 0; this.landTax = 0; this.claims = 0;
    this.tax = { R: 9, C: 9, I: 9, O: 9 };
    this.brackets = { lowDensity: 0, highDensity: 0, smallBiz: 0, largeBiz: 0 };  // offsets on the zone rates
    this.trade = { sell: true, buy: false };                                     // utility trade at the highway
    this.tradeFlow = { soldP: 0, soldW: 0, boughtP: 0, boughtW: 0 };
    this.demand = { R: 45, C: 12, I: 40, O: 0 };
    this.sandbox = opts.sandbox ? { ...SANDBOX_DEFAULTS, ...opts.sandbox, demand: { ...SANDBOX_DEFAULTS.demand } } : null;
    this.rng = mulberry32(world.seed + 99);
    this.weatherOverride = null; this.weather = weatherAt(world.seed, 0); this.wind = this.weather.wind;
    this.routeOrigin = null; this.routeRevision = 0; this.routes = null;
    const z = () => new Float32Array(F2);
    this.f = { lv: z().fill(0.3), pollution: z(), noise: z(), crime: z(), access: z().fill(0.3), waterfront: z(), view: z(), dens: z(), dev: z(), infra: z() };
    this.cov = {}; for (const k of COVER) this.cov[k] = z(); this.cov.park = z();
    this.cs = { edge: new Int32Array(F2).fill(-1), s: z(), d: z() };
    this.stats = { pop: 0, households: 0, workers: 0, employed: 0, unemp: 0, jobs: { C: 0, I: 0, O: 0 }, filled: { C: 0, I: 0, O: 0 }, commuters: 0, eduRate: 0.15, hiEdu: 0, kids: 0, adults: 0, seniors: 0, schoolLoad: 0, hiLoad: 0, clinicLoad: 0, sick: 0,
      power: [0, 0], water: [0, 0], sewage: [0, 0], garbage: [0, 0, 0], happyR: 0.6, problems: {}, incomeM: 0, expenseM: 0, inc: {}, exp: {} };
    this.month = { income: 0, expense: 0 };
    this.lastMonth = { income: 0, expense: 0 };
    this.history = [];
    this.messages = [];
    this.lastEval = 0; this.lastUtil = 0;
    this.freeCells = []; this.freeVer = -1;
    this.flowVersion = 0; this.fieldVersion = 0;
    this.budgetMs = 5;
    this.jobs = [
      { name: 'utilities', period: 1, fn: () => this.utilitiesJob(), dep: () => world.net.version + ':' + world.bldVersion },
      { name: 'growth', period: 0.5, fn: () => this.growthJob() },
    ];
    for (const j of this.jobs) { j.next = 0; j.active = null; j.lastDep = null; j.ms = 0; }
    this.coreJob = { name: 'core', ms: 0, next: 0, covNext: 0, covKey: null };
    this.host = new CoreHost(this, opts.worker !== false);
    this.staticFields();
  }

  msg(text, kind = 'info', key = text) {
    const now = performance.now(), last = this.msgAt?.[key];
    if (last && now - last < 45000) return;
    (this.msgAt ||= {})[key] = now;
    this.messages.push({ text, kind, t: now });
    if (this.messages.length > 30) this.messages.shift();
    this.headline(text, kind);
  }
  // the news feed: every message plus monthly headlines, dated
  headline(text, kind = 'info') {
    this.news.push({ day: this.day, year: this.year, text, kind });
    if (this.news.length > 60) this.news.shift();
  }

  // ---------------------------------------------------------------- money
  canAfford(c) { return (this.sandbox && this.sandbox.infinite) || this.money >= c; }
  spend(c) { if (!(this.sandbox && this.sandbox.infinite)) this.money -= c; }

  updateEra() {
    const year = this.startYear + Math.floor(this.day * this.eraPace / 360);
    if (year !== this.year) {
      const was = this.tech, before = new Map();
      for (const b of this.w.buildings.values()) if (!b.svc) before.set(b.id, buildingFloors(b, this.w));
      this.year = year; this.w.year = year; this.tech = technology(year);
      const restyle = was.style !== this.tech.style;
      for (const b of this.w.buildings.values()) {
        if (b.svc && !restyle) continue;
        if (!b.locked && !this.w.policyAt(b)?.historic) b.heightYear = year;
        // only rebuild what visibly changes: storey count, or everything when the era style flips
        if (restyle || buildingFloors(b, this.w) !== before.get(b.id)) this.w.touchBuilding(b);
      }
      if (restyle) this.msg(`A new era: ${this.tech.style} architecture from ${year}.`, 'good', 'era');
      if (!was.terraces && this.tech.terraces) this.msg('Terrace platforms unlocked: inspect a tall building to build one.', 'good');
      if (!was.flying && this.tech.flying) this.msg('Aerial mobility unlocked: dense districts now attract automatic skyways.', 'good');
    }
    this.w.updatePlatforms();
    const key = `${this.year}:${this.w.bldVersion}:${this.w.net.version}`;
    if (key !== this.skyKey) {
      this.skyKey = key;
      const sky = skyNetwork(this.w), sig = sky.links.map((l) => `${l.a}-${l.b}@${l.y}`).join(',');
      this.sky = sky;
      if (sig !== this.skySig) { this.skySig = sig; this.skyVersion++; } // rebuild meshes only when links change
    }
  }
  advanceEra() {
    if(!this.sandbox)return;
    this.day += Math.ceil(10*360/this.eraPace);this.w.day=this.day;this.updateEra();
    this.weather=weatherAt(this.w.seed,this.day,this.weatherOverride);this.wind=this.weather.wind;
  }
  selectRoutes(id) {
    if (this.routeOrigin === id) return;
    this.routeOrigin = id; this.routeRevision++; this.routes = null;
  }
  setWeather(type) {
    if (!this.sandbox) return;
    this.weatherOverride = type || null;
    this.weather = weatherAt(this.w.seed, this.day, this.weatherOverride); this.wind = this.weather.wind;
    this.budgetVersion++;
  }
  budgetFor(key) { return this.serviceBudgets[key] ?? 1; }
  setBudget(key, value) {
    if (!SERVICES[key] || !Number.isFinite(value)) return;
    this.serviceBudgets[key] = clamp(value, 0.5, this.austerity ? AUSTERITY : 1.5); this.budgetVersion++;
  }
  takeLoan(principal = 25000, months = 12) {
    if (![25000, 50000, 100000].includes(principal) || ![12, 24].includes(months) || this.loans.filter((l) => !l.bailout).length >= 3 || this.sandbox?.infinite) return false;
    const rate = 0.01, payment = principal * rate / (1 - (1 + rate) ** -months);
    this.loans.push({ id: this.loanId++, balance: principal, payment, days: months * MONTH_DAYS });
    this.money += principal; return true;
  }
  repayLoan(id) {
    const loan = this.loans.find(l => l.id === id);
    if (!loan || this.money < loan.balance) return false;
    this.money -= loan.balance; this.loans = this.loans.filter(l => l !== loan); return true;
  }
  // Month-end debt rules (not in sandbox): a warning, forced service cuts after three
  // months in the red, then after six a bailout loan at a penalty rate — or, while
  // scenario goals are still open, the city is declared bankrupt.
  bankruptcy() {
    if (this.money >= 0) {
      if (this.austerity) { this.austerity = false; this.msg('The city is solvent again: service funding can be raised.', 'good', 'debt'); }
      this.debtMonths = 0; return;
    }
    const m = this.debtMonths = (this.debtMonths || 0) + 1;
    if (m < 3) this.msg(`The city is in debt (month ${m}). After 3 months services are cut; after 6 the state steps in.`, 'bad', 'debt');
    else if (m < 6) {
      if (!this.austerity) {
        this.austerity = true;
        for (const k of Object.keys(SERVICES)) this.serviceBudgets[k] = Math.min(this.budgetFor(k), AUSTERITY);
        this.budgetVersion++;
      }
      this.msg(`Austerity: service funding is capped at ${AUSTERITY * 100}% until the city is out of debt.`, 'bad', 'debt');
    } else if (this.scenario && !this.scenarioWon) {
      this.gameOver = true; this.paused = true;
      this.msg('Bankrupt: six months in debt. The scenario is lost — load a save or start a new city.', 'bad', 'debt');
    } else {
      const principal = Math.ceil((-this.money + 20000) / 5000) * 5000, rate = 0.02, months = 24;
      this.loans.push({ id: this.loanId++, balance: principal, payment: principal * rate / (1 - (1 + rate) ** -months), days: months * MONTH_DAYS, rate, bailout: true });
      this.money += principal; this.debtMonths = 0;
      this.msg(`State bailout: a ${principal.toLocaleString()} loan at 2% a month clears the debt.`, 'warn', 'debt');
    }
  }
  debtTick() {
    let paid = 0;
    for (const l of this.loans) {
      const interest = l.balance * (l.rate ?? 0.01) / MONTH_DAYS;
      const payment = l.days <= 1 ? l.balance + interest : Math.min(l.balance + interest, l.payment / MONTH_DAYS);
      l.balance = Math.max(0, l.balance + interest - payment); l.days--; paid += payment;
    }
    this.loans = this.loans.filter(l => l.balance > 0.001); return paid;
  }
  levelRequirements(b) {
    const n = b.level + 1, pol = this.w.policyAt(b), free = this.sandbox?.ignoreAppeal;
    const checks = [
      ['District permits next level', n <= Math.min(ZONES[b.zone].maxLevel, pol?.maxLevel ?? 5) && !pol?.historic && !b.locked],
      ['Building established', this.day - b.built > (this.sandbox?.instant ? 3 : 20 + b.level * 18)],
      ['Mostly occupied', !!free || (b.hh ? b.occ >= b.hh * 0.8 : (b.workers || 0) >= (b.jobs || 1) * 0.7)],
      [`Appeal ≥ ${Math.round((LEVEL_APPEAL[n] || 0) * 100)}%`, !!free || b.appeal >= LEVEL_APPEAL[n]],
      ['Positive development demand', this.demandOf(b.zone) > -10],
    ];
    if (n >= 3) checks.push(['School and clinic coverage', !!free || (this.bcov('school', b) > 0.1 && this.bcov('clinic', b) > 0.1)]);
    if (n >= 4) checks.push(['Transit and land value ≥ 60%', !!free || (this.bcov('busstop', b) > 0.1 && (b.lv || 0) >= 0.6)]);
    if (n >= 5 && ZONES[b.zone].kind === 'O') checks.push(['Graduates ≥ 20% (college or university)', !!free || (this.stats.eduRate >= 0.6 && this.stats.hiEdu >= 0.2)]);
    return checks;
  }
  scenarioProgress() {
    if (this.scenario === 'town') return [['Population 1,000', this.stats.pop >= 1000], ['Non-negative funds', this.money >= 0], ['Unemployment ≤ 10%', this.stats.unemp <= 0.1]];
    const st = this.stats;
    if (this.scenario === 'tutorial') return TUTORIAL.map((t) => [t.label, !!t.done(this)]);
    if (this.scenario === 'gridlock') return [['No road over capacity', this.jamRoads !== null && this.day > 15 && (this.worstRoad()?.ratio ?? 0) <= 1], ['Keep 80% of residents', !!this.scenarioStart && st.pop >= this.scenarioStart.pop * 0.8], ['Happiness ≥ 60%', st.happyR >= 0.6], ['Within two years', this.day <= 720]];
    if (this.scenario === 'debt') return [['Funds ≥ ₵10,000', this.money >= 10000], ['Monthly surplus ≥ ₵500', st.incomeM - st.expenseM >= 500], ['No bailout', !this.loans.some((l) => l.bailout)], ['Keep 80% of residents', !!this.scenarioStart && st.pop >= this.scenarioStart.pop * 0.8]];
    if (this.scenario === 'prosper') return [['Population 2,500', this.stats.pop >= 2500], ['Monthly surplus ≥ ₵2,000', this.stats.incomeM - this.stats.expenseM >= 2000], ['Happiness ≥ 70%', this.stats.happyR >= 0.7]];
    return [];
  }

  // ---------------------------------------------------------------- field helpers
  staticFields() {
    const w = this.w, waterfront = new Float32Array(F2), view = new Float32Array(F2);
    for (let k = 0; k < F2; k++) {
      const gx = k % FN, gz = (k / FN) | 0; let mind = 1e9, wet = 0, n = 0;
      for (let z = gz * FC; z < gz * FC + FC; z += 2) for (let x = gx * FC; x < gx * FC + FC; x += 2) mind = Math.min(mind, w.wdist[z * N + x]);
      for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
        const x = (gx + dx) * FC + 4, z2 = (gz + dz) * FC + 4; if (x < 0 || z2 < 0 || x >= N || z2 >= N) continue;
        n++; if (w.water[z2 * N + x]) wet++;
      }
      waterfront[k] = mind < 0 ? 0 : clamp(1 - mind / 28, 0, 1);
      view[k] = clamp((wet / (n || 1)) * 3, 0, 1);
    }
    this.f.waterfront = waterfront; this.f.view = view;
  }

  at(arr, x, z) { return sampleField(arr, x, z); }
  splat(arr, x, z, r, v) { splat(arr, x, z, r, v); }

  // each coarse cell's best road access sample (edge, arc, kerb distance)
  coarseSamples() {
    const w = this.w, cs = { edge: new Int32Array(F2).fill(-1), s: new Float32Array(F2), d: new Float32Array(F2) };
    for (let k = 0; k < F2; k++) {
      const gx = k % FN, gz = (k / FN) | 0; let best = 1e9, be = -1, bs = 0;
      for (let z = gz * FC; z < gz * FC + FC; z++) for (let x = gx * FC; x < gx * FC + FC; x++) {
        const i = z * N + x; if (w.accEdge[i] >= 0 && w.accDist[i] < best) { best = w.accDist[i]; be = w.accEdge[i]; bs = w.accS[i]; }
      }
      cs.edge[k] = be; cs.s[k] = bs; cs.d[k] = be >= 0 ? best : 0;
    }
    this.cs = cs;
    return cs;
  }

  // ---------------------------------------------------------------- scheduler
  update(dt) {
    const w = this.w;
    w.txMute = true; // simulation changes never land in the player's undo history
    const maxSpeed = this.sandbox ? 16 : 4;
    this.speed = Math.min(this.speed, maxSpeed);
    if (this.gameOver) this.paused = true;
    if (!this.paused) {
      this.acc += (dt * this.speed) / DAY_SECONDS;
      let guard = 0;
      while (this.acc >= 1 && guard++ < 6) { this.acc -= 1; this.dailyTick(); }
      if (this.acc > 6) this.acc = 0;
    }
    const t = this.day + this.acc, t0 = performance.now(), deadline = t0 + this.budgetMs;
    // heavy systems (worker or in-thread)
    const cj = this.coreJob;
    if (!this.host.busy) {
      const covKey = `${w.net.version}:${w.svcVersion}:${w.districtVersion || 0}:${this.budgetVersion}:${this.routeRevision}:${this.routeOrigin == null ? 0 : w.bldVersion}`;
      const changed = covKey !== cj.covKey;
      if ((t >= cj.next && !this.paused) || changed) this.requestCore(t, changed || t >= cj.covNext, covKey);
    }
    this.host.step(deadline);
    for (const j of this.jobs) {
      if (j.active) continue;
      const dep = j.dep ? j.dep() : null;
      if ((t >= j.next && !this.paused) || (dep !== null && dep !== j.lastDep)) { j.active = j.fn(); j.lastDep = dep; }
    }
    let any = true;
    while (any && performance.now() < deadline) {
      any = false;
      for (const j of this.jobs) {
        if (!j.active) continue; any = true;
        const s = performance.now(), r = j.active.next();
        j.ms = j.ms * 0.9 + (performance.now() - s) * 0.1;
        if (r.done) { j.active = null; j.next = t + j.period; }
        if (performance.now() > deadline) break;
      }
    }
    w.txMute = false;
  }

  requestCore(t, doCoverage, covKey) {
    this.updateEra();
    const w = this.w, host = this.host, cj = this.coreJob;
    host.sync('static', w.terrainVersion || 0, () => ({ type: 'static', waterfront: this.f.waterfront, view: this.f.view }));
    host.sync('net', `${w.net.version}:${this.day}`, () => ({ type: 'net', net: netSnapshot(w.net) }));
    host.sync('cs', `${w.net.version}:${w.terrainVersion || 0}`, () => ({ type: 'cs', cs: this.coarseSamples() }));
    const blds = [], skyHubs = new Set(this.sky.hubs);
    for (const b of w.buildings.values()) {
      const Z = b.svc ? null : ZONES[b.zone], pol = b.svc ? null : w.policyAt(b);
      blds.push({
        id: b.id, cx: b.cx, cz: b.cz, edge: b.edge, s: b.s, comp: b.comp ?? -1, svc: b.svc, platformId: b.platformId, zk: Z ? Z.key : '', kind: Z ? Z.kind : '',
        level: b.level, occ: b.occ || 0, workers: b.workers || 0, ab: !!b.abandoned || (b.flood||0)>1, construction: b.constructionUntil > this.day || b.rubble > 0, spill: b.spill > 0, power: !!b.power, water: !!b.water, sewage: !!b.sewage,
        green: !!(pol && pol.green), carFree: !!(this.ordinances.carFree && pol?.carFree), bus: this.bcov('busstop', b) > 0.1, sky: skyHubs.has(b.id), spec: b.spec || null,
      });
    }
    // festival crowds: the venue draws trips like a large shopping district
    const venue = this.event && w.buildings.get(this.event.venue);
    if (venue && venue.edge >= 0) blds.push({ id: -1, cx: venue.cx, cz: venue.cz, edge: venue.edge, s: venue.s, comp: venue.comp ?? -1, svc: null, platformId: 0, zk: 'c', kind: 'C', level: 3, occ: 0, workers: 900, ab: false, construction: false, power: true, water: true, sewage: true, green: false, carFree: false, bus: false, sky: false, spec: null });
    // bus lines only run when a depot serves their road network
    w.pruneLines();
    const lines = [];
    for (const l of w.lines) {
      const stops = l.stops.map((id) => w.buildings.get(id)).filter((b) => b && b.edge >= 0);
      if (stops.length >= 2 && stops.every(b=>!b.abandoned&&(b.flood||0)<1&&(!l.mode||l.mode==='bus'||b.power)) && ((l.mode && l.mode !== 'bus') || stops.every((b) => this.busComps?.has(b.comp)))) lines.push({ id: l.id, mode: l.mode || 'bus', headway: l.headway || 10, offpeak: l.offpeak || l.headway || 10, stops: stops.map((b) => ({ edge: b.edge, s: b.s, x: b.cx, z: b.cz })) });
    }
    let prio = null;
    if (doCoverage && w.districts.some((d) => d && d.policy.priority !== 'balanced')) {
      prio = new Uint8Array(F2);
      for (let k = 0; k < F2; k++) {
        const gx = k % FN, gz = (k / FN) | 0, d = w.districts[w.district[(gz * FC + 4) * N + gx * FC + 4]];
        prio[k] = d ? PRIO_CODE[d.policy.priority] || 0 : 0;
      }
    }
    const st = this.stats;
    host.request({ t, clock: t, infra: this.infra ?? 1, ord: { ...this.ordinances }, weather: this.weather, skyShare: this.sky.share, hubs: this.skyHubs(), lines, routeOrigin: this.routeOrigin, routeRevision: this.routeRevision, netVersion: w.net.version, bldVersion: w.bldVersion, budgets: { ...this.serviceBudgets }, doCoverage, blds, prio, busComps: [...(this.busComps || [])], stats: { employed: st.employed, pop: st.pop, commuters: st.commuters, filledI: st.filled.I, outJobs: st.outJobs || 0 }, exits: this.exitWeights(), terminals: this.terminals() });
    cj.next = t + 1;
    if (doCoverage) { cj.covNext = t + 5; cj.covKey = covKey; }
  }

  applyCore(res) {
    const w = this.w;
    if (res.routeRevision === this.routeRevision && res.netVersion === w.net.version && res.bldVersion === w.bldVersion) this.routes = res.routes;
    if (res.cov) this.cov = res.cov;
    const { waterfront, view } = this.f;
    Object.assign(this.f, res.f, { waterfront, view });
    for (const [id, flow, cong, cond, speedF, cost, fAB, fBA] of res.edges) {
      const e = w.net.edges.get(id); if (!e) continue;
      e.flow = flow; e.cong = cong; e.cond = cond; e.speedF = speedF; e.cost = cost; e.fAB = fAB; e.fBA = fBA;
    }
    for (const n of w.net.nodes.values()) { n.delay = 0; n.through = 0; }
    for (const [id, delay, through] of res.nodes || []) { const n = w.net.nodes.get(id); if (n) { n.delay = delay; n.through = through; } }
    if (res.lines) { this.lineInfo = new Map(res.lines.map((l) => [l.id, l])); this.lineInfoVersion = (this.lineInfoVersion || 0) + 1; }
    if (res.samples) { this.trafficSamples = res.samples; this.sampleVersion = (this.sampleVersion || 0) + 1; }
    if (res.modal) this.stats.modal = res.modal;
    if (res.jam !== undefined) this.jamRoads = res.jam;
    if (res.exitLoad) { this.exitLoad = new Map(res.exitLoad); this.terminalLoad = new Map(res.terminalLoad || []); }
    if (res.air) { this.air = { od: res.air.od, load: new Map(res.air.load) }; this.airVersion = (this.airVersion || 0) + 1; }
    for (const [id, tOut, tJob, cong, prod] of res.blds) {
      const b = w.buildings.get(id); if (!b) continue;
      b.tOut = tOut ?? Infinity; b.tJob = tJob ?? Infinity; b.cong = cong; b.prod = prod;
    }
    for (const [text, kind, key] of res.msgs) this.msg(text, kind, key);
    this.coreJob.ms = this.coreJob.ms * 0.8 + (res.ms || 0) * 0.2;
    this.flowVersion++; this.fieldVersion++;
  }

  demandOf(zoneId) {
    const k = ZONES[zoneId].kind;
    return k === 'M' ? (this.demand.R + this.demand.C) / 2 : this.demand[k];
  }

  // zone rate + bracket (density / business size) + district offset
  taxFor(kind, b) {
    const pol = b && this.w.policyAt(b), br = this.brackets;
    let rate = this.tax[kind] + (pol ? pol.tax[kind] || 0 : 0);
    if (b && !b.svc) {
      const key = ZONES[b.zone].key;
      if (kind === 'R') rate += key === 'rl' ? br.lowDensity : br.highDensity;
      else rate += b.level <= 2 ? br.smallBiz : br.largeBiz;
    }
    return clamp(rate, 0, 30);
  }

  // ---------------------------------------------------------------- society
  // Age mix of a home: new homes draw young families; residents age with the building.
  demography(b) {
    const key = ZONES[b.zone].key, age = clamp((this.day - (b.built ?? 0)) / 2400, 0, 1), h = hash2(b.id, 5, 211);
    const kids = (key === 'rl' ? 0.3 : 0.17) * (1 - 0.45 * age) + 0.03;
    const seniors = clamp((0.05 + 0.3 * age) * (0.7 + 0.6 * h), 0, 0.45);
    return { kids, seniors, adults: 1 - kids - seniors };
  }
  // total seats / patient places of a service type, scaled by its funding
  capacityOf(svc, field) {
    let n = 0;
    for (const b of this.w.buildings.values()) if (b.svc === svc && !b.abandoned && !(b.constructionUntil > this.day)) n += SERVICES[svc][field] || 0;
    return n * this.budgetFor(svc);
  }
  // Clinics keep homes healthy; overcrowded or unserved homes risk outbreaks that
  // spread to neighbouring buildings until they burn out (a vaccination drive halves both).
  healthTick() {
    const w = this.w, st = this.stats, sb = this.sandbox, vacc = this.ordinances.vaccination ? 0.5 : 1, off = (sb && sb.noIllness) || st.pop < 500;
    const cl = st.clinicLoad > 1 ? 1 / st.clinicLoad : 1;
    let sick = 0;
    for (const b of w.buildings.values()) {
      if (b.svc || !b.hh || b.abandoned) { b.sick = 0; continue; }
      b.health = clamp(this.bcov('clinic', b) * 1.3, 0, 1) * cl;
      if (b.sick > 0) {
        b.sick--; sick++;
        if (b.sick > 0 && !off) for (const n of w.adjacentBuildings(b).values()) {
          if (n && !n.svc && n.hh && !n.sick && this.rng() < 0.03 * vacc * (1 - (n.health || 0))) n.sick = 20;
        }
      } else if (!off && b.occ > 0 && this.rng() < 0.00015 * vacc * (b.hh >= 20 ? 3 : 1) * (1 - b.health) ** 2) {
        b.sick = 25; this.msg(`Illness outbreak near ${this.streetName(b.edge)}. Clinics contain it.`, 'bad', 'ill');
      }
    }
    st.sick = sick;
  }
  setOrdinance(key, on) {
    if (!ORDINANCES[key]) return;
    const before = key === 'highrise' ? new Map([...this.w.buildings.values()].filter((b) => !b.svc).map((b) => [b.id, buildingFloors(b, this.w)])) : null;
    if (on) this.ordinances[key] = true; else delete this.ordinances[key];
    if (before) for (const b of this.w.buildings.values()) if (!b.svc && buildingFloors(b, this.w) !== before.get(b.id)) this.w.touchBuilding(b);
    this.budgetVersion++;
  }

  // ---------------------------------------------------------------- region
  // One neighbouring city per highway exit, named and sized from the seed.
  regionList() {
    const outs = [...this.w.net.nodes.values()].filter((n) => n.outside);
    for (const n of outs) if (!this.region[n.id]) {
      const h = hash2(this.w.seed, n.id, 29);
      this.region[n.id] = { id: n.id, name: NEIGHBOUR_NAMES[Math.floor(hash2(this.w.seed, n.id, 31) * NEIGHBOUR_NAMES.length)], pop: Math.round(20000 + h * 180000), growth: 0.001 + h * 0.004 };
    }
    // exits facing a region tile take that tile's city; cities you run join with their saved numbers
    const nb = this.tileNeighbours || {}, seen = new Set();
    const viaExits = outs.map((n) => {
      const t = nb[sideOf(n)];
      if (t?.kind === 'city') return null;                               // listed below as a partner
      if (t) { if (seen.has(t.name)) return null; seen.add(t.name); return { ...this.region[n.id], name: t.name, pop: t.pop, connected: n.edges.size > 0 }; }
      return { ...this.region[n.id], connected: n.edges.size > 0 };
    }).filter(Boolean);
    return [...viaExits, ...(this.partnerCities || []).map((p) => ({ id: `tile:${p.key}`, name: p.name, pop: p.pop, connected: true, player: true, dir: p.dir }))];
  }
  growRegion() {
    const trade = (this.stats.inc?.exports || 0) + (this.stats.inc?.trade || 0) > 0 ? 1.3 : 1;   // trading partners grow faster
    for (const r of Object.values(this.region)) r.pop = Math.round(r.pop * (1 + r.growth * trade));
  }
  // price multipliers for goods, power and water: seasonal swings plus the neighbours' size
  market() {
    const t = this.day / 90, ph = (k) => hash2(this.w.seed, k, 17) * 6.283;
    const size = Math.min(1, (Object.values(this.region).reduce((s, r) => s + r.pop, 0) + (this.partnerCities || []).reduce((s, p) => s + p.pop, 0)) / 400000);
    return {
      goods: clamp(0.85 + 0.2 * Math.sin(t + ph(1)) + 0.2 * size, 0.6, 1.6),
      power: clamp(0.9 + 0.2 * Math.sin(t * 1.3 + ph(2)) + (this.weather.season === 'Winter' ? 0.15 : 0), 0.6, 1.6),
      water: clamp(0.95 + 0.15 * Math.sin(t * 0.7 + ph(3)) + (this.weather.type === 'heat' ? 0.2 : 0), 0.6, 1.6),
    };
  }

  // ---------------------------------------------------------------- news & advisors
  // Street names come from the road's neighbourhood, so they survive splits.
  streetName(eid) {
    const e = this.w.net.edges.get(eid); if (!e) return 'the edge of town';
    const p = this.w.net.sampleAt(e, e.len / 2), h = hash2(Math.floor(p.x / 48), Math.floor(p.z / 48), this.w.seed % 9973 + (e.type === 'highway' ? 7 : 0));
    return `${STREET_NAMES[Math.floor(h * STREET_NAMES.length)]} ${STREET_KINDS[e.type] || 'St'}`;
  }
  worstRoad() {
    let best = null;
    for (const e of this.w.net.edges.values()) {
      if (e.len < 15) continue;
      const r = Math.max(e.fAB || 0, e.fBA || 0) / dirCapacity(e);
      if (!best || r > best.ratio) best = { edge: e.id, ratio: r };
    }
    if (best) best.name = this.streetName(best.edge);
    return best;
  }
  monthlyNews() {
    const st = this.stats, M = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
    const next = M.find((m) => m > this.milestone && st.pop >= m);
    if (next) { this.milestone = next; this.headline(`Population passes ${next.toLocaleString('en-US')}!`, 'good'); }
    const jam = this.worstRoad();
    if (jam && jam.ratio > 1.1) this.headline(`Commuters crawl along ${jam.name}: traffic at ${Math.round(jam.ratio * 100)}% of capacity.`, 'warn');
    if (st.kids > 30 && st.schoolLoad > 1.1) this.headline(`Classrooms overflow: schools at ${Math.round(st.schoolLoad * 100)}% of their seats.`, 'warn');
    if (st.pop > 300 && st.clinicLoad > 1.1) this.headline(`Clinic waiting lists grow: care at ${Math.round(st.clinicLoad * 100)}% of capacity.`, 'warn');
    const reg = this.regionList().filter((r) => r.connected);
    if (reg.length && this.day % (MONTH_DAYS * 3) === 0) {
      const r = reg[Math.floor(this.rng() * reg.length)], mk = this.market();
      this.headline(`${r.name} (${r.pop.toLocaleString('en-US')} people) buys our goods at ${Math.round(mk.goods * 100)}% of the usual price.`, 'info');
    }
  }
  // Each advisor reports one line and names the overlay that shows the problem.
  advisors() {
    const st = this.stats, out = [], pct = (v) => `${Math.round(v * 100)}%`, A = (who, mood, text, ov) => out.push({ who, mood, text, ov });
    const jam = this.worstRoad(), tot = st.modal ? st.modal.car + st.modal.transit + (st.modal.air || 0) + (st.modal.walk || 0) : 0;
    if (jam && jam.ratio > 1) A('Transport', 'bad', `Traffic on ${jam.name} is at ${pct(jam.ratio)} of capacity. Add a parallel route, an avenue or a bus line.`, 'traffic');
    else A('Transport', 'good', `Roads flow freely.${tot ? ` ${pct((st.modal.transit + (st.modal.walk || 0)) / tot)} of trips avoid the car.` : ''}`, 'traffic');
    if (st.kids > 20 && st.schoolLoad > 1) A('Education', 'bad', `Schools are at ${pct(st.schoolLoad)} of their seats. Build another school or raise school funding.`, 'school');
    else if (st.pop > 1500 && st.hiEdu < 0.15) A('Education', 'warn', 'Few graduates. A college (1,500 people) or university (5,000) unlocks top offices and tech firms.', 'higher');
    else A('Education', 'good', `${pct(st.eduRate)} schooled · ${pct(st.hiEdu)} graduates.`, 'school');
    if (st.sick) A('Health', 'bad', `${st.sick} buildings have illness. Clinics nearby contain outbreaks; a vaccination drive halves them.`, 'health');
    else if (st.clinicLoad > 1) A('Health', 'warn', `Clinics are at ${pct(st.clinicLoad)} of capacity; ${Math.round(st.seniors).toLocaleString('en-US')} retirees need extra care.`, 'clinic');
    else A('Health', 'good', 'Healthcare keeps up with the city.', 'health');
    let crime = 0, n = 0, pol = 0;
    for (const b of this.w.buildings.values()) if (b.hh && !b.abandoned) { crime += this.at(this.f.crime, b.cx, b.cz); pol += this.at(this.f.pollution, b.cx, b.cz); n++; }
    crime = n ? crime / n : 0; pol = n ? pol / n : 0;
    const ruins = [...this.w.buildings.values()].filter((b) => b.rubble > 0).length;
    if (ruins) A('Emergency', 'bad', `${ruins} buildings lie in rubble. Fire stations and maintenance depots nearby clear sites twice as fast; clinics send ambulances.`, 'fire');
    A('Safety', crime > 0.35 ? 'bad' : crime > 0.2 ? 'warn' : 'good', crime > 0.2 ? `Crime reaches ${pct(crime)} in homes. Police stations, schools or a curfew bring it down.` : 'Streets are safe.', 'crime');
    A('Environment', pol > 0.3 ? 'bad' : pol > 0.15 ? 'warn' : 'good', pol > 0.15 ? `Homes breathe ${pct(pol)} pollution. Move industry downwind, plant parks, try green roofs.` : 'The air is clean.', 'pollution');
    const [ps, pd] = st.power, [ws, wd] = st.water;
    if (pd > ps || wd > ws) A('Utilities', 'bad', `${pd > ps ? `Power short by ${Math.round(pd - ps)} MW. ` : ''}${wd > ws ? `Water short by ${Math.round(wd - ws)} units.` : ''}`, pd > ps ? 'power' : 'water');
    else A('Utilities', 'good', 'Power and water cover demand.', 'power');
    const net = st.incomeM - st.expenseM;
    A('Finance', this.money < 0 ? 'bad' : net < 0 ? 'warn' : 'good', this.money < 0 ? 'The city is in debt. Raise taxes, cut funding or sell utilities.' : net < 0 ? `Losing ₵${Math.round(-net).toLocaleString('en-US')} a month.` : `Surplus of ₵${Math.round(net).toLocaleString('en-US')} a month.`, null);
    return out;
  }

  // One resident of a home, generated from the building (the same person every time):
  // age group from the home's demography, and how they get about from what's on offer.
  citizenOf(b, k = 0) {
    const h = (s) => hash2(b.id, k * 97 + s, 419), FIRST = ['Ada', 'Bence', 'Chloé', 'Dmitri', 'Eszter', 'Farid', 'Greta', 'Hiro', 'Ines', 'Jonas', 'Kasia', 'Luca', 'Mira', 'Noor', 'Otto', 'Priya', 'Rosa', 'Sven', 'Tamás', 'Uma', 'Vera', 'Wen', 'Yara', 'Zoltán'];
    const LAST = ['Andersen', 'Baker', 'Costa', 'Dubois', 'Esposito', 'Fischer', 'García', 'Horváth', 'Ivanova', 'Jensen', 'Kowalski', 'Lindqvist', 'Moreau', 'Nagy', 'Okafor', 'Petrov', 'Quinn', 'Rossi', 'Sato', 'Tanaka'];
    const dg = this.demography(b), r = h(1), cohort = r < dg.kids ? 'child' : r < dg.kids + dg.seniors ? 'retiree' : 'adult';
    const age = cohort === 'child' ? 5 + Math.floor(h(2) * 12) : cohort === 'retiree' ? 66 + Math.floor(h(2) * 25) : 19 + Math.floor(h(2) * 45);
    const m = this.stats.modal || {}, tot = Math.max(1, (m.car || 0) + (m.transit || 0) + (m.walk || 0)), transitShare = (m.transit || 0) / tot;
    const pol = this.w.policyAt(b);
    const mode = pol?.carFree && this.ordinances.carFree ? 'walk' : this.bcov('busstop', b) > 0.1 && h(3) < transitShare * 1.6 + 0.1 ? 'transit' : h(3) > 0.93 ? 'bike' : cohort === 'child' ? 'walk' : 'car';
    return { name: `${FIRST[Math.floor(h(4) * FIRST.length)]} ${LAST[Math.floor(h(5) * LAST.length)]}`, age, cohort, mode, home: b.id, k, depart: 7 + h(6) * 1.2, back: 16.5 + h(7) * 2 };
  }

  // Weather is seeded, so storms can be forecast: three days ahead, warn which low-lying,
  // unprotected buildings by the water are at risk from the surge.
  surgeForecast() {
    if (this.sandbox?.noDisasters) return;
    const ahead = weatherAt(this.w.seed, this.day + 3, this.weatherOverride);
    if (ahead.type !== 'storm' || this.weather.type === 'storm' || this.surgeWarning?.day === this.day + 3) return;
    const w = this.w; let risk = 0;
    for (const b of w.buildings.values()) { const i = w.cellAt(b.cx, b.cz); if (!b.platformId && i >= 0 && w.wdist[i] < 30 && w.elevation[i] < 2.4 && !w.levees[i]) risk++; }
    this.surgeWarning = { day: this.day + 3, risk };
    this.msg(`Storm warning: a storm arrives in 3 days.${risk ? ` ${risk} buildings on low ground by the water are at risk of flooding. Levees and storm drains help.` : ' Low ground by the water is protected.'}`, risk ? 'bad' : 'warn', 'surge');
  }

  // A service in a neighbouring city of yours reaches this one when a road links the two.
  shared(svc) {
    const sides = new Set([...this.w.net.nodes.values()].filter((n) => n.outside && n.edges.size).map(sideOf));
    return (this.partnerCities || []).some((p) => p.services?.includes(svc) && sides.has(p.dir));
  }

  // ---------------------------------------------------------------- region exits & freight
  // weights for commuters in, commuters out and freight at each regional exit
  exitWeights() {
    const nb = this.tileNeighbours || {}, P = this.partnerCities || [], pf = this.portalFlows;
    return [...this.w.net.nodes.values()].filter((n) => n.outside && n.edges.size).map((n) => {
      const side = sideOf(n), t = nb[side], p = P.find((q) => q.dir === side), size = t ? t.pop || 0 : 20000;
      // with the regional economy running, each exit is a portal carrying its families' commutes, migrants and freight
      if (pf) { const f = pf.get(n.id); return { id: n.id, side, name: t?.name || null, in: f ? f.in + f.migrants : 0, out: f ? f.out + f.migrants : 0, freight: f ? f.freight : 0, toll: f?.toll ?? 0 }; }
      return { id: n.id, side, name: t?.name || null, in: p ? (p.unemployed || 0) * 0.25 + 5 : size / 1000, out: p ? (p.jobsFree || 0) * 0.3 + 5 : size / 1000, freight: size / 1000 + (t?.kind === 'ai' ? 20 : 5) };
    });
  }
  terminals() {
    const out = [];
    for (const b of this.w.buildings.values()) if (SERVICES[b.svc]?.freight && !b.abandoned && b.edge >= 0 && !(b.constructionUntil > this.day)) out.push({ id: b.id, svc: b.svc, edge: b.edge, s: b.s, cap: SERVICES[b.svc].freight * this.budgetFor(b.svc) });
    return out;
  }

  // ---------------------------------------------------------------- bonds, credit, insurance, land
  // A credit rating from debt against yearly income, recent deficits and debt trouble.
  creditRating() {
    const st = this.stats, annual = Math.max(1, (st.incomeM || 0) * 12);
    const debt = this.loans.reduce((s, l) => s + l.balance, 0) + this.bonds.reduce((s, b) => s + b.principal, 0);
    const deficits = this.history.slice(-12).filter((h) => h.income < h.expense).length;
    const score = 100 - (debt / annual) * 40 - deficits * 4 - (this.debtMonths || 0) * 12 - (this.money < 0 ? 15 : 0) - (this.loans.some((l) => l.bailout) ? 20 : 0);
    const G = [['AAA', 85, 0.02], ['AA', 75, 0.025], ['A', 65, 0.03], ['BBB', 55, 0.04], ['BB', 45, 0.055], ['B', 35, 0.07], ['CCC', -Infinity, 0.1]];
    const [grade, , rate] = G.find(([, min]) => score >= min);
    return { grade, rate, score: Math.round(score), debt, limit: Math.max(100000, annual * 3) };
  }
  issueBond(amount, years) {
    if (![25000, 50000, 100000, 250000].includes(amount) || ![10, 20].includes(years) || this.sandbox?.infinite) return false;
    const cr = this.creditRating(); if (cr.grade === 'CCC' || cr.debt + amount > cr.limit) return false;
    this.bonds.push({ id: this.bondId++, principal: amount, rate: cr.rate + (years === 20 ? 0.005 : 0), years, due: this.day + years * 360, grade: cr.grade });
    this.money += amount; return true;
  }
  redeemBond(id) {
    const b = this.bonds.find((q) => q.id === id); if (!b || this.money < b.principal * 1.02) return false;
    this.money -= b.principal * 1.02; this.bonds = this.bonds.filter((q) => q !== b); return true;
  }
  // daily coupons; principal falls due at maturity
  bondTick() {
    let coupon = 0;
    for (const b of [...this.bonds]) {
      coupon += (b.principal * b.rate) / 360;
      if (this.day >= b.due) { this.money -= b.principal; this.bonds = this.bonds.filter((q) => q !== b); this.msg(`A ${b.years}-year bond matured: ₵${b.principal.toLocaleString('en-US')} repaid.`, 'info', 'bond'); }
    }
    return coupon;
  }
  landValueOf(b) { const lv = b.lv ?? 0.3; return (b.area || 0) * (40 + 400 * lv * lv); }
  // what a building would cost to rebuild; insurance covers 80% of it for a monthly premium of 0.04%
  buildingValue(b) { return b.level * (b.area || 0) * 120 * (0.5 + (b.lv ?? 0.3)); }
  insuredValue() { let v = 0; for (const b of this.w.buildings.values()) if (!b.svc && !b.abandoned) v += this.buildingValue(b); return v; }
  // disaster claims pay most of a wrecked building's value when the city is insured
  claim(b) {
    if (!this.insurance) return 0;
    const pay = Math.round(this.buildingValue(b) * 0.8);
    if (!(this.sandbox && this.sandbox.infinite)) this.money += pay;
    this.claims = (this.claims || 0) + pay; return pay;
  }
  // Rising land values in old, low-rise neighbourhoods bring redevelopment, and push out residents.
  gentrify() {
    const w = this.w; let n = 0, moved = 0, where = null;
    for (const b of [...w.buildings.values()]) {
      if (b.svc || !b.hh || b.locked || b.rubble || b.abandoned || b.constructionUntil > this.day) continue;
      const pol = w.policyAt(b), lv = b.lv ?? 0;
      if (b.level > 2 || lv < 0.68 || this.day - (b.built ?? 0) < 1200 || pol?.historic || b.level + 1 > Math.min(ZONES[b.zone].maxLevel, pol?.maxLevel ?? 5)) continue;
      if (this.rng() > 0.08 * (lv - 0.68) / 0.32 + 0.01) continue;
      moved += Math.round((b.occ || 0) * HH * 0.6); w.growBuilding(b, b.level + 1); b.constructionUntil = this.day + 6; b.occ = 0; w.touchBuilding(b); n++; where ||= b;
    }
    this.stats.gentrified = n; this.stats.displaced = moved;
    if (n) this.msg(`Rising land values near ${this.streetName(where.edge)} bring redevelopment: ${moved} long-time residents move out.`, 'warn', 'gentrify');
  }

  // sky hubs with their capacity (air trips per assignment pass): taller towers take more
  skyHubs() {
    return this.sky.hubs.map((id) => this.w.buildings.get(id)).filter(Boolean).map((b) => ({ id: b.id, x: b.cx, z: b.cz, cap: this.hubCap(b) }));
  }
  hubCap(b) { return buildingFloors(b, this.w) * 1.5; }

  // skybridges (rebuilt when buildings or the era style change)
  bridges() {
    const key = `${this.w.bldVersion}:${this.tech.style}`;
    if (key !== this.bridgeKey) {
      this.bridgeKey = key; this.bridgeList = skyBridges(this.w); this.bridgeMap = new Map();
      for (const l of this.bridgeList) for (const [u, v] of [[l.a, l.b], [l.b, l.a]]) { if (!this.bridgeMap.has(u)) this.bridgeMap.set(u, []); this.bridgeMap.get(u).push(v); }
    }
    return this.bridgeList;
  }
  partners(b) { this.bridges(); return this.bridgeMap.get(b.id) || []; }
  // service coverage at a building, shared across its skybridges
  bcov(k, b) {
    let v = this.at(this.cov[k], b.cx, b.cz);
    for (const id of this.partners(b)) { const p = this.w.buildings.get(id); if (p) v = Math.max(v, this.at(this.cov[k], p.cx, p.cz)); }
    return v;
  }

  // storeys that count toward capacity: the main mass plus annex and cantilever volumes
  floorsOf(b) {
    return buildingFloors(b, this.w) + massPlan(b, this.w).bonus;
  }

  capacity(b) {
    const key = ZONES[b.zone].key, fl = this.floorsOf(b), A = b.area * 0.75;
    b.hh = 0; b.jobs = 0;
    if ((b.flood||0)>1 || b.constructionUntil > this.day || b.rubble > 0) { b.occ = 0; b.workers = 0; return; }
    if (key === 'rl') b.hh = b.level === 1 ? 1 : b.level === 2 ? 2 : Math.max(3, Math.round((A * fl) / 45));
    else if (key === 'rh') b.hh = Math.max(2, Math.round((A * fl) / 40));
    else if (key === 'm') { b.hh = Math.max(1, Math.round((A * Math.max(1, fl - 1)) / 45)); b.jobs = Math.max(2, Math.round(A / 30)); }
    else if (key === 'c') b.jobs = Math.max(2, Math.round((A * fl) / 35));
    else if (key === 'o') b.jobs = Math.max(3, Math.round((A * fl) / 25));
    else if (key === 'i') b.jobs = Math.max(4, Math.round((A * (1 + b.level)) / 22 * (b.spec === 'forestry' ? 0.8 : 1)));
  }

  // ---------------------------------------------------------------- daily economy
  dailyTick() {
    this.day++; this.w.day = this.day; this.updateEra();
    this.weather = weatherAt(this.w.seed, this.day, this.weatherOverride); this.wind = this.weather.wind;
    hazardTick(this);
    for (const b of this.w.buildings.values()) if (b.constructionUntil && b.constructionUntil <= this.day) {
      b.constructionUntil = 0; this.w.touchBuilding(b);
    }
    const w = this.w, st = this.stats, dem = this.demand, sb = this.sandbox;
    let hh = 0, hhCap = 0, happyR = 0, nR = 0, eduSum = 0, kids = 0, seniors = 0, hiSum = 0;
    const cap = { C: 0, I: 0, O: 0 };
    for (const b of w.buildings.values()) {
      if (b.svc) continue;
      this.capacity(b);
      const kind = ZONES[b.zone].kind;
      if (b.abandoned) { b.occ = 0; b.workers = 0; continue; }
      if (b.hh) {
        const rate = sb && sb.instant ? 1 : 0.1 * clamp((dem.R + 12) / 40, 0.1, 1);
        if (b.happy > 0.33 && dem.R > -8 && b.out && !b.fire) b.occ = Math.min(b.hh, b.occ + Math.max(1, Math.ceil(b.hh * rate)));
        else if (b.happy < 0.25 || dem.R < -55) b.occ = Math.max(0, b.occ - Math.max(1, Math.ceil(b.hh * 0.05)));
        b.occ = Math.min(b.occ, b.hh);
        hh += b.occ; hhCap += b.hh; happyR += b.happy * b.occ; nR += b.occ;
        eduSum += this.bcov('school', b) * b.occ;
        const people = b.occ * HH, dg = this.demography(b);
        b.kids = people * dg.kids; b.seniors = people * dg.seniors; kids += b.kids; seniors += b.seniors;
        hiSum += Math.max(0.6 * this.bcov('college', b), this.bcov('university', b), this.shared('university') ? 0.35 : this.shared('college') ? 0.2 : 0) * b.occ;
      }
      if (b.jobs) cap[kind === 'M' ? 'C' : kind] += b.jobs;
    }
    // cohorts: children need school seats, adults work, retirees need more care
    const pop = hh * HH, adults = Math.max(0, pop - kids - seniors), W = adults * 0.8 + seniors * 0.05;
    const inv = (load) => (load > 1 ? 1 / load : 1);
    const seats = this.capacityOf('school', 'seats'), schoolLoad = seats ? kids / seats : kids > 1 ? 9 : 0;
    const eduRate = 0.15 + 0.7 * (nR ? eduSum / nR : 0) * inv(schoolLoad);
    const hiSeats = this.capacityOf('college', 'seats') + this.capacityOf('university', 'seats') + (this.shared('university') ? SERVICES.university.seats / 2 : 0) + (this.shared('college') ? SERVICES.college.seats / 2 : 0), students = adults * 0.1;
    const hiLoad = hiSeats ? students / hiSeats : students > 1 ? 9 : 0;
    const hiEdu = (nR ? hiSum / nR : 0) * inv(hiLoad) * Math.min(1, eduRate / 0.5);
    const patients = this.capacityOf('clinic', 'patients'), clinicLoad = patients ? (pop + seniors * 2) / patients : pop > 1 ? 9 : 0;
    const jobCap = cap.C + cap.I + cap.O;
    const hasOut = [...w.net.nodes.values()].some((n) => n.outside && n.edges.size);
    // neighbouring cities you run send their jobless here and offer their vacancies to residents
    const partners = this.partnerCities || [], pIdle = partners.reduce((s, p) => s + (p.unemployed || 0), 0), pVac = partners.reduce((s, p) => s + (p.jobsFree || 0), 0);
    const rc = this.regionCommute;   // families of other tiles who work here, and residents working elsewhere
    const commuterPool = hasOut ? (rc ? 30 + W * 0.15 + rc.in : 30 + W * 0.3 + pIdle * 0.25) : 0;          // people who'd commute in
    const labor = W + commuterPool;
    const fill = jobCap ? Math.min(1, labor / jobCap) : 0;
    const oFill = cap.O ? Math.min(fill, (W * Math.min(1, eduRate + hiEdu * 0.5) + commuterPool * 0.4) / cap.O) : 0;
    const filled = { C: 0, I: 0, O: 0 };
    for (const b of w.buildings.values()) {
      if (b.svc || !b.jobs) continue;
      const kind = ZONES[b.zone].kind;
      const f = (kind === 'O' ? oFill : fill) * (b.abandoned || b.fire ? 0 : 1) * (b.out ? 1 : 0.3);
      b.workers = (b.workers || 0) + (b.jobs * f - (b.workers || 0)) * (sb && sb.instant ? 1 : 0.3);
      filled[kind === 'M' ? 'C' : kind] += b.workers;
    }
    const totalFilled = filled.C + filled.I + filled.O;
    const outJobs = hasOut ? (rc ? W * 0.06 + rc.out : W * 0.12 + Math.min(W * 0.1, pVac * 0.3)) : 0;   // residents working beyond the highway
    const commuters = Math.max(0, totalFilled - W);
    const employed = Math.min(W, Math.min(W, totalFilled) + outJobs);
    const unemp = W > 1 ? clamp(1 - employed / W, 0, 1) : 0;
    const avgHappyR = nR ? happyR / nR : 0.6;
    const pen = (k) => (this.tax[k] - 9) * 4.5 + (k === 'R' || k === 'C' ? (this.landTax || 0) * 3 : 0);
    // goods: shops sell what local industry makes, topped up by imports over roads and freight terminals
    const terms = this.terminals(), termCap = terms.reduce((s, t) => s + t.cap, 0), has = (k) => terms.some((t) => t.svc === k);
    const goodsDemand = cap.C * 0.5, localGoods = filled.I * 1.1, usedLocal = Math.min(localGoods, goodsDemand);
    const imported = Math.min(goodsDemand - usedLocal, (hasOut ? 150 + pop * 0.05 : 0) + termCap * 1.5);
    const supply = goodsDemand > 1 ? (usedLocal + imported) / goodsDemand : 1;
    st.goods = { demand: goodsDemand, local: localGoods, usedLocal, imported, supply, exportable: Math.max(0, localGoods - usedLocal), termCap };
    const target = {
      R: 25 + (70 * (jobCap + outJobs - W)) / (W + jobCap + 120) - 45 * Math.max(0, unemp - 0.06) - pen('R') + 30 * (avgHappyR - 0.55),
      C: (80 * (pop * 0.22 - cap.C)) / (pop * 0.22 + cap.C + 40) + 12 - pen('C'),
      I: (80 * (W * 0.4 + 60 - cap.I)) / (W * 0.4 + 60 + cap.I + 40) - pen('I') - (hasOut ? 0 : 40) + (has('harbour') ? 10 : this.shared('harbour') ? 5 : 0) + (has('cargorail') ? 5 : 0),
      O: (80 * (W * (eduRate * 0.6 + hiEdu * 0.5) + 10 - cap.O)) / (W * (eduRate * 0.6 + hiEdu * 0.5) + 10 + cap.O + 30) - pen('O') - 5 + (has('airport') ? 10 : this.shared('airport') ? 5 : 0),
    };
    if (this.devPriority && target[this.devPriority] != null) target[this.devPriority] += 10;   // the president's development priority
    for (const k in dem) dem[k] = sb && sb.lockDemand ? sb.demand[k] : clamp(dem[k] * 0.8 + target[k] * 0.2, -100, 100);
    Object.assign(st, { pop, households: hh, hhCap, workers: W, employed, unemp, jobs: cap, filled, commuters, eduRate, happyR: avgHappyR,
      kids, adults, seniors, seats, schoolLoad, hiEdu, hiSeats, hiLoad, patients, clinicLoad, outJobs });

    // money
    const inc = { R: 0, C: 0, I: 0, O: 0, fares: 0, trade: 0, tourism: 0, exports: 0 }, exp = { services: 0, utilities: 0, roads: 0, transit: 0, junctions: 0, imports: 0, policies: 0, ordinances: 0 };
    const ord = this.ordinances, mk = this.market();
    let prio = 0; for (const d of w.districts) if (d && d.policy.priority !== 'balanced') prio++;
    for (const b of w.buildings.values()) {
      if (b.svc) {
        const S = SERVICES[b.svc], base = (S.upkeep * this.budgetFor(b.svc)) / MONTH_DAYS;
        exp[S.cat === 'util' ? 'utilities' : 'services'] += base; exp.policies += base * prio * 0.05; // priority surcharge
        if (S.tourism) inc.tourism += (S.tourism * Math.min(1, this.stats.pop / 5000 + 0.3) * this.budgetFor(b.svc)) / MONTH_DAYS;
        continue;
      }
      if (b.abandoned) continue;
      const lv = b.lv ?? 0.3, pol = w.policyAt(b), kind = ZONES[b.zone].kind;
      // retirees pay about half the income tax of working households
      if (b.hh) inc.R += ((b.occ * this.taxFor('R', b)) / 100 * 85 * (0.6 + 0.8 * lv) * (1 - 0.5 * (b.seniors || 0) / Math.max(1, b.occ * HH))) / MONTH_DAYS;
      if (b.jobs) {
        const k = kind === 'M' ? 'C' : kind, prod = b.prod ?? 1;
        const spec = (b.spec === 'leisure' ? 1.25 : b.spec === 'tech' ? 1.35 : 1) * (k === 'C' && ord.curfew ? 0.92 : 1) * (k === 'I' && ord.noise ? 0.95 : 1) * (k === 'C' ? 0.6 + 0.4 * (st.goods?.supply ?? 1) : 1);   // shops without goods earn less
        const base = (k === 'C' ? 70 * (0.6 + 0.8 * lv) : k === 'O' ? 95 * (0.6 + 0.8 * lv) : 55 * (pol && pol.green ? 0.8 : 1)) * spec;
        inc[k] += (((b.workers || 0) * this.taxFor(k, b)) / 100 * base * prod) / MONTH_DAYS;
      }
    }
    // a festival triples a landmark's tourism for its weekend (parks earn from concerts)
    const venue = this.event && w.buildings.get(this.event.venue);
    if (venue) inc.tourism += ((SERVICES[venue.svc].tourism || 1200) * 3 * Math.min(1, pop / 5000 + 0.3)) / MONTH_DAYS;
    for (const e of w.net.edges.values()) exp.roads += (e.len * ROADS[e.type].upkeep * 2 * (e.layer ? 1.8 : 1)) / MONTH_DAYS;
    for (const n of w.net.nodes.values()) if (n.control === 'signal') exp.junctions += 25 / MONTH_DAYS;
    // utility trade: sell at ₵18/MW and ₵5/water unit a month; imports cost 2.5× that
    const tf = this.tradeFlow;
    // prices float with the neighbours' markets (see market())
    inc.trade = (tf.soldP * 18 * mk.power + tf.soldW * 5 * mk.water) / MONTH_DAYS; exp.imports = (tf.boughtP * 45 * mk.power + tf.boughtW * 12.5 * mk.water) / MONTH_DAYS;
    // industry exports goods to the neighbouring cities over the highway
    // only goods left after supplying local shops are exported; terminals open better markets
    const bonus = 1 + this.terminals().reduce((s, t, i, a) => (a.findIndex((q) => q.svc === t.svc) === i ? s + (SERVICES[t.svc].exportBonus || 0) : s), 0)
      + ['harbour', 'airport', 'cargorail'].reduce((s, k) => s + (!has(k) && this.shared(k) ? SERVICES[k].exportBonus / 2 : 0), 0);   // a neighbour's terminal, at half the benefit
    if (hasOut || this.terminals().length) inc.exports = ((st.goods?.exportable ?? filled.I * 1.1) * mk.goods * bonus) / MONTH_DAYS;
    inc.deals = (this.dealFlow?.inc || 0) / MONTH_DAYS; exp.deals = (this.dealFlow?.exp || 0) / MONTH_DAYS;
    inc.tolls = (this.tollIncome || 0) / MONTH_DAYS;                  // toll booths at this tile's portals (set monthly by the region)
    exp.roads *= this.infra ?? 1;                                     // the president's infrastructure spending
    // economy: bonds, insurance, preparedness and land tax
    exp.bonds = this.bondTick();
    const insured = this.insuredValue();
    exp.insurance = this.insurance ? (insured * 0.0004 * (1 - 0.2 * Math.min(1, this.preparedness || 0))) / MONTH_DAYS : 0;
    exp.preparedness = (600 * (this.preparedness || 0)) / MONTH_DAYS;
    inc.land = 0; if (this.landTax) for (const b of w.buildings.values()) if (!b.svc && !b.abandoned) inc.land += (this.landValueOf(b) * this.landTax) / 100 / 360;
    for (const k in ord) if (ord[k] && ORDINANCES[k]) exp.ordinances += ORDINANCES[k].cost / MONTH_DAYS;
    for (const d of w.districts) if (d?.policy.green) exp.policies += 60 / MONTH_DAYS;
    // bus lines: operating cost per stop, fares from peak riders (~6 per rider per month)
    for (const l of w.lines) {
      const info = this.lineInfo?.get(l.id);
      const mode=transitMode(l);
      exp.transit += ((mode.upkeep + mode.perStop * l.stops.length) * this.budgetFor('busdepot') * (0.35 * 10 / (l.headway || 10) + 0.65 * 10 / (l.offpeak || l.headway || 10))) / MONTH_DAYS;   // more frequent service costs more (peak about a third of the day)
      if (info?.ok && !ord.freeTransit) inc.fares += (info.riders * mode.fare) / MONTH_DAYS;
    }
    exp.roads += w.levees.reduce((n,v)=>n+v,0)*.03/MONTH_DAYS;
    exp.debt = this.debtTick();
    const income = inc.R + inc.C + inc.I + inc.O + inc.fares + inc.trade + inc.tourism + inc.exports + inc.deals + inc.land + inc.tolls, expense = exp.services + exp.utilities + exp.roads + exp.debt + exp.transit + exp.junctions + exp.imports + exp.policies + exp.ordinances + exp.deals + exp.bonds + exp.insurance + exp.preparedness;
    if (!(sb && sb.infinite)) this.money += income - expense;
    this.month.income += income; this.month.expense += expense;
    st.incomeM = income * MONTH_DAYS; st.expenseM = expense * MONTH_DAYS; st.inc = inc; st.exp = exp;

    const goals = this.scenarioProgress();
    if (!this.scenarioWon && goals.length && goals.every(([, ok]) => ok)) { this.scenarioWon = true; this.msg('Scenario complete! You can keep expanding.', 'good'); }
    // fires
    for (const b of [...w.buildings.values()]) {
      if (b.svc || b.abandoned || b.rubble > 0 || b.constructionUntil > this.day) continue;
      if (b.fire > 0) {
        b.fire--;
        if (!b.fire) {
          if (b.fireOut) this.msg('Firefighters put out a blaze.', 'good');
          else { w.removeBuilding(b.id); this.msg('A building burned down. Fire stations prevent this.', 'bad'); }
        }
        continue;
      }
      if (sb && sb.noFires) continue;
      const fc = this.bcov('fire', b);
      const p = (fc > 0.12 ? 0.0001 : 0.0004) * (0.6 + b.level * 0.25) * this.weather.fire * (ord.smoke ? 0.6 : 1);
      if (this.rng() < p) this.igniteBuilding(b);
    }

    this.healthTick(); disasterTick(this); this.surgeForecast();
    if (this.scenario && !this.scenarioStart && this.day >= 30) this.scenarioStart = { pop: st.pop, day: this.day };
    if (this.scenario === 'gridlock' && !this.scenarioWon && !this.scenarioFailed && this.day > 720) { this.scenarioFailed = true; this.msg('The two-year deadline has passed. Keep playing, or restart the scenario.', 'bad'); }
    if (this.day % MONTH_DAYS === 0) {
      this.monthlyNews(); this.growRegion(); this.gentrify(); this.onMonth?.();
      this.lastMonth = { ...this.month };
      this.history.push({ day: this.day, pop: Math.round(pop), money: Math.round(this.money), income: Math.round(this.month.income), expense: Math.round(this.month.expense),
        unemp: +unemp.toFixed(3), R: Math.round(this.demand.R), C: Math.round(this.demand.C), I: Math.round(this.demand.I), O: Math.round(this.demand.O), happy: +avgHappyR.toFixed(3) });
      if (this.history.length > 120) this.history.shift();
      this.month = { income: 0, expense: 0 };
      if (!sb) this.bankruptcy();
      else if (!sb.infinite && this.money < 0) this.msg('The city is in debt! Raise taxes or cut services.', 'bad');
      if (!(sb && sb.infinite) && this.money >= 0 && this.lastMonth.income < this.lastMonth.expense && pop > 50) this.msg('Running a deficit this month.', 'warn');
    }
  }

  // A fire is saved when an engine can reach it in time: dispatch from the station
  // with the fastest routed response (junction delays, one-ways and congestion count).
  dispatchFire(b) {
    const stations = [...this.w.buildings.values()].filter((f) => f.svc === 'fire' && !f.abandoned && f.edge >= 0 && f.comp === b.comp && b.edge >= 0);
    let best = null;
    for (const f of stations) {
      const r = fastestRoute(this.w.net, { edge: f.edge, s: f.s }, [{ id: b.id, edge: b.edge, s: b.s }]);
      if (r && (!best || r.seconds < best.seconds)) best = { ...r, station: f.id };
    }
    return best;
  }
  igniteBuilding(b) {
    const r = this.dispatchFire(b), limit = 45 * Math.sqrt(this.budgetFor('fire'));
    b.fireOut = !!r && r.seconds <= limit;
    b.fire = b.fireOut ? 2 : 6;
    b.fireResponse = r ? Math.round(r.seconds) : null;
    if (r) (this.dispatches ||= []).push({ kind: 'fire', target: b.id, segs: r.segments, t: performance.now() });
    return r;
  }

  // ---------------------------------------------------------------- utilities
  *utilitiesJob() {
    const w = this.w, net = w.net, g = net.graph(), t = this.day + this.acc;
    const dt = clamp(t - this.lastUtil, 0, 3); this.lastUtil = t;
    this.wind = this.weather.wind;
    const comps = new Map();
    const get = (c) => { let o = comps.get(c); if (!o) comps.set(c, (o = { p: 0, w: 0, s: 0, bus: false })); return o; };
    const all = [...w.buildings.values()];
    for (const b of all) {
      const e = b.edge >= 0 && net.edges.get(b.edge);
      const k = e ? g.idx.get(e.a) : undefined;
      b.comp = k === undefined ? -1 : g.comp[k];
      b.out = b.comp >= 0 && g.compOut[b.comp];
      if (!b.svc || b.comp < 0 || b.abandoned || (b.flood||0)>1) continue;
      const S = SERVICES[b.svc], c = get(b.comp);
      if (S.power) c.p += S.power * this.budgetFor(b.svc) * (b.svc === 'wind' ? this.wind : 1);
      if (S.water) c.w += S.water * this.budgetFor(b.svc) * (b.svc === 'pump' ? 1 - 0.6 * this.at(this.f.waterPol || this.f.pollution, b.cx, b.cz) : 1);
      if (S.sewage) c.s += S.sewage * this.budgetFor(b.svc);
      if (b.svc === 'busdepot') c.bus = true;
    }
    this.busComps = new Set([...comps].filter(([, c]) => c.bus).map(([k]) => k));
    yield;
    const need = new Map();
    for (const b of all) {
      let np, nw;
      if (b.svc) { np = 0.6; nw = 0.5; }
      else {
        const occ = b.abandoned ? 0 : b.occ || 0, wk = b.workers || 0, i = ZONES[b.zone].kind === 'I';
        np = 0.2 + occ * 0.03 + wk * (i ? 0.06 : 0.035); nw = 0.2 + occ * 0.12 + wk * (i ? 0.12 : 0.06);
      }
      np *= this.weather.power; nw *= this.weather.water;
      need.set(b.id, [np, nw]);
      const c = comps.get(b.comp); if (c) { c.dp = (c.dp || 0) + np; c.dw = (c.dw || 0) + nw; }
    }
    // utility deals with your neighbouring cities run over a road link on that side
    const df = this.dealFlow = { inc: 0, exp: 0, rows: [] };
    const outSides = new Set([...w.net.nodes.values()].filter((n) => n.outside && n.edges.size).map(sideOf));
    const hub = [...comps.entries()].find(([k]) => g.compOut[k])?.[1];
    this.utilSurplus = hub ? { power: +(hub.p - (hub.dp || 0)).toFixed(1), water: +(hub.w - (hub.dw || 0)).toFixed(1) } : { power: 0, water: 0 };   // before any deals
    for (const d of this.deals || []) {
      const dir = Object.entries(this.tileNeighbours || {}).find(([, t]) => t.key === d.partner)?.[0], linked = !!dir && outSides.has(dir) && !!hub;
      let q = 0;
      if (linked) {
        const f = d.kind === 'power' ? 'p' : 'w', need = d.kind === 'power' ? hub.dp || 0 : hub.dw || 0;
        if (d.role === 'sell') { q = Math.min(d.amount, Math.max(0, hub[f] - need)); hub[f] -= q; df.inc += q * d.price; }
        else {   // the seller can only send what it had spare when last played (or projected since)
          const seller = (this.partnerCities || []).find((p) => p.key === d.partner), spare = seller?.surplus ? Math.max(0, seller.surplus[d.kind]) : d.amount;
          q = Math.min(d.amount, spare); hub[f] += q; df.exp += q * d.price;
        }
      }
      df.rows.push({ ...d, dir, linked, delivered: q });
    }
    // networks joined to the highway can sell surplus power/water and import shortfalls
    const tr = { soldP: 0, soldW: 0, boughtP: 0, boughtW: 0 };
    for (const [k, c] of comps) {
      if (!g.compOut[k]) continue;
      const surP = c.p - (c.dp || 0), surW = c.w - (c.dw || 0);
      if (this.trade.sell) { tr.soldP += Math.max(0, surP) * 0.8; tr.soldW += Math.max(0, surW) * 0.8; }
      if (this.trade.buy) { if (surP < 0) { tr.boughtP -= surP; c.p -= surP; } if (surW < 0) { tr.boughtW -= surW; c.w -= surW; } }
    }
    this.tradeFlow = tr;
    let sp = 0, dp = 0, sw = 0, dw = 0, ss = 0;
    for (const c of comps.values()) { sp += c.p; sw += c.w; ss += c.s; }
    const order = all.filter((b) => b.svc).concat(all.filter((b) => !b.svc));
    for (const b of order) {
      const [np, nw] = need.get(b.id);
      dp += np; dw += nw;
      const c = comps.get(b.comp);
      if (!c) { b.power = b.water = b.sewage = false; continue; }
      b.power = c.p >= np; if (b.power) c.p -= np;
      b.water = c.w >= nw; if (b.water) c.w -= nw;
      b.sewage = c.s >= nw; if (b.sewage) c.s -= nw;
    }
    this.stats.power = [sp, dp]; this.stats.water = [sw, dw]; this.stats.sewage = [ss, dw];
    yield;
    const LS = SERVICES.landfill;
    const fills = all.filter((b) => b.svc === 'landfill' && !b.abandoned && b.comp >= 0);
    let capDay = 0, stored = 0, storage = 0;
    for (const l of fills) { storage += LS.storage; stored += l.garb; if (l.garb < LS.storage) capDay += LS.garbage * this.budgetFor('landfill'); }
    let capLeft = capDay * dt, produced = 0, taken = 0;
    for (const b of all) {
      if (b.svc) continue;
      const i = ZONES[b.zone].kind === 'I';
      const prod = ((b.abandoned ? 0 : b.occ || 0) * 0.25 + (b.workers || 0) * (i ? 0.35 : 0.15)) * dt;
      b.garb = (b.garb || 0) + prod; produced += prod;
      if (capLeft > 0 && this.at(this.cov.landfill, b.cx, b.cz) > 0.02) { const tk = Math.min(b.garb, capLeft); b.garb -= tk; capLeft -= tk; taken += tk; }
      b.garbOk = b.garb < 40 + ((b.hh || 0) + (b.jobs || 0)) * 3;
    }
    if (fills.length) { const per = taken / fills.length; for (const l of fills) l.garb = Math.min(LS.storage, l.garb + per); }
    if (fills.length && stored >= storage * 0.98) this.msg('Landfills are full — build another.', 'warn');
    this.stats.garbage = [capDay, produced / (dt || 1), storage ? stored / storage : 0];
  }

  // Specializations: waterside / park-side leisure shops, forestry industry in
  // woodland, tech offices where the workforce is educated and land is valuable.
  pickSpec(b) {
    const kind = ZONES[b.zone].kind, x = b.cx, z = b.cz;
    if ((kind === 'C' || kind === 'M') && (this.at(this.f.waterfront, x, z) > 0.35 || this.at(this.cov.park, x, z) > 0.45)) return 'leisure';
    if (kind === 'I' && this.w.forestAt(x, z)) return 'forestry';
    if (kind === 'O' && this.stats.hiEdu > 0.3 && this.bcov('university', b) > 0.05 && (b.lv || 0) > 0.55) return 'tech';
    return null;
  }

  // How attractive a spot would be for new development of a kind (R, C, I, O).
  desirability(kind, x, z) {
    const f = this.f, c = this.cov, a = (arr) => (arr ? this.at(arr, x, z) : 0);
    const lv = a(f.lv), pol = a(f.pollution), noi = a(f.noise), cr = a(f.crime), acc = a(f.access);
    const svcs = 0.3 * a(c.clinic) + 0.25 * a(c.police) + 0.2 * a(c.fire) + 0.25 * a(c.school);
    let v;
    if (kind === 'R') v = 0.25 + 0.5 * lv + 0.25 * svcs - 0.4 * pol - 0.2 * noi - 0.2 * cr + 0.1 * a(c.park);
    else if (kind === 'C') v = 0.2 + 0.4 * lv + 0.3 * Math.min(1, a(f.dens) / 150) + 0.2 * acc - 0.15 * cr;
    else if (kind === 'I') v = 0.35 + 0.45 * acc - 0.25 * lv + 0.15 * a(f.infra);
    else v = 0.1 + 0.45 * lv + 0.3 * a(c.school) + 0.25 * acc - 0.15 * cr;
    return clamp(v, 0, 1);
  }

  // land value breakdown at a point (for the inspector)
  lvFactors(x, z) {
    const a = (arr) => this.at(arr, x, z), c = this.cov, f = this.f;
    return [
      ['Parks & greenery', 0.22 * a(c.park)], ['Waterfront', 0.2 * a(f.waterfront) * (1 - 0.8 * (f.waterPol ? a(f.waterPol) : 0))], ['Views', 0.06 * a(f.view)],
      ['Services', 0.06 * (a(c.fire) + a(c.police) + a(c.clinic) + a(c.school))], ['Accessibility', 0.14 * a(f.access)],
      ['Neighbouring development', 0.09 * Math.min(1, a(f.dev) / 3.5)], ['Infrastructure', 0.05 * a(f.infra)],
      ['Pollution', -0.4 * a(f.pollution)], ['Noise & traffic', -0.18 * a(f.noise)], ['Crime', -0.22 * a(f.crime)],
    ];
  }

  // ---------------------------------------------------------------- growth & decline
  evalBuilding(b) {
    const x = b.cx, z = b.cz, c = this.cov, f = this.f;
    const lv = Math.min(1, this.at(f.lv, x, z) + 0.04 * (this.partners(b).length)); b.lv = lv;
    let prob = 0;
    if (!b.power) prob |= PROB.power;
    if (!b.water) prob |= PROB.water;
    if (!b.sewage) prob |= PROB.sewage;
    if (!b.svc && !b.garbOk) prob |= PROB.garbage;
    if (b.edge < 0) prob |= PROB.road;
    else if (!b.out) prob |= PROB.outside;
    if (b.abandoned) prob |= PROB.abandoned;
    if (b.fire) prob |= PROB.fire;
    if (b.sick) prob |= PROB.sick;
    if (b.rubble > 0) prob |= PROB.rubble;
    b.prob = prob;
    if (b.svc) return;
    const util = (b.power ? 0.35 : 0) + (b.water ? 0.3 : 0) + (b.sewage ? 0.15 : 0) + (b.garbOk ? 0.2 : 0);
    const pol = this.at(f.pollution, x, z), noi = this.at(f.noise, x, z), cr = this.at(f.crime, x, z);
    const acc = this.at(f.access, x, z), edu = this.bcov('school', b);
    const svcs = 0.3 * this.bcov('clinic', b) + 0.25 * this.bcov('police', b) + 0.2 * this.bcov('fire', b) + 0.25 * edu;
    const kind = ZONES[b.zone].kind, taxPen = this.taxFor(kind === 'M' ? 'R' : kind, b) - 9;
    const cong = b.cong || 0, st = this.stats;
    let appeal, happy;
    const R = () => {
      appeal = 0.5 * lv + 0.2 * svcs + 0.15 * (1 - clamp((isFinite(b.tJob) ? b.tJob : 80) / 80, 0, 1)) + 0.15 * util - 0.25 * pol - 0.1 * noi;
      happy = 0.2 + 0.45 * util + 0.2 * svcs + 0.25 * lv - 0.3 * pol - 0.12 * noi - 0.2 * cr - taxPen * 0.012 - 0.15 * st.unemp;
    };
    const Cm = () => {
      const cust = Math.min(1, this.at(f.dens, x, z) / 150 + st.pop / 4000);
      appeal = 0.45 * lv + 0.2 * cust + 0.2 * util + 0.15 * (1 - Math.min(1, cong));
      happy = 0.25 + 0.45 * util + 0.2 * lv + 0.15 * cust - 0.15 * cr - taxPen * 0.01 - 0.15 * Math.max(0, cong - 0.7) - 0.2 * (1 - (st.goods?.supply ?? 1));
    };
    if (kind === 'R') R();
    else if (kind === 'C') Cm();
    else if (kind === 'M') { R(); const a1 = appeal, h1 = happy; Cm(); appeal = (appeal + a1) / 2; happy = (happy + h1) / 2; }
    else if (kind === 'I') {
      const out = 1 - clamp((isFinite(b.tOut) ? b.tOut : 150) / 150, 0, 1);
      appeal = 0.3 + 0.3 * util + 0.25 * out + 0.1 * acc - 0.1 * cr;
      happy = 0.25 + 0.5 * util + 0.2 * out - 0.12 * cr - taxPen * 0.01 - 0.15 * Math.max(0, cong - 0.7);
    } else {
      appeal = 0.45 * lv + 0.2 * edu + 0.2 * util + 0.15 * acc;
      happy = 0.25 + 0.45 * util + 0.2 * lv + 0.15 * edu - 0.12 * cr - taxPen * 0.01 - 0.1 * Math.max(0, cong - 0.7);
    }
    if (b.sick) happy -= 0.2;
    if (this.shock > 0) happy -= 0.12 * this.shock / 45;   // a city recovering from a disaster is uneasy
    if (b.edge < 0) { appeal = 0; happy = 0; }
    else if (!b.out) happy -= 0.25;
    b.appeal = clamp(appeal, 0, 1);
    b.happy = clamp(happy - Math.min(.5,(b.flood||0)*.2), 0, 1);
  }

  *growthJob() {
    const w = this.w, net = w.net, t = this.day + this.acc, sb = this.sandbox;
    const dt = clamp(t - this.lastEval, 0, 3); this.lastEval = t;
    if (this.freeVer !== w.zoneVersion) {
      const a = [];
      for (let i = 0; i < N * N; i++) if (w.zone[i] && !w.bld[i] && !w.road[i] && w.accEdge[i] >= 0) a.push(i);
      this.freeCells = a; this.freeVer = w.zoneVersion;
      yield;
    }
    const g = net.graph(), free = this.freeCells;
    if (free.length) for (let zid = 1; zid <= 6; zid++) {
      const dem = this.demandOf(zid); if (dem < 4) continue;
      const tries = (2 + Math.floor(dem / 18)) * (sb && sb.instant ? 6 : 1);
      for (let k = 0; k < tries; k++) {
        const c = free[(this.rng() * free.length) | 0];
        if (w.zone[c] !== zid || !w.free(c) || w.accEdge[c] < 0) continue;
        const e = net.edges.get(w.accEdge[c]); if (!e) continue;
        const ci = g.idx.get(e.a); if (ci === undefined || !g.compOut[g.comp[ci]]) continue;
        const cells = w.formLot(c, zid); if (!cells) continue;
        const b = w.createBuilding({ zone: zid, level: 1, cells });
        b.constructionUntil = this.day + (sb?.instant ? 0 : 5);
        b.comp = g.comp[ci]; b.out = true; b.happy = 0.5;
        this.capacity(b);
      }
    }
    yield;
    const list = [...w.buildings.values()];
    let n = 0, abandonedNow = 0;
    for (const b of list) {
      if (b.removed) continue;
      this.evalBuilding(b);
      if (b.svc || b.locked || b.rubble > 0 || b.constructionUntil > this.day) continue;
      const Z = ZONES[b.zone], pol = w.policyAt(b), frozen = pol && pol.historic;
      if (b.abandoned) { b.abDays += dt; if (b.abDays > 30) w.removeBuilding(b.id); continue; }
      if (!(sb && sb.noDecline)) {
        if (b.happy < 0.28) b.neglect += dt; else b.neglect = Math.max(0, b.neglect - dt * 2);
        if (b.neglect > 22) { b.abandoned = true; b.abDays = 0; b.occ = 0; b.workers = 0; w.touchBuilding(b); abandonedNow++; continue; }
      }
      if (frozen || b.fire) continue;
      const maxL = Math.min(Z.maxLevel, pol ? pol.maxLevel : 5);
      const next = b.level + 1, fast = sb && sb.instant;
      if (this.levelRequirements(b).every(([, ok]) => ok) && this.rng() < (fast ? 0.6 : 0.07) * dt) {
        if (!b.spec && next >= 2) b.spec = this.pickSpec(b);
        w.growBuilding(b, next);
        b.constructionUntil = this.day + (fast ? 0 : 4 + next * 2); b.occ = 0; b.workers = 0; w.touchBuilding(b);
      } else if (b.level > maxL) w.rebuildAt(b, maxL);
      else if (!(sb && sb.noDecline) && b.level > 1 && b.appeal < LEVEL_APPEAL[b.level] - 0.2) { b.low += dt; if (b.low > 40) { if (!(b.level - 1 < 3 && w.splitBuilding(b, b.level - 1))) w.rebuildAt(b, b.level - 1); } }
      else b.low = Math.max(0, b.low - dt);
      if (++n % 150 === 0) yield;
    }
    if (abandonedNow) this.msg(`${abandonedNow} building${abandonedNow > 1 ? 's were' : ' was'} abandoned — check utilities & services.`, 'bad', 'abandon');
    const pr = { power: 0, water: 0, sewage: 0, garbage: 0, road: 0, outside: 0 };
    for (const b of w.buildings.values()) for (const k in pr) if (b.prob & PROB[k]) pr[k]++;
    this.stats.problems = pr;
    if (pr.power > 4) this.msg(`${pr.power} buildings have no electricity.`, 'warn', 'power');
    if (pr.water > 4) this.msg(`${pr.water} buildings have no running water.`, 'warn', 'water');
    if (pr.sewage > 4) this.msg(`${pr.sewage} buildings have no sewage service.`, 'warn', 'sewage');
    if (pr.garbage > 4) this.msg(`Garbage is piling up at ${pr.garbage} buildings.`, 'warn', 'garbage');
  }

  // ---------------------------------------------------------------- save
  serialize() { return { day: this.day, money: this.money, tax: this.tax, demand: this.demand, history: this.history, sandbox: this.sandbox, serviceBudgets: this.serviceBudgets, loans: this.loans, loanId: this.loanId, scenario: this.scenario, scenarioWon: this.scenarioWon, event: this.event || null, shock: this.shock || 0, bonds: this.bonds, bondId: this.bondId, insurance: !!this.insurance, preparedness: this.preparedness || 0, landTax: this.landTax || 0, debtMonths: this.debtMonths || 0, austerity: !!this.austerity, gameOver: !!this.gameOver, ordinances: this.ordinances, region: this.region, news: this.news.slice(-30), milestone: this.milestone, scenarioStart: this.scenarioStart, scenarioFailed: !!this.scenarioFailed, tutorialFlags: this.tutorialFlags, weatherOverride: this.weatherOverride, startYear: this.startYear, eraPace: this.eraPace, brackets: this.brackets, trade: this.trade }; }
  load(d) {
    Object.assign(this, { day: d.day, money: d.money, tax: d.tax, demand: d.demand, history: d.history || [] });
    this.sandbox = d.sandbox ? { ...SANDBOX_DEFAULTS, ...d.sandbox } : null;
    this.serviceBudgets = d.serviceBudgets || {}; this.loans = d.loans || []; this.loanId = d.loanId || 1;
    this.scenario = d.scenario || null; this.scenarioWon = !!d.scenarioWon; this.budgetVersion++;
    this.event = d.event || null; this.shock = d.shock || 0;
    this.bonds = d.bonds || []; this.bondId = d.bondId || 1; this.insurance = !!d.insurance; this.preparedness = d.preparedness || 0; this.landTax = d.landTax || 0;
    this.debtMonths = d.debtMonths || 0; this.austerity = !!d.austerity; this.gameOver = !!d.gameOver;
    this.ordinances = { ...(d.ordinances || {}) }; this.w.ordinances = this.ordinances; this.region = d.region || {}; this.news = d.news || []; this.milestone = d.milestone || 0;
    this.scenarioStart = d.scenarioStart || null; this.scenarioFailed = !!d.scenarioFailed; this.tutorialFlags = d.tutorialFlags || {};
    this.weatherOverride = this.sandbox ? d.weatherOverride || null : null;
    this.weather = weatherAt(this.w.seed, this.day, this.weatherOverride); this.wind = this.weather.wind;
    this.startYear=START_ERAS.includes(d.startYear) || (Number.isInteger(d.startYear) && d.startYear > 1800 && d.startYear < 2400) ? d.startYear : 2000;   // later region cities start in the region's current year
    this.eraPace=[1,5,10].includes(d.eraPace)?d.eraPace:1;
    this.brackets = { lowDensity: 0, highDensity: 0, smallBiz: 0, largeBiz: 0, ...(d.brackets || {}) };
    this.trade = { sell: true, buy: false, ...(d.trade || {}) };
    this.w.day = d.day;this.updateEra();hazardTick(this,false);
  }
}
