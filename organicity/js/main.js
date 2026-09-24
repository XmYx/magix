// Organicity — boot, save/load and the frame loop.
import { World } from './world.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { Tools } from './tools.js';
import { UI } from './ui.js';
import { SAVE_KEY, makeSave, loadSave } from './save.js';
import { CityAudio } from './audio.js';
import { SCENARIOS, setupScenario } from './scenarios.js';
import { readShared, encodeSave, decodeSave } from './share.js';
import { createRegion, loadRegion, saveRegion, cityKey, partnersOf, summarize, canBuy, tileCost, nameFor, edgeMatchFor, stubsFor, neighbours as tileNeighbours, dealsFor, addDeal, removeDeal, evolveAI, backgroundMonth, OPPOSITE } from './region.js';
import { technology, START_ERAS } from './eras.js';
import { loadPacks } from './packs.js';
import { RegionSim } from './regionsim.js';
import { fastestRoute } from './routes.js';
import { t, LANGS, getLang, setLang } from './i18n.js';

// content packs register their styles and landmarks before any city is built
const packsReady = loadPacks();
// installable, offline-capable: the service worker caches the game after the first visit
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { /* private mode etc. */ });

const BOOT_KEY = 'organicity-boot';
const $ = (id) => document.getElementById(id);

// start screen language
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, el.textContent);
$('optLang').innerHTML = Object.entries(LANGS).map(([k, n]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${n}</option>`).join('');
$('optLang').onchange = (e) => { setLang(e.target.value); for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, el.textContent); };

function readSave() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

// opts: { mode: 'new' | 'load' | 'shared', seed?, sandbox?, scenario?, save? }
async function boot(opts) {
  await packsReady;
  let world, sim;
  if (opts.mode === 'load' || opts.mode === 'shared' || opts.mode === 'tile') {
    try { ({ world, sim } = loadSave(opts.mode === 'load' ? readSave() : opts.save)); }
    catch (e) { alert(`Could not load the ${opts.mode === 'shared' ? 'shared' : 'saved'} city: ${e.message}\nStarting a new one instead.`); opts = { mode: 'new' }; }
  }
  if (!world) {
    const scen = !opts.sandbox && SCENARIOS[opts.scenario] ? opts.scenario : null;
    const seed = SCENARIOS[scen]?.seed ?? (Number.isFinite(opts.seed) ? opts.seed : (Math.random() * 1e6) | 0);
    world = new World(seed, opts.mapPreset || 'river');
    if (opts.mode === 'found') { const pre = loadRegion(); if (pre) world.edgeMatch = edgeMatchFor(pre, opts.tileKey); }   // continue the neighbours' coast and hills
    world.newGame();
    sim = new Sim(world, { sandbox: opts.sandbox ? {} : null, scenario: scen, startYear: opts.startYear, eraPace: opts.eraPace });
    if (scen) setupScenario(world, sim, scen);
    if (opts.year > sim.year) { sim.startYear = opts.year; sim.year = world.year = opts.year; sim.tech = technology(opts.year); }   // a region city founded later
  }
  // the region this city belongs to: kept for tiles, loads and continues; new or imported cities start a fresh one
  let region = ['tile', 'found', 'load'].includes(opts.mode) ? loadRegion() : null;
  const tileKey = opts.tileKey || region?.active;
  if (!region || !region.tiles[tileKey] || (opts.mode === 'load' && region.tiles[tileKey].seed !== world.seed)) {
    const old = loadRegion();
    if (old && (!region || old.id !== region.id)) for (const k of Object.keys(localStorage)) if (k.startsWith(`organicity-city:${old.id}:`)) localStorage.removeItem(k);
    region = createRegion(world, sim);
  } else region.active = tileKey;
  const here = region.tiles[region.active];
  if (opts.mode === 'found') Object.assign(here, { kind: 'city', owned: true, name: here.name || nameFor(region) });
  // road stubs that line up with the neighbours' exits, so roads meet across the border
  world.edgeStubs = stubsFor(region, region.active);
  if (opts.mode === 'found') {
    for (const st of world.edgeStubs) {
      const edge = st.side === 'west' ? [0.5, st.pos] : st.side === 'east' ? [511.5, st.pos] : st.side === 'north' ? [st.pos, 0.5] : [st.pos, 511.5];
      const inward = st.side === 'west' ? [34, st.pos] : st.side === 'east' ? [478, st.pos] : st.side === 'north' ? [st.pos, 34] : [st.pos, 478];
      const res = world.buildRoad(world.net.snap(edge[0], edge[1], 3), null, world.net.snap(inward[0], inward[1], 3), 'street', 0);
      if (!res.edges.length) continue;
    }
    world.undoStack.length = 0;
  }
  const syncRegion = () => {
    sim.partnerCities = partnersOf(region, region.active);
    sim.tileNeighbours = Object.fromEntries(tileNeighbours(region, region.active).filter((q) => q.t.kind !== 'wild').map((q) => [q.dir, { name: q.t.name, pop: q.t.kind === 'ai' ? q.t.pop : q.t.summary?.pop || 0, kind: q.t.kind, key: `${q.t.x},${q.t.z}` }]));
    sim.deals = dealsFor(region, region.active);
  };
  syncRegion();
  // meet newer neighbours halfway along shared edges (they matched this city when founded,
  // but may have changed since); roads, lots and water are left as they are
  if (opts.mode !== 'found') for (const q of tileNeighbours(region, region.active)) if (q.t.kind === 'city' && q.t.summary?.edges?.[OPPOSITE[q.dir]]) world.blendEdge(q.dir, q.t.summary.edges[OPPOSITE[q.dir]]);
  // other cities carry on at low detail while this one runs
  // the regional economy: presidents, families, housing, jobs, portals and tolls for every tile
  const econ = new RegionSim(region).attach(sim, world, region.active); world.econ = econ;
  const regionEvents = () => {
    for (const ev of econ.events.splice(0)) {
      if (ev.type === 'term') { ui.termReport(ev.term); continue; }
      // a family moving across the border drives a removal van through the portal
      const b = world.buildings.get(ev.building), node = world.net.nodes.get(ev.node); if (!b || !node || b.edge < 0) continue;
      const e = world.net.edges.get([...node.edges][0]); if (!e) continue;
      const r = ev.out ? fastestRoute(world.net, { edge: b.edge, s: b.s }, [{ id: -1, node: node.id }]) : fastestRoute(world.net, { edge: e.id, s: e.a === node.id ? 0 : e.len }, [{ id: b.id, edge: b.edge, s: b.s }]);
      if (r?.segments.length) (sim.dispatches ||= []).push({ kind: 'van', segs: r.segments, t: performance.now() });
    }
  };
  sim.onMonth = () => { econ.month(sim); regionEvents(); syncRegion(); econ.pack(); saveRegion(region); };
  saveRegion(region);
  const rend = new Renderer($('view'), world, sim);
  const store = () => localStorage.setItem(SAVE_KEY, JSON.stringify(makeSave(world, sim)));
  // save the city and file it under its region tile, with fresh numbers for the world map
  const persist = async () => {
    store();
    const t = region.tiles[region.active]; t.summary = summarize(world, sim, rend);
    econ.pack();
    for (const q of Object.values(region.tiles)) if (q.kind === 'ai' && q.exitNode != null && q.home === region.active && sim.region[q.exitNode]) sim.region[q.exitNode].pop = q.pop;   // the world map drives neighbour size
    localStorage.setItem(cityKey(region, region.active), await encodeSave(makeSave(world, sim)));
    saveRegion(region);
  };
  for (const q of Object.values(region.tiles)) if (q.kind === 'ai' && q.exitNode != null && q.home == null) q.home = region.active;
  const leave = async (next) => {
    try { await persist(); } catch (e) { ui.toast('Could not store this city: ' + e.message, 'bad'); return; }
    sessionStorage.setItem(BOOT_KEY, JSON.stringify(next)); location.reload();
  };
  const ui = new UI(world, sim, rend, {
    save() {
      persist().then(() => ui.toast('City saved in this browser.', 'good'), (e) => ui.toast('Could not save: ' + e.message, 'bad'));
    },
    region: () => region,
    renameTile(key, name) { const t = region.tiles[key]; if (!t || !name?.trim()) return; t.name = name.trim().slice(0, 24); saveRegion(region); syncRegion(); ui.renderWorldMap(); },
    addDeal(deal) { addDeal(region, deal); saveRegion(region); syncRegion(); },
    removeDeal(id) { removeDeal(region, id); saveRegion(region); syncRegion(); },
    buyTile(key) {
      if (!canBuy(region, key)) return ui.toast('Only tiles next to one you own can be bought.', 'warn');
      const cost = tileCost(region);
      if (!sim.canAfford(cost)) return ui.toast(`Buying this tile costs ${cost.toLocaleString('en-US')}.`, 'warn');
      sim.spend(cost); region.tiles[key].owned = true; saveRegion(region);
      ui.toast('Tile bought. Found a city on it from the world map.', 'good'); ui.renderWorldMap();
    },
    switchTile(key) { const t = region.tiles[key]; if (t?.kind === 'city' && key !== region.active) leave({ mode: 'tile', tileKey: key }); },
    foundTile(key) {
      const t = region.tiles[key]; if (!t?.owned || t.kind !== 'wild') return;
      if (!confirm(`Found a new city on this ${t.preset} tile? ${world.buildings.size ? 'This city is saved and you can switch back any time.' : ''}`)) return;
      leave({ mode: 'found', tileKey: key, seed: t.seed, mapPreset: t.preset, year: sim.year, startYear: [...START_ERAS].reverse().find((y) => y <= sim.year) || 2000, eraPace: sim.eraPace, sandbox: !!sim.sandbox });
    },
    newCity() {
      $('intro').hidden = false; $('introLoad').hidden = true; $('newOpts').hidden = false;
      $('introGo').textContent = 'Found a new city';
      $('introGo').onclick = () => { sessionStorage.setItem(BOOT_KEY, JSON.stringify(newOpts())); location.reload(); };
      $('introBack').hidden = false;
    },
    help() {
      $('intro').hidden = false; $('introLoad').hidden = true; $('newOpts').hidden = true; $('introBack').hidden = true;
      $('introGo').textContent = 'Back to the city';
      $('introGo').onclick = () => { $('intro').hidden = true; };
    },
  });
  $('introBack').onclick = () => { $('intro').hidden = true; };
  const tools = new Tools(world, sim, rend, ui);
  const audio = new CityAudio(sim, rend);
  ui.tools = tools; ui.audio = audio; ui.applySettings();
  ui.toolChanged(); ui.hud();
  window.city = { world, sim, rend, tools, ui, audio, region, econ };
  rend.setRegion?.(region);
  if (sim.sandbox) ui.toast(`Sandbox mode · seed ${world.seed}`, 'info');
  if (sim.scenario && SCENARIOS[sim.scenario]) ui.toast(`${SCENARIOS[sim.scenario].name}: ${SCENARIOS[sim.scenario].desc}`, 'info');

  let last = performance.now(), saveT = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    sim.update(dt);
    tools.update(dt);
    rend.frame(dt);
    ui.update(dt);
    audio.update(dt);
    saveT += dt;
    if (saveT > 120 && world.buildings.size) { saveT = 0; persist().catch(() => { /* quota exceeded — keep playing */ }); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function newOpts() {
  const raw = $('optSeed').value.trim();
  const seed = raw === '' ? NaN : /^\d+$/.test(raw) ? +raw : [...raw].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1e6;
  return { mode: 'new', seed, mapPreset: $('optMap').value, sandbox: $('optSandbox').checked, scenario: $('optScenario').value || null, startYear: +$('optEra').value, eraPace: +$('optPace').value };
}

$('optScenario').innerHTML = `<option value="">Free play</option>${Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}" title="${s.desc}">${s.name}</option>`).join('')}`;

// a city shared as a file or link (see share.js)
async function importCity(text) {
  try {
    const save = await readShared(text);
    if (window.city) { sessionStorage.setItem(BOOT_KEY, JSON.stringify({ mode: 'shared', save })); location.reload(); return; }   // one city per page
    $('intro').hidden = true; boot({ mode: 'shared', save });
  }
  catch (e) { alert(`That doesn't look like an Organicity city: ${e.message}`); }
}
$('introImport').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => { const f = e.target.files[0]; if (f) importCity(await f.text()); };

let pending = null;
try { pending = JSON.parse(sessionStorage.getItem(BOOT_KEY) || 'null'); } catch { pending = null; }
sessionStorage.removeItem(BOOT_KEY);
if (location.hash.startsWith('#city=')) {
  const code = location.hash; history.replaceState(null, '', location.pathname + location.search);
  importCity(code);
} else if (pending?.mode === 'tile') {
  // switching to another city of the region: its save is stored compressed under the tile
  $('intro').hidden = true;
  const r = loadRegion(), code = r && localStorage.getItem(cityKey(r, pending.tileKey));
  if (code) decodeSave(code).then((save) => boot({ ...pending, save }), (e) => { alert('That city could not be opened: ' + e.message); boot({ mode: 'load' }); });
  else boot({ mode: 'load' });
} else if (pending && pending.mode) { $('intro').hidden = true; boot(pending); }
else {
  $('introLoad').hidden = !readSave();
  $('introGo').onclick = () => { $('intro').hidden = true; boot(newOpts()); };
  $('introLoad').onclick = () => { $('intro').hidden = true; boot({ mode: 'load' }); };
}
