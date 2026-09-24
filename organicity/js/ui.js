// Organicity — DOM interface: HUD, tool dock, panels, tooltips and toasts.
import { STYLES, LAYERS, JUNCTIONS, ROADS, ZONES, SERVICES, OVERLAYS, DISTRICT_COLORS, PRIORITIES, LEVEL_APPEAL, MONTH_DAYS } from './config.js';
import { fmtMoney, fmtInt, clamp } from './util.js';
import { TERRACE_SERVICES, buildingFloors, massPlan } from './eras.js';
import { WEATHER } from './weather.js';
import { PROB } from './sim.js';

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
  { id: 'lines', key: 'L', label: 'Bus lines', glyph: '⊶' },
  { id: 'bulldoze', key: '7', label: 'Bulldoze', glyph: '✖' },
  { id: 'overlays', key: '8', label: 'Overlays', glyph: '◐', panel: true },
  { id: 'budget', key: '9', label: 'Budget', glyph: '₵', panel: true },
  { id: 'terrain', key: 'T', label: 'Terrain', glyph: '≈', sandbox: true },
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
      <div class="stat"><small>Funds</small><b id="hMoney"></b><em id="hNet"></em></div>
      <div class="stat"><small>Population</small><b id="hPop"></b></div>
      <div class="stat"><small>Jobs</small><b id="hJobs"></b><em id="hUnemp"></em></div>
      <div class="stat"><small>Date</small><b id="hDate"></b><em id="hWeather"></em></div>
      <div id="speed" role="group" aria-label="Simulation speed">
        <button data-s="0" title="Pause (Space)">❚❚</button><button data-s="1" title="Normal">▶</button><button data-s="2" title="Fast">▶▶</button><button data-s="4" title="Fastest">▶▶▶</button>${this.sim.sandbox ? '<button data-s="8" title="Sandbox 8×">8×</button><button data-s="16" title="Sandbox 16×">16×</button>' : ''}
      </div>
      <div id="demand" title="Zoning demand: residential, commercial, industrial, office">
        ${['R', 'C', 'I', 'O'].map((k) => `<div class="dem"><div class="col"><i id="d${k}"></i></div><span>${k}</span></div>`).join('')}
      </div>
      <div class="menu">
        <button id="mUndo" title="Undo (Ctrl+Z)">↶ Undo</button>
        <button id="mDay" title="Day/night: cycle, always day, always night"></button>
        <button id="mPix" title="Pixel size">▣ <span></span></button>
        <button id="mSave" title="Save to this browser">Save</button>
        <button id="mNew" title="Start a new city">New</button>
        <button id="mHelp" title="How to play">Help</button>
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
    $('hDate').textContent = `${y} · ${MONTHS[m]} ${d}`;
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
    $('dock').innerHTML = CATS.filter((c) => !c.sandbox || this.sim.sandbox).map((c) => `<button data-c="${c.id}" title="${c.label}${c.key ? ` (${c.key})` : ''}"><span class="g">${c.glyph}</span><span class="l">${c.label}</span>${c.key ? `<kbd>${c.key}</kbd>` : ''}</button>`).join('');
    $('dock').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.pickCategory(b.dataset.c); });
    $('fly').addEventListener('click', (e) => this.flyClick(e));
    $('fly').addEventListener('input', (e) => this.flyInput(e));
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
          const locked = S.landmark && this.sim.stats.pop < S.landmark && !this.sim.sandbox, built = S.landmark && [...this.w.buildings.values()].some((b) => b.svc === k);
          return `<button class="${s.svc === k ? 'on' : ''}" data-svc="${k}" title="${esc(S.desc)}${S.landmark ? ` Landmark: unlocks at ${fmtInt(S.landmark)} people; ₵${fmtInt(S.tourism)}/month tourism.` : ''}" ${locked || built ? 'disabled' : ''}>${S.landmark ? '★ ' : ''}${S.name}<small>${locked ? `pop ${fmtInt(S.landmark)}` : built ? 'built' : fmtMoney(S.cost)}</small></button>`;
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
        h = `<div class="row"><button class="${s.water ? 'on' : ''}" data-water="1"><span class="sw" style="background:#4a8ac8"></span>Water</button><button class="${!s.water ? 'on' : ''}" data-water="0"><span class="sw" style="background:#7ab04a"></span>Land</button>${brush}</div>
          <p class="hint">Sandbox terrain: paint lakes, rivers and coastline, or fill water in. Roads crossing new water become bridges; buildings in the way are removed.</p>`;
        break;
      case 'lines':
        h = `<div class="row"><button data-show-lines="1">Manage lines (${this.w.lines.length})</button></div>
          <p class="hint">Click bus stops in the order buses should visit them, then press Enter or right-click. Lines need a bus depot on the same road network; riders are trips whose home and destination both sit near stops of one line.</p>`;
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
    if (d.water) t.set({ water: +d.water });
    if (d.layer) t.set({ layer: +d.layer });
    if (d.parallel) t.set({ parallel: +d.parallel });
    if (d.upgrade) t.set({ upgrade: !t.s.upgrade });
    if (d.zone) t.set({ zone: +d.zone });
    if (d.fill) t.set({ fill: d.fill === '1', place: 0 });
    if (d.place) t.set({ place: t.s.place === +d.place ? 0 : +d.place });
    if (d.svc) t.set({ svc: d.svc });
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
    if (name === 'budget') this.openPanel('budget', 'Budget & taxes', () => this.budgetHtml());
    if (name === 'overlays') this.openPanel('overlays', 'Info overlays', () => this.overlayHtml());
    if (name === 'sandbox') this.openPanel('sandbox', 'Sandbox', () => this.sandboxHtml());
    if (name === 'lines') this.showLines();
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
    el.querySelector('[data-skyline]')?.addEventListener('click',()=>{const b=this.inspected;this.r.cam.x=b.cx;this.r.cam.z=b.cz;this.r.cam.targetY=(b.top || buildingFloors(b,this.w)*1.6)/2;this.r.cam.dist=Math.max(100,this.r.cam.targetY*3);});
    el.querySelector('[data-tints]')?.addEventListener('change', e => { this.r.buildingTints = e.target.checked; });
    el.querySelectorAll('[data-route]').forEach(b => { b.onclick = () => { this.r.routeKind = b.dataset.route; this.renderPanel(true); }; });
    el.querySelectorAll('[data-budget]').forEach(inp => { inp.oninput = () => { this.sim.setBudget(inp.dataset.budget, +inp.value / 100); inp.nextElementSibling.textContent = inp.value + '%'; }; });
    el.querySelectorAll('[data-loan]').forEach(btn => { btn.onclick = () => { this.sim.takeLoan(+btn.dataset.loan); this.renderPanel(true); }; });
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
      <h3>Loans</h3>
      <p class="dim">12-month term · 1% monthly interest, accrued daily. Maximum three loans. Repay early without a fee.</p>
      <div class="row">${[25000,50000,100000].map(v => `<button data-loan="${v}" ${s.loans.filter((l) => !l.bailout).length >= 3 || s.sandbox?.infinite ? 'disabled' : ''}>Borrow ${fmtMoney(v)}</button>`).join('')}</div>
      ${s.loans.map(l => `<p>${l.bailout ? 'Bailout · ' : ''}${fmtMoney(l.balance)} remaining · ${fmtMoney(l.payment)}/month · ${Math.ceil(l.days / MONTH_DAYS)} months <button data-repay="${l.id}">Repay</button></p>`).join('')}
      <h3>Forecast</h3><p>In three months: ${fmtMoney(s.money + 3 * (st.incomeM - st.expenseM))}</p>
      <p class="dim">Assumes current income and spending continue; construction costs and future growth are excluded.</p>
      ${s.scenario ? `<h3>${s.scenarioWon ? 'Scenario complete' : 'Scenario goals'}</h3>${s.scenarioProgress().map(([label, ok]) => `<p>${ok ? '✓' : '○'} ${label}</p>`).join('')}` : ''}
      <h3>Monthly budget</h3>
      <table class="kv">
        <tr><td>Residential tax</td><td class="pos">${m(inc.R)}</td></tr><tr><td>Commercial tax</td><td class="pos">${m(inc.C)}</td></tr>
        <tr><td>Industrial tax</td><td class="pos">${m(inc.I)}</td></tr><tr><td>Office tax</td><td class="pos">${m(inc.O)}</td></tr>
        <tr><td>Services upkeep</td><td class="neg">-${m(exp.services)}</td></tr><tr><td>Utilities upkeep</td><td class="neg">-${m(exp.utilities)}</td></tr>
        <tr><td>Bus fares</td><td class="pos">${m(inc.fares)}</td></tr><tr><td>Tourism</td><td class="pos">${m(inc.tourism)}</td></tr><tr><td>Utility exports</td><td class="pos">${m(inc.trade)}</td></tr>
        <tr><td>Utility imports</td><td class="neg">-${m(exp.imports)}</td></tr><tr><td>District policies</td><td class="neg">-${m(exp.policies)}</td></tr>
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

  sandboxHtml() {
    const sb = this.sim.sandbox; if (!sb) return null;
    const chk = (k, label) => `<label class="chk"><input type="checkbox" data-sb="${k}" ${sb[k] ? 'checked' : ''}> ${label}</label>`;
    return `${chk('infinite', 'Unlimited money')}
      ${chk('instant', 'Instant growth: fast spawning, moving in and levelling up')}
      ${chk('ignoreAppeal', 'Level-ups ignore appeal and occupancy')}
      ${chk('noFires', 'No fires')}
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
          ${b.hh ? `<tr><td>Residents</td><td>${fmtInt(b.occ * 2.6)} (${b.occ}/${b.hh} homes)</td></tr>` : ''}
          ${b.jobs ? `<tr><td>Workers</td><td>${fmtInt(b.workers || 0)} / ${b.jobs} jobs</td></tr>` : ''}
          <tr><td>Happiness</td><td>${bar(b.happy)}</td></tr>
          <tr><td>Appeal</td><td>${bar(b.appeal)}</td></tr>
          <tr><td>Land value</td><td>${bar(b.lv ?? 0)}</td></tr>
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
          + `<button data-skyline>Frame building height</button>`;
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
        <tr><td>Congestion</td><td>${bar(e.cong || 0, false)} ${Math.round((e.cong || 0) * 100)}%</td></tr>
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
    this.openPanel('lines', 'Bus lines', () => {
      const w = this.w, s = this.sim;
      if (!w.lines.length) return '<p class="dim">No lines yet. Place bus stops (Services), a bus depot, then use the Bus lines tool (L) to click stops in order.</p>';
      const modal = s.stats.modal;
      return `${modal ? `<p class="dim">Transit share of trips: ${Math.round((modal.transit / Math.max(1, modal.car + modal.transit + (modal.air || 0))) * 100)}%${modal.air ? ` · by air: ${Math.round((modal.air / Math.max(1, modal.car + modal.transit + modal.air)) * 100)}%` : ''}</p>` : ''}
        <table class="kv">${w.lines.map((l) => {
          const info = s.lineInfo?.get(l.id);
          const state = !info ? 'waiting for depot' : !info.ok ? 'no route' : `${fmtInt(info.riders)} riders · ${Math.round(info.len * 1.5)} m${info.busLaneShare ? ` · ${Math.round(info.busLaneShare * 100)}% bus lane` : ''}`;
          return `<tr><td><span class="sw" style="background:#${l.color.toString(16).padStart(6, '0')}"></span> ${esc(l.name)} · ${l.stops.length} stops</td><td>${state} <button data-line-del="${l.id}" title="Remove line">✕</button></td></tr>`;
        }).join('')}</table>
        <p class="dim">Each line costs ₵150 + ₵45 per stop a month and earns fares from its riders.</p>`;
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
        <tr><td>Zone</td><td>${w.zone[ci] ? ZONES[w.zone[ci]].name : w.water[ci] ? 'Water' : w.road[ci] ? 'Road' : 'Unzoned'}</td></tr>
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
    if (this.panelT > 0.5) { this.panelT = 0; if (this.panelName !== 'district' && this.panelName !== 'sandbox') this.renderPanel(false); }
    for (const m of this.sim.messages) if (m.t > this.seenMsg) { this.seenMsg = m.t; this.toast(m.text, m.kind); }
  }
}
