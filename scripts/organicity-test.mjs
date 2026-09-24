#!/usr/bin/env node
import { hazardTick } from '../organicity/js/terrain.js';
import { TRANSIT } from '../organicity/js/transit.js';
import { deckHeight } from '../organicity/js/agents.js';
// Headless regression tests for Organicity (organicity/js). Runs the land model,
// road graph, simulation (in-thread core) and save/undo logic without a browser.
//   node scripts/organicity-test.mjs            run all tests
//   node scripts/organicity-test.mjs undo       run tests whose name contains "undo"
import { World } from '../organicity/js/world.js';
import { Sim } from '../organicity/js/sim.js';
import { makeSave, loadSave, migrate, SAVE_VERSION } from '../organicity/js/save.js';
import { PROB } from '../organicity/js/sim.js';
import { RoadNet } from '../organicity/js/roads.js';
import { fastestRoute, commuteRoutes } from '../organicity/js/routes.js';
import { weatherAt, WEATHER, frontAt } from '../organicity/js/weather.js';
import { Core, netSnapshot, sampleField } from '../organicity/js/core.js';
import { N, ZONES, SERVICES } from '../organicity/js/config.js';
import { setupScenario, TUTORIAL } from '../organicity/js/scenarios.js';
import { quake, tornado, accident, festival, disasterTick, DISASTERS } from '../organicity/js/disasters.js';
import { createRegion, canBuy, tileCost, partnersOf, neighbours as tileNeighbours, exitDir, edgeProfile, exitsOf, stubsFor, evolveAI } from '../organicity/js/region.js';
import { headway, lineCapacity, transitGraph, transitSearch, transitTo, updateCosts } from '../organicity/js/assign.js';
import { pond } from '../organicity/js/terrain.js';
import { registerPack, landmarkDef } from '../organicity/js/packs.js';
import { t as tr, setLang, STRINGS } from '../organicity/js/i18n.js';
import { backgroundMonth } from '../organicity/js/region.js';
import { RegionSim, TERM_YEARS } from '../organicity/js/regionsim.js';
import { rentOf, salaryOf, utility as famUtility, reconsider, newFamily, THRESHOLD } from '../organicity/js/families.js';
import { applyPolicy, aiDecide, clampPolicy, predict } from '../organicity/js/presidents.js';
import { readFileSync, existsSync } from 'node:fs';
import { encodeSave, decodeSave, readShared } from '../organicity/js/share.js';
import { technology, buildingFloors, massPlan } from '../organicity/js/eras.js';
import { assignTraffic, routeLines, junctionDelay } from '../organicity/js/assign.js';
import { Traffic, AGENT_TYPES, AgentSim, TYPE_IDS, POSE_STRIDE } from '../organicity/js/agents.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const S = (w, x, z) => w.net.snap(x, z, 3);
const road = (w, a, b, c = null, t = 'street', ow = 0) => w.buildRoad(S(w, ...a), c && { x: c[0], z: c[1] }, S(w, ...b), t, ow);
const run = (sim, days) => { for (let d = 0; d < days; d++) for (let k = 0; k < 30; k++) sim.update(1 / 30); };
const count = (arr, v) => { let n = 0; for (let i = 0; i < arr.length; i++) if (arr[i] === v) n++; return n; };

// A small, fully serviced town used by several tests.
function town(seed = 4242) {
  const w = new World(seed); w.newGame();
  let shore = 0; for (let x = 262; x < N; x++) if (w.water[262 * N + x]) { shore = x; break; }
  road(w, [150, 262], [shore - 8, 262], null, 'avenue');
  road(w, [170, 195], [245, 330], [215, 215]);
  road(w, [205, 195], [205, 335]);
  road(w, [165, 195], [260, 190]);
  road(w, [160, 305], [255, 300], [210, 365]);
  for (const [x, z, id] of [[178, 240, 1], [228, 215, 2], [185, 285, 3], [230, 285, 4], [215, 318, 6]]) w.fillZone(x, z, id);
  // try a few spots around (x, z) — shorelines differ per seed
  const place = (k, x, z) => {
    for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [4, 0], [0, -4], [0, 4], [-4, 0], [6, 0]]) {
      const p = w.planService(k, x + dx, z + dz); if (p.ok) { w.placeService(k, p); return true; }
    }
    return false;
  };
  const placed = [place('coal', 175, 178), place('pump', shore - 5, 254), place('outlet', shore - 5, 272), place('landfill', 150, 290), place('fire', 215, 272)];
  return { w, shore, placed };
}

test('terrain is deterministic per seed', () => {
  const a = new World(7); a.genTerrain(); const b = new World(7); b.genTerrain(); const c = new World(8); c.genTerrain();
  assert(a.water.every((v, i) => v === b.water[i]), 'same seed differs');
  assert(a.water.some((v, i) => v !== c.water[i]), 'different seeds identical');
});

test('crossing roads split into a 4-way junction at any angle', () => {
  const w = new World(1); w.newGame();
  road(w, [200, 150], [320, 170]);
  road(w, [230, 110], [300, 220]);
  const deg4 = [...w.net.nodes.values()].filter((n) => n.edges.size === 4);
  assert(deg4.length === 1, `expected one 4-way junction, got ${deg4.length}`);
  assert(w.net.edges.size === 5, `expected 5 edges (highway + 4), got ${w.net.edges.size}`);
});

test('one-way roads are respected by routing', () => {
  const w = new World(1); w.newGame();
  road(w, [200, 100], [260, 100], null, 'street', 1);   // only west → east
  const e = [...w.net.edges.values()].find((x) => x.oneway === 1);
  const A = w.net.nodes.get(e.a), B = w.net.nodes.get(e.b);
  const fwd = w.net.dijkstra([[A.id, 0]], 'len'), back = w.net.dijkstra([[B.id, 0]], 'len');
  const g = fwd.g;
  assert(isFinite(fwd.dist[g.idx.get(B.id)]), 'cannot drive along a one-way');
  assert(!isFinite(back.dist[g.idx.get(A.id)]), 'drove against a one-way');
  assert(g.comp[g.idx.get(A.id)] === g.comp[g.idx.get(B.id)], 'one-way split the utility network');
});

test('lots follow the road Voronoi and fill angled corners', () => {
  const w = new World(3); w.newGame();
  road(w, [150, 262], [280, 262]);
  road(w, [180, 262], [260, 200]);           // ~38° wedge between the two streets
  const n = w.fillZone(215, 250, 3);
  assert(n > 300, `wedge fill too small: ${n}`);
  const seen = new Set(); let lots = 0, cells = 0;
  for (let i = 0; i < N * N; i++) {
    if (w.zone[i] !== 3 || seen.has(i) || !w.free(i)) continue;
    const lot = w.formLot(i, 3); if (!lot) continue;
    lots++; cells += lot.length;
    w.createBuilding({ zone: 3, cells: lot });
    for (const c of lot) seen.add(c);
  }
  assert(lots >= 4, `expected several lots, got ${lots}`);
  assert(cells / n > 0.85, `only ${Math.round((cells / n) * 100)}% of the wedge was used`);
});

test('town grows with utilities (in-thread core)', () => {
  const { w, placed } = town();
  assert(placed.slice(0, 4).every(Boolean), `service placement failed: ${placed}`);
  const sim = new Sim(w, { worker: false });
  run(sim, 200);
  const st = sim.stats;
  assert(sim.host.mode === 'in-thread', 'expected in-thread core in Node');
  assert(st.pop > 150, `population too low: ${Math.round(st.pop)}`);
  assert(w.buildings.size > 20, `too few buildings: ${w.buildings.size}`);
  assert([...sim.f.lv].every(Number.isFinite), 'land value has NaN');
  assert([...w.net.edges.values()].some((e) => e.flow > 0), 'no traffic flow was assigned');
  assert(Number.isFinite(sim.money), 'money is not finite');
});

test('sandbox: infinite money, instant growth, locked demand', () => {
  const { w } = town(99);
  const sim = new Sim(w, { worker: false, sandbox: { instant: true, lockDemand: true } });
  const m0 = sim.money;
  sim.spend(1e6);
  assert(sim.money === m0 && sim.canAfford(1e9), 'sandbox money is not infinite');
  run(sim, 60);
  assert(sim.demand.R === 50, 'demand was not locked');
  assert(w.buildings.size > 25, `instant growth too slow: ${w.buildings.size}`);
});

test('save round-trips and v1 saves migrate', () => {
  const { w } = town(5);
  road(w, [120, 120], [160, 120], null, 'street', -1);
  const sim = new Sim(w, { worker: false }); run(sim, 60);
  const save = JSON.parse(JSON.stringify(makeSave(w, sim)));
  assert(save.v === SAVE_VERSION, 'wrong save version');
  const back = loadSave(save, { worker: false });
  assert(back.world.buildings.size === w.buildings.size, 'building count changed');
  assert(back.world.net.edges.size === w.net.edges.size, 'edge count changed');
  assert([...back.world.net.edges.values()].some((e) => e.oneway === -1), 'one-way lost');
  const v1 = JSON.parse(JSON.stringify(save)); delete v1.v; v1.world.edges = v1.world.edges.map((e) => e.slice(0, 7)); delete v1.sim.sandbox;
  const m = migrate(v1);
  assert(m.v === SAVE_VERSION && m.world.edges.every((e) => e.length === 10) && m.world.nodes.every((n) => n.length === 5), 'v1 migration failed');
  let threw = false; try { migrate({ ...save, v: SAVE_VERSION + 1 }); } catch { threw = true; }
  assert(threw, 'newer save was not rejected');
});

test('sandbox terrain edits persist', () => {
  const w = new World(11); w.newGame();
  w.paintWater(100, 100, 8, 1); w.finishTerrain();
  assert(w.water[100 * N + 100] === 1 && w.wdist[100 * N + 100] < 0, 'water not painted');
  const sim = new Sim(w, { worker: false, sandbox: {} });
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, sim))), { worker: false });
  assert(back.world.water[100 * N + 100] === 1, 'terrain edit lost on reload');
});

test('undo: zoning, roads (incl. splits) and bulldozing', () => {
  const w = new World(21); w.newGame();
  road(w, [150, 262], [260, 262]);
  w.beginTx('zone'); w.paintZone(200, 270, 6, 3); w.commitTx();
  assert(count(w.zone, 3) > 50, 'zone not painted');
  w.undo();
  assert(count(w.zone, 3) === 0, 'zone undo failed');
  // a road that splits an existing one and demolishes a building on its path
  w.paintZone(200, 250, 8, 2);
  const lot = w.formLot(w.cellAt(200, 252), 2); const b = w.createBuilding({ zone: 2, cells: lot });
  const edges0 = w.net.edges.size, roadCells0 = count(w.road, 1);
  w.beginTx('road', { net: true }); road(w, [200, 230], [200, 300]); w.commitTx(100);
  assert(w.net.edges.size > edges0, 'road not built');
  assert(!w.buildings.has(b.id), 'building under the new road survived');
  const t = w.undo();
  assert(t.money === 100, 'undo lost the cost');
  assert(w.net.edges.size === edges0, `edges not restored: ${w.net.edges.size} vs ${edges0}`);
  assert(count(w.road, 1) === roadCells0, 'road cells not restored');
  assert(w.buildings.has(b.id), 'demolished building not restored');
  const e = [...w.net.edges.values()].find((x) => x.type === 'street');
  w.beginTx('bulldoze', { net: true }); w.removeRoad(e.id); w.commitTx();
  w.undo();
  assert(w.net.edges.has(e.id), 'removed road not restored');
});

test('loans: repayment schedule, limits, early repayment and persistence', () => {
  const { w } = town(); const s = new Sim(w, { worker: false }); const initial = s.money;
  assert(!s.takeLoan(-1) && !s.takeLoan(25000, -12), 'invalid loan accepted');
  assert(s.takeLoan(25000) && s.money === initial + 25000, 'principal not credited');
  let total = 0; for (let i = 0; i < 360; i++) total += s.debtTick();
  assert(!s.loans.length && total > 25000 && total < 28000, `invalid repayment total ${total}`);
  s.takeLoan(25000); s.takeLoan(50000); s.takeLoan(100000);
  assert(!s.takeLoan(25000), 'loan cap ignored');
  const restored = loadSave(JSON.parse(JSON.stringify(makeSave(w,s))), { worker: false }).sim;
  assert(restored.loans.length === 3, 'loans lost on load');
  const balance = restored.loans[0].balance, before = restored.money;
  assert(restored.repayLoan(restored.loans[0].id) && restored.money === before - balance, 'early payoff incorrect');
  restored.money = 0; assert(!restored.repayLoan(restored.loans[0].id), 'unaffordable payoff accepted');
});

test('funding changes utility capacity, upkeep and worker coverage', () => {
  const { w } = town(); const s = new Sim(w, { worker: false });
  const finish = gen => { for (const _ of gen) {} };
  finish(s.utilitiesJob()); const power = s.stats.power[0];
  s.dailyTick(); const costs = s.stats.exp.utilities;
  for (const b of w.buildings.values()) if (b.svc) s.setBudget(b.svc, 0.5);
  finish(s.utilitiesJob()); s.dailyTick();
  assert(Math.abs(s.stats.power[0] - power * 0.5) < 0.01, 'utility funding does not scale output');
  assert(Math.abs(s.stats.exp.utilities - costs * 0.5) < 0.01, 'utility funding does not scale cost');
  s.setBudget('fire', 0.5); s.requestCore(1, true, 'low'); s.host.step(Infinity);
  const low = s.cov.fire.reduce((a,v) => a+v, 0);
  s.setBudget('fire', 1.5); s.requestCore(2, true, 'high'); s.host.step(Infinity);
  const high = s.cov.fire.reduce((a,v) => a+v, 0);
  assert(high > low, 'worker coverage does not respond to service budget');
});

test('construction blocks occupancy until completion and survives saves', () => {
  const { w } = town(); const s = new Sim(w, { worker: false });
  const c = w.zone.findIndex((v,i) => v === 1 && w.free(i));
  const cells = w.formLot(c, 1); assert(cells, 'fixture has no lot');
  const b = w.createBuilding({ cells, zone: 1, constructionUntil: 5 });
  s.capacity(b); assert(b.hh === 0 && b.jobs === 0, 'unfinished building has capacity');
  const loaded = loadSave(JSON.parse(JSON.stringify(makeSave(w,s))), { worker: false });
  assert(loaded.world.buildings.get(b.id).constructionUntil === 5, 'construction lost');
  for (let i=0;i<5;i++) s.dailyTick();
  s.capacity(b); assert(b.constructionUntil === 0 && b.hh > 0, 'construction never completed');
});

test('level requirements enforce services, transit and policy', () => {
  const { w } = town(); const s = new Sim(w, { worker: false }); s.day = 200;
  const c = w.zone.findIndex((v,i) => v === 1 && w.free(i));
  const b = w.createBuilding({cells:w.formLot(c,1), zone:1, level:2, built:0});
  s.capacity(b); b.occ = b.hh; b.appeal=1; b.lv=1; s.demand.R=50;
  assert(!s.levelRequirements(b).every(([,ok])=>ok), 'missing services allowed upgrade');
  s.cov.school.fill(1); s.cov.clinic.fill(1);
  assert(s.levelRequirements(b).every(([,ok])=>ok), 'serviced level 3 denied');
  b.locked=true; assert(!s.levelRequirements(b)[0][1], 'level lock ignored');
});

test('scenario goals and v2 migration', () => {
  const { w } = town(); const s = new Sim(w, { worker:false, scenario:'town' });
  assert(!s.scenarioProgress().every(([,ok])=>ok), 'empty town wins');
  s.stats.pop=1000; s.stats.unemp=0.05;
  assert(s.scenarioProgress().every(([,ok])=>ok), 'goal evaluation incorrect');
  const save=makeSave(w,s); save.v=2; delete save.sim.loans; delete save.sim.serviceBudgets;
  const loaded=loadSave(JSON.parse(JSON.stringify(save)), {worker:false});
  assert(loaded.sim.loans.length===0 && loaded.sim.budgetFor('fire')===1, 'v2 defaults invalid');
});

test('routes: partial edges, one-way restrictions, detours and disconnection', () => {
  const n = new RoadNet(), a=n.addNode(0,0), b=n.addNode(100,0), c=n.addNode(100,50), d=n.addNode(0,50);
  const edge=(p,q)=>n.addEdge(p,q,{x:(p.x+q.x)/2,z:(p.z+q.z)/2},'street');
  const ab=edge(a,b); ab.oneway=1; ab.cost=100;
  const start={edge:ab.id,s:20}, target={id:9,edge:ab.id,s:80};
  let r=fastestRoute(n,start,[target]);
  assert(Math.abs(r.seconds-60)<0.001 && r.segments.length===1 && r.segments[0].from===20,'direct partial route incorrect');
  assert(!fastestRoute(n,{edge:ab.id,s:80},[{id:1,edge:ab.id,s:20}]),'illegal reverse one-way trip');
  const bc=edge(b,c),cd=edge(c,d),da=edge(d,a); for(const e of [bc,cd,da])e.cost=10;
  r=fastestRoute(n,{edge:ab.id,s:80},[{id:1,edge:ab.id,s:20}]);
  assert(Math.abs(r.seconds-70)<0.01 && r.segments.length===5,'legal detour not reconstructed');
  for(const seg of r.segments) { const e=n.edges.get(seg.edge); assert(!e.oneway || Math.sign(seg.to-seg.from)===e.oneway,'wrong-direction segment'); }
  n.removeEdge(cd.id);n.removeEdge(da.id);
  assert(!fastestRoute(n,{edge:ab.id,s:80},[{id:1,edge:ab.id,s:20}]),'disconnected route returned');
});

test('routes choose travel time, exclude self and unfinished jobs', () => {
  const n=new RoadNet(),a=n.addNode(0,0),b=n.addNode(100,0,true);
  const e=n.addEdge(a,b,{x:50,z:35},'street');e.cost=20;
  const home={id:1,edge:e.id,s:10,workers:5}, near={id:2,edge:e.id,s:20,workers:5,construction:true}, job={id:3,edge:e.id,s:30,workers:5};
  const routes=commuteRoutes(n,[home,near,job],1);
  assert(routes.job.destination===3 && routes.highway.destination===b.id,'bad destination selection');
  assert(Math.abs(routes.job.seconds-20/e.len*20)<0.001,'curved-edge cost incorrect');
  assert(commuteRoutes(n,[home],1).job===null,'self selected as workplace');
  const before=routes.job.seconds;e.cost*=2;
  assert(Math.abs(commuteRoutes(n,[home,job],1).job.seconds-before*2)<0.001,'congestion cost ignored');
});

test('weather deterministic across reloads, seasons and sandbox overrides', () => {
  for(let day=0;day<720;day+=5)assert(JSON.stringify(weatherAt(7,day))===JSON.stringify(weatherAt(7,day)),'weather unstable');
  assert(new Set([0,90,180,270].map(d=>weatherAt(7,d).season)).size===4,'missing seasons');
  const {w}=town();const s=new Sim(w,{worker:false,sandbox:{}});s.day=152;s.setWeather('snow');
  const loaded=loadSave(JSON.parse(JSON.stringify(makeSave(w,s))),{worker:false}).sim;
  assert(loaded.weather.type==='snow' && loaded.wind===s.wind,'weather changed on reload');
  s.setWeather(null);assert(s.weather.type===weatherAt(w.seed,152).type,'seasonal mode not restored');
});

test('weather changes traffic costs, utility demand and fire modifiers', () => {
  const {w}=town();const s=new Sim(w,{worker:false,sandbox:{}}),finish=g=>{for(const _ of g){}};
  s.setWeather('clear');finish(s.utilitiesJob());const demand=[s.stats.power[1],s.stats.water[1]];
  s.setWeather('heat');finish(s.utilitiesJob());
  assert(Math.abs(s.stats.power[1]-demand[0]*1.3)<0.01 && Math.abs(s.stats.water[1]-demand[1]*1.35)<0.01,'heat demand ignored');
  const core=new Core();core.handle({type:'net',net:netSnapshot(w.net)});
  const req={blds:[],stats:{employed:0,pop:0,commuters:0,filledI:0},weather:WEATHER.clear};
  finish(core.traffic(req,0,{msgs:[]}));const before=[...core.net.edges.values()][0].cost;
  req.weather=WEATHER.snow;finish(core.traffic(req,0,{msgs:[]}));
  assert(Math.abs([...core.net.edges.values()][0].cost-before/0.6)<0.01,'snow travel time ignored');
  assert(WEATHER.rain.fire<1 && WEATHER.heat.fire>1,'fire risk modifiers missing');
});

test('worker route results reject obsolete selection and edited networks', () => {
  const {w}=town();const s=new Sim(w,{worker:false});s.selectRoutes(1);
  s.requestCore(0,true,'test');s.host.step(Infinity);
  const result=structuredClone(s.host.local.result);
  assert(result.routes.origin===1,'worker omitted route origin');
  s.selectRoutes(2);s.applyCore(result);assert(s.routes===null,'stale selection route applied');
  s.selectRoutes(1);result.routeRevision=s.routeRevision;w.net.version++;
  s.applyCore(result);assert(s.routes===null,'stale network route applied');
});

// ------------------------------------------------------------------ eras
// a dense level-5 block on one of the town's zones
function tower(w, zone = 2, level = 5) {
  for (const z of [zone, 2, 3, 6, 5]) {
    for (let i = 0; i < w.zone.length; i++) {
      if (w.zone[i] !== z || !w.free(i)) continue;
      const cells = w.formLot(i, z);
      if (cells && cells.length >= 60) return w.createBuilding({ cells, zone: z, level, built: 0 });
    }
  }
  throw new Error('fixture has no dense lot');
}

test('eras: technology ceilings rise from heritage to cyberpunk', () => {
  const t = (y) => technology(y);
  assert(t(1820).heightLimit < t(1920).heightLimit && t(1920).heightLimit < t(2020).heightLimit && t(2020).heightLimit < t(2080).heightLimit, 'ceilings do not rise');
  assert(t(1850).style === 'heritage' && t(1950).style === 'industrial' && t(2010).style === 'modern' && t(2060).style === 'cyberpunk', 'wrong era styles');
  assert(!t(2020).terraces && t(2030).terraces && !t(2040).flying && t(2055).flying, 'unlock years wrong');
});

test('eras: towers grow over time; locked buildings keep their height', () => {
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: {}, startYear: 2000, eraPace: 10 });
  const a = tower(w), b = tower(w); b.locked = true;
  const f0 = buildingFloors(a, w), l0 = buildingFloors(b, w);
  for (let k = 0; k < 6; k++) s.advanceEra();
  assert(s.year >= 2060 && s.tech.style === 'cyberpunk', `calendar did not advance: ${s.year}`);
  assert(buildingFloors(a, w) > f0 + 5, `tower did not grow: ${f0} → ${buildingFloors(a, w)}`);
  assert(buildingFloors(b, w) === l0, 'locked building changed height');
  const s2 = new Sim(new World(1), { worker: false, startYear: 1800 });
  assert(s2.tech.heightLimit <= 4, '1800s allow tall buildings');
});

test('eras: automatic skyways link tall hubs after 2050', () => {
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: {}, startYear: 2000, eraPace: 10 });
  const a = tower(w, 2), b = tower(w, 3);
  assert(a.edge >= 0 && b.edge >= 0, 'fixture towers lack road access');
  assert(s.sky.links.length === 0, 'skyways before 2050');
  for (let k = 0; k < 6; k++) s.advanceEra();
  assert(s.sky.hubs.length >= 2 && s.sky.links.length >= 1 && s.sky.share > 0, `no skyways: ${JSON.stringify(s.sky)}`);
  const v = s.skyVersion; s.updateEra(); assert(s.skyVersion === v, 'skyway meshes rebuilt without changes');
});

test('eras: terrace platforms build, expand, host services, undo and persist', () => {
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: {}, startYear: 2000, eraPace: 10 });
  const host = tower(w);
  assert(!w.planPlatform(host.id).ok, 'platform allowed before 2025');
  for (let k = 0; k < 3; k++) s.advanceEra();
  const plan = w.planPlatform(host.id); assert(plan.ok, `platform refused: ${plan.err}`);
  w.beginTx('Terrace'); const p = w.buildPlatform(plan); w.commitTx(plan.cost);
  const grown = w.planPlatform(host.id, true);
  assert(grown.ok && grown.x1 - grown.x0 > p.x1 - p.x0, `expansion does not grow the deck: ${grown.err || ''}`);
  w.buildPlatform(grown);
  const deck = w.platforms.get(p.id);
  const svc = w.planService('parkS', (deck.x0 + deck.x1) / 2, (deck.z0 + deck.z1) / 2, p.id); assert(svc.ok, `terrace park refused: ${svc.err}`);
  const park = w.placeService('parkS', svc);
  assert(park.platformId === p.id && park.baseY > 10, 'service not elevated on the terrace');
  assert(!w.planService('coal', (deck.x0 + deck.x1) / 2, (deck.z0 + deck.z1) / 2, p.id).ok, 'heavy utility allowed on a terrace');
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, s))), { worker: false });
  assert(back.world.platforms.size === 1 && back.world.buildings.get(park.id)?.platformId === p.id, 'terrace lost on reload');
  w.removeBuilding(park.id);
  while (w.undoStack.length) w.undo();
  assert(w.platforms.size === 0, 'undo left the terrace in place');
});

// ------------------------------------------------------------------ roads & traffic
test('roads: elevated roads cross without junctions and leave the land below free', () => {
  const w = new World(1); w.newGame();
  road(w, [200, 150], [320, 150]);
  const cost0 = w.roadCost({ x: 260, z: 100 }, { x: 260, z: 160 }, { x: 260, z: 220 }, 'street', 0).cost;
  const cost1 = w.roadCost({ x: 260, z: 100 }, { x: 260, z: 160 }, { x: 260, z: 220 }, 'street', 1).cost;
  assert(cost1 > cost0 * 2, 'elevated road not more expensive');
  w.buildRoad(S(w, 260, 100), null, S(w, 260, 220), 'street', 0, 1);
  assert(![...w.net.nodes.values()].some((n) => n.edges.size >= 3), 'elevated road made a junction');
  assert(w.road[190 * N + 260] === 0 && w.road[105 * N + 260] === 1, 'deck occupies land / ramp missing');
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, new Sim(w, { worker: false })))), { worker: false });
  assert([...back.world.net.edges.values()].some((e) => e.layer === 1), 'layer lost on reload');
});

test('junctions: control trades base delay for capacity; ramps are one-way', () => {
  const n = { edges: new Set([1, 2, 3, 4]), control: 'auto' };
  const d = (control, through) => junctionDelay({ ...n, control }, through);
  assert(d('auto', 200) < d('signal', 200), 'lights slower than uncontrolled at low volume expected');
  assert(d('signal', 2400) < d('auto', 2400) && d('roundabout', 2400) < d('stop', 2400), 'high-capacity control not faster when busy');
  assert(junctionDelay({ edges: new Set([1, 2]), control: 'auto' }, 5000) === 0, 'plain bend has a delay');
  const w = new World(1); w.newGame();
  road(w, [200, 150], [320, 150]); road(w, [260, 100], [260, 220]);
  const x = [...w.net.nodes.values()].find((k) => k.edges.size === 4);
  assert(w.setJunction(x.id, 'signal') && x.control === 'signal', 'signal not set');
  const bend = [...w.net.nodes.values()].find((k) => k.edges.size === 1);
  assert(!w.setJunction(bend.id, 'signal'), 'dead end accepted a signal');
  w.buildRoad(S(w, 100, 100), null, S(w, 150, 100), 'ramp');
  assert([...w.net.edges.values()].find((e) => e.type === 'ramp').oneway === 1, 'ramp is not one-way');
});

// two routes A→B: a short one and a longer detour; homes at A, jobs at B
function corridor() {
  const net = new RoadNet();
  const A = net.addNode(0, 0), B = net.addNode(200, 0), C = net.addNode(100, 80);
  const direct = net.addEdge(A, B, { x: 100, z: 0 }, 'street');
  const d1 = net.addEdge(A, C, { x: 50, z: 40 }, 'street'), d2 = net.addEdge(C, B, { x: 150, z: 40 }, 'street');
  const H = net.addNode(-40, 0), Jn = net.addNode(240, 0);
  const home = net.addEdge(H, A, { x: -20, z: 0 }, 'street'), work = net.addEdge(B, Jn, { x: 220, z: 0 }, 'street');
  const blds = [
    { id: 1, cx: -20, cz: 5, edge: home.id, s: 10, occ: 400, workers: 0, kind: 'R', comp: 0 },
    { id: 2, cx: 220, cz: 5, edge: work.id, s: 10, occ: 0, workers: 400, kind: 'O', comp: 0 },
  ];
  return { net, direct, detour: [d1, d2], home, work, blds };
}
const drain = (g) => { let r; do r = g.next(); while (!r.done); return r.value; };

test('assignment: congestion spreads trips onto the detour; one-way flows stay directional', () => {
  const light = corridor(); drain(assignTraffic(light.net, light.blds, { total: 20, rng: () => 1 }));
  assert(light.direct.fAB > 0 && light.detour[0].fAB < light.direct.fAB * 0.2, 'light traffic should use the direct road');
  const heavy = corridor(); drain(assignTraffic(heavy.net, heavy.blds, { total: 3000, rng: () => 1 }));
  assert(heavy.detour[0].fAB > heavy.direct.fAB * 0.2, `heavy traffic did not spread: ${heavy.direct.fAB} vs ${heavy.detour[0].fAB}`);
  assert(heavy.direct.fBA === 0 && heavy.home.fAB > 0, 'flow direction wrong');
  const ow = corridor(); ow.direct.oneway = -1; ow.net.version++;
  drain(assignTraffic(ow.net, ow.blds, { total: 200, rng: () => 1 }));
  assert(ow.direct.fAB === 0 && ow.detour[1].fAB > 0, 'traffic drove against a one-way');
});

test('bus lines: riders, bus lanes, pruning, undo and saves', () => {
  const c = corridor();
  const lines = [{ id: 7, stops: [{ edge: c.home.id, s: 12, x: -20, z: 5 }, { edge: c.work.id, s: 12, x: 220, z: 5 }] }];
  const r = routeLines(c.net, lines);
  assert(r[0].ok && r[0].len > 400, 'line not routed as a loop');
  const out = drain(assignTraffic(c.net, c.blds, { total: 200, lines, rng: () => 1 }));
  assert(out.riders.get(7) > 20 && out.transit > 20, 'line carried no riders');
  c.direct.busLane = true;
  const lanes = routeLines(c.net, lines)[0];
  assert(lanes.busLaneShare > 0, 'bus lane share missing');
  const { w } = town();
  const stops = [];
  for (const [x, z] of [[190, 262], [240, 262]]) { const p = w.planService('busstop', x, z + 6); if (p.ok) stops.push(w.placeService('busstop', p)); }
  assert(stops.length === 2, 'could not place stops');
  w.beginTx('Line'); const line = w.addLine(stops.map((b) => b.id)); w.commitTx();
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, new Sim(w, { worker: false })))), { worker: false });
  assert(back.world.lines.length === 1 && back.world.lines[0].stops.length === 2, 'line lost on reload');
  w.undo(); assert(!w.lines.length, 'undo kept the line');
  w.addLine(stops.map((b) => b.id)); w.removeBuilding(stops[0].id); w.pruneLines();
  assert(!w.lines.length, 'line with one stop survived');
  assert(line.id >= 1);
});

test('agents: queues keep gaps, red lights hold traffic, full roads cause spillback', () => {
  const net = new RoadNet();
  const A = net.addNode(0, 0), X = net.addNode(100, 0), B = net.addNode(200, 0), N1 = net.addNode(100, 60), S1 = net.addNode(100, -60);
  const e1 = net.addEdge(A, X, { x: 50, z: 0 }, 'street'), e2 = net.addEdge(X, B, { x: 150, z: 0 }, 'street');
  net.addEdge(X, N1, { x: 100, z: 30 }, 'street'); net.addEdge(X, S1, { x: 100, z: -30 }, 'street');
  const route = [{ edge: e1.id, from: 0, to: e1.len }, { edge: e2.id, from: 0, to: e2.len }];
  const T = new Traffic();
  for (let k = 0; k < 6; k++) { const a = T.spawn(route, 'car'); a.s = 60 - k * 4; }
  for (let k = 0; k < 60; k++) T.step(net, 0.05);
  const q = T.agents.filter((a) => a.i === 0).sort((p, r) => r.s - p.s);
  for (let k = 1; k < q.length; k++) assert(q[k - 1].s - q[k].s >= AGENT_TYPES.car.len, 'vehicles overlap in the queue');
  // red light: hold the queue before the junction
  X.control = 'signal';
  const T2 = new Traffic(); T2.clock = 0;
  const axis = T2.axis(net, X.id, e1), red = T2.phase(X.id) !== axis ? 0 : 7.01; T2.clock = red;
  const car = T2.spawn(route, 'car'); car.s = 85;
  for (let k = 0; k < 20; k++) T2.step(net, 0.05);
  assert(car.i === 0 && car.s < e1.len - 1, 'ran a red light');
  // spillback: the next road is jammed at its start, so vehicles wait
  X.control = 'auto';
  const T3 = new Traffic();
  const blocker = T3.spawn([{ edge: e2.id, from: 0, to: e2.len }], 'truck'); blocker.s = 1; blocker.vm = 0; // stalled
  const c3 = T3.spawn(route, 'car'); c3.s = 90;
  for (let k = 0; k < 40; k++) T3.step(net, 0.05);
  assert(c3.i === 0, 'entered a road with no room');
});

test('fire response is routed: reachable fires are saved, isolated ones are not', () => {
  const { w } = town(); const s = new Sim(w, { worker: false });
  run(s, 3);
  const near = [...w.buildings.values()].find((b) => !b.svc && b.comp === [...w.buildings.values()].find((f) => f.svc === 'fire')?.comp);
  assert(near, 'no building near the fire station');
  const r = s.igniteBuilding(near);
  assert(r && near.fireOut && near.fireResponse <= 45, `nearby fire not saved (response ${near.fireResponse})`);
  assert(s.dispatches?.length, 'no engine dispatched');
  road(w, [60, 60], [100, 60]);
  w.paintZone(80, 66, 5, 1);
  const lot = w.formLot(w.cellAt(80, 66), 1); const lone = w.createBuilding({ zone: 1, cells: lot });
  s.utilitiesJob().next(); lone.comp = -9;
  s.igniteBuilding(lone);
  assert(!lone.fireOut, 'unreachable fire was put out');
});

test('pollution: sewage fouls the shore, cuts pumps; smoke drifts downwind', () => {
  const core = new Core(1);
  const wf = new Float32Array(64 * 64).fill(1);
  core.handle({ type: 'static', waterfront: wf, view: new Float32Array(64 * 64) });
  const run1 = (blds, weather) => { const g = core.fields({ blds, weather }); while (!g.next().done); return core.f; };
  const f = run1([{ id: 1, svc: 'outlet', cx: 256, cz: 256, level: 1 }], { direction: 0, wind: 1 });
  assert(sampleField(f.waterPol, 256, 256) > 0.5 && sampleField(f.waterPol, 50, 50) === 0, 'outlet did not pollute the water locally');
  const east = run1([{ id: 1, svc: 'coal', cx: 256, cz: 256, level: 1 }], { direction: Math.PI / 2, wind: 1.2 });
  const e1 = sampleField(east.pollution, 300, 256), w1 = sampleField(east.pollution, 212, 256);
  assert(e1 > w1 * 1.3, `smoke not blown downwind (east ${e1.toFixed(2)} vs west ${w1.toFixed(2)})`);
});

test('budget: tax brackets, utility trade and landmark tourism', () => {
  const { w } = town(); const s = new Sim(w, { worker: false }); run(s, 5);
  const home = [...w.buildings.values()].find((b) => !b.svc && ZONES[b.zone].key === 'rl');
  assert(home, 'no low-density home');
  const base = s.taxFor('R', home); s.brackets.lowDensity = 3;
  assert(s.taxFor('R', home) === base + 3, 'bracket not applied');
  s.trade = { sell: true, buy: false };
  const u = s.utilitiesJob(); while (!u.next().done);
  assert(s.tradeFlow.soldP > 0, 'surplus power not sold');
  s.dailyTick(); assert(s.stats.inc.trade > 0, 'no export income');
  const p = w.planService('plaza', 190, 262 + 12);
  if (p.ok) {
    w.placeService('plaza', p);
    assert(!w.planService('plaza', 230, 262 + 12).ok, 'second plaza allowed');
    s.dailyTick(); assert(s.stats.inc.tourism > 0, 'landmark earned no tourism');
  }
});

test('specializations and splitting of declining merged blocks', () => {
  const { w } = town(); const s = new Sim(w, { worker: false });
  const shop = [...w.buildings.values()].find((b) => !b.svc) || tower(w, 3, 2);
  s.f.waterfront = new Float32Array(64 * 64).fill(1);
  const c = tower(w, 3, 2); assert(s.pickSpec(c) === 'leisure', 'waterside shop not leisure');
  const forest = [...Array(400).keys()].map((k) => [(k % 20) * 25, Math.floor(k / 20) * 25]).find(([x, z]) => w.forestAt(x, z));
  assert(forest, 'map has no forest');
  // split: a big merged high-density block broken back into ordinary lots
  const big = tower(w, 2, 4);
  const cells = [...big.cells], extra = [];
  for (const n of [...w.adjacentBuildings(big).values()]) if (n && !n.svc && n.zone === big.zone) { extra.push(...n.cells); w.removeBuilding(n.id); }
  if (extra.length) w.setCells(big, [...cells, ...extra]);
  const area = big.area, made = w.splitBuilding(big, 1);
  if (area > 260 * 1.2) assert(made && made.length >= 2 && !w.buildings.has(big.id), `merged block of ${area} cells did not split`);
  assert(shop);
});

test('agent worker host: spawns from samples, runs buses, packs poses', () => {
  { const t = new Traffic(); assert(!t.canSpawn([]) && !t.spawn([]), 'empty route spawned'); new AgentSim().handle({ type: 'spawn', list: [{ segs: [], kind: 'police' }] }); }
  const c = corridor(), sim = new AgentSim();
  sim.handle({ type: 'net', net: netSnapshot(c.net) });
  const segs = [{ edge: c.home.id, from: 5, to: c.home.len }, { edge: c.direct.id, from: 0, to: c.direct.len }];
  sim.handle({ type: 'samples', samples: [{ segs, kind: 'car' }], target: 3 });
  sim.step(0.5);   // a car spawns and pulls away before the bus appears at the same stop
  sim.handle({ type: 'lines', lines: [{ id: 1, segs, len: 300, color: 0xff0000, sig: 'a' }] });
  let r = sim.step(0.1);
  assert(r.n >= 2 && r.buf.length >= r.n * POSE_STRIDE, 'no poses packed');
  const types = new Set(); for (let i = 0; i < r.n; i++) types.add(TYPE_IDS[r.buf[i * POSE_STRIDE + 4]]);
  assert(types.has('car') && types.has('bus'), `missing vehicle types: ${[...types]}`);
  const first = sim.T.agents[0], s0 = first.s;
  for (let k = 0; k < 20; k++) r = sim.step(0.1);
  assert(first.s !== s0 || first.i > 0, 'vehicles did not move');
  const buses = sim.T.agents.filter((a) => a.type === 'bus').map((a) => a.id).join();
  sim.handle({ type: 'lines', lines: [{ id: 1, segs, len: 300, color: 0xff0000, sig: 'a' }] });
  assert(sim.T.agents.filter((a) => a.type === 'bus').map((a) => a.id).join() === buses, 'unchanged line respawned its buses');
});

test('terraces attach at any floor, several per building; heights vary per building', () => {
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: {}, startYear: 2000, eraPace: 10 });
  for (let k = 0; k < 3; k++) s.advanceEra();
  const host = tower(w); const fl = buildingFloors(host, w);
  assert(fl >= 8, `host too short for the test: ${fl}`);
  const low = w.planPlatform(host.id, false, 3); assert(low.ok, `floor-3 deck refused: ${low.err}`);
  const d1 = w.buildPlatform(low);
  assert(Math.abs(d1.y - 3 * 1.6) < 0.01, `deck not at floor 3: ${d1.y}`);
  assert(!w.planPlatform(host.id, false, 5).ok, 'deck allowed two floors above another');
  const roof = w.planPlatform(host.id, false, null); assert(roof.ok, `roof deck refused: ${roof.err}`);
  const d2 = w.buildPlatform(roof);
  assert(d2.y > d1.y + 8, 'roof deck not above the floor deck');
  const grown = w.planPlatform(host.id, d1.id); assert(grown.ok && grown.id === d1.id && grown.level === 3, 'expanding kept neither id nor level');
  w.buildPlatform(grown);
  const deck = w.platforms.get(d1.id);
  const svc = w.planService('clinic', (deck.x0 + deck.x1) / 2, deck.z0 + 5, d1.id);
  if (svc.ok) { const b = w.placeService('clinic', svc); assert(Math.abs(b.baseY - d1.y) < 0.01, 'service not on the low deck'); }
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, s))), { worker: false });
  assert(back.world.platforms.get(d1.id)?.level === 3 && back.world.platforms.size === 2, 'deck levels lost on reload');
  // same zone & level, different buildings → different storey counts
  const heights = new Set();
  for (let id = 1; id < 40; id++) heights.add(buildingFloors({ id, zone: 2, level: 4, svc: null }, { policyAt: () => null, year: 2000 }));
  assert(heights.size >= 4, `skyline too uniform: ${[...heights]}`);
});

test('skyline accents count: annex and cantilever storeys add capacity, deterministically', () => {
  const fake = { policyAt: () => null, year: 2080 };
  const plans = []; for (let id = 1; id < 60; id++) plans.push(massPlan({ id, zone: 2, level: 5, svc: null, area: 400 }, fake));
  assert(plans.some((p) => p.annex) && plans.some((p) => !p.annex) && plans.some((p) => p.canti.length), 'accents not varied');
  const again = massPlan({ id: 7, zone: 2, level: 5, svc: null, area: 400 }, fake);
  assert(JSON.stringify(again) === JSON.stringify(plans[6]), 'mass plan not deterministic');
  assert(massPlan({ id: 7, zone: 4, level: 3, svc: null, area: 400 }, fake).bonus === 0, 'industry got tower accents');
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: {}, startYear: 2000, eraPace: 10 });
  for (let k = 0; k < 7; k++) s.advanceEra();
  const b = tower(w); const plan = massPlan(b, w);
  assert(Math.abs(s.floorsOf(b) - buildingFloors(b, w) - plan.bonus) < 1e-9, 'capacity ignores the accents');
  s.capacity(b); const withAccents = b.hh + b.jobs;
  s.floorsOf = (x) => buildingFloors(x, w); s.capacity(b);
  assert(plan.bonus === 0 || withAccents > b.hh + b.jobs, 'accent storeys add no households or jobs');
});

test('skybridges: shared by sim and render, share coverage, raise land value', () => {
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: {}, startYear: 2000, eraPace: 10 });
  for (let k = 0; k < 3; k++) s.advanceEra();
  for (let k = 0; k < 8; k++) try { tower(w, [2, 3, 5, 6][k % 4]); } catch { break; }
  const br = s.bridges();
  assert(br.length >= 1, 'no skybridges between nearby towers');
  const l = br[0], a = w.buildings.get(l.a), b = w.buildings.get(l.b);
  assert(s.partners(a).includes(b.id) && s.partners(b).includes(a.id), 'bridge partners not symmetric');
  s.at = (f, x, z) => (f === s.cov.school && x === b.cx && z === b.cz ? 1 : 0);
  assert(s.bcov('school', a) === 1, 'coverage not shared across the bridge');
  s.evalBuilding(a); assert(a.lv >= 0.04 * s.partners(a).length - 1e-9, 'no land value bonus');
  s.year = 1950; s.tech = technology(1950); w.year = 1950;
  assert(s.bridges().length === 0, 'bridges before the modern era');
});

test('air traffic: hub-to-hub trips leave the roads, limited by pad capacity', () => {
  const opts = (cap) => ({ total: 400, rng: () => 1, skyShare: 0.35, hubs: cap ? [{ id: 1, x: -20, z: 5, cap }, { id: 2, x: 220, z: 5, cap }] : [] });
  const sky = (c) => { c.blds[0].sky = true; return c; };
  const ground = sky(corridor()), g = drain(assignTraffic(ground.net, ground.blds, opts(0)));
  assert(g.air === 0 && g.airOD.size === 0, 'flew without hubs');
  const big = sky(corridor()), f = drain(assignTraffic(big.net, big.blds, opts(1e6)));
  assert(f.air > 0 && f.airOD.get('1-2') > 0 && f.hubLoad.get(1) > 0, 'no air trips between hubs');
  assert(big.home.fAB < ground.home.fAB, 'air trips still drove');
  const small = sky(corridor()), t = drain(assignTraffic(small.net, small.blds, opts(5)));
  assert(t.air > 0 && t.air <= 5 + 1e-6 && t.air < f.air, `pad capacity ignored: ${t.air}`);
});

test('bankruptcy: warning, austerity, then bailout — or game over in a scenario', () => {
  const { w } = town(); const s = new Sim(w, { worker: false });
  s.money = -5000; s.setBudget('fire', 1.4);
  s.bankruptcy(); s.bankruptcy(); assert(!s.austerity && s.debtMonths === 2, 'cut services too early');
  s.bankruptcy(); assert(s.austerity && s.budgetFor('fire') <= 0.75, 'no austerity after 3 months');
  s.setBudget('fire', 1.5); assert(s.budgetFor('fire') <= 0.75, 'austerity cap bypassed');
  const saved = loadSave(JSON.parse(JSON.stringify(makeSave(w, s))), { worker: false }).sim;
  assert(saved.debtMonths === 3 && saved.austerity, 'debt state lost on reload');
  s.bankruptcy(); s.bankruptcy(); s.bankruptcy();
  const bail = s.loans.find((l) => l.bailout);
  assert(bail && bail.rate === 0.02 && s.money > 0 && !s.gameOver, 'no bailout after 6 months');
  assert(s.takeLoan(25000), 'bailout blocked a voluntary loan');
  s.bankruptcy(); assert(!s.austerity, 'austerity kept after recovery');
  const sc = new Sim(town().w, { worker: false, scenario: 'town' }); sc.money = -1;
  for (let k = 0; k < 6; k++) sc.bankruptcy();
  assert(sc.gameOver && sc.paused, 'scenario not lost'); sc.paused = false; sc.update(0.1); assert(sc.paused, 'game over resumed');
  const sb = new Sim(town().w, { worker: false, sandbox: {} }); sb.money = -1; run(sb, 200);
  assert(!sb.debtMonths && !sb.loans.length, 'sandbox punished for debt');
});

test('sandbox placement stamps locked buildings on zoned lots', () => {
  const { w } = town();
  const spot = (zone) => { for (let i = 0; i < w.zone.length; i++) if (w.zone[i] === zone && w.free(i) && w.accEdge[i] >= 0 && w.formLot(i, zone)) return [(i % N) + 0.5, Math.floor(i / N) + 0.5]; throw new Error('no spot'); };
  const n0 = w.buildings.size;
  w.beginTx('Place'); const r = w.placeGrowable(...spot(3), 4); w.commitTx();
  assert(r.ok && r.b.level === 4 && r.b.locked && w.buildings.size === n0 + 1, `placement failed: ${r.err}`);
  const c = w.placeGrowable(...spot(1), 5); assert(c.ok && c.b.level === 3 && c.capped, 'level not capped to zone max');
  assert(!w.placeGrowable(r.b.cx, r.b.cz, 2).ok, 'placed on top of a building');
  assert(!w.placeGrowable(5, 5, 2).ok, 'placed on unzoned ground');
  w.undo(); w.undo(); assert(!w.buildings.has(r.b.id), 'undo kept the placed building');
});

// ------------------------------------------------------------------ phase J: people and society
const grown = (days = 120, opts = {}) => { const { w } = town(); const s = new Sim(w, { worker: false, sandbox: { instant: true, noIllness: true, ...opts } }); run(s, days); return { w, s }; };

test('demographics: cohorts add up, homes age, retirees pay less tax', () => {
  const { w, s } = grown();
  const st = s.stats;
  assert(st.pop > 100 && st.kids > 0 && st.seniors > 0, `no cohorts: ${JSON.stringify({ pop: st.pop, kids: st.kids, seniors: st.seniors })}`);
  assert(Math.abs(st.kids + st.adults + st.seniors - st.pop) < 1e-6, 'cohorts do not add up');
  const b = [...w.buildings.values()].find((x) => x.hh);
  const young = s.demography({ ...b, built: s.day }), old = s.demography({ ...b, built: s.day - 3000 });
  assert(old.seniors > young.seniors && old.kids < young.kids, 'buildings do not age');
});

test('education chain: school seats, colleges and universities make graduates', () => {
  const { w, s } = grown();
  const noSchool = s.stats.eduRate;
  assert(s.stats.schoolLoad > 1 && noSchool < 0.2, `no school, yet educated: ${noSchool}`);
  assert(s.stats.hiEdu === 0, 'graduates without a college');
  const put = (k, x, z) => { for (let d = 0; d < 40; d += 3) for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) { const p = w.planService(k, x + dx, z + dz); if (p.ok) return w.placeService(k, p); } return null; };
  assert(put('school', 200, 250) && put('university', 230, 240), 'could not place school/university');
  run(s, 30);
  assert(s.stats.eduRate > noSchool, 'school did not raise education');
  assert(s.stats.hiEdu > 0 && s.stats.hiSeats === SERVICES.university.seats, `no graduates: ${s.stats.hiEdu}`);
  const office = [...w.buildings.values()].find((b) => !b.svc) || tower(w, 5);
  office.level = 4; office.zone = 5;
  assert(s.levelRequirements(office).some(([l]) => l.startsWith('Graduates')), 'level-5 offices do not need graduates');
});

test('health: unserved homes fall ill, outbreaks spread, vaccination and clinics help', () => {
  const { w, s } = grown(120);
  s.sandbox.noIllness = false; s.stats.pop = Math.max(s.stats.pop, 600);
  const homes = [...w.buildings.values()].filter((b) => b.hh && b.occ);
  s.rng = () => 0;                                              // every roll succeeds
  s.healthTick();
  assert(homes.every((b) => b.sick > 0), 'no outbreak without clinics');
  assert(s.stats.sick === 0 || s.stats.sick >= 0, 'sick count missing');
  s.evalBuilding(homes[0]); assert(homes[0].prob & PROB.sick, 'illness not flagged as a problem');
  for (const b of homes) b.sick = 0;
  s.rng = () => 0.00011; s.healthTick(); const plain = homes.filter((b) => b.sick).length;
  for (const b of homes) b.sick = 0;
  s.setOrdinance('vaccination', true); s.healthTick(); const vacc = homes.filter((b) => b.sick).length;
  assert(plain > 0 && vacc < plain, `vaccination did not help: ${plain} vs ${vacc}`);
  s.sandbox.noIllness = true; for (const b of homes) b.sick = 0; s.rng = () => 0; s.healthTick();
  assert(!homes.some((b) => b.sick), 'sandbox switch ignored');
});

test('ordinances: costs, high-rise ban, curfew and free transit', () => {
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: { instant: true } });
  const t = tower(w); for (let k = 0; k < 7; k++) s.advanceEra(); run(s, 60);
  assert(buildingFloors(t, w) > 8, 'tower too short');
  s.setOrdinance('highrise', true); assert(buildingFloors(t, w) === 8, 'high-rise ban ignored');
  s.setOrdinance('highrise', false); assert(buildingFloors(t, w) > 8, 'ban not lifted');
  s.setOrdinance('curfew', true); s.setOrdinance('freeTransit', true);
  run(s, 2);
  assert(Math.abs(s.stats.exp.ordinances * 30 - 400) < 1e-6 && s.stats.inc.fares === 0, `ordinance costs wrong: ${s.stats.exp.ordinances * 30}`);
  const a = town(), b = town();
  const sa = new Sim(a.w, { worker: false, sandbox: { instant: true } }), sb = new Sim(b.w, { worker: false, sandbox: { instant: true } });
  sb.setOrdinance('curfew', true); run(sa, 90); run(sb, 90);
  const mean = (f) => f.reduce((x, y) => x + y, 0) / f.length;
  assert(mean(sb.f.crime) < mean(sa.f.crime), `curfew did not cut crime: ${mean(sb.f.crime)} vs ${mean(sa.f.crime)}`);
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, s))), { worker: false }).sim;
  assert(back.ordinances.curfew && back.w.ordinances === back.ordinances, 'ordinances lost on reload');
});

test('car-free centres move trips off the roads; free transit fills buses', () => {
  const base = corridor(), b0 = drain(assignTraffic(base.net, base.blds, { total: 300, rng: () => 1 }));
  const cf = corridor(); cf.blds[0].carFree = true; const b1 = drain(assignTraffic(cf.net, cf.blds, { total: 300, rng: () => 1 }));
  assert(b1.walk > 0 && cf.home.fAB < base.home.fAB, 'car-free trips still drove');
  assert(b0.walk === 0, 'walking without a car-free centre');
});

test('news and advisors: street names, headlines, seven advisors', () => {
  const { w, s } = grown(60);
  const e = [...w.net.edges.values()].find((x) => x.type === 'street');
  assert(/^[A-Z][a-z]+ St$/.test(s.streetName(e.id)) && s.streetName(e.id) === s.streetName(e.id), `bad street name ${s.streetName(e.id)}`);
  s.milestone = 0; s.stats.pop = 1200; s.monthlyNews();
  assert(s.news.some((n) => n.text.includes('1,000')), 'no milestone headline');
  const adv = s.advisors();
  assert(adv.length === 7 && adv.every((a) => a.who && a.text && ['good', 'warn', 'bad'].includes(a.mood)), 'advisors incomplete');
  assert(adv.filter((a) => a.ov).every((a) => a.ov in { traffic: 1, school: 1, higher: 1, health: 1, clinic: 1, crime: 1, pollution: 1, power: 1, water: 1 }), 'advisor overlay unknown');
});

test('scenarios: tutorial steps, gridlock and debt cities', () => {
  const tw = new World(77); tw.newGame(); const ts = new Sim(tw, { worker: false, scenario: 'tutorial' });
  let prog = ts.scenarioProgress(); assert(prog.length === TUTORIAL.length && !prog[0][1], 'tutorial starts complete');
  road(tw, [150, 262], [200, 262]); prog = ts.scenarioProgress(); assert(prog[0][1] && !prog[1][1], 'road step not detected');
  ts.tutorialFlags.overlays = true; assert(ts.scenarioProgress()[8][1], 'overlay flag ignored');
  const gw = new World(4242); gw.newGame(); const gs = new Sim(gw, { worker: false, scenario: 'gridlock' });
  setupScenario(gw, gs, 'gridlock');
  const homes = [...gw.buildings.values()].filter((b) => !b.svc);
  assert(homes.length > 20 && homes.some((b) => b.occ > 0) && !homes.some((b) => b.locked), `gridlock city not built: ${homes.length}`);
  assert(!gw.undoStack.length, 'scenario setup left undo history');
  run(gs, 35);
  assert(gs.stats.pop > 500 && gs.jamRoads !== null && gs.scenarioStart, `gridlock sim idle: pop ${gs.stats.pop}, jams ${gs.jamRoads}`);
  const gp = gs.scenarioProgress();
  assert(gp.length === 4 && !gp[0][1] && gs.worstRoad().ratio > 1, `gridlock is not gridlocked: ${gs.worstRoad()?.ratio}`);
  const dw = new World(4242); dw.newGame(); const ds = new Sim(dw, { worker: false, scenario: 'debt' });
  setupScenario(dw, ds, 'debt');
  assert(ds.money < 0 && ds.loans.length === 1 && ds.budgetFor('fire') === 1.5, 'debt scenario not set up');
  run(ds, 31); assert(ds.debtMonths >= 1 || ds.money >= 0, 'debt clock not running');
  console.log(`       gridlock: ${homes.length} buildings, pop ${Math.round(gs.stats.pop)}, worst road ${gs.worstRoad().name} at ${Math.round(gs.worstRoad().ratio * 100)}%`);
});

// ------------------------------------------------------------------ phase L: region and scale
test('region: named neighbours per exit, floating prices, goods exports, persistence', () => {
  const { w, s } = grown(90);
  const reg = s.regionList();
  assert(reg.length >= 1 && reg[0].name && reg[0].pop > 10000 && reg[0].connected, 'no neighbour city');
  const mk = s.market(); for (const k of ['goods', 'power', 'water']) assert(mk[k] >= 0.6 && mk[k] <= 1.6, `price out of range: ${k}`);
  const shop = [...w.buildings.values()].find((b) => !b.svc && ZONES[b.zone].kind === 'C'); shop.zone = 4;   // the fixture has no industry
  run(s, 3); assert(s.stats.filled.I > 0 && (s.stats.inc.exports > 0 || s.stats.goods.usedLocal > 0), `industry output unused: ${s.stats.filled.I}`);
  const p0 = reg[0].pop; s.growRegion(); assert(s.regionList()[0].pop > p0, 'neighbour did not grow');
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, s))), { worker: false }).sim;
  assert(back.regionList()[0].pop === s.regionList()[0].pop && back.news.length > 0, 'region/news lost on reload');
  const old = makeSave(w, s); old.v = 6; delete old.sim.ordinances; delete old.sim.region;
  const mig = migrate(JSON.parse(JSON.stringify(old)));
  assert(mig.v === SAVE_VERSION && mig.sim.ordinances && mig.sim.region, 'v6 save did not migrate');
});

test('scale: a map-filling city (every lot built) completes a core pass in time', () => {
  const w = new World(9001); w.newGame();
  for (let x = 60; x <= 460; x += 26) road(w, [x, 40], [x, 470]);
  for (let z = 40; z <= 470; z += 26) road(w, [60, z], [460, z]);
  road(w, [150, 262], [60, 262]);
  const ids = [1, 3, 6, 2, 4, 5];
  let k = 0; for (let x = 73; x < 460; x += 26) for (let z = 53; z < 470; z += 26) { if (!w.water[Math.floor(z) * N + Math.floor(x)]) w.fillZone(x, z, ids[k++ % ids.length]); }
  const s = new Sim(w, { worker: false, sandbox: { instant: true } });
  for (let i = 0; i < w.zone.length; i += 2) if (w.zone[i] && w.free(i) && w.accEdge[i] >= 0) w.placeGrowable((i % N) + 0.5, Math.floor(i / N) + 0.5, 2);
  for (const b of w.buildings.values()) if (!b.svc) { s.capacity(b); b.occ = b.hh; b.workers = (b.jobs || 0) * 0.8; }
  const n = w.buildings.size;
  assert(n > 1200, `synthetic city too small: ${n}`);
  s.dailyTick(); assert(s.stats.employed > 0, 'benchmark city has no commuters');
  const t0 = Date.now(); s.requestCore(0, true, 'bench'); while (s.host.gen) s.host.step(Infinity); const ms = Date.now() - t0;
  console.log(`       ${n} buildings, ${w.net.edges.size} road segments, ${Math.round(s.stats.pop)} people: core pass ${ms} ms (${Math.round(s.stats.modal?.car || 0)} car trips assigned)`);
  assert(ms < 20000, `core pass too slow: ${ms} ms`);
});

// ------------------------------------------------------------------ phase M: sharing
test('share: compressed links round-trip a city', async () => {
  const { w, s } = grown(30);
  const save = makeSave(w, s), code = await encodeSave(save);
  assert(/^[A-Za-z0-9_-]+$/.test(code) && code.length < JSON.stringify(save).length, 'code not compressed/url-safe');
  const back = await decodeSave(code), viaLink = await readShared(`https://example.test/organicity/#city=${code}`);
  assert(JSON.stringify(back) === JSON.stringify(save) && viaLink.v === save.v, 'round trip changed the save');
  const city = loadSave(back, { worker: false });
  assert(city.world.buildings.size === w.buildings.size && city.sim.day === s.day, 'shared city differs');
  assert((await readShared(JSON.stringify(save))).v === save.v, 'plain JSON import failed');
});


test('H: weather holds for thirty days and snow persists after snowfall', () => {
  const a=weatherAt(4242,0);for(let d=1;d<30;d++)assert(weatherAt(4242,d).type===a.type,'weather changed within a regime');
  const w=new World();const sim=new Sim(w,{worker:false,sandbox:{}});sim.weather={type:'snow'};
  for(let d=0;d<10;d++){sim.day=d;hazardTick(sim);}assert(w.hazards.snow>.4,'snow did not accumulate');
  sim.weather={type:'clear'};hazardTick(sim);assert(w.hazards.snow>.3,'snow disappeared immediately');
});
test('H: hills increase construction costs and survive worker snapshots and saves', () => {
  const flat=new World(42),hill=new World(42,'hills');flat.newGame();hill.newGame();
  assert(hill.elevation.some(v=>v>3),'no hills');
  let best=null;
  for(let z=60;z<400;z+=20){const a={x:170,z},b={x:270,z},c={x:220,z};const q=hill.roadCost(a,c,b,'street');if(q.climb>1){best={a,b,c,q};break;}}
  assert(best,'no hillside road');assert(best.q.cost>flat.roadCost(best.a,best.c,best.b,'street').cost,'hills cost no extra');
  hill.buildRoad(hill.net.snap(best.a.x,best.a.z,3),best.c,hill.net.snap(best.b.x,best.b.z,3),'street');
  const e=[...hill.net.edges.values()].find(e=>e.heights.some(v=>v>0));assert(e,'missing profile');
  const agent=new AgentSim();agent.handle({type:'net',net:netSnapshot(hill.net)});
  assert(Math.abs(deckHeight(e,e.len/2)-deckHeight(agent.net.edges.get(e.id),e.len/2))<1e-5,'worker lost elevation');
  const copy=World.load(hill.serialize());assert(copy.mapPreset==='hills'&&copy.heightAt(220,100)===hill.heightAt(220,100),'terrain changed on save');
});
test('H: continuous levees block floodwater, gaps flood and drains reduce depth', () => {
  const w=new World(),sim=new Sim(w,{worker:false,sandbox:{}});for(let z=0;z<N;z++)w.water[z*N]=1;
  w.hazards.surge=2;sim.weather={type:'clear'};
  hazardTick(sim,false);const ci=100*N+10,unprotected=w.flood[ci];assert(unprotected>1,'flood failed to spread');
  for(let z=0;z<N;z++)w.levees[z*N+5]=1;
  hazardTick(sim,false);assert(w.flood[ci]===0,'levee did not block water');
  w.levees[100*N+5]=0;hazardTick(sim,false);assert(w.flood[ci]>0,'levee gap did not leak');
  const before=w.flood[ci];w.buildings.set(1,{id:1,svc:'stormdrain',cx:10,cz:100,edge:0,power:true,water:true});
  hazardTick(sim,false);assert(w.flood[ci]<before,'drain did not reduce flood');
});
test('H: snowplow coverage restores road speed and levees undo and save', () => {
  const w=new World();w.newGame();const sim=new Sim(w,{worker:false,sandbox:{}}),e=[...w.net.edges.values()][0];sim.weather={type:'clear'};w.hazards.snow=1;
  hazardTick(sim,false);const slow=e.hazardSpeed,p=w.net.sampleAt(e,e.len/2),g=w.net.graph();
  w.buildings.set(1,{id:1,svc:'snowdepot',cx:p.x,cz:p.z,edge:e.id,power:true,water:true,comp:g.comp[g.idx.get(e.a)]});hazardTick(sim,false);assert(e.hazardSpeed>slow,'plows did not clear the road');w.buildings.clear();
  w.beginTx('Levee');const n=w.paintLevee(50,50,4,1);w.commitTx(n*12);assert(n>0,'levee placement failed');
  const saved=World.load(w.serialize());assert(saved.levees[50*N+50]===1&&saved.hazards.snow===1,'hazards not saved');w.undo();assert(!w.levees.some(Boolean),'levee undo failed');
});
test('I: independent rail and metro tracks connect disconnected road components', () => {
  const w=new World();road(w,[20,20],[80,20]);road(w,[200,20],[260,20]);const es=[...w.net.edges.values()];
  const stops=[{edge:es[0].id,s:20,x:40,z:20},{edge:es[1].id,s:20,x:220,z:20}];
  assert(!routeLines(w.net,[{id:1,mode:'bus',stops}])[0].ok,'bus crossed disconnected roads');
  for(const mode of ['rail','metro']){const r=routeLines(w.net,[{id:1,mode,stops}])[0];assert(r.ok&&r.track.length===3&&r.len===360,'dedicated track missing');}
});
test('I: modal assignment is capacity limited and modes conserve transit totals', () => {
  const w=new World();road(w,[20,100],[300,100]);const e=[...w.net.edges.values()][0];
  const blds=[{id:1,cx:40,cz:100,edge:e.id,s:20,occ:10000,kind:'R'},{id:2,cx:240,cz:100,edge:e.id,s:220,workers:10000,kind:'O'}];
  for(const mode of ['bus','tram','rail','metro']) {
    const line={id:1,mode,stops:[{x:40,z:100,edge:e.id,s:20},{x:240,z:100,edge:e.id,s:220}]};
    const gen=assignTraffic(w.net,blds,{total:20000,lines:[line],rng:()=>.2});let r;do{r=gen.next();}while(!r.done);const out=r.value;
    assert(out[mode]>0,`${mode} had no riders`);assert(out[mode]<=TRANSIT[mode].capacity+1e-6,'over capacity');assert(out.car>0,'overflow did not drive');
    assert(Math.abs(out.transit-out.bus-out.tram-out.rail-out.metro)<1e-5,'modal total mismatch');
  }
});
test('I: station pruning preserves each mode and saves its mode', () => {
  const w=new World();w.newGame();const a=w.createBuilding({svc:'tramstop',cells:[100*N+100]}),b=w.createBuilding({svc:'tramstop',cells:[110*N+100]});
  w.addLine([a.id,b.id],'Tram','tram');w.pruneLines();assert(w.lines.length===1,'tram stops removed by bus-only pruning');
  const copy=World.load(w.serialize());assert(copy.lines[0].mode==='tram','mode not saved');w.removeBuilding(a.id);w.pruneLines();assert(w.lines.length===0,'broken line retained');
});

test('I: rail transports trips across disconnected streets', () => {
  const w=new World();road(w,[20,100],[100,100]);road(w,[200,100],[280,100]);const es=[...w.net.edges.values()];
  const blds=[{id:1,cx:40,cz:100,edge:es[0].id,s:20,occ:100,kind:'R'},{id:2,cx:220,cz:100,edge:es[1].id,s:20,workers:100,kind:'O'}];
  const gen=assignTraffic(w.net,blds,{total:100,lines:[{id:1,mode:'rail',stops:[{x:40,z:100},{x:220,z:100}]}],rng:()=>.2});let r;do{r=gen.next();}while(!r.done);
  assert(r.value.rail>0&&r.value.car===0,'rail did not bridge disconnected streets');
});
test('H: lightning dispatches a fire and sandbox can suppress damage', () => {
  const make=()=>{const w=new World();w.newGame();const b=w.createBuilding({zone:1,cells:[100*N+100],level:1});const s=new Sim(w,{worker:false,sandbox:{noFires:false}});s.weather={type:'storm'};return{w,b,s};};
  const {w,b,s}=make();for(let d=1;d<=100&&!w.hazards.lightning;d++){s.day=d;hazardTick(s);}assert(w.hazards.lightning&&b.fire,'no lightning fire');
  const other=make();other.s.sandbox.noFires=true;other.s.day=s.day;hazardTick(other.s);assert(other.w.hazards.lightning&&!other.b.fire,'sandbox fire suppression ignored');
});

// ------------------------------------------------------------------ terrain grading and the region
function hillTown(seed = 5151) {
  const w = new World(seed, 'hills'); w.newGame();
  // find a hilly stretch next to the highway end
  road(w, [150, 262], [230, 262]); road(w, [230, 262], [300, 200]); road(w, [230, 262], [300, 330]);
  return w;
}

test('grading: roads get smooth, grade-limited profiles that meet at junctions and sit on levelled ground', () => {
  const w = hillTown();
  let relief = 0; for (let i = 0; i < w.elevation.length; i += 97) relief = Math.max(relief, w.elevation[i]);
  assert(relief > 5, `hills preset is flat: ${relief}`);
  for (const e of w.net.edges.values()) {
    if (e.type === 'highway' && !e.heights) continue;
    assert(e.heights && e.heights.length === e.n + 1, 'edge without a profile');
    for (let k = 1; k <= e.n; k++) { const d = e.cum[k] - e.cum[k - 1]; const J = Math.min(e.hw + 3, e.len / 4), g = Math.max(0.09, 1.02 * Math.abs(e.heights[e.n] - e.heights[0]) / Math.max(1, e.len - 2 * J)); assert(Math.abs(e.heights[k] - e.heights[k - 1]) <= g * d + 1e-6, `too steep on edge ${e.id} at ${k}`); }
    for (let k = 0; k <= e.n; k += 2) { const got = w.heightAt(e.pts[2 * k], e.pts[2 * k + 1]); assert(Math.abs(got - e.heights[k]) < 0.6, `ground not levelled under edge ${e.id}: ${got.toFixed(2)} vs ${e.heights[k].toFixed(2)}`); }
  }
  for (const n of w.net.nodes.values()) {
    const ends = [...n.edges].map((id) => { const e = w.net.edges.get(id); return e.a === n.id ? e.heights[0] : e.heights[e.n]; });
    assert(ends.every((h) => Math.abs(h - ends[0]) < 1e-6), `junction ${n.id} heights differ: ${ends}`);
  }
});

test('grading: buildings sit on flat pads; grading replays identically on load', () => {
  const w = hillTown(); const s = new Sim(w, { worker: false, sandbox: { instant: true } });
  for (const [x, z, id] of [[190, 250, 1], [260, 250, 3], [265, 290, 1]]) w.fillZone(x, z, id);
  for (let i = 0; i < w.zone.length; i += 5) if (w.zone[i] && w.free(i) && w.accEdge[i] >= 0) w.placeGrowable((i % N) + 0.5, Math.floor(i / N) + 0.5, 1);
  const blds = [...w.buildings.values()].filter((b) => !b.svc);
  assert(blds.length > 5, 'no buildings on the hill');
  for (const b of blds) {
    for (const c of b.cells) if (!w.water[c]) assert(Math.abs(w.elevation[c] - b.pad) < 1e-4, `lot ${b.id} not flat: cell ${c} ${w.elevation[c].toFixed(2)} vs ${b.pad.toFixed(2)}, road ${w.road[c]}`);
    assert(Math.abs(b.baseY - b.pad) < 1e-4, 'building not on its pad');
  }
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, s))), { worker: false }).world;
  let diff = 0; for (let i = 0; i < w.elevation.length; i++) diff = Math.max(diff, Math.abs(back.elevation[i] - w.elevation[i]));
  assert(diff < 0.5, `grading changed on reload by ${diff.toFixed(2)}`);
  for (const b of blds) assert(Math.abs(back.buildings.get(b.id).baseY - b.baseY) < 0.5, 'pad moved on reload');
});

test('region: AI neighbours beyond exits, buying adjacent tiles, partners share commuters', () => {
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: { instant: true } }); run(s, 60);
  const r = createRegion(w, s), home = r.tiles[r.active];
  assert(r.size === 5 && home.kind === 'city' && home.owned && home.seed === w.seed, 'home tile wrong');
  const exit = [...w.net.nodes.values()].find((n) => n.outside), [dx, dz] = exitDir(exit), west = r.tiles[`${home.x + dx},${home.z + dz}`];
  assert(west.kind === 'ai' && west.name === s.regionList()[0].name, 'exit neighbour not on its tile');
  assert(Object.values(r.tiles).filter((t) => t.kind === 'ai').length >= 4, 'too few AI cities');
  const adj = tileNeighbours(r, r.active).find((q) => q.t.kind === 'wild').t, far = r.tiles['0,0'];
  assert(canBuy(r, `${adj.x},${adj.z}`) && !canBuy(r, '0,0') || far.kind !== 'wild', 'buying rules wrong');
  const c1 = tileCost(r); adj.owned = true; assert(tileCost(r) > c1, 'tiles do not get dearer');
  Object.assign(adj, { kind: 'city', name: 'Northgate', summary: { pop: 3000, jobsFree: 800, unemployed: 400 } });
  const partners = partnersOf(r, r.active);
  assert(partners.length === 1 && partners[0].name === 'Northgate', 'partner city missing');
  const base = { ...s.stats }; s.partnerCities = partners; run(s, 3);
  assert(s.regionList().some((q) => q.player && q.name === 'Northgate'), 'partner not in the region list');
  assert(s.stats.outJobs > base.outJobs * 0.99 + 1, `no jobs in the partner city: ${s.stats.outJobs} vs ${base.outJobs}`);
});

// ------------------------------------------------------------------ phase K: disasters and events
test('disasters: quakes wreck, rubble is cleared and rebuilt lower, and it all saves', () => {
  const { w, s } = grown(120);
  const homes = [...w.buildings.values()].filter((b) => !b.svc), c = homes[0];
  for (const b of homes) b.level = Math.max(b.level, 2);
  const n = quake(s, c.cx, c.cz, 7.2);
  const ruins = homes.filter((b) => b.rubble > 0);
  assert(n > 0 && ruins.length === n && s.shock > 0, `quake did nothing: ${n}`);
  const r = ruins[0]; s.capacity(r); assert(r.occ === 0 && (r.hh === 0 || r.occ === 0), 'rubble still occupied');
  s.evalBuilding(r); assert(r.prob & PROB.rubble, 'rubble not flagged');
  assert(s.advisors().some((a) => a.who === 'Emergency'), 'no emergency advisor');
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, s))), { worker: false });
  assert(back.world.buildings.get(r.id).rubble === r.rubble && back.sim.shock === s.shock, 'rubble lost on reload');
  const lvl = r.level; s.sandbox.instant = false;
  for (let d = 0; d < 60 && r.rubble > 0; d++) disasterTick(s), s.day++;
  assert(!r.rubble && r.level === Math.max(1, lvl - 1) && r.constructionUntil > 0, `not rebuilt: rubble ${r.rubble}, level ${r.level}/${lvl}`);
});

test('disasters: tornado track, industrial spill, festival income', () => {
  const { w, s } = grown(120);
  const c = [...w.buildings.values()].find((b) => !b.svc);
  let trees = 0; for (const t of w.tree) trees += t;
  const n = tornado(s, c.cx, c.cz, 0.3);
  let after = 0; for (const t of w.tree) after += t;
  assert(n > 0 && after < trees && s.tornado, `tornado missed: ${n}, trees ${trees}→${after}`);
  const shop = [...w.buildings.values()].find((b) => !b.svc && ZONES[b.zone].kind === 'C' && !b.rubble); shop.zone = 4;
  run(s, 2); const polBefore = s.at(s.f.pollution, shop.cx, shop.cz);
  assert(accident(s, shop) && shop.spill > 0 && shop.fire > 0, 'no accident');
  run(s, 6); assert(s.at(s.f.pollution, shop.cx, shop.cz) > polBefore, 'spill did not raise pollution');
  const put = (k, x, z) => { for (let d = 0; d < 60; d += 3) for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) { const p = w.planService(k, x + dx, z + dz); if (p.ok) return w.placeService(k, p); } return null; };
  const park = put('parkL', 200, 300); assert(park, 'no park for the festival');
  run(s, 1); const base = s.stats.inc.tourism;
  assert(festival(s, park) && s.event.venue === park.id, 'festival not held');
  run(s, 1); assert(s.stats.inc.tourism > base, 'festival earned nothing');
  run(s, 5); assert(!s.event, 'festival never ended');
});

test('disasters: seeded schedule, sandbox switch', () => {
  const rate = DISASTERS.quake.rate; DISASTERS.quake.rate = 1;
  try {
    const a = grown(90), b = grown(90);
    a.s.sandbox.noDisasters = true; a.s.stats.pop = 900; disasterTick(a.s);
    assert(![...a.w.buildings.values()].some((x) => x.rubble), 'sandbox switch ignored');
    for (const x of [a, b]) { x.s.sandbox.noDisasters = false; x.s.stats.pop = 900; disasterTick(x.s); }
    const ra = [...a.w.buildings.values()].filter((x) => x.rubble).map((x) => x.id).join(), rb = [...b.w.buildings.values()].filter((x) => x.rubble).map((x) => x.id).join();
    assert(ra && ra === rb, `not deterministic: ${ra} vs ${rb}`);
  } finally { DISASTERS.quake.rate = rate; }
});

// ------------------------------------------------------------------ N: connected region
test('region edges: a new tile continues its neighbour\'s coast and hills, and keeps it on reload', () => {
  const a = new World(777, 'hills'); a.newGame();
  const east = edgeProfile(a, 'east');
  const b = new World(888, 'coast'); b.edgeMatch = { west: east }; b.newGame();
  let wet = 0, dh = 0;
  for (let k = 0; k < 128; k++) { const z = Math.floor(k * 4 + 2), i = z * N; if (b.water[i] === east[2 * k]) wet++; if (!b.water[i]) dh = Math.max(dh, Math.abs(b.elevation[i] - east[2 * k + 1])); }
  assert(wet >= 120 && dh < 1.5, `edge not matched: water ${wet}/128, height gap ${dh.toFixed(2)}`);
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(b, new Sim(b, { worker: false })))), { worker: false }).world;
  assert(back.edgeMatch && Math.abs(back.elevation[100 * N] - b.elevation[100 * N]) < 1e-6, 'edge match lost on reload');
});

test('region roads: roads to the map edge become exits, stubs face the neighbour, trips use the right exit', () => {
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: { instant: true } });
  road(w, [205, 195], [205, 0.5]);
  const north = [...w.net.nodes.values()].find((n) => n.outside && n.z < 3);
  assert(north && exitsOf(w).some((x) => x.side === 'north'), 'road to the edge is not an exit');
  const r = createRegion(w, s), up = r.tiles[`${r.tiles[r.active].x},${r.tiles[r.active].z - 1}`];
  Object.assign(up, { kind: 'city', owned: true, name: 'Northgate', summary: { pop: 3000, jobsFree: 800, unemployed: 300, exits: [{ side: 'south', pos: 205 }] } });
  const stubs = stubsFor(r, `${up.x},${up.z + 1}`);
  assert(stubs.length === 1 && stubs[0].side === 'north' && stubs[0].pos === 205, 'no stub facing the neighbour');
  s.partnerCities = partnersOf(r, r.active); s.tileNeighbours = { north: { name: 'Northgate', pop: 3000, kind: 'city', key: `${up.x},${up.z}` } };
  run(s, 40);
  assert(s.exitLoad?.get(north.id) > 0, `no regional trips through the north exit: ${JSON.stringify([...(s.exitLoad || [])])}`);
  s.deals = [{ id: 1, role: 'sell', partner: `${up.x},${up.z}`, kind: 'power', amount: 5, price: 15 }];
  run(s, 3);
  const row = s.dealFlow.rows[0];
  assert(row.linked && row.delivered > 0 && s.stats.inc.deals > 0, `deal not running: ${JSON.stringify(row)}`);
});

test('region AI: neighbours grow with trade and shrink under competition', () => {
  const { w } = town(); const s = new Sim(w, { worker: false });
  const r1 = createRegion(w, s), r2 = JSON.parse(JSON.stringify(r1));
  evolveAI(r1, 0, true, 0); evolveAI(r1, 3600, true, 0);
  evolveAI(r2, 0, false, 5e6); evolveAI(r2, 3600, false, 5e6);
  const ai1 = Object.values(r1.tiles).filter((t) => t.kind === 'ai'), ai2 = Object.values(r2.tiles).filter((t) => t.kind === 'ai');
  assert(ai1.every((t, i) => t.pop > ai2[i].pop), 'competition did not shrink neighbours');
});

// ------------------------------------------------------------------ O: terrain tools
test('terraforming: raise, level and undo; roads and lots stay put', () => {
  const { w } = town();
  const i = 230 * N + 150, before = w.elevation[i], roadCell = w.road.findIndex((v) => v), roadH = w.elevation[roadCell];
  w.beginTx('Terrain'); const vol = w.terraform(150.5, 230.5, 6, 'raise'); w.terraform(150.5, 230.5, 6, 'raise'); w.commitTx();
  assert(vol > 0 && w.elevation[i] > before, 'raise did nothing');
  w.terraform((roadCell % N) + 0.5, Math.floor(roadCell / N) + 0.5, 4, 'raise');
  assert(w.elevation[roadCell] === roadH, 'terraformed under a road');
  w.undo(); assert(Math.abs(w.elevation[i] - before) < 1e-6, 'undo did not restore the ground');
  for (let k = 0; k < 6; k++) w.terraform(150.5, 230.5, 6, 'level', 3); assert(Math.abs(w.elevation[i] - 3) < 0.5, 'level did not reach its target');
});

test('steep roads bore tunnels through hills and cross valleys on viaducts', () => {
  const w = new World(4242, 'river'); w.newGame();
  for (let z = 70; z < 130; z++) for (let x = 40; x < 170; x++) { const i = z * N + x; w.water[i] = 0; w.elevation[i] = 30 * Math.exp(-((x - 100) ** 2) / 120); }
  road(w, [50, 100], [150, 100]);
  const hill = [...w.net.edges.values()].find((e) => e.type === 'street');
  assert(hill.struct && hill.struct.includes(-1), 'no tunnel through the hill');
  assert(w.elevation[100 * N + 100] > 25, 'the hill was dug away');
  const v = new World(4242, 'river'); v.newGame();
  for (let z = 70; z < 130; z++) for (let x = 40; x < 170; x++) { const i = z * N + x; v.water[i] = 0; v.elevation[i] = Math.abs(x - 100) < 14 ? 0 : 30; }
  road(v, [50, 100], [150, 100]);
  const gap = [...v.net.edges.values()].find((e) => e.type === 'street');
  assert(gap.struct && gap.struct.includes(1) && v.elevation[100 * N + 100] < 1, 'no viaduct over the valley');
});

// ------------------------------------------------------------------ P: transit and freight
test('transit: headways set capacity; transfers join two lines', () => {
  assert(lineCapacity({ mode: 'bus', headway: 5 }) === 2 * lineCapacity({ mode: 'bus', headway: 10 }) && headway({}) === 10, 'headway capacity wrong');
  const c = corridor();
  const lines = [
    { id: 1, mode: 'bus', headway: 10, stops: [{ x: -20, z: 5, edge: c.home.id, s: 10 }, { x: 100, z: 0, edge: c.direct.id, s: 100 }] },
    { id: 2, mode: 'bus', headway: 10, stops: [{ x: 110, z: 0, edge: c.direct.id, s: 110 }, { x: 220, z: 5, edge: c.work.id, s: 10 }] },
  ];
  const out = drain(assignTraffic(c.net, c.blds, { total: 300, rng: () => 1, lines }));
  assert(out.transfers > 0 && out.riders.get(1) > 0 && out.riders.get(2) > 0, `no transfers: ${out.transfers}`);
});

test('freight: terminals take trucks off the highway; goods supply the shops', () => {
  const { w, s } = grown(90);
  let placed = null; for (let d = 0; d < 80 && !placed; d += 3) for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) { const p = w.planService('cargorail', 200 + dx, 300 + dz); if (p.ok) { placed = w.placeService('cargorail', p); break; } }
  assert(placed, 'could not place a cargo terminal');
  const shop = [...w.buildings.values()].find((b) => !b.svc && ZONES[b.zone].kind === 'C'); shop.zone = 4;
  run(s, 30);
  assert(s.terminals().length === 1 && s.stats.goods.termCap > 0, 'terminal not active');
  assert(s.terminalLoad?.get(placed.id) > 0, 'no freight at the terminal');
  assert(s.stats.goods.supply >= 0 && s.stats.goods.supply <= 1 && s.stats.goods.demand > 0, 'goods chain missing');
});

// ------------------------------------------------------------------ Q: economy
test('bonds and credit: ratings price debt; coupons, maturity and redemption', () => {
  const { w } = town(); const s = new Sim(w, { worker: false }); run(s, 40);
  s.stats.incomeM = 20000;
  const r0 = s.creditRating(); assert(r0.grade === 'AAA', `clean city not AAA: ${JSON.stringify(r0)}`);
  assert(s.issueBond(250000, 10) && s.bonds.length === 1, 'bond refused');
  const r1 = s.creditRating(); assert(r1.score < r0.score && r1.rate >= r0.rate, 'debt did not lower the rating');
  const coupon = s.bondTick(); assert(Math.abs(coupon - 250000 * s.bonds[0].rate / 360) < 1e-6, 'coupon wrong');
  s.day = s.bonds[0].due; const m = s.money; s.bondTick(); assert(!s.bonds.length && s.money === m - 250000, 'maturity not repaid');
  s.issueBond(25000, 20); s.money = 100000; assert(s.redeemBond(s.bonds[0].id) && Math.abs(s.money - (100000 - 25500)) < 1e-6, 'early redemption premium wrong');
  const back = loadSave(JSON.parse(JSON.stringify(makeSave(w, s))), { worker: false }).sim; assert(back.bondId === s.bondId, 'bonds lost on reload');
});

test('insurance pays claims; preparedness limits damage; land tax and gentrification', () => {
  const a = grown(120), b = grown(120);
  for (const x of [a, b]) for (const q of x.w.buildings.values()) if (!q.svc) q.level = Math.max(q.level, 2);
  const c = [...a.w.buildings.values()].find((q) => !q.svc);
  a.s.sandbox.infinite = false; a.s.insurance = true; const m0 = a.s.money;
  const na = quake(a.s, c.cx, c.cz, 7.4);
  b.s.preparedness = 1.5; const nb = quake(b.s, c.cx, c.cz, 7.4);
  assert(na > 0 && a.s.claims > 0 && a.s.money > m0, 'insurance paid nothing');
  assert(nb < na, `preparedness did not help: ${nb} vs ${na}`);
  a.s.landTax = 2; run(a.s, 2); assert(a.s.stats.inc.land > 0 && a.s.stats.exp.insurance > 0, 'land tax or premium missing');
  const g = grown(60);
  const homes = [...g.w.buildings.values()].filter((q) => q.hh && q.level <= 2 && !q.rubble);
  for (const h of homes) { h.lv = 0.95; h.built = g.s.day - 2000; }
  g.s.rng = () => 0; g.s.gentrify();
  assert(g.s.stats.gentrified > 0 && g.s.stats.displaced >= 0 && homes.some((h) => h.level > 2 || h.constructionUntil > g.s.day), 'no gentrification');
});

// ------------------------------------------------------------------ R: simulation fidelity
test('weather fronts: rain bands move across the tile; only roads under them slow down', () => {
  const w = { ...weatherAt(5, 40, 'rain') }, xs = [];
  for (let x = 0; x < 512; x += 64) xs.push(frontAt(w, x, x, 3.2));
  assert(Math.max(...xs) > 0.8 && Math.min(...xs) < 0.3, `no band: ${xs.map((v) => v.toFixed(2))}`);
  assert(frontAt({ ...w, type: 'clear' }, 100, 100, 1) === 0 && frontAt({ ...w, type: 'fog' }, 100, 100, 1) === 1, 'clear/fog wrong');
  const a = frontAt(w, 256, 256, 3.0), b = frontAt(w, 256, 256, 3.4); assert(Math.abs(a - b) > 0.01, 'front does not move');
  const c = corridor(); for (const e of c.net.edges.values()) e.wet = 0; c.direct.wet = 1;
  updateCosts(c.net, 0.5);
  assert(c.direct.speedF < c.home.speedF * 0.8, 'wet road not slower than dry');
});

test('pluvial ponding collects rain in hollows; storms are forecast with a warning', () => {
  const { w, s } = grown(30);
  let hx = -1; for (let i = 200 * N + 150; i < 240 * N; i++) if (!w.water[i] && !w.road[i] && !w.bld[i] && w.wdist[i] > 20) { hx = i; break; }
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) { const i = hx + dz * N + dx; if (!w.water[i]) w.elevation[i] = 2 + Math.hypot(dx, dz) * 0.4; }
  w.elevation[hx] = 0.5;
  s.weather = { ...weatherAt(w.seed, s.day, 'storm') }; s.weather.front = null;   // uniform storm
  for (let k = 0; k < 4; k++) pond(w, s);
  assert(w.pond[hx] > 0.2 && w.pond[hx] > w.pond[hx + 5 * N] * 2, `no ponding in the hollow: ${w.pond[hx]}`);
  let warned = false; s.sandbox.noDisasters = false;
  for (let d = 0; d < 400 && !warned; d++) { s.day = d; s.weather = weatherAt(w.seed, d); s.surgeWarning = null; s.messages.length = 0; s.msgAt = {}; s.surgeForecast(); warned = s.messages.some((m) => m.text.startsWith('Storm warning')); if (warned) assert(weatherAt(w.seed, d + 3).type === 'storm', 'warned for no storm'); }
  assert(warned, 'no storm warning in 400 days');
});

test('following a resident: a stable person with an age group and a way to work', () => {
  const { w, s } = grown(60);
  const home = [...w.buildings.values()].find((b) => b.hh && b.occ);
  const a = s.citizenOf(home, 0), b = s.citizenOf(home, 0), c = s.citizenOf(home, 1);
  assert(a.name === b.name && a.age === b.age && /\w+ \w+/.test(a.name), 'citizen not stable');
  assert(['child', 'adult', 'retiree'].includes(a.cohort) && ['car', 'transit', 'walk', 'bike'].includes(a.mode) && a.depart >= 7 && a.back >= 16.5, 'citizen fields wrong');
  assert(c.name !== a.name || c.age !== a.age, 'next resident identical');
});

// ------------------------------------------------------------------ S: platform
test('platform: offline app files, content packs (sanitised, saved with the city), languages', () => {
  const root = new URL('../organicity/', import.meta.url);
  const man = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert(man.display === 'standalone' && man.icons.length && existsSync(new URL('sw.js', root)) && existsSync(new URL('icon.svg', root)), 'PWA files missing');
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  for (const f of ['js/packs.js', 'js/i18n.js', 'js/region.js']) assert(sw.includes(f.replace('js/', '').replace('.js', '')), `service worker misses ${f}`);
  const pack = JSON.parse(readFileSync(new URL('packs/sample-pack.json', root), 'utf8'));
  const info = registerPack(pack);
  assert(info.styles.length === 2 && info.landmarks.length === 2 && SERVICES.pk_lighthouse?.model.length === 5, 'sample pack not registered');
  const evil = landmarkDef({ name: '<img src=x onerror=alert(1)>', w: 1e9, model: [{ h: -5, color: 'red' }] }, 'x', 'pk_evil');
  assert(!/[<>]/.test(evil.name) && evil.w === 40 && evil.model[0].h === 0.1 && evil.model[0].color === 0x999999, 'pack not sanitised');
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: {} });
  let lh = null; for (let d = 0; d < 80 && !lh; d += 3) for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) { const p = w.planService('pk_lighthouse', 200 + dx, 300 + dz); if (p.ok) { lh = w.placeService('pk_lighthouse', p); break; } }
  assert(lh && lh.svc === 'pk_lighthouse' && SERVICES.pk_lighthouse.model.some((m) => m.y + m.h > 15), 'pack landmark not built');
  const save = JSON.parse(JSON.stringify(makeSave(w, s))); delete SERVICES.pk_lighthouse;
  const back = loadSave(save, { worker: false });
  assert(back.world.buildings.get(lh.id) && SERVICES.pk_lighthouse, 'city with a pack landmark did not load without the pack');
  for (const l of ['en', 'hu', 'de']) assert(Object.keys(STRINGS[l]).length === Object.keys(STRINGS.en).length, `${l} strings incomplete`);
  assert(tr('no.such.key', 'fallback') === 'fallback', 'translation fallback wrong');
});

// ------------------------------------------------------------------ T: deeper region play
test('region in the background: neighbours keep growing; deals only deliver spare supply', () => {
  const r = { tiles: { '2,2': { kind: 'city', summary: { pop: 1000 } }, '2,1': { kind: 'city', summary: { pop: 2000, growth: 0.02, jobsFree: 100, unemployed: 50, surplus: { power: 40, water: 60 } } } } };
  for (let m = 0; m < 12; m++) backgroundMonth(r, '2,2');
  const nb = r.tiles['2,1'].summary;
  assert(nb.pop > 2400 && nb.surplus.power < 40 && r.tiles['2,2'].summary.pop === 1000, `background growth wrong: ${JSON.stringify(nb)}`);
  const { w } = town(); const s = new Sim(w, { worker: false, sandbox: { instant: true } });
  road(w, [205, 195], [205, 0.5]);
  s.tileNeighbours = { north: { name: 'Northgate', pop: 3000, kind: 'city', key: '2,1' } };
  s.partnerCities = [{ key: '2,1', dir: 'north', name: 'Northgate', pop: 3000, jobsFree: 0, unemployed: 0, surplus: { power: 4, water: 0 }, services: ['university'] }];
  s.deals = [{ id: 1, role: 'buy', partner: '2,1', kind: 'power', amount: 20, price: 15 }];
  run(s, 30);
  const row = s.dealFlow.rows[0];
  assert(row.linked && Math.abs(row.delivered - 4) < 1e-6, `buyer got more than the seller had: ${row.delivered}`);
  assert(s.shared('university') && !s.shared('airport') && s.stats.hiSeats >= SERVICES.university.seats / 2, 'shared university not used');
});

test('region edges: an older city eases its edge toward a newer neighbour', () => {
  const w = new World(3131, 'hills'); w.newGame();
  const prof = []; for (let k = 0; k < 128; k++) prof.push(0, 20);
  const i = 200 * N + 511, before = w.elevation[i];
  const n = w.blendEdge('east', prof);
  assert(w.water[i] || (n > 0 && Math.abs(w.elevation[i] - 20) < Math.abs(before - 20)), 'edge not eased');
  assert(w.blendEdge('east', prof) <= n, 'blending does not settle');
});

test('transit: journeys with several transfers; peak and off-peak timetables', () => {
  const L = (id, pts, hw = 10, off = 30) => ({ id, mode: 'bus', headway: hw, offpeak: off, stops: pts.map(([x, z]) => ({ x, z })) });
  const lines = [L(1, [[0, 0], [100, 0]]), L(2, [[110, 0], [210, 0]]), L(3, [[220, 0], [320, 0]])];
  const G = transitGraph(lines, 'peak'), S = transitSearch(G, { x: 0, z: 5 });
  const j = transitTo(G, S, { x: 320, z: 5 });
  assert(j && j.transfers === 2 && j.lines.map((l) => l.id).join() === '1,2,3', `no two-transfer journey: ${j && j.lines.map((l) => l.id)}`);
  const off = transitTo(transitGraph(lines, 'off'), transitSearch(transitGraph(lines, 'off'), { x: 0, z: 5 }), { x: 320, z: 5 });
  assert(off.time > j.time && lineCapacity(lines[0], 'off') < lineCapacity(lines[0], 'peak'), 'off-peak not slower/smaller');
  assert(!transitTo(G, transitSearch(G, { x: 0, z: 5 }, new Set([2])), { x: 320, z: 5 }), 'full line still used');
});

// ------------------------------------------------------------------ the regional economy
// Organicity (grown, with a north exit) next to a city of yours with housing, jobs and a matching exit, plus AI cities
function econFixture({ northJobs = 60, northQuality = 0.7, northToll = 2, northKind = 'O', northLevel = 4 } = {}) {
  const { w, s } = grown(60);
  road(w, [205, 195], [205, 0.5]);
  run(s, 2);
  const r = createRegion(w, s), home = r.tiles[r.active], up = r.tiles[`${home.x},${home.z - 1}`], upKey = `${up.x},${up.z}`;
  Object.assign(up, { kind: 'city', owned: true, name: 'Northgate', summary: { pop: 800, exits: [{ side: 'south', pos: 205 }] } });
  r.econ = { tiles: { [upKey]: { policy: { toll: northToll }, housing: Array.from({ length: 10 }, (_, i) => [i + 1, 30, 10, northQuality, 100 + i * 30, 400, 0.7, 0.05, 0.05, 0.8]), jobs: Array.from({ length: 6 }, (_, i) => [i + 1, northJobs, 0, northKind, northLevel, 200 + i * 20, 470]) } }, families: [], nextFamily: 1, history: {}, terms: [], termStart: null, lastYear: null };
  const econ = new RegionSim(r).attach(s, w, r.active);
  return { w, s, r, econ, upKey, homeKey: r.active };
}

test('economy 1 — portals: exits pair across tiles; AI cities accept any exit; unmatched exits are dead ends', () => {
  const { w, econ, upKey, homeKey } = econFixture();
  const north = econ.portals.find((p) => p.tile === homeKey && p.to === upKey);
  assert(north && north.node != null && w.net.nodes.get(north.node)?.outside, 'north exit is not a portal on its node');
  assert(econ.portals.some((p) => p.tile === upKey && p.to === homeKey), 'no portal back');
  const west = econ.portals.find((p) => p.tile === homeKey && econ.tile(p.to).kind === 'ai');
  assert(west, 'highway exit not linked to the AI neighbour');
  assert(econ.reach.get(homeKey).includes(upKey), 'linked neighbour not reachable');
  const r2 = econFixture(); r2.r.tiles[r2.upKey].summary.exits = [{ side: 'south', pos: 60 }]; r2.econ.buildPortals();
  assert(!r2.econ.portals.some((p) => p.tile === r2.homeKey && p.to === r2.upKey) && !r2.econ.reach.get(r2.homeKey).includes(r2.upKey), 'unmatched exits linked');
});

test('economy 2 — families: one per occupied home, reconciled with the city, with a budget', () => {
  const { w, s, econ, homeKey } = econFixture();
  const occ = [...w.buildings.values()].filter((b) => b.hh > 0 && !b.svc).reduce((t, b) => t + Math.round(b.occ || 0), 0);
  const fam = [...econ.families.values()].filter((f) => f.tile === homeKey);
  assert(fam.length === occ && occ > 0, `families ${fam.length} vs occupied homes ${occ}`);
  econ.month(s);
  const f = [...econ.families.values()].find((q) => q.tile === homeKey);
  assert(f.income > 0 && f.rent > 0 && f.size >= 1 && f.size <= 5 && f.happy >= 0 && f.happy <= 1, `family budget missing: ${JSON.stringify(f)}`);
  assert([...econ.families.values()].filter((q) => q.tile === homeKey).some((q) => q.wt != null), 'nobody found work');
});

test('economy 3 — housing and rent: quality, tight markets and the rent target set rents; families weigh them', () => {
  assert(rentOf(0.9, 0.9) > rentOf(0.3, 0.9) && rentOf(0.5, 0.98) > rentOf(0.5, 0.5) && rentOf(0.5, 0.9, 0.7) < rentOf(0.5, 0.9, 1), 'rent rules wrong');
  assert(salaryOf('O', 4) > salaryOf('C', 1) && salaryOf('C', 2, 0.4) > salaryOf('C', 2, 1), 'salary rules wrong');
  const ctx = { portal: () => null, toll: () => 0 }, fam = newFamily(1, 'a', 1, 1, { size: 3, earners: 1 }), job = { salary: 2600, x: 0, z: 0 };
  const home = (o) => ({ rent: 900, quality: 0.5, services: 0.5, appeal: 0.5, pollution: 0.1, crime: 0.1, x: 10, z: 0, ...o });
  const u = (o) => famUtility(ctx, fam, 'a', home(o), 'a', job);
  assert(u({ rent: 700 }) > u({}) && u({ quality: 0.9 }) > u({}) && u({ pollution: 0.8 }) < u({}) && u({ crime: 0.8 }) < u({}) && u({ x: 400 }) < u({}), 'utility ignores a factor');
});

test('economy 4 — migration: a clearly better tile wins, within thresholds, costs and cooldowns', () => {
  const { s, econ, upKey, homeKey } = econFixture({ northQuality: 0.95, northJobs: 200 });
  for (let m = 0; m < 14; m++) { s.day += 30; econ.month(s); }
  const north = [...econ.families.values()].filter((f) => f.tile === upKey);
  assert(north.length > 0 && econ.tile(upKey).acc.migIn + (econ.e.history[upKey]?.reduce((t, r) => t + r.migIn, 0) || 0) > 0, 'nobody moved to the better tile');
  const mover = north.find((f) => f.moved > 0);
  assert(!mover || s.day - mover.moved < 420, 'mover timestamp missing');
  // a family that just moved does not move again at once
  if (mover) { mover.next = s.day; const d = reconsider(econ.ctx(), mover); assert(!d || s.day - mover.moved >= 360, 'moved again inside the cooldown'); }
  const poor = [...econ.families.values()].find((f) => f.tile === homeKey); if (poor) { poor.savings = 0; poor.moved = -9999; assert(!reconsider(econ.ctx(), poor), 'moved without money for the move'); }
});

test('economy 5 — tolls: charged on entry, paid to the entered tile, and they deter commuters', () => {
  // jobs next door paying about what local jobs pay: the toll decides
  const cheap = econFixture({ northJobs: 200, northToll: 0, northKind: 'O', northLevel: 2 }), dear = econFixture({ northJobs: 200, northToll: 20, northKind: 'O', northLevel: 2 });
  for (const x of [cheap, dear]) for (let m = 0; m < 6; m++) { x.s.day += 30; x.econ.month(x.s); }
  const commuters = (x) => [...x.econ.families.values()].filter((f) => f.tile === x.homeKey && f.wt === x.upKey).length;
  assert(commuters(cheap) > commuters(dear), `toll did not deter commuting: ${commuters(cheap)} vs ${commuters(dear)}`);
  const mid = econFixture({ northJobs: 200 }); for (let m = 0; m < 3; m++) { mid.s.day += 30; mid.econ.month(mid.s); }
  assert(commuters(mid) > 0 && mid.econ.tile(mid.upKey).acc.tolls > 0 && mid.econ.tile(mid.homeKey).acc.tolls > 0, 'tolls not paid to the tile entered (to work, and home again)');
  assert(mid.s.tollIncome > 0, 'the played city receives no toll income');
  assert(cheap.econ.tile(cheap.upKey).acc.tolls === 0 || cheap.econ.tile(cheap.upKey).policy.toll > 0, 'toll-free tile collected tolls');
  assert(cheap.s.tollIncome >= 0 && cheap.s.stats.inc.tolls !== undefined, 'played city has no toll income line');
});

test('economy 6 — presidents: one policy object drives the played city and the region model', () => {
  const { s, econ, homeKey } = econFixture();
  econ.setPolicy(homeKey, { tax: 14, services: 1.3, infra: 0.6, dev: 'industry', rentTarget: 0.8, toll: 7 });
  assert(s.tax.R === 14 && s.tax.I === 12 && s.infra === 0.6 && s.devPriority === 'I', `policy not applied: ${JSON.stringify(s.tax)}`);
  assert([...s.w.buildings.values()].filter((b) => b.svc).every((b) => s.budgetFor(b.svc) === 1.3), 'service funding not applied');
  econ.month(s);
  assert(econ.ctx().toll(homeKey) === 7 && [...econ.tile(homeKey).housing.values()].every((h) => h.rent === rentOf(h.quality, econ.tile(homeKey).occ / Math.max(1, econ.tile(homeKey).units), 0.8)), 'rent target or toll not in force');
  assert(clampPolicy({ tax: 99, toll: 0 }).tax === 20 && clampPolicy({ toll: 0 }).toll === 0, 'policy limits wrong');
});

test('economy 7 — AI presidents: deterministic, and their priorities lead to different policies', () => {
  const st = { pop: 50000, units: 20000, occ: 19000, jobs: 22000, filled: 18000, baseRent: 1400, income: 2600, salary: 2200, crossings: 3000, appeal: 0.5, unemp: 0.12, treasury: 1e6 };
  const base = clampPolicy({});
  const pick = (priority) => { let p = base; for (let y = 0; y < 8; y++) p = aiDecide(st, { priority }, p); return p; };
  const a = pick('treasury'), b = pick('affordability'), c = pick('growth');
  assert(JSON.stringify(pick('treasury')) === JSON.stringify(a), 'not deterministic');
  assert(a.tax > c.tax || a.toll > c.toll, `treasury president no greedier than growth: ${JSON.stringify(a)} vs ${JSON.stringify(c)}`);
  assert(b.rentTarget < a.rentTarget, 'affordability president did not cut rents');
  const broke = aiDecide({ ...st, treasury: -1e6 }, { priority: 'growth' }, base), rich = aiDecide(st, { priority: 'growth' }, base);
  assert(predict(st, broke).treasury >= predict(st, rich).treasury, 'broke president ignored the budget');
});

test('economy 8 — simulation levels: the played tile full, neighbours near, the rest far', () => {
  const { s, econ, upKey, homeKey } = econFixture();
  assert(econ.tile(homeKey).level === 'full' && econ.tile(upKey).level === 'near', 'levels wrong');
  const far = [...econ.tiles.values()].find((t) => t.level === 'far');
  assert(far, 'no far tile');
  const f = newFamily(econ.e.nextFamily++, far.key, [...far.housing.keys()][0] ?? 1, 1, { next: 0 }); econ.families.set(f.id, f);
  const before = JSON.stringify(f); econ.month(s);
  assert(!econ.families.has(f.id) || JSON.stringify(econ.families.get(f.id)) === before || far.kind === 'ai', 'far-tile family was simulated in detail');
});

test('economy 9 — regional migration: AI cities send families to a better tile of yours, through the portal', () => {
  const { s, econ, homeKey } = econFixture();
  const ai = econ.reach.get(homeKey).map((k) => econ.tile(k)).find((t) => t.kind === 'ai');
  for (const h of ai.housing.values()) { h.quality = 0.05; h.pollution = 0.9; h.crime = 0.9; }
  for (const j of ai.jobs.values()) j.slots = j.filled;   // no work there
  for (const b of s.w.buildings.values()) if (b.hh > 1) b.occ = Math.floor(b.hh / 2);   // homes to move into
  const occ0 = [...ai.housing.values()].reduce((t, h) => t + h.occ, 0), fam0 = [...econ.families.values()].filter((f) => f.tile === homeKey).length;
  for (let m = 0; m < 4; m++) { s.day += 30; econ.month(s); }
  const occ1 = [...ai.housing.values()].reduce((t, h) => t + h.occ, 0);
  assert(occ1 < occ0, 'no families left the AI city');
  assert(econ.portals.filter((p) => p.tile === ai.key && p.to === homeKey).length, 'no portal for the migrants');
  const moved = [...econ.families.values()].filter((f) => f.tile === homeKey && f.moved > 0).length;
  assert(moved > 0 || [...econ.families.values()].filter((f) => f.tile === homeKey).length > fam0 - 50, 'migrants did not arrive');
});

test('economy 10 — annual statistics, ten-year terms, elections and saved history', () => {
  const { s, econ, r } = econFixture();
  const y0 = s.year;
  for (let y = 1; y <= TERM_YEARS * 2; y++) { s.year = y0 + y; s.day += 30; econ.month(s); }
  const keys = Object.keys(econ.e.history);
  assert(keys.length === econ.tiles.size && econ.e.history[keys[0]].length === TERM_YEARS * 2, `history incomplete: ${econ.e.history[keys[0]]?.length}`);
  const row = econ.e.history[keys[0]][0];
  for (const k of ['pop', 'treasury', 'income', 'expenses', 'rent', 'employment', 'migIn', 'migOut', 'landValue', 'tolls', 'president']) assert(k in row, `annual stat ${k} missing`);
  assert(econ.e.terms.length === 2 && econ.e.terms[0].end - econ.e.terms[0].start === TERM_YEARS, `terms: ${econ.e.terms.map((t) => `${t.start}-${t.end}`)}`);
  assert(Object.values(econ.e.terms[0].tiles).every((v) => v.president && v.pop.length === 2 && v.treasury.length === 2), 'term record incomplete');
  assert(econ.events.filter((e) => e.type === 'term').length === 2, 'no term-end events for the interface');
  econ.pack(); const again = new RegionSim(JSON.parse(JSON.stringify(r)));
  assert(again.families.size === econ.families.size && again.e.terms.length === 2 && again.tile(s.w ? r.active : r.active).president.name === econ.tile(r.active).president.name, 'region economy not saved');
});

// ------------------------------------------------------------------ runner
const filter = process.argv[2];
let failed = 0;
for (const t of tests) {
  if (filter && !t.name.includes(filter)) continue;
  const t0 = Date.now();
  try { await t.fn(); console.log(`  ok   ${t.name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
