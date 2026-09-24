import { TRANSIT, transitMode } from './transit.js';
// Organicity — DOM interface: HUD, tool dock, panels, tooltips and toasts.
import { STYLES, LAYERS, JUNCTIONS, ROADS, ZONES, SERVICES, OVERLAYS, DISTRICT_COLORS, PRIORITIES, LEVEL_APPEAL, MONTH_DAYS, ORDINANCES } from './config.js';
import { fmtMoney, fmtInt, clamp } from './util.js';
import { TERRACE_SERVICES, buildingFloors, massPlan } from './eras.js';
import { WEATHER } from './weather.js';
import { PROB } from './sim.js';
import { TUTORIAL, SCENARIOS } from './scenarios.js';
import { encodeSave, shareLink, download } from './share.js';
import { makeSave } from './save.js';
import { t, LANGS, getLang, setLang } from './i18n.js';
import { loaded as packsLoaded, addUserPack, removeUserPack, userPacks } from './packs.js';
import { canBuy, tileCost, neighbours as tileNeighbours } from './region.js';
import { MAP_PRESETS } from './terrain.js';
import { quake, tornado, accident, festival, VENUES } from './disasters.js';
import { LEVERS, DEV, PRIORITIES as AIMS } from './presidents.js';
import { TERM_YEARS } from './regionsim.js';

const SETTINGS_KEY = 'organicity-settings';
const hash2c = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 997) / 997; };
export function loadSettings() {
  try { return { palette: 'default', reducedMotion: matchMedia?.('(prefers-reduced-motion: reduce)').matches || false, uiScale: 1, lod: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { palette: 'default', reducedMotion: false, uiScale: 1, lod: true }; }
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rgbCss = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KIND = { R: 'Residential', C: 'Commercial', I: 'Industrial', O: 'Office' };
const bar = (v, good = true) => {
  const t = clamp(v, 0, 1), hue = good ? t * 120 : (1 - t) * 120;
  return `<span class="bar"><i style="width:${(t * 100).toFixed(0)}%;background:hsl(${hue},62%,48%)"></i></span>`;
};

const CATS = [
  { id: 'inspect', key: '1', label: 'Inspect', glyph: '?' },
  { id: 'road', key: '2', label: 'Roads', glyph: '═' },
  { id: 'zone', key: '3', label: 'Zones', glyph: '▦' },
  { id: 'util', key: '4', label: 'Utilities', glyph: 'ϟ' },
  { id: 'svc', key: '5', label: 'Services', glyph: '✚' },
  { id: 'district', key: '6', label: 'Districts', glyph: '◇' },
  { id: 'lines', key: 'L', label: 'Transit lines', glyph: '⊶' },
  { id: 'bulldoze', key: '7', label: 'Bulldoze', glyph: '✖' },
  { id: 'overlays', key: '8', label: 'Overlays', glyph: '◐', panel: true },
  { id: 'budget', key: '9', label: 'Budget', glyph: '₵', panel: true },
  { id: 'people', key: 'Y', label: 'Society', glyph: '☺', panel: true },
  { id: 'advisors', key: 'N', label: 'Advisors', glyph: '✉', panel: true },
  { id: 'region', key: 'R', label: 'Region', glyph: '⇄', panel: true },
  { id: 'president', key: 'K', label: 'President', glyph: '♛', panel: true },
  { id: 'terrain', key: 'T', label: 'Terrain', glyph: '≈' },
  { id: 'sandbox', key: '', label: 'Sandbox', glyph: '⚙', panel: true, sandbox: true },
];

export class UI {
  constructor(world, sim, rend, actions) {
    this.w = world; this.sim = sim; this.r = rend; this.actions = actions;
    this.tools = null;
    this.panelName = null; this.panelFn = null; this.panelT = 0; this.hudT = 0;
    this.seenMsg = 0;
    this.buildHud();
    this.buildDock();
  }

  // ---------------------------------------------------------------- HUD
  buildHud() {
    $('top').innerHTML = `
      <div class="brand">ORGANICITY</div>
      <div class="stat"><small>${t('hud.funds')}</small><b id="hMoney"></b><em id="hNet"></em></div>
      <div class="stat"><small>${t('hud.pop')}</small><b id="hPop"></b></div>
      <div class="stat"><small>${t('hud.jobs')}</small><b id="hJobs"></b><em id="hUnemp"></em></div>
      <div class="stat"><small>${t('hud.date')}</small><b id="hDate"></b><em id="hWeather"></em></div>
      <div id="speed" role="group" aria-label="Simulation speed">
        <button data-s="0" title="Pause (Space)">❚❚</button><button data-s="1" title="Normal">▶</button><button data-s="2" title="Fast">▶▶</button><button data-s="4" title="Fastest">▶▶▶</button>${this.sim.sandbox ? '<button data-s="8" title="Sandbox 8×">8×</button><button data-s="16" title="Sandbox 16×">16×</button>' : ''}
      </div>
      <div id="demand" title="Zoning demand: residential, commercial, industrial, office">
        ${['R', 'C', 'I', 'O'].map((k) => `<div class="dem"><div class="col"><i id="d${k}"></i></div><span>${k}</span></div>`).join('')}
      </div>
      <div class="menu">
        <button id="mUndo" title="Undo (Ctrl+Z)">↶ ${t('menu.undo')}</button>
        <button id="mDay" title="Day/night: cycle, always day, always night"></button>
        <button id="mPix" title="Pixel size">▣ <span></span></button>
        <button id="mWorld" title="World map: your region's cities and tiles (M)">◫ ${t('menu.world')}</button>
        <button id="mPhoto" title="Photo mode (P)">◘ ${t('menu.photo')}</button>
        <button id="mShare" title="Share this city as a link or file">${t('menu.share')}</button>
        <button id="mSet" title="Sound, accessibility and graphics">⚙</button>
        <button id="mSave" title="Save to this browser">${t('menu.save')}</button>
        <button id="mNew" title="Start a new city">${t('menu.new')}</button>
        <button id="mHelp" title="How to play">${t('menu.help')}</button>
      </div>`;
    $('speed').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const s = +b.dataset.s; if (!s) this.sim.paused = !this.sim.paused; else { this.sim.speed = s; this.sim.paused = false; }
      this.hud();
    });
    $('mDay').addEventListener('click', () => { const order = ['cycle', 'day', 'night']; this.r.setDayMode(order[(order.indexOf(this.r.dayMode) + 1) % 3]); this.hud(); });
    $('mPix').addEventListener('click', () => { this.r.setPixel(this.r.pixel >= 4 ? 1 : this.r.pixel + 1); this.hud(); });
    $('mSave').addEventListener('click', () => this.actions.save());
    $('mUndo').addEventListener('click', () => this.tools.undo());
    $('mNew').addEventListener('click', () => { if (confirm('Start a new city? Unsaved progress will be lost.')) this.actions.newCity(); });
    $('mHelp').addEventListener('click', () => this.actions.help());
    $('mPhoto').addEventListener('click', () => this.togglePhoto());
    $('mWorld').addEventListener('click', () => this.toggleWorldMap());
    $('mShare').addEventListener('click', () => this.togglePanel('share'));
    $('mSet').addEventListener('click', () => this.togglePanel('settings'));
    $('news').addEventListener('click', () => this.togglePanel('advisors'));
  }

  hud() {
    const s = this.sim, st = s.stats;
    const inf = s.sandbox && s.sandbox.infinite;
    $('hMoney').textContent = inf ? '∞' : fmtMoney(s.money);
    $('hMoney').className = !inf && s.money < 0 ? 'neg' : '';
    const net = st.incomeM - st.expenseM;
    $('hNet').textContent = `${net >= 0 ? '+' : ''}${fmtMoney(net)}/mo`;
    $('hNet').className = net < 0 ? 'neg' : 'pos';
    $('hPop').title = this.sim.scenario ? this.sim.scenarioProgress().map(([label, ok]) => `${ok ? '✓' : '○'} ${label}`).join(' · ') : '';
    $('hPop').textContent = fmtInt(st.pop);
    const jobs = st.jobs.C + st.jobs.I + st.jobs.O, filled = st.filled.C + st.filled.I + st.filled.O;
    $('hJobs').textContent = `${fmtInt(filled)}/${fmtInt(jobs)}`;
    $('hUnemp').textContent = st.workers > 5 ? `${Math.round(st.unemp * 100)}% idle` : '';
    const y = s.year, m = Math.floor((s.day % 360) / MONTH_DAYS), d = (s.day % MONTH_DAYS) + 1;
    $('hWeather').textContent = `${s.weather.season} · ${s.weather.label}`;
    $('hWeather').title = `Road speed ${Math.round(s.weather.speed*100)}% · power demand ${Math.round(s.weather.power*100)}% · water demand ${Math.round(s.weather.water*100)}% · wind output ${Math.round(s.wind*100)}%`;
    $('hDate').title = `${s.tech.style} · technology ceiling ${s.tech.heightLimit} floors · ${s.eraPace} calendar years per game year`;
    const H = this.r.hour ? this.r.hour() : 12;
    $('hDate').textContent = `${y} · ${MONTHS[m]} ${d} · ${String(Math.floor(H)).padStart(2, '0')}:${String(Math.floor((H % 1) * 6)) }0`;
    for (const b of $('speed').children) b.classList.toggle('on', +b.dataset.s === 0 ? s.paused : !s.paused && +b.dataset.s === s.speed);
    for (const k of ['R', 'C', 'I', 'O']) {
      const v = s.demand[k], el = $('d' + k);
      el.style.height = `${Math.abs(v) / 2}%`; el.style.bottom = v >= 0 ? '50%' : `${50 - Math.abs(v) / 2}%`;
      el.className = v >= 0 ? 'up' : 'down';
    }
    $('mPix').querySelector('span').textContent = `${this.r.pixel}×`;
    $('mDay').textContent = { cycle: '◐ Cycle', day: '☀ Day', night: '☾ Night' }[this.r.dayMode];
    $('mUndo').disabled = !this.w.undoStack.length;
    $('mUndo').title = this.w.undoStack.length ? `Undo ${this.w.undoStack[this.w.undoStack.length - 1].label} (Ctrl+Z)` : 'Nothing to undo';
  }

  // ---------------------------------------------------------------- dock & flyouts
  buildDock() {
    this.renderDock();
    $('dock').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.pickCategory(b.dataset.c); });
    $('fly').addEventListener('click', (e) => this.flyClick(e));
    $('fly').addEventListener('input', (e) => this.flyInput(e));
  }
  renderDock() {
    $('dock').innerHTML = CATS.filter((c) => !c.sandbox || this.sim.sandbox).map((c) => `<button data-c="${c.id}" title="${t('cat.' + c.id, c.label)}${c.key ? ` (${c.key})` : ''}"><span class="g">${c.glyph}</span><span class="l">${t('cat.' + c.id, c.label)}</span>${c.key ? `<kbd>${c.key}</kbd>` : ''}</button>`).join('');
  }

  pickCategory(c) {
    const cat = CATS.find((x) => x.id === c); if (!cat) return;
    if (cat.panel) { this.togglePanel(c); return; }
    const t = this.tools;
    if (c === 'util' && SERVICES[t.s.svc].cat !== 'util') t.s.svc = 'coal';
    if (c === 'svc' && SERVICES[t.s.svc].cat !== 'svc') t.s.svc = 'fire';
    t.setTool(c);
    if (c === 'district' && t.s.district) this.showDistrict(t.s.district);
  }

  toolChanged() {
    const s = this.tools.s;
    this.r.uiTransit = s.tool === 'lines' || this.panelName === 'lines';
    for (const b of $('dock').children) b.classList.toggle('on', b.dataset.c === s.tool || b.dataset.c === this.panelName);
    let h = '';
    const brush = `<label class="rng">Brush <input type="range" min="1" max="30" value="${s.brush}" data-k="brush"><b>${s.brush}</b></label>`;
    switch (s.tool) {
      case 'road':
        h = `<div class="row">${Object.entries(ROADS).map(([k, R]) => `<button class="${s.road === k ? 'on' : ''}" data-road="${k}" title="${esc(R.desc)}"><span class="sw road-${k}"></span>${R.name}<small>${fmtMoney(R.cost)}/m</small></button>`).join('')}</div>
          <div class="row"><button class="${!s.curve ? 'on' : ''}" data-curve="0">Straight</button><button class="${s.curve ? 'on' : ''}" data-curve="1">Curved <kbd>C</kbd></button><button class="${s.oneway ? 'on' : ''}" data-oneway="1" title="New roads run one way, in the direction you draw them">One-way →</button></div>
          <div class="row">${[1, 0, -1].map((L) => `<button class="${s.layer === L ? 'on' : ''}" data-layer="${L}" title="${L ? `Crosses other roads without a junction; ×${LAYERS[L].cost} cost` : 'Joins every road it crosses'}">${LAYERS[L].name}</button>`).join('')}
            ${[0, 14, 22].map((d) => `<button class="${s.parallel === d ? 'on' : ''}" data-parallel="${d}" title="${d ? 'Also build an identical road alongside (one-way twins run opposite: a dual carriageway)' : 'Single road'}">${d ? `Parallel ${Math.round(d * 1.5)} m` : 'Single'}</button>`).join('')}
            <button class="${s.upgrade ? 'on' : ''}" data-upgrade="1" title="Drag over existing roads to convert them to the selected type">Upgrade brush</button></div>
          <p class="hint">${s.upgrade ? 'Drag across roads to convert them. ' : ''}Click to start, click to end; roads chain on. ${s.curve ? 'Curves: start → bend → end. ' : ''}Crossings join at any angle. <kbd>Shift</kbd> snaps to 15°. Right-click stops.</p>`;
        break;
      case 'zone':
        h = `<div class="row">${ZONES.slice(1).map((Z) => `<button class="${s.zone === Z.id ? 'on' : ''}" data-zone="${Z.id}" title="${Z.name}"><span class="sw" style="background:${rgbCss(Z.color)}"></span>${Z.name}</button>`).join('')}
          <button class="${s.zone === 0 ? 'on' : ''}" data-zone="0"><span class="sw x"></span>Dezone</button></div>
          <div class="row"><button class="${!s.fill && !s.place ? 'on' : ''}" data-fill="0">Brush</button><button class="${s.fill && !s.place ? 'on' : ''}" data-fill="1">Fill block <kbd>F</kbd></button>${s.fill || s.place ? '' : brush}</div>
          ${this.sim.sandbox ? `<div class="row">Place building: ${[1, 2, 3, 4, 5].map((L) => `<button class="${s.place === L ? 'on' : ''}" data-place="${L}" title="Click a zoned lot to stamp a finished, level-locked building">L${L}</button>`).join('')}</div>` : ''}
          <p class="hint">Paint any shape along a road. Lots follow the streets, so wedges, corners and slivers all get built on.</p>`;
        break;
      case 'util': case 'svc':
        h = `<div class="row">${Object.entries(SERVICES).filter(([key, S]) => S.cat === s.tool && (!s.platform || TERRACE_SERVICES.includes(key))).map(([k, S]) => {
          const need = S.landmark || S.unlock, locked = need && this.sim.stats.pop < need && !this.sim.sandbox, built = S.landmark && [...this.w.buildings.values()].some((b) => b.svc === k);
          return `<button class="${s.svc === k ? 'on' : ''}" data-svc="${k}" title="${esc(S.desc)}${S.landmark ? ` Landmark: unlocks at ${fmtInt(S.landmark)} people; ₵${fmtInt(S.tourism)}/month tourism.` : ''}" ${locked || built ? 'disabled' : ''}>${S.landmark ? '★ ' : ''}${S.name}<small>${locked ? `pop ${fmtInt(need)}` : built ? 'built' : fmtMoney(S.cost)}</small></button>`;
        }).join('')}</div>
          <p class="hint">${esc(SERVICES[s.svc].desc)} Upkeep ${fmtMoney(SERVICES[s.svc].upkeep)}/month. ${s.platform ? `Placing on terrace #${s.platform}. Click inside the deck. <button data-ground="1">Return to ground</button>` : 'Placement snaps to the nearest road.'}</p>`;
        break;
      case 'district': {
        const ds = this.w.districts.filter(Boolean);
        h = `<div class="row">${ds.map((d) => `<button class="${s.district === d.id && !s.dErase ? 'on' : ''}" data-dist="${d.id}"><span class="sw" style="background:${rgbCss(DISTRICT_COLORS[d.id])}"></span>${esc(d.name)}</button>`).join('')}
          <button data-dist="new">+ New district</button><button class="${s.dErase ? 'on' : ''}" data-dist="erase">Erase</button>${brush}</div>
          <p class="hint">Paint free-form districts, then set local taxes, density and height limits, and service priorities.</p>`;
        break;
      }
      case 'terrain':
        h = `<div class="row">${['raise', 'lower', 'level', 'smooth'].map((m) => `<button data-terrain-mode="${m}" class="${s.terrainMode === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
          <div class="row"><button data-terrain-mode="levee" class="${s.terrainMode==='levee'?'on':''}">Levee · ₵12/cell</button><button data-terrain-mode="removeLevee">Remove levee</button>${this.sim.sandbox ? `<button class="${s.water ? 'on' : ''}" data-water="1"><span class="sw" style="background:#4a8ac8"></span>Water</button><button class="${!s.water ? 'on' : ''}" data-water="0"><span class="sw" style="background:#7ab04a"></span>Land</button>` : ''}${brush}</div>
          <p class="hint">Raise, lower, level (to the height where you start the stroke) or smooth open ground: ₵3 per unit of earth moved; roads, lots and water stay put; Ctrl+Z undoes a stroke. Paint continuous levees on empty land to hold back floods; roads and buildings leave gaps. Levees stand 3 units tall. Storm drains reduce local flood depth. Snowplow depots clear roads. Sandbox also allows water editing.</p>`;
        break;
      case 'lines':
        h = `<div class="row">${Object.entries(TRANSIT).map(([k,m])=>`<button data-transit-mode="${k}" class="${s.transitMode===k?'on':''}">${m.name}<small>Tracks ₵${m.trackCost}/unit</small></button>`).join('')}<button data-show-lines="1">Manage lines (${this.w.lines.length})</button></div>
          <p class="hint">Select a mode, place its stations in Services, then click them in order and press Enter. Buses need a depot; trams follow roads. Rail builds elevated tracks; metro builds tunnels. Track costs are charged on completion. Capacity limits leave excess riders driving.</p>`;
        break;
      case 'bulldoze': h = '<p class="hint">Click a building or road segment to remove it. Services refund 40%. Ctrl+Z undoes.</p>'; break;
      default: h = '<p class="hint">Click buildings, roads or land for details. Right-drag rotates · middle-drag or Shift+right-drag pans · wheel zooms · WASD moves · Q/E turn.</p>';
    }
    $('fly').innerHTML = h;
  }

  flyClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const t = this.tools, d = b.dataset;
    if(d.ground){t.set({platform:0});this.r.cam.targetY=0;}
    if (d.road) t.set({ road: d.road });
    if (d.curve) t.set({ curve: d.curve === '1' });
    if (d.oneway) t.set({ oneway: !t.s.oneway });
    if (d.water) t.set({ water: +d.water,terrainMode:'water' });
    if(d.terrainMode)t.set({terrainMode:d.terrainMode});
    if (d.layer) t.set({ layer: +d.layer });
    if (d.parallel) t.set({ parallel: +d.parallel });
    if (d.upgrade) t.set({ upgrade: !t.s.upgrade });
    if (d.zone) t.set({ zone: +d.zone });
    if (d.fill) t.set({ fill: d.fill === '1', place: 0 });
    if (d.place) t.set({ place: t.s.place === +d.place ? 0 : +d.place });
    if (d.svc) t.set({ svc: d.svc });
    if (d.transitMode) {t.lineStops=[];t.set({transitMode:d.transitMode});}
    if (d.showLines) this.showLines();
    if (d.dist) {
      if (d.dist === 'new') { const nd = this.w.newDistrict(); if (nd) { t.set({ district: nd.id, dErase: false }); this.showDistrict(nd.id); } else this.toast('District limit reached', 'warn'); }
      else if (d.dist === 'erase') t.set({ dErase: !t.s.dErase });
      else { t.set({ district: +d.dist, dErase: false }); this.showDistrict(+d.dist); }
    }
  }
  flyInput(e) {
    const k = e.target.dataset.k; if (!k) return;
    this.tools.s[k] = +e.target.value; e.target.nextElementSibling.textContent = e.target.value; this.tools.refresh();
  }

  // ---------------------------------------------------------------- panels
  openPanel(name, title, fn, district = 0) {
    this.panelName = name; this.panelFn = fn; this.panelTitle = title; this.panelDistrict = district;
    $('panel').hidden = false;
    this.renderPanel(true);
    for (const b of $('dock').children) b.classList.toggle('on', b.dataset.c === this.tools.s.tool || b.dataset.c === name);
  }
  closePanel() { this.sim.selectRoutes(null); this.panelName = null; this.panelFn = null; $('panel').hidden = true; this.toolChanged(); this.r.setHighlight(null); }
  togglePanel(name) {
    if (this.panelName === name) return this.closePanel();
    if (name === 'budget') this.openPanel('budget', () => t('panel.budget'), () => this.budgetHtml());
    if (name === 'overlays') this.openPanel('overlays', () => t('panel.overlays'), () => this.overlayHtml());
    if (name === 'sandbox') this.openPanel('sandbox', () => t('panel.sandbox'), () => this.sandboxHtml());
    if (name === 'lines') this.showLines();
    if (name === 'president') this.openPanel('president', () => t('panel.president'), () => this.presidentHtml());
    if (name === 'people') this.openPanel('people', () => t('panel.people'), () => this.peopleHtml());
    if (name === 'advisors') this.openPanel('advisors', () => t('panel.advisors'), () => this.advisorsHtml());
    if (name === 'region') this.openPanel('region', () => t('panel.region'), () => this.regionHtml());
    if (name === 'share') this.openPanel('share', () => t('panel.share'), () => this.shareHtml());
    if (name === 'settings') this.openPanel('settings', () => t('panel.settings'), () => this.settingsHtml());
    if (name === 'overlays' || name === 'budget') this.sim.tutorialFlags[name] = true;
  }
  renderPanel(force) {
    if (!this.panelFn) return;
    const el = $('panel'), a = document.activeElement;
    if (!force && el.contains(a) && a.matches('input, select')) return;
    const html = this.panelFn(); if (html === null) return this.closePanel();
    const scroll = el.querySelector('.body')?.scrollTop || 0;
    const title = typeof this.panelTitle === 'function' ? this.panelTitle() : this.panelTitle;
    el.innerHTML = `<header><h2>${esc(title)}</h2><button class="x" aria-label="Close">✕</button></header><div class="body">${html}</div>`;
    el.querySelector('.body').scrollTop = scroll;
    el.querySelector('.x').onclick = () => this.closePanel();
    this.bindPanel(el);
  }

  bindPanel(el) {
    el.querySelectorAll('[data-pol]').forEach((inp) => { inp.onchange = () => { this.w.econ?.setPolicy(this.w.econ.active, { [inp.dataset.pol]: +inp.value }); this.renderPanel(true); }; });
    el.querySelector('[data-pol-dev]')?.addEventListener('change', (e) => { this.w.econ?.setPolicy(this.w.econ.active, { dev: e.target.value }); this.renderPanel(true); });
    el.querySelector('[data-hist]')?.addEventListener('change', (e) => { this.histMetric = e.target.value; this.renderPanel(true); });
    el.querySelector('[data-report-close]')?.addEventListener('click', () => { this.reportTerm = null; this.renderPanel(true); });
    el.querySelectorAll('[data-ord]').forEach((c) => { c.onchange = () => { this.sim.setOrdinance(c.dataset.ord, c.checked); this.renderPanel(true); }; });
    el.querySelectorAll('[data-advov]').forEach((b) => { b.onclick = () => { this.r.setOverlay(b.dataset.advov); this.toast(`Overlay: ${OVERLAYS[b.dataset.advov].name}`, 'info'); }; });
    el.querySelector('[data-share-link]')?.addEventListener('click', async () => {
      try { const url = shareLink(await encodeSave(makeSave(this.w, this.sim))); await navigator.clipboard.writeText(url); this.toast(`Link copied (${Math.round(url.length / 1024)} KB). Anyone opening it gets a copy of this city.`, 'good'); }
      catch (e) { this.toast('Could not copy the link: ' + e.message, 'bad'); }
    });
    el.querySelector('[data-open-world]')?.addEventListener('click', () => this.toggleWorldMap(true));
    el.querySelector('[data-deal-add]')?.addEventListener('click', () => {
      const q = (k) => el.querySelector(`[data-deal-${k}]`).value, r = this.actions.region(), mk = this.sim.market(), kind = q('kind'), role = q('role'), partner = q('partner');
      const price = Math.round((kind === 'power' ? 18 * mk.power : 5 * mk.water) * 0.85);
      this.actions.addDeal({ seller: role === 'sell' ? r.active : partner, buyer: role === 'sell' ? partner : r.active, kind, amount: +q('amount'), price });
      this.toast('Deal signed. It runs every month while both cities have a road link on that side.', 'good'); this.renderPanel(true);
    });
    el.querySelectorAll('[data-deal-del]').forEach((b) => { b.onclick = () => { this.actions.removeDeal(+b.dataset.dealDel); this.renderPanel(true); }; });
    el.querySelectorAll('[data-offpeak]').forEach((sel) => { sel.onchange = () => { const l = this.w.lines.find((q) => q.id === +sel.dataset.offpeak); if (l) { l.offpeak = +sel.value; this.w.lineVersion++; } }; });
    el.querySelectorAll('[data-headway]').forEach((sel) => { sel.onchange = () => { const l = this.w.lines.find((q) => q.id === +sel.dataset.headway); if (l) { l.headway = +sel.value; this.w.lineVersion++; } }; });
    el.querySelectorAll('[data-wm-rename]').forEach((b) => { b.onclick = () => { const n = prompt('Name this city', this.actions.region().tiles[b.dataset.wmRename].name || ''); if (n) this.actions.renameTile(b.dataset.wmRename, n); }; });
    el.querySelector('[data-share-file]')?.addEventListener('click', () => download(`organicity-${this.w.seed}-${this.sim.year}.organicity`, JSON.stringify(makeSave(this.w, this.sim)), 'application/json'));
    el.querySelectorAll('[data-set]').forEach((c) => { c.onchange = () => { const S = loadSettings(), k = c.dataset.set; S[k] = k === 'palette' ? (c.checked ? 'cb' : 'default') : c.type === 'checkbox' ? c.checked : c.type === 'range' || k === 'uiScale' ? +c.value : c.value; try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch { /* ignore */ } this.applySettings(); }; });
    el.querySelector('[data-lang]')?.addEventListener('change', (e) => { setLang(e.target.value); this.buildHud(); this.renderDock(); this.toolChanged(); this.hud(); this.renderPanel(true); });
    el.querySelector('[data-pack-add]')?.addEventListener('click', () => el.querySelector('[data-pack-file]').click());
    el.querySelector('[data-pack-file]')?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { const info = addUserPack(await f.text()); this.toast(`Pack "${info.name}" added: ${info.styles.length} styles, ${info.landmarks.length} landmarks.`, 'good'); } catch (err) { this.toast('Not a valid pack: ' + err.message, 'bad'); } this.renderPanel(true); });
    el.querySelectorAll('[data-pack-del]').forEach((b) => { b.onclick = () => { removeUserPack(b.dataset.packDel); this.toast('Pack removed; it disappears after a reload.', 'info'); this.renderPanel(true); }; });
    el.querySelector('[data-vol]')?.addEventListener('input', (e) => { this.audio?.setVolume(+e.target.value / 100); e.target.nextElementSibling.textContent = e.target.value + '%'; });
    el.querySelector('[data-mute]')?.addEventListener('change', (e) => { if (this.audio && this.audio.muted !== e.target.checked) this.audio.toggleMute(); });
    el.querySelector('[data-era-advance]')?.addEventListener('click',()=>{this.sim.advanceEra();this.hud();this.renderPanel(true);});
    // build a new deck at the chosen floor, or expand an existing deck by id
    const makeDeck = (plan, label) => {
      if(!plan.ok)return this.toast(plan.err,'warn');if(!this.sim.canAfford(plan.cost))return this.toast('Not enough money','warn');
      this.w.beginTx(label);const p=this.w.buildPlatform(plan);this.w.commitTx(plan.cost);this.sim.spend(plan.cost);this.showPlatform(p.id);
    };
    el.querySelectorAll('[data-platform-build]').forEach(btn=>{btn.onclick=()=>makeDeck(this.w.planPlatform(+btn.dataset.platformBuild,false,this.deckLevel||null),'Build terrace');});
    el.querySelectorAll('[data-platform-expand]').forEach(btn=>{const p=this.w.platforms.get(+btn.dataset.platformExpand);btn.onclick=()=>p&&makeDeck(this.w.planPlatform(p.host,p.id),'Expand terrace');});
    el.querySelector('[data-deck-level]')?.addEventListener('change',e=>{this.deckLevel=+e.target.value||null;this.renderPanel(true);});
    el.querySelector('[data-deck-level]')?.addEventListener('input',e=>{e.target.nextElementSibling.textContent=+e.target.value?`floor ${e.target.value}`:'roof';});
    el.querySelectorAll('[data-platform-open]').forEach(btn=>{btn.onclick=()=>this.showPlatform(+btn.dataset.platformOpen);});
    el.querySelectorAll('[data-platform-service]').forEach(btn=>{btn.onclick=()=>{
      const [id,key]=btn.dataset.platformService.split(':');this.tools.setTool(SERVICES[key].cat,{svc:key,platform:+id});this.focusPlatform(+id);
    };});
    el.querySelector('[data-platform-remove]')?.addEventListener('click',e=>{
      const id=+e.target.dataset.platformRemove;
      if([...this.w.buildings.values()].some(b=>b.platformId===id))return this.toast('Remove terrace services first.','warn');
      this.w.beginTx('Remove terrace');this.w.platforms.delete(id);this.w.platformVersion++;this.w.commitTx();this.tools.s.platform=0;this.r.cam.targetY=0;this.closePanel();
    });
    el.querySelector('[data-ground-view]')?.addEventListener('click',()=>{this.tools.set({platform:0});this.r.cam.targetY=0;});
    el.querySelector('[data-follow]')?.addEventListener('click', () => this.followResident(this.inspected, 0));
    el.querySelector('[data-follow-next]')?.addEventListener('click', () => { const f = this.r.follow; if (f) this.followResident(this.w.buildings.get(f.citizen.home), f.citizen.k + 1); });
    el.querySelector('[data-follow-cam]')?.addEventListener('click', () => { if (this.r.follow) { this.r.follow.camera = !this.r.follow.camera; this.renderPanel(true); } });
    el.querySelector('[data-follow-stop]')?.addEventListener('click', () => { this.r.follow = null; this.closePanel(); });
    el.querySelector('[data-skyline]')?.addEventListener('click',()=>{const b=this.inspected;this.r.cam.x=b.cx;this.r.cam.z=b.cz;this.r.cam.targetY=(b.top || buildingFloors(b,this.w)*1.6)/2;this.r.cam.dist=Math.max(100,this.r.cam.targetY*3);});
    el.querySelector('[data-tints]')?.addEventListener('change', e => { this.r.buildingTints = e.target.checked; });
    el.querySelectorAll('[data-route]').forEach(b => { b.onclick = () => { this.r.routeKind = b.dataset.route; this.renderPanel(true); }; });
    el.querySelectorAll('[data-budget]').forEach(inp => { inp.oninput = () => { this.sim.setBudget(inp.dataset.budget, +inp.value / 100); inp.nextElementSibling.textContent = inp.value + '%'; }; });
    el.querySelectorAll('[data-loan]').forEach(btn => { btn.onclick = () => { this.sim.takeLoan(+btn.dataset.loan); this.renderPanel(true); }; });
    el.querySelectorAll('[data-bond]').forEach((btn) => { btn.onclick = () => { if (!this.sim.issueBond(+btn.dataset.bond, this.bondYears || 10)) this.toast('The market will not take this bond at your rating.', 'warn'); this.renderPanel(true); }; });
    el.querySelectorAll('[data-bondyears]').forEach((r) => { r.onchange = () => { this.bondYears = +r.value; this.renderPanel(true); }; });
    el.querySelectorAll('[data-redeem]').forEach((btn) => { btn.onclick = () => { if (!this.sim.redeemBond(+btn.dataset.redeem)) this.toast('Not enough funds to redeem this bond.', 'warn'); this.renderPanel(true); }; });
    el.querySelector('[data-insure]')?.addEventListener('change', (e) => { this.sim.insurance = e.target.checked; this.renderPanel(true); });
    el.querySelector('[data-prep]')?.addEventListener('input', (e) => { this.sim.preparedness = +e.target.value / 100; e.target.nextElementSibling.textContent = e.target.value + '%'; });
    el.querySelector('[data-landtax]')?.addEventListener('input', (e) => { this.sim.landTax = +e.target.value; e.target.nextElementSibling.textContent = e.target.value + '%'; });
    el.querySelectorAll('[data-repay]').forEach(btn => { btn.onclick = () => { if (!this.sim.repayLoan(+btn.dataset.repay)) this.toast('Not enough funds to repay this loan.', 'warn'); this.renderPanel(true); }; });
    el.querySelectorAll('[data-tax]').forEach((inp) => { inp.oninput = () => { this.sim.tax[inp.dataset.tax] = +inp.value; inp.nextElementSibling.textContent = inp.value + '%'; }; });
    el.querySelectorAll('[data-ov]').forEach((b) => { b.onclick = () => { this.r.setOverlay(b.dataset.ov); this.renderPanel(true); }; });
    el.querySelectorAll('[data-retype]').forEach((b) => {
      b.onclick = () => {
        const [id, type] = b.dataset.retype.split(':'), e = this.w.net.edges.get(+id); if (!e) return;
        const cost = Math.round(ROADS[type].cost * e.len * 0.7);
        if (!this.sim.canAfford(cost)) return this.toast('Not enough money', 'warn');
        this.w.beginTx(`Change to ${ROADS[type].name.toLowerCase()}`, { net: true }); this.w.retypeRoad(+id, type); this.w.commitTx(cost);
        this.sim.spend(cost); this.inspectRoad(this.w.net.edges.get(+id));
      };
    });
    el.querySelectorAll('[data-bracket]').forEach((inp) => { inp.oninput = () => { this.sim.brackets[inp.dataset.bracket] = +inp.value; inp.nextElementSibling.textContent = (inp.value > 0 ? '+' : '') + inp.value + '%'; }; });
    el.querySelectorAll('[data-trade]').forEach((c) => { c.onchange = () => { this.sim.trade[c.dataset.trade] = c.checked; }; });
    el.querySelectorAll('[data-buslane]').forEach((b) => {
      b.onclick = () => { const e = this.w.net.edges.get(+b.dataset.buslane); if (!e) return; this.w.beginTx('Bus lanes', { net: true }); this.w.setBusLane(e.id, !e.busLane); this.w.commitTx(); this.renderPanel(true); };
    });
    el.querySelectorAll('[data-junction]').forEach((b) => {
      b.onclick = () => {
        const [id, ctl] = b.dataset.junction.split(':'), cost = JUNCTIONS[ctl].cost;
        if (!this.sim.canAfford(cost)) return this.toast('Not enough money', 'warn');
        this.w.beginTx(JUNCTIONS[ctl].name, { net: true });
        if (this.w.setJunction(+id, ctl)) { this.sim.spend(cost); this.w.commitTx(cost); } else this.w.commitTx();
        this.renderPanel(true);
      };
    });
    el.querySelectorAll('[data-line-del]').forEach((b) => { b.onclick = () => { this.w.beginTx('Remove line'); this.w.removeLine(+b.dataset.lineDel); this.w.commitTx(); this.renderPanel(true); }; });
    el.querySelectorAll('[data-oneway]').forEach((b) => {
      b.onclick = () => {
        const [id, ow] = b.dataset.oneway.split(':').map(Number);
        this.w.beginTx('One-way', { net: true }); this.w.setOneway(id, ow); this.w.commitTx(); this.renderPanel(true);
      };
    });
    el.querySelectorAll('[data-setlevel]').forEach((b) => {
      b.onclick = () => { const bl = this.inspected; if (!bl || bl.removed) return; this.w.rebuildAt(bl, +b.dataset.setlevel); bl.locked = true; this.renderPanel(true); };
    });
    el.querySelector('[data-lock]')?.addEventListener('change', (e) => { if (this.inspected) this.inspected.locked = e.target.checked; });
    if (this.panelName === 'sandbox') this.bindSandbox(el);
    const dId = this.panelName === 'district' ? this.panelDistrict : 0, D = this.w.districts[dId];
    if (!D) return;
    const P = D.policy, q = (s) => el.querySelector(s);
    q('[data-dname]').addEventListener('change', (e) => { D.name = e.target.value.trim().slice(0, 32) || D.name; this.toolChanged(); this.renderPanel(true); });
    el.querySelectorAll('[data-dtax]').forEach((inp) => { inp.oninput = () => { P.tax[inp.dataset.dtax] = +inp.value; inp.nextElementSibling.textContent = (inp.value > 0 ? '+' : '') + inp.value + '%'; }; });
    q('[data-maxlevel]').addEventListener('input', (e) => { P.maxLevel = +e.target.value; e.target.nextElementSibling.textContent = P.maxLevel; });
    q('[data-maxfloors]').addEventListener('input', (e) => { e.target.nextElementSibling.textContent = e.target.value; });
    q('[data-maxfloors]').addEventListener('change', (e) => { P.maxFloors = +e.target.value; this.touchDistrict(dId); });
    q('[data-prio]').addEventListener('change', (e) => { P.priority = e.target.value; this.w.districtVersion++; });
    q('[data-style]').addEventListener('change', (e) => { P.style = e.target.value; this.touchDistrict(dId); });
    q('[data-green]').addEventListener('change', (e) => { P.green = e.target.checked; });
    q('[data-historic]').addEventListener('change', (e) => { P.historic = e.target.checked; });
    q('[data-carfree]').addEventListener('change', (e) => { P.carFree = e.target.checked; });
    q('[data-ddel]').addEventListener('click', () => {
      if (!confirm(`Dissolve ${D.name}? Buildings stay; the district and its policies are removed.`)) return;
      for (let i = 0; i < this.w.district.length; i++) if (this.w.district[i] === dId) this.w.district[i] = 0;
      for (const b of this.w.buildings.values()) if (b.district === dId) b.district = 0;
      this.w.districts[dId] = null; this.w.markGround(0, 0, 512, 512);
      if (this.tools.s.district === dId) this.tools.s.district = 0;
      this.closePanel();
    });
  }

  touchDistrict(id) { for (const b of this.w.buildings.values()) if (b.district === id && !b.svc) this.w.touchBuilding(b); }

  budgetHtml() {
    const s = this.sim, st = s.stats, inc = st.inc || {}, exp = st.exp || {};
    const m = (v) => fmtMoney((v || 0) * MONTH_DAYS);
    const util = (name, [sup, dem]) => `<tr><td>${name}</td><td>${Math.round(sup)}</td><td>${Math.round(dem)}</td><td>${bar(dem ? sup / dem / 1.2 : 1)}</td></tr>`;
    const hist = s.history.slice(-24), ga = st.garbage;
    let spark = '';
    if (hist.length > 1) {
      const maxP = Math.max(1, ...hist.map((h) => h.pop)), W = 260, H = 44;
      const pts = hist.map((h, i) => `${((i / (hist.length - 1)) * W).toFixed(1)},${(H - (h.pop / maxP) * (H - 4) - 2).toFixed(1)}`).join(' ');
      spark = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}"/></svg><p class="dim">Population, last ${hist.length} months (peak ${fmtInt(maxP)})</p>`;
    }
    return `
      <h3>Tax rates</h3>
      ${['R', 'C', 'I', 'O'].map((k) => `<label class="rng wide">${KIND[k]}<input type="range" min="0" max="29" value="${s.tax[k]}" data-tax="${k}"><b>${s.tax[k]}%</b></label>`).join('')}
      <p class="dim">Higher taxes raise income but dampen demand and happiness. 9% is neutral.</p>
      <h3>Tax brackets</h3>
      ${[['lowDensity', 'Low-density homes'], ['highDensity', 'Apartments & mixed'], ['smallBiz', 'Small business (L1–2)'], ['largeBiz', 'Large business (L3–5)']].map(([k, n]) => `<label class="rng wide">${n}<input type="range" min="-5" max="5" value="${s.brackets[k]}" data-bracket="${k}"><b>${s.brackets[k] > 0 ? '+' : ''}${s.brackets[k]}%</b></label>`).join('')}
      <p class="dim">Offsets added to the zone rates above (and before district offsets).</p>
      <h3>Utility trade at the highway</h3>
      <label class="chk"><input type="checkbox" data-trade="sell" ${s.trade.sell ? 'checked' : ''}> Sell surplus power & water (₵18/MW, ₵5/unit a month)</label>
      <label class="chk"><input type="checkbox" data-trade="buy" ${s.trade.buy ? 'checked' : ''}> Import shortfalls (₵45/MW, ₵12.5/unit a month)</label>
      <p class="dim">Only networks connected to the highway can trade. Now: selling ${Math.round(s.tradeFlow.soldP)} MW / ${Math.round(s.tradeFlow.soldW)} water · buying ${Math.round(s.tradeFlow.boughtP)} MW / ${Math.round(s.tradeFlow.boughtW)} water.</p>
      <h3>Service funding</h3>
      <p class="dim">50–150%: funding changes operating cost, utility output and service reach. Parks also respond to funding.</p>
      ${[...new Set([...this.w.buildings.values()].filter(b => b.svc).map(b => b.svc))].map(k => `<label class="rng wide">${SERVICES[k].name}<input type="range" min="50" max="${s.austerity ? 75 : 150}" step="5" value="${Math.round(s.budgetFor(k) * 100)}" data-budget="${k}"><b>${Math.round(s.budgetFor(k) * 100)}%</b></label>`).join('') || '<p class="dim">Place a service to adjust its funding.</p>'}
      ${s.gameOver ? `<p class="bad"><b>Bankrupt.</b> The scenario is lost — load a save or start a new city.</p>` : s.debtMonths ? `<p class="bad">In debt for ${s.debtMonths} month${s.debtMonths > 1 ? 's' : ''}.${s.austerity ? ' Austerity caps service funding at 75%.' : ''} ${s.sandbox ? '' : 'After 6 months: ' + (s.scenario && !s.scenarioWon ? 'bankruptcy.' : 'a state bailout at 2% a month.')}</p>` : ''}
      ${(() => { const cr = s.creditRating(); return `<h3>Credit rating · <b class="${cr.grade.startsWith('A') ? 'pos' : cr.grade.startsWith('B') ? 'warn' : 'neg'}">${cr.grade}</b></h3>
      <p class="dim">Score ${cr.score}/100 from debt (${fmtMoney(cr.debt)} of a ${fmtMoney(cr.limit)} limit), deficits in the past year and debt trouble. Better ratings borrow cheaper: new bonds pay ${(cr.rate * 100).toFixed(1)}% a year (+0.5% for 20 years).</p>
      <div class="row">${[25000, 50000, 100000, 250000].map((v) => `<button data-bond="${v}" ${cr.grade === 'CCC' || cr.debt + v > cr.limit || s.sandbox?.infinite ? 'disabled' : ''}>Issue ${fmtMoney(v)}</button>`).join('')}</div>
      <div class="row"><label class="chk"><input type="radio" name="bondyears" value="10" ${(this.bondYears || 10) === 10 ? 'checked' : ''} data-bondyears> 10 years</label><label class="chk"><input type="radio" name="bondyears" value="20" ${this.bondYears === 20 ? 'checked' : ''} data-bondyears> 20 years</label></div>
      ${s.bonds.map((b) => `<p>Bond ${fmtMoney(b.principal)} · ${(b.rate * 100).toFixed(1)}% (${b.grade}) · due ${Math.max(0, Math.ceil((b.due - s.day) / 360))} yr <button data-redeem="${b.id}" title="Repay early with a 2% premium">Redeem</button></p>`).join('')}`; })()}
      <p class="dim">Bonds pay interest monthly and the principal at maturity. They replace short loans.</p>
      ${s.loans.length ? `<h3>Loans</h3>${s.loans.map(l => `<p>${l.bailout ? 'Bailout · ' : ''}${fmtMoney(l.balance)} remaining · ${fmtMoney(l.payment)}/month · ${Math.ceil(l.days / MONTH_DAYS)} months <button data-repay="${l.id}">Repay</button></p>`).join('')}` : ''}
      <h3>Disaster insurance & preparedness</h3>
      <label class="chk"><input type="checkbox" data-insure ${s.insurance ? 'checked' : ''}> Insure buildings: ${fmtMoney(s.insuredValue() * 0.0004 * (1 - 0.2 * Math.min(1, s.preparedness || 0)))}/month for ${fmtMoney(s.insuredValue())} of property; claims pay 80% of each wrecked building${s.claims ? ` · ${fmtMoney(s.claims)} paid out so far` : ''}</label>
      <label class="rng wide">Preparedness funding<input type="range" min="0" max="150" step="25" value="${Math.round((s.preparedness || 0) * 100)}" data-prep><b>${Math.round((s.preparedness || 0) * 100)}%</b></label>
      <p class="dim">₵600/month at 100%: up to a third less disaster damage, faster rubble clearance from 75%, and up to 20% off premiums.</p>
      <h3>Land tax</h3>
      <label class="rng wide">Yearly rate on land value<input type="range" min="0" max="3" step="0.25" value="${s.landTax || 0}" data-landtax><b>${s.landTax || 0}%</b></label>
      <p class="dim">Taxes lot value (area × land value) and slightly dampens housing and shop demand. Rising land values in old low-rise areas cause redevelopment that displaces residents${st.displaced ? ` (${fmtInt(st.displaced)} last month)` : ''}.</p>
      <h3>Forecast</h3><p>In three months: ${fmtMoney(s.money + 3 * (st.incomeM - st.expenseM))}</p>
      <p class="dim">Assumes current income and spending continue; construction costs and future growth are excluded.</p>
      ${s.scenario ? `<h3>${s.scenarioWon ? 'Scenario complete' : 'Scenario goals'}</h3>${s.scenarioProgress().map(([label, ok]) => `<p>${ok ? '✓' : '○'} ${label}</p>`).join('')}` : ''}
      <h3>Monthly budget</h3>
      <table class="kv">
        <tr><td>Residential tax</td><td class="pos">${m(inc.R)}</td></tr><tr><td>Commercial tax</td><td class="pos">${m(inc.C)}</td></tr>
        <tr><td>Industrial tax</td><td class="pos">${m(inc.I)}</td></tr><tr><td>Office tax</td><td class="pos">${m(inc.O)}</td></tr>
        <tr><td>Services upkeep</td><td class="neg">-${m(exp.services)}</td></tr><tr><td>Utilities upkeep</td><td class="neg">-${m(exp.utilities)}</td></tr>
        <tr><td>Bus fares</td><td class="pos">${m(inc.fares)}</td></tr><tr><td>Tourism</td><td class="pos">${m(inc.tourism)}</td></tr><tr><td>Utility exports</td><td class="pos">${m(inc.trade)}</td></tr><tr><td>Goods exports</td><td class="pos">${m(inc.exports)}</td></tr>
        <tr><td>Utility imports</td><td class="neg">-${m(exp.imports)}</td></tr><tr><td>District policies</td><td class="neg">-${m(exp.policies)}</td></tr><tr><td>Ordinances</td><td class="neg">-${m(exp.ordinances)}</td></tr>
        <tr><td>Utility deals</td><td class="${(inc.deals || 0) - (exp.deals || 0) < 0 ? 'neg' : 'pos'}">${m((inc.deals || 0) - (exp.deals || 0))}</td></tr><tr><td>Land tax</td><td class="pos">${m(inc.land)}</td></tr><tr><td>Tolls</td><td class="pos">${m(inc.tolls)}</td></tr>
        <tr><td>Bond interest</td><td class="neg">-${m(exp.bonds)}</td></tr><tr><td>Insurance & preparedness</td><td class="neg">-${m((exp.insurance || 0) + (exp.preparedness || 0))}</td></tr>
        <tr><td>Road maintenance</td><td class="neg">-${m(exp.roads)}</td></tr><tr><td>Bus lines</td><td class="neg">-${m(exp.transit)}</td></tr><tr><td>Traffic signals</td><td class="neg">-${m(exp.junctions)}</td></tr><tr><td>Loan payments</td><td class="neg">-${m(exp.debt)}</td></tr>
        <tr class="sum"><td>Net</td><td class="${st.incomeM - st.expenseM < 0 ? 'neg' : 'pos'}">${fmtMoney(st.incomeM - st.expenseM)}</td></tr>
      </table>
      <h3>Utilities</h3>
      <table class="kv util"><tr><th></th><th>Supply</th><th>Use</th><th></th></tr>
        ${util('Electricity (MW)', st.power)}${util('Water', st.water)}${util('Sewage', st.sewage)}
        <tr><td>Garbage / day</td><td>${Math.round(ga[0])}</td><td>${Math.round(ga[1])}</td><td>${ga[2] ? `landfill ${Math.round(ga[2] * 100)}% full` : ''}</td></tr>
      </table>
      <h3>City</h3>
      <table class="kv">
        <tr><td>Population</td><td>${fmtInt(st.pop)}</td></tr><tr><td>Households</td><td>${fmtInt(st.households)} / ${fmtInt(st.hhCap || 0)}</td></tr>
        <tr><td>Workers</td><td>${fmtInt(st.workers)} (${Math.round(st.unemp * 100)}% unemployed)</td></tr>
        <tr><td>Jobs C / I / O</td><td>${fmtInt(st.filled.C)}/${fmtInt(st.jobs.C)} · ${fmtInt(st.filled.I)}/${fmtInt(st.jobs.I)} · ${fmtInt(st.filled.O)}/${fmtInt(st.jobs.O)}</td></tr>
        <tr><td>Commuters in</td><td>${fmtInt(st.commuters)}</td></tr><tr><td>Educated share</td><td>${Math.round(st.eduRate * 100)}%</td></tr>
        <tr><td>Resident happiness</td><td>${bar(st.happyR)}</td></tr>
      </table>
      ${spark}
      ${['money', 'income', 'expense'].map(key => {
        if (hist.length < 2) return '';
        const low = Math.min(0, ...hist.map(h => h[key] || 0)), high = Math.max(1, ...hist.map(h => h[key] || 0));
        const points = hist.map((h,i) => `${i / (hist.length - 1) * 260},${42 - ((h[key] || 0) - low) / (high - low) * 40}`).join(' ');
        return `<p>${key}: ${fmtMoney(low)} to ${fmtMoney(high)}</p><svg class="spark" role="img" aria-label="Monthly ${key} history" viewBox="0 0 260 44"><polyline points="${points}"/></svg>`;
      }).join('')}
      <h3>Era & aerial transport</h3><p>${s.year} · ${s.tech.style}. Technology ceiling: ${s.tech.heightLimit} floors. District caps still apply.</p>
      <p>${s.sky.hubs.length} sky hubs · ${fmtInt(s.stats.modal?.air || 0)} trips by air per pass · ${s.bridges().length} skybridges</p>
      <p class="dim">From 2050, completed level-3+ buildings with at least 12 floors become sky hubs. Up to ${Math.round(s.sky.share*100)}% of hub residents' trips fly to the hub nearest their destination, while both pads have capacity (taller towers handle more); the rest drive. Skybridges join nearby towers from 2000 and share their service coverage.</p>
      <h3>Simulation</h3>
      <p class="dim">Coverage, land value &amp; traffic run ${s.host.mode === 'worker' ? 'in a Web Worker' : 'on the main thread'} (${s.coreJob.ms.toFixed(1)} ms per pass) · ${s.jobs.map((j) => `${j.name} ${j.ms.toFixed(1)} ms`).join(' · ')} · ${fmtInt(this.w.buildings.size)} buildings · ${fmtInt(this.w.net.edges.size)} road segments</p>`;
  }

  peopleHtml() {
    const s = this.sim, st = s.stats, pop = Math.max(1, st.pop), pct = (v) => `${Math.round(v * 100)}%`;
    const load = (used, cap, label) => cap ? `<tr><td>${label}</td><td>${bar(clamp(1.25 - used / cap, 0, 1))} ${fmtInt(used)} / ${fmtInt(cap)}</td></tr>` : `<tr><td>${label}</td><td class="neg">none built</td></tr>`;
    return `
      <h3>Population</h3>
      <table class="kv">
        <tr><td>Children</td><td>${fmtInt(st.kids)} · ${pct(st.kids / pop)}</td></tr>
        <tr><td>Working age</td><td>${fmtInt(st.adults)} · ${pct(st.adults / pop)}</td></tr>
        <tr><td>Retirees</td><td>${fmtInt(st.seniors)} · ${pct(st.seniors / pop)}</td></tr>
      </table>
      <p class="dim">New homes attract young families; neighbourhoods age with their buildings, so older districts need more care and fewer school seats. Retirees pay about half the income tax. Redevelopment brings in new, younger residents.</p>
      <h3>Education</h3>
      <table class="kv">
        ${load(st.kids, st.seats, 'School seats')}
        ${load(st.adults * 0.1, st.hiSeats, 'College & university seats')}
        <tr><td>Schooled</td><td>${bar(st.eduRate)} ${pct(st.eduRate)}</td></tr>
        <tr><td>Graduates</td><td>${bar(st.hiEdu / 0.5)} ${pct(st.hiEdu)}</td></tr>
      </table>
      <p class="dim">School → college (unlocks at 1,500 people) → university (5,000). Graduates staff top-level offices (level 5 needs 20%) and tech firms, which need a university nearby.</p>
      <h3>Health & safety</h3>
      <table class="kv">
        ${load(st.pop + st.seniors * 2, st.patients, 'Clinic places (retirees count triple)')}
        <tr><td>Illness</td><td class="${st.sick ? 'neg' : ''}">${st.sick ? `${st.sick} buildings affected` : 'none'}</td></tr>
      </table>
      <p class="dim">Homes without clinic cover, or with overloaded clinics, risk outbreaks that spread to neighbours. Crime follows density; police and schools reduce it (Crime overlay).</p>
      <h3>Ordinances</h3>
      ${Object.entries(ORDINANCES).map(([k, o]) => `<label class="chk"><input type="checkbox" data-ord="${k}" ${s.ordinances[k] ? 'checked' : ''}> <b>${o.name}</b> ${o.cost ? `· ₵${fmtInt(o.cost)}/mo` : ''}<br><span class="dim">${o.desc}</span></label>`).join('')}`;
  }

  advisorsHtml() {
    const s = this.sim, list = s.advisors(), MOOD = { good: '●', warn: '▲', bad: '■' };
    return `<div class="advisors">${list.map((a) => `<div class="adv ${a.mood}"><b>${MOOD[a.mood]} ${a.who}</b><p>${esc(a.text)}</p>${a.ov ? `<button data-advov="${a.ov}">Show ${OVERLAYS[a.ov].name.toLowerCase()}</button>` : ''}</div>`).join('')}</div>
      <h3>City news</h3>
      <ul class="newslist">${s.news.slice(-14).reverse().map((n) => `<li class="${n.kind}"><small>${n.year} · ${MONTHS[Math.floor((n.day % 360) / MONTH_DAYS)]}</small> ${esc(n.text)}</li>`).join('') || '<li class="dim">No news yet.</li>'}</ul>`;
  }

  regionHtml() {
    const s = this.sim, st = s.stats, reg = s.regionList(), mk = s.market(), inc = st.inc || {}, P = reg.reduce((t, r) => t + (r.connected ? r.pop : 0), 0);
    const price = (v) => `<span class="${v >= 1 ? 'pos' : 'neg'}">${Math.round(v * 100)}%</span>`;
    return `<div class="row"><button class="primary" data-open-world>Open the world map (M)</button></div><h3>Neighbouring cities</h3>
      <table class="kv">${reg.map((r) => `<tr><td>${esc(r.name)}</td><td>${fmtInt(r.pop)} people${r.connected ? ` · ${fmtInt(P ? (st.commuters * r.pop) / P : 0)} commute in` : ' · <span class="dim">no road link</span>'}</td></tr>`).join('') || '<tr><td colspan="2" class="dim">No highway exits.</td></tr>'}</table>
      <p class="dim">One neighbour sits beyond each highway exit. They grow over time, faster while trading with you, and bigger neighbours pay more for goods.</p>
      <h3>Markets (vs. usual price)</h3>
      <table class="kv">
        <tr><td>Goods (industry exports)</td><td>${price(mk.goods)} · ${fmtMoney((inc.exports || 0) * MONTH_DAYS)}/mo</td></tr>
        <tr><td>Electricity</td><td>${price(mk.power)} · sell ₵${Math.round(18 * mk.power)}/MW · buy ₵${Math.round(45 * mk.power)}</td></tr>
        <tr><td>Water</td><td>${price(mk.water)} · sell ₵${Math.round(5 * mk.water)} · buy ₵${Math.round(12.5 * mk.water)}</td></tr>
      </table>
      <p class="dim">Prices swing with the seasons: power is dear in winter, water in heatwaves. Utility trade is set in the Budget.</p>
      <h3>Commuting</h3>
      <table class="kv"><tr><td>Workers commuting in</td><td>${fmtInt(st.commuters)}</td></tr><tr><td>Residents working outside</td><td>${fmtInt(st.outJobs || 0)}</td></tr></table>
      <h3>Regional exits</h3>
      <table class="kv">${s.exitWeights().map((x) => `<tr><td>${x.side} edge${x.name ? ` → ${esc(x.name)}` : ''}</td><td>${fmtInt(s.exitLoad?.get(x.id) || 0)} trips/pass</td></tr>`).join('') || '<tr><td class="dim" colspan="2">No roads leave the tile.</td></tr>'}</table>
      <p class="dim">Draw a road to the edge of the map to open a new exit; amber posts mark where a neighbouring city's road reaches the border. Commuters and freight use the exit facing the city they travel to, so busy neighbours load their exits.</p>
      <h3>Goods</h3>
      ${st.goods ? `<table class="kv"><tr><td>Shops need</td><td>${fmtInt(st.goods.demand)}</td></tr><tr><td>Local industry</td><td>${fmtInt(st.goods.usedLocal)} used · ${fmtInt(st.goods.exportable)} exported</td></tr><tr><td>Imported</td><td>${fmtInt(st.goods.imported)}</td></tr><tr><td>Supply</td><td>${bar(st.goods.supply)} ${Math.round(st.goods.supply * 100)}%</td></tr>
        ${s.terminals().map((t) => `<tr><td>${SERVICES[t.svc].name}</td><td>${fmtInt(s.terminalLoad?.get(t.id) || 0)} / ${fmtInt(t.cap)} freight</td></tr>`).join('')}</table>` : ''}
      <p class="dim">Shops without enough goods earn less and lose customers. Cargo rail, a harbour or an airport import goods, take trucks off the roads and raise export prices.</p>
      ${this.dealsHtml()}`;
  }

  // utility deals with your neighbouring cities (stored in the region)
  dealsHtml() {
    const r = this.actions.region?.(); if (!r) return '';
    const s = this.sim, mine = Object.values(s.tileNeighbours || {}).filter((t) => t.kind === 'city' && t.gov !== 'ai'), mk = s.market();
    const rows = s.dealFlow?.rows || s.deals || [];
    return `<h3>Utility deals</h3>
      ${rows.map((d) => { const other = r.tiles[d.partner]; return `<p>${d.role === 'sell' ? 'Sell' : 'Buy'} ${d.amount} ${d.kind === 'power' ? 'MW' : 'water'} ${d.role === 'sell' ? 'to' : 'from'} ${esc(other?.name || d.partner)} · ₵${d.price}/unit/month${d.linked === false ? ' · <span class="neg">no road link on that side</span>' : d.role === 'sell' && d.delivered < d.amount ? ` · <span class="warn">delivering ${Math.round(d.delivered)}</span>` : ''} <button data-deal-del="${d.id}">Cancel</button></p>`; }).join('') || '<p class="dim">No deals yet.</p>'}
      ${mine.length ? `<div class="row"><select data-deal-partner>${mine.map((t) => `<option value="${t.key}">${esc(t.name)}</option>`).join('')}</select><select data-deal-role><option value="sell">Sell</option><option value="buy">Buy</option></select><select data-deal-kind><option value="power">Power (MW)</option><option value="water">Water</option></select><select data-deal-amount>${[10, 25, 50, 100].map((v) => `<option>${v}</option>`).join('')}</select><button data-deal-add>Sign</button></div>
        <p class="dim">Contracts between your own cities run each month over a road link on the shared side. Price: 85% of the market (now ₵${Math.round(18 * mk.power * 0.85)}/MW, ₵${Math.round(5 * mk.water * 0.85)}/water unit). The seller delivers what surplus allows.</p>` : '<p class="dim">Found a city on a neighbouring tile (World map, M) to trade power and water with it.</p>'}`;
  }

  shareHtml() {
    return `<p>Send this city to someone: the whole save travels inside the link or file, so nothing is uploaded.</p>
      <div class="row"><button class="primary" data-share-link>Copy share link</button><button data-share-file>Download .organicity file</button></div>
      <p class="dim">To open a shared city, visit its link, or use <b>Import city…</b> on the start screen. Large cities make long links; files work at any size. Use Photo mode (P) for screenshots.</p>`;
  }

  settingsHtml() {
    const S = loadSettings(), a = this.audio;
    return `<h3>Sound</h3>
      <label class="rng wide">Volume<input type="range" min="0" max="100" value="${Math.round((a?.volume ?? 0.6) * 100)}" data-vol><b>${Math.round((a?.volume ?? 0.6) * 100)}%</b></label>
      <label class="chk"><input type="checkbox" data-mute ${a?.muted ? 'checked' : ''}> Mute</label>
      <p class="dim">A generated soundscape: city hum, nearby traffic, rain, sirens, birds in quiet older towns and a synth pad after 2050. Starts after your first click.</p>
      <h3>Accessibility</h3>
      <label class="chk"><input type="checkbox" data-set="palette" value="cb" ${S.palette === 'cb' ? 'checked' : ''}> Colour-blind friendly overlays (purple → teal → yellow)</label>
      <label class="chk"><input type="checkbox" data-set="reducedMotion" ${S.reducedMotion ? 'checked' : ''}> Reduced motion: no rain, smoke or vehicle easing</label>
      <label>Interface size <select data-set="uiScale">${[0.85, 1, 1.15, 1.3, 1.5].map((v) => `<option value="${v}" ${+S.uiScale === v ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}</select></label>
      <h3>${t('set.language')}</h3><select data-lang>${Object.entries(LANGS).map(([k, n]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <p class="dim">Menus, tools and panel titles; changing it reloads the interface.</p>
      <h3>${t('set.performance')}</h3><select data-set="perf">${[['auto', 'Automatic (phones get the light profile)'], ['low', 'Light: no shadows, fewer vehicles and raindrops, nearer simplification'], ['high', 'Full detail']].map(([k, n]) => `<option value="${k}" ${(S.perf || 'auto') === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <h3>${t('set.packs')}</h3>
      ${packsLoaded.map((p) => `<p>${esc(p.name)} · ${p.styles.length} styles, ${p.landmarks.length} landmarks${userPacks().some((u) => String(u.name).replace(/[<>&"'`]/g, '').trim().slice(0, 60) === p.name) ? ` <button data-pack-del="${esc(p.name)}">Remove</button>` : ''}</p>`).join('') || '<p class="dim">None loaded.</p>'}
      <div class="row"><button data-pack-add>Add a pack (.json)…</button><input type="file" accept=".json,application/json" data-pack-file hidden></div>
      <p class="dim">Packs add district styles (District panel) and landmarks (Services). Cities that use a pack landmark keep working without the pack.</p>
      <h3>Graphics</h3>
      <label class="chk"><input type="checkbox" data-set="lod" ${S.lod !== false ? 'checked' : ''}> Simplify distant buildings (faster on big cities)</label>`;
  }

  sandboxHtml() {
    const sb = this.sim.sandbox; if (!sb) return null;
    const chk = (k, label) => `<label class="chk"><input type="checkbox" data-sb="${k}" ${sb[k] ? 'checked' : ''}> ${label}</label>`;
    return `${chk('infinite', 'Unlimited money')}
      ${chk('instant', 'Instant growth: fast spawning, moving in and levelling up')}
      ${chk('ignoreAppeal', 'Level-ups ignore appeal and occupancy')}
      ${chk('noFires', 'No fires')}
      ${chk('noDisasters', 'No earthquakes, tornadoes or industrial accidents')}
      ${chk('noIllness', 'No illness outbreaks')}
      <h3>Trigger an event</h3><div class="row"><button data-dis="quake">Earthquake</button><button data-dis="tornado">Tornado</button><button data-dis="accident">Industrial accident</button><button data-dis="festival">Festival</button></div>
      <p class="dim">Events strike near the camera. Wrecked buildings become rubble, are cleared (faster with fire and depot coverage) and rebuilt a level lower.</p>
      ${chk('noDecline', 'No decline or abandonment')}
      <h3>Era progression</h3><p>${this.sim.year} · ${this.sim.tech.style} · height ceiling ${this.sim.tech.heightLimit} floors</p>
      <button data-era-advance>Advance calendar 10 years</button><p class="dim">Sandbox shortcut: advances technology without simulating the intervening economy. Platforms unlock in 2025; floating cars and automatic skyways in 2050.</p>
      <h3>Weather</h3><label>Override <select data-weather><option value="">Seasonal weather</option>${Object.entries(WEATHER).map(([key,w]) => `<option value="${key}" ${this.sim.weatherOverride === key ? 'selected' : ''}>${w.label}</option>`).join('')}</select></label>
      <p class="dim">Weather affects road speed, wear, fire risk, power and water demand. Wind drives turbines. Each season lasts 90 days.</p>
      <h3>Demand</h3>
      ${chk('lockDemand', 'Lock demand at these values')}
      ${['R', 'C', 'I', 'O'].map((k) => `<label class="rng wide">${KIND[k]}<input type="range" min="-100" max="100" value="${sb.demand[k]}" data-sbd="${k}"><b>${sb.demand[k]}</b></label>`).join('')}
      ${sb.infinite ? '' : `<h3>Funds</h3><label class="txt">Set funds <input type="text" inputmode="numeric" value="${Math.round(this.sim.money)}" data-sbmoney></label>`}
      <p class="dim">Paint terrain with the Terrain tool (T). Inspect a building to set or lock its level. Speeds up to 16× are available.</p>`;
  }

  bindSandbox(el) {
    el.querySelectorAll('[data-dis]').forEach((b) => { b.onclick = () => {
      const s = this.sim, c = this.r.cam, all = [...this.w.buildings.values()], near = (f) => all.filter(f).sort((p, q) => Math.hypot(p.cx - c.x, p.cz - c.z) - Math.hypot(q.cx - c.x, q.cz - c.z))[0];
      const k = b.dataset.dis;
      if (k === 'quake') quake(s, c.x, c.z, 6.2);
      if (k === 'tornado') tornado(s, c.x, c.z);
      if (k === 'accident' && !accident(s, near((q) => !q.svc && ZONES[q.zone].kind === 'I'))) this.toast('No industry to have an accident.', 'warn');
      if (k === 'festival' && !festival(s, near((q) => VENUES[q.svc]))) this.toast('Build a city park or landmark to host festivals.', 'warn');
    }; });
    el.querySelector('[data-weather]')?.addEventListener('change', e => { this.sim.setWeather(e.target.value); this.hud(); });
    const sb = this.sim.sandbox;
    el.querySelectorAll('[data-sb]').forEach((c) => { c.onchange = () => { sb[c.dataset.sb] = c.checked; if (c.dataset.sb === 'infinite') this.renderPanel(true); this.hud(); }; });
    el.querySelectorAll('[data-sbd]').forEach((r) => { r.oninput = () => { sb.demand[r.dataset.sbd] = +r.value; r.nextElementSibling.textContent = r.value; }; });
    el.querySelector('[data-sbmoney]')?.addEventListener('change', (e) => { const v = +e.target.value.replace(/[^\d-]/g, ''); if (Number.isFinite(v)) this.sim.money = v; this.hud(); });
  }

  overlayHtml() {
    const o = this.r.overlay, O = OVERLAYS[o];
    return `<div class="ovs">${Object.entries(OVERLAYS).map(([k, v]) => `<button class="${o === k ? 'on' : ''}" data-ov="${k}">${v.name}</button>`).join('')}</div>
      ${o !== 'none' && o !== 'districts' ? `<div class="legend"><span>${O.good || o === 'traffic' ? 'poor' : 'low'}</span><i class="${O.good ? 'good' : 'bad'}"></i><span>${O.good ? 'good' : o === 'traffic' ? 'jammed' : 'high'}</span></div>` : ''}
      <label class="chk"><input type="checkbox" data-tints ${this.r.buildingTints ? 'checked' : ''}> Tint buildings as well as land</label>
      <p class="dim">Grey buildings have no applicable data. Colours refresh with the simulation. Traffic shows road congestion and each building’s access-road congestion. Inspect a building to trace routes while keeping the overlay visible.</p>`;
  }

  inspectBuilding(b) {
    this.r.setHighlight(b); this.inspected = b; this.sim.selectRoutes(b.id);
    const title = () => (b.svc ? SERVICES[b.svc].name : ZONES[b.zone].name);
    this.openPanel('inspect', title, () => {
      if (b.removed) return null;
      this.r.setHighlight(b);
      const s = this.sim, d = this.w.districts[b.district];
      const currentRoutes = s.routes && s.routes.origin === b.id && s.routes.netVersion === this.w.net.version && s.routes.bldVersion === this.w.bldVersion ? s.routes : null;
      const travelTime = key => currentRoutes?.[key] ? Math.round(currentRoutes[key].seconds) + 's' : '—';
      const prob = [];
      for (const [k, t] of [['fire', 'On fire!'], ['abandoned', 'Abandoned'], ['road', 'No road access'], ['outside', 'Not connected to the highway'], ['power', 'No electricity'], ['water', 'No water'], ['sewage', 'No sewage'], ['garbage', 'Garbage not collected']]) if (b.prob & PROB[k]) prob.push(t);
      const yes = (v) => (v ? '<b class="pos">✓</b>' : '<b class="neg">✗</b>');
      let body = `<p class="dim">${d ? `District: ${esc(d.name)} · ` : ''}${Math.round(b.area * 2.25)} m² lot${b.svc ? '' : ` · built day ${b.built}`}</p>`;
      if (b.svc) {
        const S = SERVICES[b.svc];
        body += `<table class="kv"><tr><td>Upkeep</td><td>${fmtMoney(S.upkeep * s.budgetFor(b.svc))}/mo</td></tr>
          ${S.power ? `<tr><td>Output</td><td>${Math.round(S.power * s.budgetFor(b.svc) * (b.svc === 'wind' ? s.wind : 1))} MW</td></tr>` : ''}
          ${S.water ? `<tr><td>Pumps</td><td>${Math.round(S.water * s.budgetFor(b.svc))} water units</td></tr>` : ''}${S.sewage ? `<tr><td>Treats</td><td>${Math.round(S.sewage * s.budgetFor(b.svc))} sewage units</td></tr>` : ''}
          ${S.radius ? `<tr><td>Coverage</td><td>${Math.round(S.radius * Math.sqrt(s.budgetFor(b.svc)) * 1.5)} m by road</td></tr>` : ''}${S.park ? `<tr><td>Appeal radius</td><td>${Math.round(S.park * Math.sqrt(s.budgetFor(b.svc)) * 1.5)} m</td></tr>` : ''}
          ${b.svc === 'landfill' ? `<tr><td>Fill level</td><td>${bar(1 - b.garb / S.storage)} ${Math.round((b.garb / S.storage) * 100)}%</td></tr>` : ''}
          <tr><td>Electricity</td><td>${yes(b.power)}</td></tr><tr><td>Water</td><td>${yes(b.water)}</td></tr></table>
          <p class="dim">${esc(S.desc)}</p>`;
      } else {
        const Z = ZONES[b.zone], maxL = Math.min(Z.maxLevel, d ? d.policy.maxLevel : 5);
        body += `<div class="lvl">${Array.from({ length: Z.maxLevel }, (_, i) => `<i class="${i < b.level ? 'on' : ''} ${i >= maxL ? 'cap' : ''}"></i>`).join('')}<span>Level ${b.level} / ${maxL}</span></div>
          <table class="kv">
          ${b.rubble > 0 ? `<tr><td>Disaster damage</td><td class="neg">Rubble · cleared in about ${Math.ceil(b.rubble)} days, then rebuilt a level lower</td></tr>` : ''}
          ${b.hh ? `<tr><td>Residents</td><td>${fmtInt(b.occ * 2.6)} (${b.occ}/${b.hh} homes)</td></tr>` : ''}
          ${b.jobs ? `<tr><td>Workers</td><td>${fmtInt(b.workers || 0)} / ${b.jobs} jobs</td></tr>` : ''}
          <tr><td>Happiness</td><td>${bar(b.happy)}</td></tr>
          <tr><td>Appeal</td><td>${bar(b.appeal)}</td></tr>
          <tr><td>Land value</td><td>${bar(b.lv ?? 0)}</td></tr>
          ${b.hh && this.w.econ?.tile(this.w.econ.active)?.housing.get(b.id) ? (() => { const h = this.w.econ.tile(this.w.econ.active).housing.get(b.id); return `<tr><td>Rent · quality</td><td>₵${fmtInt(h.rent)} a unit · ${bar(h.quality)} · ${h.occ}/${h.units} families</td></tr>`; })() : ''}
          ${!b.svc ? `<tr><td>Lot price / building value</td><td>${fmtMoney(s.landValueOf(b))} / ${fmtMoney(s.buildingValue(b))}${s.insurance ? ' · insured' : ''}</td></tr>` : ''}
          ${b.hh ? `<tr><td>Residents</td><td>${fmtInt(b.kids || 0)} children · ${fmtInt(Math.max(0, (b.occ || 0) * 2.6 - (b.kids || 0) - (b.seniors || 0)))} adults · ${fmtInt(b.seniors || 0)} retirees</td></tr>
          <tr><td>Health</td><td>${b.sick ? '<span class="neg">Illness outbreak</span>' : `${bar(b.health || 0)}`}</td></tr>` : ''}
          <tr><td>Utilities</td><td>power ${yes(b.power)} water ${yes(b.water)} sewer ${yes(b.sewage)} trash ${yes(b.garbOk)}</td></tr>
          <tr><td>To jobs / highway</td><td>${travelTime('job')} / ${travelTime('highway')}</td></tr>
          ${b.cong ? `<tr><td>Street traffic</td><td>${bar(b.cong, false)}</td></tr>` : ''}
          </table>
          ${b.level < maxL ? `<p class="dim">Grows to level ${b.level + 1} at appeal ≥ ${Math.round(LEVEL_APPEAL[b.level + 1] * 100)}% once mostly occupied, and may merge with neighbouring lots.</p>` : '<p class="dim">At maximum level here.</p>'}`;
      }
      if(!b.svc){
        const mp = massPlan(b, this.w), hub = s.sky.hubs.includes(b.id), br = s.partners(b).length;
        body += `<h3>Vertical development</h3><p>${buildingFloors(b,this.w)} floors${mp.bonus ? ` + ${mp.bonus.toFixed(1)} in annex/cantilevers` : ''} · current technology ceiling ${s.tech.heightLimit}</p>`
          + (hub ? `<p>Sky hub · ${fmtInt(s.air?.load.get(b.id) || 0)} / ${fmtInt(s.hubCap(b))} air trips</p>` : '')
          + (br ? `<p>${br} skybridge${br > 1 ? 's' : ''}: shares service coverage, +${br * 4}% land value</p>` : '')
          + `<button data-skyline>Frame building height</button>${b.hh && b.occ ? ' <button data-follow>Follow a resident</button>' : ''}`;
        if (this.deckFor !== b.id) { this.deckFor = b.id; this.deckLevel = null; }
        const fl = buildingFloors(b,this.w), decks=[...this.w.platforms.values()].filter(p=>p.host===b.id).sort((p,q)=>p.y-q.y), plan=this.w.planPlatform(b.id,false,this.deckLevel||null);
        body += `<h3>Terrace platforms</h3>${decks.map(d=>`<button data-platform-open="${d.id}">Terrace #${d.id} · ${d.level ? `floor ${d.level}` : 'roof'}</button>`).join('')}
          <label class="rng wide">Attach at<input type="range" min="0" max="${fl}" value="${this.deckLevel || 0}" data-deck-level><b>${this.deckLevel ? `floor ${this.deckLevel}` : 'roof'}</b></label>
          <button data-platform-build="${b.id}" ${!plan.ok ? 'disabled' : ''}>Build terrace ${plan.ok ? fmtMoney(plan.cost) : ''}</button><p class="dim">${plan.ok ? 'Decks can sit at any floor (at least five floors apart) and hold parks, plazas, clinics, schools, emergency and transit services, depots, water towers and wind turbines.' : esc(plan.err)}</p>`;
      } else if(b.platformId) body += `<p>Elevated terrace service · ${Math.round(b.baseY)} units above ground</p><button data-platform-open="${b.platformId}">Manage terrace</button>`;
      if (!b.svc) {
        if (b.constructionUntil > s.day) body += `<p class="warn">Under construction · ${Math.ceil(b.constructionUntil - s.day)} days remaining. No residents or jobs until completion.</p>`;
        else if (b.level < ZONES[b.zone].maxLevel) body += `<h3>Next level requirements</h3>${s.levelRequirements(b).map(([label, ok]) => `<p class="${ok ? 'pos' : 'dim'}">${ok ? '✓' : '○'} ${label}</p>`).join('')}`;
      }
      const routes = s.routes, valid = routes && routes.origin === b.id && routes.netVersion === this.w.net.version && routes.bldVersion === this.w.bldVersion;
      body += `<h3>Travel routes</h3><div class="row">${[['job','Workplace'],['highway','Highway'],['none','Hide']].map(([key,label]) => `<button data-route="${key}" class="${this.r.routeKind === key ? 'on' : ''}">${label}</button>`).join('')}</div>`;
      if (this.r.routeKind !== 'none') {
        const route = valid ? routes[this.r.routeKind] : null;
        body += `<p>${!valid ? 'Calculating route…' : route ? `${Math.round(route.seconds)} s on roads · ${route.segments.length} road sections · ${this.r.routeKind === 'job' ? 'workplace building' : 'highway exit'} #${route.destination}` : 'No reachable destination.'}</p>`;
      }
      body += '<p class="dim">Cyan: fastest reachable staffed workplace. Gold: highway exit. Arrows show travel direction. Estimates use current congestion and weather; these are representative routes, not individual citizen assignments. Walking to the road is excluded.</p>';
      if (prob.length) body += `<p class="warn">${prob.join(' · ')}</p>`;
      if (this.sim.sandbox && !b.svc) {
        body += `<h3>Sandbox</h3><div class="row">${Array.from({ length: ZONES[b.zone].maxLevel }, (_, i) => `<button class="${b.level === i + 1 ? 'on' : ''}" data-setlevel="${i + 1}">L${i + 1}</button>`).join('')}</div>
          <label class="chk"><input type="checkbox" ${b.locked ? 'checked' : ''} data-lock> Lock level (no growth, decline or abandonment)</label>`;
      }
      return body;
    });
  }

  focusPlatform(id) {
    const p=this.w.platforms.get(id);if(!p)return;
    this.r.cam.x=(p.x0+p.x1)/2;this.r.cam.z=(p.z0+p.z1)/2;this.r.cam.targetY=p.y;this.r.cam.dist=Math.max(75,(p.x1-p.x0)*3);
  }
  showPlatform(id) {
    const p=this.w.platforms.get(id);if(!p)return;
    this.sim.selectRoutes(null);this.focusPlatform(id);
    this.openPanel('platform',`Terrace #${id}`,()=>{
      const deck=this.w.platforms.get(id);if(!deck)return null;
      const plan=this.w.planPlatform(deck.host,id),services=[...this.w.buildings.values()].filter(b=>b.platformId===id);
      return `<p>${deck.x1-deck.x0} × ${deck.z1-deck.z0} deck · ${deck.level ? `floor ${deck.level}` : 'roof level'} · ${Math.round(deck.y)} units above ground</p>
        <button data-platform-expand="${id}" ${!plan.ok?'disabled':''}>Expand ${plan.ok?fmtMoney(plan.cost):''}</button>
        ${!plan.ok?`<p>${esc(plan.err)}</p>`:''}<h3>Build on this platform</h3><div class="row">${TERRACE_SERVICES.map(key=>`<button data-platform-service="${id}:${key}">${SERVICES[key].name}<small>${fmtMoney(SERVICES[key].cost)}</small></button>`).join('')}</div>
        <p class="dim">Choose a service, then click a free space on the deck. Services use the host building’s road and utility connection. Ground buildings remain intact.</p>
        <p>${services.length} services on this deck. Inspect and bulldoze them individually to free space.</p>
        <button data-ground-view>Ground view</button><button data-platform-remove="${id}" ${services.length?'disabled':''}>Dismantle empty platform</button>`;
    });
  }
  inspectRoad(e) {
    this.sim.selectRoutes(null);
    this.openPanel('inspect', () => ROADS[e.type].name, () => {
      if (!this.w.net.edges.has(e.id)) return null;
      const R = ROADS[e.type];
      const ups = Object.entries(ROADS).filter(([k]) => k !== e.type && k !== 'highway');
      return `<table class="kv"><tr><td>Length</td><td>${Math.round(e.len * 1.5)} m</td></tr>
        <tr><td>Peak traffic</td><td>${fmtInt(e.flow)} / ${fmtInt(R.capacity)}</td></tr>
        <tr><td>Snow / flood depth</td><td>${(e.snow||0).toFixed(2)} / ${(e.flood||0).toFixed(2)}</td></tr><tr><td>Congestion</td><td>${bar(e.cong || 0, false)} ${Math.round((e.cong || 0) * 100)}%</td></tr>
        <tr><td>Condition</td><td>${bar(e.cond)} ${Math.round(e.cond * 100)}%</td></tr>
        <tr><td>Speed</td><td>${Math.round((e.speedF || 1) * 100)}% of limit</td></tr>
        <tr><td>Flow ⇢ / ⇠</td><td>${fmtInt(e.fAB || 0)} / ${fmtInt(e.fBA || 0)}</td></tr>
        ${e.layer ? `<tr><td>Grade</td><td>${LAYERS[e.layer].name}</td></tr>` : ''}</table>
        ${['avenue', 'boulevard'].includes(e.type) ? `<h3>Transit</h3><div class="row"><button class="${e.busLane ? 'on' : ''}" data-buslane="${e.id}">${e.busLane ? 'Remove bus lanes' : 'Add bus lanes'}</button></div><p class="dim">Buses skip congestion; cars lose a quarter of the capacity.</p>` : ''}
        <h3>Direction</h3><div class="row">
          <button class="${!e.oneway ? 'on' : ''}" data-oneway="${e.id}:0">Two-way</button>
          <button class="${e.oneway === 1 ? 'on' : ''}" data-oneway="${e.id}:1">One-way ⇢</button>
          <button class="${e.oneway === -1 ? 'on' : ''}" data-oneway="${e.id}:-1">One-way ⇠</button></div>
        ${e.type === 'highway' ? '' : `<h3>Change type</h3><div class="row">${ups.map(([k, U]) => `<button data-retype="${e.id}:${k}">${U.name}<small>${fmtMoney(U.cost * e.len * 0.7)}</small></button>`).join('')}</div>`}
        <p class="dim">Wider roads carry more traffic. Maintenance depots keep condition up.</p>`;
    });
  }

  inspectJunction(n) {
    this.sim.selectRoutes(null);
    this.openPanel('inspect', () => JUNCTIONS[n.control || 'auto'].name, () => {
      if (!this.w.net.nodes.has(n.id)) return null;
      const J = JUNCTIONS[n.control || 'auto'];
      return `<table class="kv"><tr><td>Roads meeting</td><td>${n.edges.size}</td></tr>
        <tr><td>Through traffic</td><td>${fmtInt(n.through || 0)} / ${fmtInt(J.capacity)}</td></tr>
        <tr><td>Delay per vehicle</td><td>${(n.delay || 0).toFixed(1)} s</td></tr></table>
        <h3>Control</h3><div class="row">${Object.entries(JUNCTIONS).map(([k, j]) => `<button class="${(n.control || 'auto') === k ? 'on' : ''}" data-junction="${n.id}:${k}" title="base delay ${j.delay}s · capacity ${j.capacity}">${j.name}${j.cost ? `<small>${fmtMoney(j.cost)}</small>` : ''}</button>`).join('')}</div>
        <p class="dim">Lights and roundabouts cost a little time when quiet but carry far more traffic before queues build. Stop signs are cheap but saturate early. Delay feeds route choice, so drivers avoid slow junctions.</p>`;
    });
  }

  showLines() {
    this.openPanel('lines', 'Transit lines', () => {
      const w = this.w, s = this.sim;
      if (!w.lines.length) return '<p class="dim">No lines yet. Select a mode in Transit lines (L), place its stations from Services, then connect them. Buses also need a depot.</p>';
      const modal = s.stats.modal;
      return `${modal ? `<p class="dim">Transit share of trips: ${Math.round((modal.transit / Math.max(1, modal.car + modal.transit + (modal.air || 0))) * 100)}%${modal.air ? ` · by air: ${Math.round((modal.air / Math.max(1, modal.car + modal.transit + modal.air)) * 100)}%` : ''}</p>` : ''}
        <p>${modal ? ['car','bus','tram','rail','metro','air','walk','unserved'].map(k=>`${k}: ${fmtInt(modal[k]||0)}`).join(' · ') : ''}</p><table class="kv">${w.lines.map((l) => {
          const info = s.lineInfo?.get(l.id);
          const state = !info ? 'waiting for depot / power' : !info.ok ? 'no route' : `${fmtInt(info.riders)} riders · ${Math.round(info.len * 1.5)} m${info.busLaneShare ? ` · ${Math.round(info.busLaneShare * 100)}% bus lane` : ''}`;
          return `<tr><td><span class="sw" style="background:#${l.color.toString(16).padStart(6, '0')}"></span> ${esc(l.name)} · ${transitMode(l).name} · ${l.stops.length} stops</td><td>${state} <select data-headway="${l.id}" title="Rush hours (commutes): minutes between vehicles">${[3, 5, 10, 15].map((h) => `<option value="${h}" ${(l.headway || 10) === h ? 'selected' : ''}>peak ${h} min</option>`).join('')}</select><select data-offpeak="${l.id}" title="Rest of the day (shopping, errands): minutes between vehicles">${[5, 10, 15, 30, 60].map((h) => `<option value="${h}" ${(l.offpeak || l.headway || 10) === h ? 'selected' : ''}>off-peak ${h} min</option>`).join('')}</select> <button data-line-del="${l.id}" title="Remove line">✕</button></td></tr>`;
        }).join('')}</table>
        <p class="dim">Journeys can change lines as often as needed at stations within a short walk (transfers: ${fmtInt(s.stats.modal?.transfers || 0)} a pass). Commutes use the peak timetable, other trips the off-peak one; buses on the street follow the timetable of the hour. Each line's timetable sets waiting time, capacity and running cost (listed prices are at every 10 minutes). Monthly line costs: bus ₵150 + 45/stop; tram ₵400 + 70/stop; rail ₵900 + 140/stop; metro ₵1,200 + 180/stop. Stations have separate upkeep. Fares depend on mode.</p>`;
    });
  }

  inspectCell(x, z) {
    this.sim.selectRoutes(null);
    const w = this.w, s = this.sim, ci = w.cellAt(x, z); if (ci < 0) return;
    this.r.setHighlight(null);
    this.openPanel('inspect', 'Land', () => {
      const f = s.lvFactors(x, z), lv = s.at(s.f.lv, x, z), d = w.districts[w.district[ci]];
      const maxAbs = Math.max(0.05, ...f.map(([, v]) => Math.abs(v)));
      return `<table class="kv"><tr><td>Land value</td><td>${bar(lv)} ${Math.round(lv * 100)}%</td></tr>
        <tr><td>Elevation / flood depth</td><td>${w.heightAt(x,z).toFixed(1)} / ${(w.flood[ci]||0).toFixed(2)}</td></tr><tr><td>Snow / storm surge</td><td>${w.hazards.snow.toFixed(2)} / ${w.hazards.surge.toFixed(2)}</td></tr><tr><td>Zone</td><td>${w.zone[ci] ? ZONES[w.zone[ci]].name : w.water[ci] ? 'Water' : w.road[ci] ? 'Road' : 'Unzoned'}</td></tr>
        <tr><td>Road access</td><td>${w.accEdge[ci] >= 0 ? `${Math.round(w.accDist[ci] * 1.5)} m from kerb` : 'None (too deep or no road)'}</td></tr>
        ${d ? `<tr><td>District</td><td>${esc(d.name)}</td></tr>` : ''}</table>
        <h3>What drives appeal here</h3>
        <div class="factors">${f.map(([k, v]) => `<div><span>${k}</span><i class="${v < 0 ? 'neg' : 'pos'}" style="width:${(Math.abs(v) / maxAbs) * 50}%"></i><em>${v >= 0 ? '+' : ''}${Math.round(v * 100)}</em></div>`).join('')}</div>`;
    });
  }

  showDistrict(id) {
    const D = this.w.districts[id]; if (!D) return;
    this.openPanel('district', () => D.name, () => {
      if (!this.w.districts[id]) return null;
      const P = D.policy;
      let n = 0, pop = 0; for (const b of this.w.buildings.values()) if (b.district === id) { n++; pop += (b.occ || 0) * 2.6; }
      return `<label class="txt">Name <input type="text" value="${esc(D.name)}" maxlength="32" data-dname></label>
        <p class="dim"><span class="sw" style="background:${rgbCss(DISTRICT_COLORS[id])}"></span> ${n} buildings · ${fmtInt(pop)} residents</p>
        <h3>Local tax offset</h3>
        ${['R', 'C', 'I', 'O'].map((k) => `<label class="rng wide">${KIND[k]}<input type="range" min="-5" max="5" value="${P.tax[k]}" data-dtax="${k}"><b>${P.tax[k] > 0 ? '+' : ''}${P.tax[k]}%</b></label>`).join('')}
        <h3>Development rules</h3>
        <label class="rng wide">Max density level<input type="range" min="1" max="5" value="${P.maxLevel}" data-maxlevel><b>${P.maxLevel}</b></label>
        <label class="rng wide">Height limit (0 = technology ceiling)<input type="range" min="0" max="500" value="${P.maxFloors}" data-maxfloors><b>${P.maxFloors || 'Auto'}</b></label>
        <label class="chk"><input type="checkbox" ${P.historic ? 'checked' : ''} data-historic> Historic: freeze buildings as they are</label>
        <label class="chk"><input type="checkbox" ${P.carFree ? 'checked' : ''} data-carfree> Car-free centre${this.sim.ordinances.carFree ? '' : ' (needs the car-free ordinance in Society)'}: a third of trips walk or cycle, quieter streets</label>
        <label class="chk"><input type="checkbox" ${P.green ? 'checked' : ''} data-green> Green industry: half the pollution, −20% industrial tax</label>
        <h3>Service priority</h3>
        <h3>Architecture</h3><select data-style>${Object.entries(STYLES).map(([k, v]) => `<option value="${k}" ${(P.style || 'auto') === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
        <h3>Services</h3><select data-prio>${Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}" ${P.priority === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <p class="dim">A priority boosts coverage inside the district; each one adds 5% to all service upkeep.</p>
        <button class="danger" data-ddel>Dissolve district</button>`;
    }, id);
  }

  // ---------------------------------------------------------------- feedback
  tip(text, x, y) {
    const t = $('tip');
    if (!text) { t.hidden = true; return; }
    t.hidden = false; t.textContent = text;
    t.style.left = Math.max(8, Math.min(x + 18, innerWidth - t.offsetWidth - 8)) + 'px'; t.style.top = y + 18 + 'px';
  }
  toast(text, kind = 'info') {
    const box = $('toasts'), el = document.createElement('div');
    el.className = `toast ${kind}`; el.textContent = text;
    box.prepend(el);
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 6000);
    while (box.children.length > 5) box.lastChild.remove();
  }
  float(text, x, y) {
    const el = document.createElement('div'); el.className = 'float'; el.textContent = text;
    el.style.left = x + 'px'; el.style.top = y + 'px'; document.body.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  update(dt) {
    this.hudT += dt; this.panelT += dt;
    if (this.hudT > 0.25) { this.hudT = 0; this.hud(); }
    if (this.panelT > 0.5) { this.panelT = 0; if (!['district', 'sandbox', 'settings', 'share'].includes(this.panelName)) this.renderPanel(false); }
    for (const m of this.sim.messages) if (m.t > this.seenMsg) { this.seenMsg = m.t; this.toast(m.text, m.kind); }
    this.newsT = (this.newsT || 0) + dt;
    if (this.newsT > 1) { this.newsT = 0; this.ticker(); this.coach(); }
  }

  // ---------------------------------------------------------------- presidents, families, history
  termReport(term) {
    this.reportTerm = term;
    const mine = Object.entries(term.tiles).filter(([, v]) => v.controller === 'player').map(([, v]) => v);
    this.toast(`Presidential term ${term.start}–${term.end} is over. See how every president did.`, 'info');
    if (mine.length) this.sim.headline(`End of term ${term.start}–${term.end}: ${mine.map((v) => `${fmtInt(v.pop[1])} residents, ₵${fmtInt(v.treasury[1])} in the treasury`).join('; ')}.`, 'info');
    if (this.panelName !== 'president') this.togglePanel('president'); else this.renderPanel(true);
  }
  presidentHtml() {
    const econ = this.w.econ; if (!econ) return '<p class="dim">The regional economy starts with your first city.</p>';
    const me = econ.tile(econ.active), p = me.policy, pr = me.president, e = econ.e, r = this.actions.region?.();
    const cityName = (k) => esc(r?.tiles[k]?.name || k), pct = (v) => `${Math.round(v * 100)}%`;
    const lever = (k, label, fmt) => { const [lo, hi, st] = LEVERS[k]; return `<label class="rng wide">${label}<input type="range" min="${lo}" max="${hi}" step="${st}" value="${p[k]}" data-pol="${k}"><b>${fmt(p[k])}</b></label>`; };
    const fams = [...econ.families.values()].filter((f) => f.tile === econ.active), n = Math.max(1, fams.length), avg = (k) => fams.reduce((s, f) => s + f[k], 0) / n;
    const out = fams.filter((f) => f.wt != null && f.wt !== f.tile).length, inn = [...econ.families.values()].filter((f) => f.wt === econ.active && f.tile !== econ.active).length;
    const rows = econ.presidents().sort((a, b) => (b.pop || 0) - (a.pop || 0));
    const report = this.reportTerm ? this.termHtml(this.reportTerm, cityName) : '';
    return `${report}
      <h3>You: ${esc(pr.name)} · president of ${cityName(econ.active)} since ${pr.since}</h3>
      <p class="dim">Term ${e.termStart}–${e.termStart + TERM_YEARS}. Your policy sets taxes, service funding and road spending here, the rent level, and the toll everyone pays to enter this tile. AI presidents use the same levers.</p>
      ${lever('rentTarget', 'Rent target (of market)', pct)}${lever('tax', 'Tax rate', (v) => `${v}%`)}${lever('toll', 'Toll to enter', (v) => `₵${v}`)}${lever('infra', 'Infrastructure spending', pct)}${lever('services', 'Service funding', pct)}
      <label>Development priority <select data-pol-dev>${Object.entries(DEV).map(([k, v]) => `<option value="${k}" ${p.dev === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <h3>Families living here</h3>
      <table class="kv"><tr><td>Families</td><td>${fmtInt(fams.length)} · ${pct(fams.filter((f) => f.wt != null).length / n)} employed</td></tr>
        <tr><td>Income / rent (average)</td><td>₵${fmtInt(avg('income'))} / ₵${fmtInt(avg('rent'))} a month</td></tr><tr><td>Savings · happiness</td><td>₵${fmtInt(avg('savings'))} · ${bar(avg('happy'))}</td></tr>
        <tr><td>Commuting</td><td>${fmtInt(out)} out to other tiles · ${fmtInt(inn)} in from them</td></tr><tr><td>Moved this year</td><td>${fmtInt(me.acc.migIn)} in · ${fmtInt(me.acc.migOut)} out · tolls ₵${fmtInt(me.acc.tolls)}</td></tr></table>
      <p class="dim">Families weigh rent against income, commute and tolls, services, appeal, pollution and crime. About once a year each one looks for a better home, first choosing a tile, then a home within it, and moves only when it's clearly better and they can pay the move.</p>
      <h3>Presidents of the region</h3>
      <table class="kv">${rows.map((q) => `<tr><td>${cityName(q.key)}${q.key === econ.active ? ' (here)' : ''}<br><small class="dim">${esc(q.president.name)} · ${q.president.controller === 'player' ? 'you' : AIMS[q.president.priority]}</small></td><td>${fmtInt(q.pop)} people · ₵${fmtInt(q.treasury)}<br><small class="dim">rent ₵${fmtInt(q.stats?.rentAvg || 0)} · toll ₵${q.policy.toll} · tax ${q.policy.tax}% · ${q.level}</small></td></tr>`).join('')}</table>
      <h3>History</h3>
      <select data-hist>${Object.entries({ treasury: 'Treasury', pop: 'Residents', rent: 'Average rent', employment: 'Employment', tolls: 'Toll revenue', mig: 'Net migration', landValue: 'Land value' }).map(([k, v]) => `<option value="${k}" ${(this.histMetric || 'treasury') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${this.historyChart(this.histMetric || 'treasury', cityName)}
      ${e.terms.length ? `<h3>Past terms</h3>${e.terms.slice().reverse().map((tm, i) => `<details ${i ? '' : 'open'}><summary>${tm.start}–${tm.end}</summary>${this.termHtml(tm, cityName, true)}</details>`).join('')}` : `<p class="dim">Every ${TERM_YEARS} years a term ends: presidents are compared, and AI presidents whose tiles lost both residents and money are voted out.</p>`}`;
  }
  // year-by-year lines for every tile, with term boundaries
  historyChart(metric, cityName) {
    const H = this.w.econ.e.history, keys = Object.keys(H).filter((k) => H[k].length); if (!keys.length) return '<p class="dim">Statistics are recorded every year.</p>';
    const val = (row) => (metric === 'mig' ? row.migIn - row.migOut : row[metric] ?? 0);
    const all = keys.flatMap((k) => H[k].map((row) => [row.year, val(row)])), x0 = Math.min(...all.map((a) => a[0])), x1 = Math.max(x0 + 1, ...all.map((a) => a[0]));
    const y0 = Math.min(0, ...all.map((a) => a[1])), y1 = Math.max(1, ...all.map((a) => a[1])), W = 300, Hh = 120, X = (x) => 4 + ((x - x0) / (x1 - x0)) * (W - 8), Y = (y) => Hh - 4 - ((y - y0) / (y1 - y0)) * (Hh - 8);
    const col = (k) => `hsl(${Math.round(hash2c(k) * 360)},65%,60%)`;
    const terms = [this.w.econ.e.termStart, ...this.w.econ.e.terms.map((tm) => tm.start)].filter((y) => y > x0 && y < x1);
    return `<svg class="spark hist" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${metric} by tile">
      ${terms.map((y) => `<line x1="${X(y)}" x2="${X(y)}" y1="0" y2="${Hh}" stroke="#5c6f8a" stroke-dasharray="3 3"/>`).join('')}
      ${keys.map((k) => `<polyline fill="none" stroke="${col(k)}" stroke-width="${k === this.w.econ.active ? 2.5 : 1.3}" points="${H[k].map((row) => `${X(row.year).toFixed(1)},${Y(val(row)).toFixed(1)}`).join(' ')}"/>`).join('')}</svg>
      <p class="legend-lines">${keys.map((k) => `<span><i style="background:${col(k)}"></i>${cityName(k)}</span>`).join(' ')}</p><p class="dim">${x0}–${x1} · ${fmtInt(y0)} to ${fmtInt(y1)} · dashed lines mark new terms</p>`;
  }
  termHtml(term, cityName, compact = false) {
    const rows = Object.entries(term.tiles).sort((a, b) => b[1].treasury[1] - a[1].treasury[1]);
    const maxT = Math.max(1, ...rows.map(([, v]) => Math.abs(v.treasury[1] - v.treasury[0]))), maxP = Math.max(1, ...rows.map(([, v]) => Math.abs(v.pop[1] - v.pop[0])));
    const barc = (d, m) => `<span class="dbar"><i class="${d < 0 ? 'n' : 'p'}" style="width:${Math.round(Math.abs(d) / m * 100)}%"></i></span>`;
    return `${compact ? '' : `<h3>Term ${term.start}–${term.end}: how the presidents did</h3>`}
      <table class="kv term">${rows.map(([k, v]) => `<tr><td>${cityName(k)}<br><small class="dim">${esc(v.president)}${v.controller === 'player' ? ' (you)' : ` · ${AIMS[v.priority] || ''}`}${v.replacedBy ? ` → voted out for ${esc(v.replacedBy)}` : ''}</small></td>
        <td>Treasury ${barc(v.treasury[1] - v.treasury[0], maxT)} ₵${fmtInt(v.treasury[1] - v.treasury[0])}<br>Residents ${barc(v.pop[1] - v.pop[0], maxP)} ${fmtInt(v.pop[1] - v.pop[0])}</td></tr>`).join('')}</table>
      ${compact ? '' : '<button data-report-close>Close the report</button>'}`;
  }

  // ---------------------------------------------------------------- a resident's day
  followResident(b, k) {
    if (!b) return;
    const citizen = this.sim.citizenOf(b, k);
    this.r.follow = { citizen, camera: true }; this.sim.selectRoutes(b.id);
    this.openPanel('citizen', () => `${citizen.name}, ${citizen.age}`, () => this.citizenHtml());
  }
  citizenHtml() {
    const f = this.r.follow; if (!f) return null;
    const c = f.citizen, s = this.sim, w = this.w, home = w.buildings.get(c.home); if (!home) return null;
    const hh = (x) => { const H = ((x % 24) + 24) % 24; return `${String(Math.floor(H)).padStart(2, '0')}:${String(Math.floor((H % 1) * 60)).padStart(2, '0')}`; };
    const work = f.work && w.buildings.get(f.work), dur = (f.minutes || 20) / 60;
    const how = { car: 'drives', transit: 'takes transit', walk: 'walks', bike: 'cycles' }[c.mode];
    const place = (b) => b ? (b.svc ? SERVICES[b.svc].name.toLowerCase() : `a level-${b.level} ${ZONES[b.zone].name.toLowerCase()} building near ${s.streetName(b.edge)}`) : 'nowhere yet';
    const role = c.cohort === 'child' ? 'school pupil' : c.cohort === 'retiree' ? 'retired' : work ? 'works' : 'looking for work';
    const now = { home: 'At home', commute: `On the way to ${c.cohort === 'child' ? 'school' : 'work'}`, work: c.cohort === 'child' ? 'At school' : 'At work', 'return': 'Heading home' }[f.state || 'home'];
    const at = (arr) => s.at(arr, home.cx, home.cz), day = c.cohort === 'retiree'
      ? [[9.5, `goes for a walk${s.at(s.cov.park, home.cx, home.cz) > 0.1 ? ' in the park' : ' around the block'}`], [11, home.health > 0.4 ? 'drops in at the clinic for a check-up' : 'wishes there were a clinic nearby'], [15, 'meets friends at the shops'], [19, 'is home for the evening']]
      : !work ? [[9, c.cohort === 'child' ? 'walks to the nearest school' : 'checks job listings: nothing within reach yet'], [11.5, 'runs errands at the shops'], [15, 'meets friends nearby'], [19, 'is home for the evening']]
      : [[c.depart, `leaves home and ${how}`], [c.depart + dur, `arrives at ${c.cohort === 'child' ? 'school' : place(work)} (${f.minutes || '?'} min)`], [c.back, 'heads home'], [c.back + dur, 'is home; dinner, then an evening in']];
    return `<p>${esc(c.name)}, ${c.age} · ${role} · lives in ${place(home)}.</p>
      <p><b>${hh(this.r.hour())} — ${now}</b></p>
      <ul class="newslist">${day.map(([t, x]) => `<li><small>${hh(t)}</small> ${esc(x)}</li>`).join('')}</ul>
      ${(() => { const fams = this.w.econ?.familiesAt(home.id) || [], fam = fams.length ? fams[c.k % fams.length] : null; if (!fam) return '';
        const where = fam.wt == null ? 'looking for work' : fam.wt === fam.tile ? 'works in this city' : `commutes to ${esc(this.actions.region?.()?.tiles[fam.wt]?.name || fam.wt)} through the portal`;
        return `<h3>The household</h3><table class="kv"><tr><td>Family</td><td>${fam.size} people · ${fam.earners} earner${fam.earners > 1 ? 's' : ''} · ${where}</td></tr>
          <tr><td>Income</td><td>₵${fmtInt(fam.income)} a month</td></tr><tr><td>Rent · commute · tolls</td><td>₵${fmtInt(fam.rent)} · ₵${fmtInt(fam.commute)} · ₵${fmtInt(fam.toll)}</td></tr>
          <tr><td>Savings</td><td>₵${fmtInt(fam.savings)}</td></tr><tr><td>Contentment</td><td>${bar(fam.happy)}</td></tr></table>`; })()}
      <h3>How life is</h3>
      <table class="kv"><tr><td>Happiness at home</td><td>${bar(home.happy || 0)}</td></tr><tr><td>Health</td><td>${home.sick ? '<span class="neg">illness in the building</span>' : bar(home.health || 0)}</td></tr>
        <tr><td>Noise / pollution</td><td>${bar(at(s.f.noise), false)} ${bar(at(s.f.pollution), false)}</td></tr><tr><td>Crime nearby</td><td>${bar(at(s.f.crime), false)}</td></tr>
        <tr><td>Commute</td><td>${work ? `${f.minutes || '?'} min by ${c.mode}` : 'no job within reach'}</td></tr></table>
      <div class="row"><button data-follow-next>Another resident</button><button data-follow-cam>${f.camera ? 'Free the camera' : 'Follow with camera'}</button><button data-follow-stop>Stop following</button></div>
      <p class="dim">A resident generated from this home's demographics, on the city's real route to their workplace. The yellow marker shows where they are; the day follows the visual clock.</p>`;
  }

  // ---------------------------------------------------------------- world map
  toggleWorldMap(on = $('worldmap').hidden) {
    $('worldmap').hidden = !on; if (on) { this.closePanel(); this.renderWorldMap(); }
  }
  renderWorldMap() {
    const r = this.actions.region?.(), el = $('worldmap'); if (!r || el.hidden) return;
    const cost = tileCost(r), here = r.tiles[r.active], fmtPop = (p) => (p >= 1000 ? `${(p / 1000).toFixed(p >= 1e5 ? 0 : 1)}k` : fmtInt(p));
    const cells = [];
    for (let z = 0; z < r.size; z++) for (let x = 0; x < r.size; x++) {
      const k = `${x},${z}`, t = r.tiles[k], active = k === r.active, next = tileNeighbours(r, r.active).some((q) => q.t === t);
      let body = '', cls = `wt ${t.kind} p-${t.preset}${active ? ' here' : ''}${t.owned ? ' owned' : ''}`, style = '';
      if (t.kind === 'city') {
        const sm = active ? { ...(t.summary || {}), pop: Math.round(this.sim.stats.pop), year: this.sim.year } : t.summary || {};
        if (t.summary?.thumb) style = `background-image:url(${t.summary.thumb})`;
        const gov = this.w.econ?.tile(k)?.president, ai = t.gov === 'ai';
        body = `<b>${esc(t.name || 'City')}${ai ? '' : ` <button class="ren" data-wm-rename="${k}" title="Rename">✎</button>`}</b><small>${fmtPop(sm.pop || 0)} people${sm.year ? ` · ${sm.year}` : ''}</small>`
          + (ai ? `<small class="gov">AI · ${esc(gov?.name || 'governor')}${gov?.priority ? ` · ${AIMS[gov.priority]}` : ''}</small>${active ? '' : `<button data-wm-take="${k}" title="Play this city as its governor">Play as governor</button>`}`
            : active ? '<em>You are here</em>' : `<button data-wm-switch="${k}">Play this city</button><button data-wm-hand="${k}" title="Let an AI governor run and build it">Hand to AI</button>`);
        if (ai) cls += ' aigov';
      } else if (t.kind === 'ai') {
        body = `<b>${esc(t.name)}</b><small>${fmtPop(t.pop || 0)} people · AI city</small><em>Being founded by its governor…</em>`;
      } else if (t.owned) {
        body = `<b>Your land</b><small>${MAP_PRESETS[t.preset]}</small><button class="primary" data-wm-found="${k}">Found a city</button>`;
      } else {
        body = `<small>${MAP_PRESETS[t.preset]}</small>${canBuy(r, k) ? `<button data-wm-buy="${k}">Buy · ${fmtMoney(cost)}</button>` : ''}`;
      }
      cells.push(`<div class="${cls}" style="${style}">${body}</div>`);
    }
    const mine = Object.values(r.tiles).filter((t) => t.kind === 'city'), total = mine.reduce((s, t) => s + (t === here ? this.sim.stats.pop : t.summary?.pop || 0), 0);
    el.innerHTML = `<div class="wm-card"><header><h2>World map</h2><span class="dim">${mine.length} ${mine.length === 1 ? 'city' : 'cities'} · ${fmtInt(total)} people in your region</span><button class="x" data-wm-close aria-label="Close">✕</button></header>
      <div class="wm-grid" style="grid-template-columns:repeat(${r.size},1fr)">${cells.join('')}</div>
      <p class="dim">Buy tiles next to land you own, found cities on them and switch between them; each city keeps its own budget. Cities next to each other share commuters: unemployed workers take neighbouring vacancies. AI cities trade goods and send commuters over the highway.</p></div>`;
    el.querySelector('[data-wm-close]').onclick = () => this.toggleWorldMap(false);
    el.querySelectorAll('[data-wm-buy]').forEach((b) => { b.onclick = () => this.actions.buyTile(b.dataset.wmBuy); });
    el.querySelectorAll('[data-wm-found]').forEach((b) => { b.onclick = () => this.actions.foundTile(b.dataset.wmFound); });
    el.querySelectorAll('[data-wm-switch]').forEach((b) => { b.onclick = () => this.actions.switchTile(b.dataset.wmSwitch); });
    el.querySelectorAll('[data-wm-take]').forEach((b) => { b.onclick = () => this.actions.takeOver(b.dataset.wmTake); });
    el.querySelectorAll('[data-wm-hand]').forEach((b) => { b.onclick = () => this.actions.handOver(b.dataset.wmHand); });
    el.querySelectorAll('[data-wm-rename]').forEach((b) => { b.onclick = () => { const n = prompt('Name this city', r.tiles[b.dataset.wmRename].name || ''); if (n) this.actions.renameTile(b.dataset.wmRename, n); }; });
  }

  // ---------------------------------------------------------------- news, tutorial, photo mode, settings
  ticker() {
    const n = this.sim.news[this.sim.news.length - 1], el = $('news');
    el.hidden = !n || document.body.classList.contains('photo');
    if (n && el.dataset.k !== `${n.day}:${n.text}`) { el.dataset.k = `${n.day}:${n.text}`; el.className = n.kind; el.innerHTML = `<b>${n.year} · ${MONTHS[Math.floor((n.day % 360) / MONTH_DAYS)]}</b> ${esc(n.text)}`; }
  }
  coach() {
    const el = $('coach'), s = this.sim;
    if (s.scenario !== 'tutorial' || document.body.classList.contains('photo')) { el.hidden = true; return; }
    const i = TUTORIAL.findIndex((t) => !t.done(s)); el.hidden = false;
    el.innerHTML = i < 0 ? `<b>Tutorial complete!</b><p>You know the basics. Try the Advisors (N) when something goes wrong, and Society (Y) for education, health and ordinances.</p>`
      : `<small>Step ${i + 1} of ${TUTORIAL.length}</small><b>${esc(TUTORIAL[i].label)}</b><p>${esc(TUTORIAL[i].hint)}</p><div class="dots">${TUTORIAL.map((t, k) => `<i class="${k < i ? 'on' : k === i ? 'now' : ''}"></i>`).join('')}</div>`;
  }
  togglePhoto(on = !document.body.classList.contains('photo')) {
    document.body.classList.toggle('photo', on); this.r.photo = on; const el = $('photo');
    if (!on) { this.r.photoTod = null; el.hidden = true; return; }
    this.closePanel();
    el.hidden = false;
    el.innerHTML = `<label>Time of day <input type="range" min="0" max="100" value="${Math.round((this.r.tod ?? 0.3) * 100)}" data-tod></label>
      <label class="chk"><input type="checkbox" data-live checked> Live clock</label>
      <button data-shot class="primary">Save PNG</button><button data-exit>Exit (P)</button>
      <span class="dim">WASD move · Q/E turn · right-drag to tilt low</span>`;
    const tod = el.querySelector('[data-tod]'), live = el.querySelector('[data-live]');
    tod.oninput = () => { live.checked = false; this.r.photoTod = +tod.value / 100; };
    live.onchange = () => { this.r.photoTod = live.checked ? null : +tod.value / 100; };
    el.querySelector('[data-shot]').onclick = () => { el.hidden = true; download(`organicity-${this.sim.year}-${Date.now() % 100000}.png`, this.r.capture()); el.hidden = false; this.toast('Screenshot saved.', 'good'); };
    el.querySelector('[data-exit]').onclick = () => this.togglePhoto(false);
  }
  applySettings() {
    const S = loadSettings();
    this.r.applySettings(S);
    document.documentElement.style.setProperty('--ui-scale', String(S.uiScale || 1));
    document.body.classList.toggle('reduced-motion', !!S.reducedMotion);
  }
}
