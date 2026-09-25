import { N, setMapSize } from './config.js';
// Organicity — boot, save/load and the frame loop.
import { World } from './world.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { Tools } from './tools.js';
import { UI } from './ui.js';
import { SAVE_KEY, makeSave, loadSave } from './save.js';
import { CityAudio } from './audio.js';
import { SCENARIOS, setupScenario } from './scenarios.js';
import { readShared, encodeSave, decodeSave, download } from './share.js';
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { createRegion, loadRegion, saveRegion, cityKey, partnersOf, summarize, canBuy, tileCost, nameFor, edgeMatchFor, edgesOf, stubsFor, neighbours as tileNeighbours, dealsFor, addDeal, removeDeal, evolveAI, backgroundMonth, OPPOSITE } from './region.js';
import { technology, START_ERAS } from './eras.js';
import { loadPacks } from './packs.js';
import { RegionSim } from './regionsim.js';
import { regionMarket, aiOffers } from './resources.js';
import { TileHost, loadView, storeView } from './tilehost.js';
import * as saves from './saves.js';
import { Multiplayer, joinGame, adoptRegion, savedName, saveName, iceText, setIce, relayText, setRelay } from './mpgame.js';
import { COLORS } from './mp.js';
import { viewSnapshot, unb64 } from './tileview.js';
import { newPresident } from './presidents.js';
import { fastestRoute } from './routes.js';
import { t, LANGS, getLang, setLang, watchDom } from './i18n.js';
import { galleryUrl, listCities, fetchCity, shotUrl, reportCity } from './gallery.js';

// content packs register their styles and landmarks before any city is built
const packsReady = loadPacks();
// installable, offline-capable: the service worker caches the game after the first visit
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { /* private mode etc. */ });

const BOOT_KEY = 'organicity-boot';
const $ = (id) => document.getElementById(id);

// in the desktop app there is no site to go back to
if (window.organicityDesktop) for (const a of document.querySelectorAll('#intro a[href="../index.html"]')) a.parentElement.hidden = true;
// start screen language
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, el.textContent);
watchDom();   // the rest of the interface, as the game draws it (and right to left for Arabic)
$('optLang').innerHTML = Object.entries(LANGS).map(([k, n]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${n}</option>`).join('');
$('optLang').onchange = (e) => { setLang(e.target.value); for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, el.textContent); watchDom(); };

function readSave() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

// opts: { mode: 'new' | 'load' | 'shared', seed?, sandbox?, scenario?, save? }
async function boot(opts) {
  await packsReady;
  let world, sim;
  // the tile size comes first: from the save, the region, or the new-game choice (scenarios are drawn for 512)
  const saved = opts.mode === 'load' ? readSave() : opts.save, reg = ['tile', 'found', 'load'].includes(opts.mode) ? loadRegion() : null;
  setMapSize(saved?.world?.size || (opts.mode === 'found' || opts.mode === 'tile' ? reg?.tileSize : null) || (opts.scenario ? 512 : opts.mapSize) || 512);
  if (opts.mode === 'load' || opts.mode === 'shared' || opts.mode === 'tile') {
    try { ({ world, sim } = loadSave(opts.mode === 'load' ? readSave() : opts.save)); }
    catch (e) { alert(`Could not load the ${opts.mode === 'shared' ? 'shared' : 'saved'} city: ${e.message}\nStarting a new one instead.`); opts = { mode: 'new' }; }
  }
  if (!world) {
    const scen = !opts.sandbox && SCENARIOS[opts.scenario] ? opts.scenario : null;
    const seed = SCENARIOS[scen]?.seed ?? (Number.isFinite(opts.seed) ? opts.seed : (Math.random() * 1e6) | 0);
    world = new World(seed, SCENARIOS[scen]?.map || opts.mapPreset || 'river');   // a pack scenario brings its own map
    if (opts.mode === 'found') { const pre = loadRegion(); if (pre) world.edgeMatch = edgeMatchFor(pre, opts.tileKey); }   // continue the neighbours' coast and hills
    world.newGame();
    sim = new Sim(world, { sandbox: opts.sandbox ? {} : null, scenario: scen, startYear: SCENARIOS[scen]?.startYear ?? opts.startYear, eraPace: opts.eraPace });
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
  for (const k of Object.keys(localStorage)) if (k.startsWith('organicity-view:') && !k.startsWith(`organicity-view:${region.id}:`)) localStorage.removeItem(k);   // views of a replaced region
  const here = region.tiles[region.active];
  if (opts.mode === 'found') Object.assign(here, { kind: 'city', owned: true, name: here.name || nameFor(region) });
  // road stubs that line up with the neighbours' exits, so roads meet across the border
  world.edgeStubs = stubsFor(region, region.active);
  if (opts.mode === 'found') {
    for (const st of world.edgeStubs) {
      const edge = st.side === 'west' ? [0.5, st.pos] : st.side === 'east' ? [N - 0.5, st.pos] : st.side === 'north' ? [st.pos, 0.5] : [st.pos, N - 0.5];
      const inward = st.side === 'west' ? [34, st.pos] : st.side === 'east' ? [478, st.pos] : st.side === 'north' ? [st.pos, 34] : [st.pos, 478];
      const res = world.buildRoad(world.net.snap(edge[0], edge[1], 3), null, world.net.snap(inward[0], inward[1], 3), 'street', 0);
      if (!res.edges.length) continue;
    }
    world.undoStack.length = 0;
  }
  const syncRegion = () => {
    sim.partnerCities = partnersOf(region, region.active);
    sim.tileNeighbours = Object.fromEntries(tileNeighbours(region, region.active).filter((q) => q.t.kind !== 'wild').map((q) => [q.dir, { name: q.t.name, pop: q.t.kind === 'ai' ? q.t.pop : q.t.summary?.pop || 0, kind: q.t.kind, gov: q.t.gov || (q.t.kind === 'city' ? 'player' : 'ai'), key: `${q.t.x},${q.t.z}` }]));
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
  sim.onMonth = () => { region.day = (region.day || 0) + 30; econ.month(sim); regionEvents(); syncRegion(); sim.regionMarket = regionMarket(region, region.active); region.offers = aiOffers(region, region.active, sim, tileNeighbours(region, region.active).map((q) => `${q.t.x},${q.t.z}`)); econ.pack(); saveRegion(region); mp?.monthly(); };
  let mp = null;   // multiplayer (set up once the background runner exists)
  sim.regionMarket = regionMarket(region, region.active);
  saveRegion(region);
  const rend = new Renderer($('view'), world, sim);
  const store = () => localStorage.setItem(SAVE_KEY, JSON.stringify(makeSave(world, sim)));
  // save the city and file it under its region tile, with fresh numbers for the world map
  const persist = async () => {
    store();
    const t = region.tiles[region.active]; t.summary = summarize(world, sim, rend); t.simDay = region.day;
    storeView(region, region.active, viewSnapshot(world));   // how this city looks from next door
    econ.pack();
    for (const q of Object.values(region.tiles)) if (q.kind === 'ai' && q.exitNode != null && q.home === region.active && sim.region[q.exitNode]) sim.region[q.exitNode].pop = q.pop;   // the world map drives neighbour size
    localStorage.setItem(cityKey(region, region.active), await encodeSave(makeSave(world, sim)));
    saveRegion(region);
  };
  for (const q of Object.values(region.tiles)) if (q.kind === 'ai' && q.exitNode != null && q.home == null) q.home = region.active;
  const leave = async (next) => {
    if (mp?.active && !confirm('Leaving this city ends your multiplayer session (you can rejoin later with the same name). Continue?')) return;
    mp?.leave();
    try { await persist(); } catch (e) { ui.toast('Could not store this city: ' + e.message, 'bad'); return; }
    sessionStorage.setItem(BOOT_KEY, JSON.stringify(next)); location.reload();
  };
  // saved games: the whole region, kept in the browser's (or the desktop app's) own database
  const gameMeta = () => { const t = region.tiles[region.active]; return { meta: { city: t.name, pop: Math.round(sim.stats.pop || 0), money: Math.round(sim.money), year: sim.year, day: sim.day, cities: Object.values(region.tiles).filter((q) => q.kind === 'city' && q.gov !== 'ai').length, sandbox: !!sim.sandbox }, thumb: t.summary?.thumb || null }; };
  const ui = new UI(world, sim, rend, {
    mp: () => mp, mpConfig: { iceText, setIce, relayText, setRelay, savedName, colors: COLORS },
    save() {
      persist().then(() => ui.toast('City saved in this browser.', 'good'), (e) => ui.toast('Could not save: ' + e.message, 'bad'));
    },
    async saveGame(name, id = null) {
      try { await persist(); const gid = await saves.saveGame({ id, name, ...gameMeta() }); ui.toast(`Game saved${name ? ` as “${name}”` : ''}.`, 'good'); return gid; }
      catch (e) { ui.toast('Could not save the game: ' + e.message, 'bad'); return null; }
    },
    quickSave() { const id = saves.currentSlot(); return this.saveGame(null, id || null); },
    async loadGame(id) {
      if (!confirm('Load this saved game? Progress since your last save will be lost.')) return;
      try { await saves.loadGame(id); sessionStorage.setItem(BOOT_KEY, JSON.stringify({ mode: 'load' })); location.reload(); }
      catch (e) { ui.toast('Could not load: ' + e.message, 'bad'); }
    },
    games: () => saves.listGames(),
    currentGame: () => saves.currentSlot(),
    renameGame: (id, name) => saves.renameGame(id, name),
    deleteGame: (id) => saves.deleteGame(id),
    async exportGame(id, name) { try { download(`${(name || 'city').replace(/[^\w-]+/g, '-')}.organicity-game`, await saves.exportGame(id), 'application/json'); } catch (e) { ui.toast('Could not export: ' + e.message, 'bad'); } },
    async importGame(file) { try { await saves.importGame(await file.text()); ui.toast('Saved game imported.', 'good'); } catch (e) { ui.toast('Could not import: ' + e.message, 'bad'); } },
    region: () => region,
    renameTile(key, name) { const t = region.tiles[key]; if (!t || !name?.trim()) return; t.name = name.trim().slice(0, 24); saveRegion(region); syncRegion(); ui.renderWorldMap(); },
    addDeal(deal) { addDeal(region, deal); saveRegion(region); syncRegion(); },
    removeDeal(id) { removeDeal(region, id); saveRegion(region); syncRegion(); },
    buyTile(key) {
      if (mp?.active) { if (!canBuy(region, key)) return ui.toast('You can claim land next to your own.', 'warn'); mp.claim(key); ui.toast('Claim sent to the region.', 'info'); return; }   // in multiplayer, land is claimed through the host
      if (!canBuy(region, key)) return ui.toast('Only tiles next to one you own can be bought.', 'warn');
      const cost = tileCost(region);
      if (!sim.canAfford(cost)) return ui.toast(`Buying this tile costs ${cost.toLocaleString('en-US')}.`, 'warn');
      sim.spend(cost); region.tiles[key].owned = true; saveRegion(region);
      ui.toast('Tile bought. Found a city on it from the world map.', 'good'); ui.renderWorldMap();
    },
    switchTile(key) { const t = region.tiles[key]; if (t?.kind === 'city' && t.gov !== 'ai' && t.gov !== 'remote' && key !== region.active) leave({ mode: 'tile', tileKey: key }); },
    // play another governor's city: it becomes yours (you keep their name and policy)
    takeOver(key) {
      const t = region.tiles[key]; if (!t || t.kind !== 'city' || t.gov !== 'ai' || key === region.active) return;
      if (mp?.active) { mp.buyCity(key); return; }   // in multiplayer an AI city sells only for its value
      if (!localStorage.getItem(cityKey(region, key))) return ui.toast('That city is still being founded. Try again shortly.', 'warn');
      if (!confirm(`Take over ${t.name} and play it as ${econ.tile(key)?.president.name}? The AI governor steps aside; you can hand it back later.`)) return;
      Object.assign(t, { gov: 'player', owned: true }); econ.tile(key).president.controller = 'player';
      leave({ mode: 'tile', tileKey: key });
    },
    // commodity contracts offered by AI governors next door
    acceptOffer(i) {
      const o = region.offers?.[i]; if (!o) return;
      addDeal(region, { seller: o.role === 'sell' ? region.active : o.partner, buyer: o.role === 'sell' ? o.partner : region.active, kind: o.kind, amount: o.amount, price: o.price });
      region.offers.splice(i, 1); syncRegion(); saveRegion(region); ui.toast(`Contract signed with ${o.name}: ${o.amount} ${o.kind} a month.`, 'good');
    },
    cancelContract(id) {
      const d = (region.deals || []).find((x) => x.id === id);
      if (mp?.active && d?.players?.length) { mp.endContract(id); return; }   // a contract with another player ends through the host
      removeDeal(region, id); syncRegion(); saveRegion(region); ui.toast('Contract ended.', 'info');
    },
    offers: () => region.offers || [],
    contracts: () => (sim.deals || []).filter((d) => d.kind && !['power', 'water'].includes(d.kind)).map((d) => ({ ...d, name: region.tiles[d.partner]?.name || d.partner })),
    // let an AI governor run one of your other cities (it keeps building in the background)
    handOver(key) {
      const t = region.tiles[key]; if (!t || t.kind !== 'city' || t.gov === 'ai' || key === region.active) return;
      Object.assign(t, { gov: 'ai', owned: false }); econ.govern(econ.tile(key), t);
      econ.pack(); saveRegion(region); syncRegion(); ui.renderWorldMap(); ui.toast(`${t.name} is now run by ${econ.tile(key).president.name} (AI).`, 'info');
    },
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
  // the neighbouring cities, drawn from their latest views; the background host keeps them running
  // every other tile's view: cities from their last run, wild land as it was pregenerated
  const views = () => Object.fromEntries(Object.keys(region.tiles).filter((k) => k !== region.active).map((k) => [k, loadView(region, k)]).filter(([, v]) => v));
  { const here = region.tiles[region.active]; if (!here.edges && !here.summary?.edges) here.edges = edgesOf(world); }   // neighbours' land continues this city's edges
  let regionT = null; const redrawRegion = () => { clearTimeout(regionT); regionT = setTimeout(() => rend.setRegion?.(region, views()), 400); };
  rend.setRegion?.(region, views());
  const thumb = (v) => { try { const cls = unb64(v.cls), S = v.S, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), img = g.createImageData(S, S);
    const P = [[96, 146, 62], [70, 124, 168], [150, 150, 146], [128, 180, 88], [42, 150, 60], [70, 140, 230], [230, 190, 50], [150, 110, 220], [230, 120, 160], [180, 178, 170], [62, 104, 44]];
    for (let i = 0; i < S * S; i++) { const c = P[cls[i]] || P[0]; img.data.set([c[0], c[1], c[2], 255], i * 4); } g.putImageData(img, 0, 0); return cv.toDataURL('image/png'); } catch { return null; } };
  const host = new TileHost(region, econ, sim, {
    thumb,
    onTerrain: (k) => { redrawRegion(); mp?.tileChanged(k); },
    onTile(k, res, job) {
      redrawRegion(); mp?.tileChanged(k);
      const t = region.tiles[k], built = new Set(res.built), pres = econ.tile(k)?.president.name;
      if (job.generated) sim.headline(`${pres} founded the city of ${t.name} next door.`, 'info');
      else for (const s of ['school', 'clinic', 'fire', 'police', 'landfill']) if (built.has(s)) { sim.headline(`${t.name} (${pres}) opened a new ${s === 'fire' ? 'fire station' : s === 'police' ? 'police station' : s}.`, 'info'); break; }
      syncRegion(); ui.renderWorldMap();
    },
  });
  window.city.host = host;
  mp = new Multiplayer({ region, econ, sim, world, rend, ui, tilehost: host, redrawRegion, syncRegion });
  window.city.mp = mp;
  if (opts.mp) mp.attachGuest(opts.mp);
  if (sim.sandbox) ui.toast(`Sandbox mode · seed ${world.seed}`, 'info');
  if (sim.scenario && SCENARIOS[sim.scenario]) ui.toast(`${SCENARIOS[sim.scenario].name}: ${SCENARIOS[sim.scenario].desc}`, 'info');

  let last = performance.now(), saveT = 0, autoT = 0, lastFrame = performance.now();
  // the simulation, saves and autosaves; drawn frames add the view on top
  function step(dt) {
    sim.update(dt);
    saveT += dt;
    if (saveT > 120 && world.buildings.size) { saveT = 0; persist().catch(() => { /* quota exceeded — keep playing */ }); }
    autoT = (autoT || 0) + dt;
    if (autoT > 300 && world.buildings.size) { autoT = 0; persist().then(() => saves.saveGame({ id: saves.AUTOSAVE_ID, name: 'Autosave', ...gameMeta() })).catch(() => { /* keep playing */ }); }   // every five minutes
  }
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; lastFrame = performance.now();
    step(dt);
    tools.update(dt);
    rend.frame(dt);
    ui.update(dt);
    audio.update(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // the region's other cities run on a timer, not on drawn frames, so they keep going while the window is hidden
  setInterval(() => host.tick(), 1000);
  // minimised in the desktop app (which keeps its timers running): no frames are drawn, so the city steps on a timer
  if (window.organicityDesktop) setInterval(() => {
    const now = performance.now(); if (now - lastFrame < 600) return;
    const dt = Math.min(1, (now - last) / 1000); last = now;
    for (let left = dt; left > 1e-3; left -= 0.1) step(Math.min(0.1, left));
  }, 250);
}

function newOpts() {
  const raw = $('optSeed').value.trim();
  const seed = raw === '' ? NaN : /^\d+$/.test(raw) ? +raw : [...raw].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1e6;
  return { mode: 'new', seed, mapPreset: $('optMap').value, mapSize: +($('optSize')?.value || 512), sandbox: $('optSandbox').checked, scenario: $('optScenario').value || null, startYear: +$('optEra').value, eraPace: +$('optPace').value };
}

const fillScenarios = () => { $('optScenario').innerHTML = `<option value="">Free play</option>${Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}" title="${esc(s.desc)}">${esc(s.name)}${s.def ? ` · ${esc(s.def.pack)}` : ''}</option>`).join('')}`; };
fillScenarios(); packsReady.then(fillScenarios);   // pack scenarios join the list once packs load

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

// the opt-in gallery: cities other players shared, approved by a moderator (gallery.js)
if (galleryUrl()) $('introGallery').hidden = false;
$('introGallery').onclick = async () => {
  const el = $('galleryList'), url = galleryUrl(); el.hidden = !el.hidden; if (el.hidden) return;
  el.innerHTML = '<p class="dim">Loading the gallery…</p>';
  try {
    const list = await listCities(url);
    el.innerHTML = list.length ? list.map((c) => `<div class="game"><img src="${esc(shotUrl(url, c.id))}" alt="" loading="lazy"><div><b>${esc(c.title)}</b><small>by ${esc(c.author)} · ${(c.stats?.pop || 0).toLocaleString('en-US')} people · ${c.stats?.year || ''}${c.stats?.size > 512 ? ` · ${c.stats.size} map` : ''}</small></div><div class="row"><button class="primary" data-gal-open="${esc(c.id)}">Open</button><button data-gal-report="${esc(c.id)}">Report</button></div></div>`).join('') : '<p class="dim">No cities in the gallery yet.</p>';
  } catch (e) { el.innerHTML = `<p class="dim">The gallery could not be reached: ${esc(e.message)}</p>`; }
};
$('galleryList').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return; const url = galleryUrl();
  try {
    if (b.dataset.galOpen) { b.disabled = true; importCity((await fetchCity(url, b.dataset.galOpen)).code); }
    if (b.dataset.galReport) { const why = prompt('What is wrong with this city? A moderator will look at it.'); if (why != null) { await reportCity(url, b.dataset.galReport, why); b.textContent = 'Reported'; b.disabled = true; } }
  } catch (err) { alert(err.message); b.disabled = false; }
};

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
  // joining someone else's region: connect first, then build your city on the land the host gives you
  $('introMp').onclick = () => { $('mpJoin').hidden = !$('mpJoin').hidden; };
  $('mpName').value = savedName();
  $('mpColors').innerHTML = 'Colour ' + COLORS.map((c, i) => `<label class="chk"><input type="radio" name="mpcol" value="${c}" ${i === 1 ? 'checked' : ''}><span class="sw" style="background:${c}"></span></label>`).join('');
  $('mpRelay').value = relayText(); $('mpIce').value = iceText();
  $('mpAccess').oninput = (e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); e.target.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v; };
  $('mpAccess').onkeydown = (e) => { if (e.key === 'Enter') $('mpStart').click(); };
  const join = async (manual) => {
    const name = $('mpName').value.trim(); if (!name) { $('mpStatus').textContent = 'Pick a name first.'; return; }
    const code = manual ? null : $('mpAccess').value.trim(); if (!manual && !code) { $('mpStatus').textContent = 'Type the access code the host gave you.'; return; }
    saveName(name); setRelay($('mpRelay').value); setIce($('mpIce').value);
    $('mpStart').disabled = $('mpMakeCode').disabled = true;
    let give; const answer = () => new Promise((ok) => { give = ok; });
    $('mpConnect').onclick = () => give?.($('mpAnswer').value.trim());
    $('mpCopy').onclick = () => { navigator.clipboard?.writeText($('mpCode').value); $('mpStatus').textContent = 'Join code copied. Send it to the host.'; };
    try {
      const { session, welcome } = await joinGame({ name, color: document.querySelector('input[name=mpcol]:checked')?.value, code, answer,
        onCode: (c) => { $('mpCodes').hidden = false; $('mpCode').value = c; }, onStatus: (t) => { $('mpStatus').textContent = t; } });
      const { region: r, tile, year } = adoptRegion(welcome), t = r.tiles[tile], saved = localStorage.getItem(cityKey(r, tile));
      $('intro').hidden = true;
      if (saved) boot({ mode: 'tile', tileKey: tile, save: await decodeSave(saved), mp: session });
      else boot({ mode: 'found', tileKey: tile, seed: t.seed, mapPreset: t.preset, year, startYear: [...START_ERAS].reverse().find((y) => y <= year) || 2000, eraPace: 1, mp: session });
    } catch (e) { $('mpStatus').textContent = 'Could not join: ' + e.message; $('mpStart').disabled = $('mpMakeCode').disabled = false; }
  };
  $('mpStart').onclick = () => join(false);
  $('mpMakeCode').onclick = () => join(true);
  // saved games on the start screen
  saves.listGames().then((list) => {
    $('introGames').hidden = false;
    const render = (games) => {
      $('introList').innerHTML = games.length ? games.map((g) => `<div class="game"><img src="${g.thumb || ''}" alt=""><div><b>${esc(g.name)}</b><small>${esc(g.meta?.city || '')} · ${(g.meta?.pop || 0).toLocaleString('en-US')} people · ${g.meta?.year || ''} · ${new Date(g.updated).toLocaleString()}</small></div><div class="row"><button data-gload="${g.id}" class="primary">Load</button><button data-gdel="${g.id}">Delete</button></div></div>`).join('')
        : '<p class="dim">No saved games yet: save one from the game with the Save button (Ctrl+S saves quickly).</p>';
      $('introList').innerHTML += '<div class="row"><button data-gimp>Import a saved game file…</button></div>';
    };
    render(list);
    $('introGames').onclick = () => { $('introList').hidden = !$('introList').hidden; };
    $('introList').onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.gload) { try { await saves.loadGame(b.dataset.gload); $('intro').hidden = true; boot({ mode: 'load' }); } catch (err) { alert(err.message); } }
      if (b.dataset.gdel && confirm('Delete this saved game?')) { await saves.deleteGame(b.dataset.gdel); render(await saves.listGames()); }
      if (b.dataset.gimp) $('gameFile').click();
    };
    $('gameFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await saves.importGame(await f.text()); render(await saves.listGames()); } catch (err) { alert(err.message); } };
  });
  $('introGo').onclick = () => { $('intro').hidden = true; boot(newOpts()); };
  $('introLoad').onclick = () => { $('intro').hidden = true; boot({ mode: 'load' }); };
}
