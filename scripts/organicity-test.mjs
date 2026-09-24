#!/usr/bin/env node
// Headless regression tests for Organicity (organicity/js). Runs the land model,
// road graph, simulation (in-thread core) and save/undo logic without a browser.
//   node scripts/organicity-test.mjs            run all tests
//   node scripts/organicity-test.mjs undo       run tests whose name contains "undo"
import { World } from '../organicity/js/world.js';
import { Sim } from '../organicity/js/sim.js';
import { makeSave, loadSave, migrate, SAVE_VERSION } from '../organicity/js/save.js';
import { RoadNet } from '../organicity/js/roads.js';
import { fastestRoute, commuteRoutes } from '../organicity/js/routes.js';
import { weatherAt, WEATHER } from '../organicity/js/weather.js';
import { Core, netSnapshot, sampleField } from '../organicity/js/core.js';
import { N, ZONES } from '../organicity/js/config.js';
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

// ------------------------------------------------------------------ runner
const filter = process.argv[2];
let failed = 0;
for (const t of tests) {
  if (filter && !t.name.includes(filter)) continue;
  const t0 = Date.now();
  try { t.fn(); console.log(`  ok   ${t.name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
