import { TRANSIT, transitMode } from './transit.js';
import { routeLines } from './assign.js';
// Organicity — input: camera controls and the player's tools.
import { ROADS, SERVICES, ZONES, LAYERS, JUNCTIONS, ULINES } from './config.js';
import { bezier, clamp, fmtMoney } from './util.js';
import { undergroundY } from './grid.js';

export class Tools {
  constructor(world, sim, rend, ui) {
    this.w = world; this.sim = sim; this.r = rend; this.ui = ui;
    this.s = { tool: 'inspect', road: 'street', curve: false, oneway: false, zone: 1, brush: 6, fill: false, svc: 'fire', district: 0, dErase: false, water: 1, transitMode: 'bus', terrainMode: 'water', platform: 0, layer: 0, parallel: 0, upgrade: false, place: 0, uline: null };
    this.lineStops = [];      // bus stops picked for a new line
    this.pts = [];            // road points being drawn
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, g: null };
    this.drag = null;
    this.hover = null;
    const cv = rend.r.domElement;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointermove', (e) => this.move(e));
    addEventListener('pointerup', (e) => this.up(e));
    cv.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => this.keys.clear());
  }

  setTool(tool, patch = {}) {
    if (tool !== this.s.tool) this.pts = [];
    Object.assign(this.s, patch, { tool });
    if(tool==='terrain'&&!this.sim.sandbox&&this.s.terrainMode==='water')this.s.terrainMode='levee';
    this.r.clearPreview();
    this.r.setDistricts(tool === 'district');
    this.ui.toolChanged();
    this.refresh();
  }
  set(patch) {
    Object.assign(this.s, patch);
    if ('curve' in patch && this.pts.length > 1) this.pts = this.pts.slice(0, 1);
    this.ui.toolChanged(); this.refresh();
  }

  // ---------------------------------------------------------------- camera
  wheel(e) {
    e.preventDefault();
    const c = this.r.cam, g0 = this.r.groundAt(e.clientX, e.clientY);
    const nd = clamp(c.dist * Math.pow(1.0015, e.deltaY), 22, 1000);
    if (g0 && nd < c.dist) { const k = 1 - nd / c.dist; c.x += (g0.x - c.x) * k * 0.6; c.z += (g0.z - c.z) * k * 0.6; }
    c.dist = nd;
  }
  update(dt) {
    const c = this.r.cam, k = this.keys, sp = c.dist * 1.1 * dt;
    let fx = 0, fz = 0;
    if (k.has('w') || k.has('arrowup')) fz -= 1;
    if (k.has('s') || k.has('arrowdown')) fz += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;
    if (fx || fz) {
      const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
      c.x += (fx * cy + fz * sy) * sp; c.z += (-fx * sy + fz * cy) * sp;
      this.refresh();
    }
    if (k.has('q')) c.yaw += dt * 1.4;
    if (k.has('e')) c.yaw -= dt * 1.4;
  }

  key(e, down) {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (!down) { this.keys.delete(k); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); this.ui.actions.quickSave?.(); return; }
    this.keys.add(k);
    if (k === 'p') { this.ui.togglePhoto(); return; }
    if (k === 'm') { this.ui.toggleWorldMap(); return; }
    if (k === 'escape' && !document.getElementById('worldmap').hidden) { this.ui.toggleWorldMap(false); return; }
    if (document.body.classList.contains('photo')) { if (k === 'escape') this.ui.togglePhoto(false); return; }   // photo mode: camera keys only
    const map = { 1: 'inspect', 2: 'road', 3: 'zone', 4: 'util', 5: 'svc', i: 'ind', 6: 'district', 7: 'bulldoze', l: 'lines', t: 'terrain', y: 'people', n: 'advisors', r: 'region', k: 'president', j: 'mp' };
    if (map[k]) { this.ui.pickCategory(map[k]); return; }
    if (k === '8') { this.ui.togglePanel('overlays'); return; }
    if (k === '9') { this.ui.togglePanel('budget'); return; }
    if (k === ' ') { e.preventDefault(); this.sim.paused = !this.sim.paused; this.ui.hud(true); }
    if (k === 'enter' && this.s.tool === 'lines') { this.finishLine(); return; }
    if (k === 'escape') { this.lineStops = []; if (this.pts.length) { this.pts = []; this.refresh(); } else this.setTool('inspect'); this.ui.closePanel(); }
    if (k === 'c' && this.s.tool === 'road') this.set({ curve: !this.s.curve });
    if ((k === 'pageup' || k === 'pagedown') && this.s.tool === 'road') { e.preventDefault(); this.set({ layer: clamp(this.s.layer + (k === 'pageup' ? 1 : -1), -1, 3) }); this.ui.toast(`Road level: ${LAYERS[this.s.layer].name}`, 'info'); }
    if (k === 'f' && this.s.tool === 'zone') this.set({ fill: !this.s.fill });
    if (k === '[') this.set({ brush: clamp(this.s.brush - 1, 1, 30) });
    if (k === ']') this.set({ brush: clamp(this.s.brush + 1, 1, 30) });
    if (k === 'delete' || k === 'backspace') this.ui.pickCategory('bulldoze');
    if (k === '+' || k === '=') { this.sim.speed = Math.min(this.sim.sandbox ? 16 : 4, this.sim.speed * 2); this.sim.paused = false; this.ui.hud(true); }
    if (k === '-') { this.sim.speed = Math.max(1, this.sim.speed / 2); this.ui.hud(true); }
  }

  // ---------------------------------------------------------------- touch: one finger uses the tool,
  // two fingers pan, pinch to zoom and twist to rotate
  gestureState() {
    const [a, b] = [...this.touches.values()];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
  pinch() {
    const g = this.gestureState(), o = this.gesture, c = this.r.cam;
    c.dist = clamp(c.dist * o.dist / Math.max(1, g.dist), 22, 1000);
    let da = g.angle - o.angle; da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI; c.yaw -= da;
    const p0 = this.r.groundAt(o.mx, o.my), p1 = this.r.groundAt(g.mx, g.my);
    if (p0 && p1) { c.x += p0.x - p1.x; c.z += p0.z - p1.z; }
    this.r.updateCamera(); this.gesture = this.gestureState();
  }
  endStroke() { if (this.stroke) { this.stroke = false; this.w.finishTerrain(); this.w.commitTx(this.strokeCost || 0); this.strokeCost = 0; } }

  down(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    if (e.pointerType === 'touch') {
      (this.touches ||= new Map()).set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) { this.endStroke(); this.drag = null; this.gesture = this.gestureState(); return; }
    }
    if (this.r.photo && e.button === 0) { this.drag = { type: 'rotate', x: e.clientX, y: e.clientY, moved: 0, button: 0 }; return; }   // photo mode: drag orbits
    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
      this.drag = { type: e.button === 1 || e.shiftKey ? 'pan' : 'rotate', x: e.clientX, y: e.clientY, moved: 0, button: e.button, g: this.r.groundAt(e.clientX, e.clientY) };
      return;
    }
    if (e.button !== 0) return;
    this.drag = { type: 'tool', x: e.clientX, y: e.clientY, moved: 0 };
    const t = this.s.tool;
    if ((t === 'zone' && !this.s.fill && !this.s.place) || t === 'district' || t === 'terrain') { this.w.beginTx(t === 'zone' ? 'Zoning' : t === 'district' ? 'District paint' : 'Terrain'); this.stroke = true; this.strokeCost=0; }
    if (t === 'road' && this.s.upgrade) { this.w.beginTx(`Upgrade to ${ROADS[this.s.road].name.toLowerCase()}`, { net: true }); this.stroke = true; this.strokeCost = 0; }
    this.act(true);
  }

  move(e) {
    if (e.pointerType === 'touch' && this.touches?.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.gesture && this.touches.size >= 2) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.pinch(); return; }
    }
    const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    const d = this.drag, c = this.r.cam;
    if (d) d.moved += Math.abs(dx) + Math.abs(dy);
    if (d && d.type === 'rotate') { c.yaw -= dx * 0.006; c.pitch = clamp(c.pitch + dy * 0.004, this.r.photo ? 0.06 : 0.32, 1.48); return; }
    if (d && d.type === 'pan') {
      const g = this.r.groundAt(e.clientX, e.clientY);
      if (g && d.g) { c.x += d.g.x - g.x; c.z += d.g.z - g.z; this.r.updateCamera(); d.g = this.r.groundAt(e.clientX, e.clientY); }
      return;
    }
    if (e.target !== this.r.r.domElement && !d) { this.ui.tip(null); return; }
    this.refresh();
    if (d && d.type === 'tool' && ((this.s.tool === 'zone' && !this.s.fill && !this.s.place) || this.s.tool === 'district' || this.s.tool === 'terrain' || (this.s.tool === 'road' && this.s.upgrade))) this.act(false);
  }

  up(e) {
    if (e.pointerType === 'touch' && this.touches) {
      this.touches.delete(e.pointerId);
      if (this.gesture) { if (this.touches.size < 2) { this.gesture = null; this.drag = null; } return; }   // a lifted gesture never clicks
    }
    const d = this.drag; this.drag = null;
    this.endStroke();
    if (d && d.type === 'rotate' && d.button === 2 && d.moved < 4) { // right click = cancel
      if (this.s.tool === 'lines' && this.lineStops.length) this.finishLine();
      else if (this.pts.length) { this.pts = []; this.refresh(); } else if (this.s.tool !== 'inspect') this.ui.pickCategory('inspect');
    }
  }

  // underground editing picks on the flat pipe level, so what you point at is the pipe you see
  underground() { const s = this.s; return (s.tool === 'util' && (s.uline === 'water' || s.uline === 'sewer')) || (s.tool === 'bulldoze' && s.under); }
  ground() {
    if (this.underground()) return this.r.groundAt(this.mouse.x, this.mouse.y, undergroundY(this.w));
    const p=['svc','util','ind'].includes(this.s.tool) && this.w.platforms.get(this.s.platform);return this.r.groundAt(this.mouse.x, this.mouse.y, p?.y || 0);
  }

  undo() {
    if (this.stroke) return;
    const t = this.w.undo();
    if (!t) { this.ui.toast('Nothing to undo', 'info'); return; }
    if (t.money) this.sim.spend(-t.money);
    this.pts = []; this.ui.toast(`Undid: ${t.label}${t.money > 0 && !this.sim.sandbox?.infinite ? ` (refunded ${fmtMoney(t.money)})` : ''}`, 'good');
    this.refresh();
  }

  // Upgrade brush: retype roads under the cursor (drag), paid per metre.
  upgradeAt(g) {
    const hit = this.w.net.nearestEdge(g.x, g.z, 2), type = this.s.road;
    if (!hit || hit.e.type === type || hit.e.type === 'highway' || type === 'highway') return;
    const cost = Math.round(ROADS[type].cost * hit.e.len * 0.7);
    if (!this.sim.canAfford(cost)) { this.ui.toast('Not enough money', 'warn'); return; }
    this.w.retypeRoad(hit.e.id, type); this.sim.spend(cost); this.strokeCost = (this.strokeCost || 0) + cost;
  }

  finishLine() {
    const stops = this.lineStops; this.lineStops = [];
    if (stops.length < 2) { this.ui.toast('A line needs at least two stops', 'warn'); return; }
    const mode=this.s.transitMode, buildings=stops.map(id=>this.w.buildings.get(id));
    const route=routeLines(this.w.net,[{id:0,mode,stops:buildings.map(b=>({edge:b.edge,s:b.s,x:b.cx,z:b.cz}))}])[0];
    if(!route.ok){this.ui.toast('Stops need a connected route','warn');return;}
    const cost=Math.round(route.len*TRANSIT[mode].trackCost);
    if(!this.sim.canAfford(cost)){this.ui.toast(`Tracks cost ₵${cost.toLocaleString()}`,'warn');return;}
    this.w.beginTx('Transit line'); const l = this.w.addLine(stops,undefined,mode); this.w.commitTx(cost);this.sim.spend(cost);
    this.ui.toast(`${l.name} created with ${stops.length} stops`, 'good'); this.ui.showLines();
  }

  // ---------------------------------------------------------------- road helpers
  roadSnap(g) {
    const hw = ROADS[this.s.road].width / 2;
    let p = this.w.net.snap(g.x, g.z, hw, this.s.layer);
    if (!p.node && !p.edge && this.keys.has('shift') && this.pts.length) { // angle snap to 15°
      const a = this.pts[this.pts.length - 1], ang = Math.atan2(g.z - a.z, g.x - a.x), st = Math.PI / 12;
      const sa = Math.round(ang / st) * st, len = Math.hypot(g.x - a.x, g.z - a.z);
      p = { x: a.x + Math.cos(sa) * len, z: a.z + Math.sin(sa) * len };
    }
    // a neighbour's road reaches the border here: snap onto it so the two roads meet
    if (!p.node && !p.edge) for (const st of this.w.edgeStubs || []) {
      const sx = st.side === 'west' ? 0.5 : st.side === 'east' ? 511.5 : st.pos, sz = st.side === 'north' ? 0.5 : st.side === 'south' ? 511.5 : st.pos;
      if (Math.hypot(p.x - sx, p.z - sz) < 12) { p = { x: sx, z: sz, stub: st }; break; }
    }
    p.x = clamp(p.x, 0, 511.9); p.z = clamp(p.z, 0, 511.9);
    return p;
  }
  roadPlan(h) {
    const P = this.pts; if (!P.length) return null;
    const A = P[0], mid = { x: (A.x + h.x) / 2, z: (A.z + h.z) / 2 };
    const C = this.s.curve && P.length === 2 ? P[1] : mid;
    const needCtrl = this.s.curve && P.length === 1;
    const s = this.s, chk = this.w.net.check(A, C, h, s.road, s.layer);
    const cost = this.w.roadCost(A, C, h, s.road, s.layer);
    const pts = []; for (let i = 0; i <= 24; i++) pts.push(bezier(A, C, h, i / 24));
    // parallel twin: offset start, bend and end along the local normals
    let twin = null;
    if (s.parallel) {
      const off = (p, t0, t1) => { const dx = t1.x - t0.x, dz = t1.z - t0.z, l = Math.hypot(dx, dz) || 1; return { x: p.x - (dz / l) * s.parallel, z: p.z + (dx / l) * s.parallel }; };
      const A2 = off(A, A, C), B2 = off(h, C, h), C2 = off(C, A, h);
      twin = { A: A2, C: C2, B: B2, pts: [] };
      for (let i = 0; i <= 24; i++) twin.pts.push(bezier(A2, C2, B2, i / 24));
      const tc = this.w.roadCost(A2, C2, B2, s.road, s.layer); cost.cost += tc.cost;
      twin.ok = this.w.net.check(A2, C2, B2, s.road, s.layer).ok;
    }
    const afford = this.sim.canAfford(cost.cost), ok = chk.ok && (!twin || twin.ok);
    return { A, C, B: h, pts, twin, ok: ok && afford && !needCtrl, err: !chk.ok ? chk.err : twin && !twin.ok ? 'Parallel road is blocked' : afford ? null : 'Not enough money', cost, needCtrl };
  }

  // ---------------------------------------------------------------- hover / preview
  refresh() {
    const r = this.r, g = this.ground(), s = this.s;
    this.mouse.g = g;
    r.clearPreview();
    if (!g) { this.ui.tip(null); return; }
    let tip = null;
    switch (s.tool) {
      case 'road': {
        const h = this.roadSnap(g);
        r.setSnap(h.node || h.edge ? h : null);
        if (this.pts.length) {
          const plan = this.roadPlan(h);
          if (plan.needCtrl) { r.setRoadPreview([plan.A, h], 0.4, true); tip = 'Click to place the bend of the curve'; }
          else {
            r.setRoadPreview(plan.twin ? [...plan.pts, ...plan.twin.pts.slice().reverse()] : plan.pts, ROADS[s.road].width / 2, plan.ok, s.layer > 0 ? LAYERS[s.layer].y : 0);
            tip = `${s.layer ? LAYERS[s.layer].name + ' ' : ''}${ROADS[s.road].name}${plan.twin ? ' ×2' : ''} · ${Math.round(plan.cost.len)} m${plan.cost.wetLen > 1 ? ' (bridge)' : ''} · ${fmtMoney(plan.cost.cost)}${plan.err ? ' — ' + plan.err : ''}`;
          }
        } else tip = s.upgrade ? `Drag over roads to upgrade them to ${ROADS[s.road].name.toLowerCase()}` : `${ROADS[s.road].name}: click to start${s.curve ? ' a curve' : ''}`;
        if (s.upgrade) { const hit = this.w.net.nearestEdge(g.x, g.z, 2); r.setSnap(null); if (hit) r.setEdgeHighlight(hit.e, hit.e.type !== s.road); }
        break;
      }
      case 'lines': {
        const b = r.pickBuilding(this.mouse.x, this.mouse.y);
        if (b && b.svc === TRANSIT[this.s.transitMode].stop) r.setHighlight(b);
        tip = this.lineStops.length ? `${this.lineStops.length} stop${this.lineStops.length > 1 ? 's' : ''} · click more stops, Enter or right-click to finish` : `Click ${TRANSIT[this.s.transitMode].name.toLowerCase()} stops in order`;
        break;
      }
      case 'zone': {
        const col = s.zone ? (ZONES[s.zone].color[0] << 16) | (ZONES[s.zone].color[1] << 8) | ZONES[s.zone].color[2] : 0xff6a5a;
        if (s.place) { r.setBrush(g.x, g.z, 1.5, 0xffffff); tip = `Place a level-${s.place} building on this lot`; }
        else if (s.fill) { r.setBrush(g.x, g.z, 1.5, col); tip = s.zone ? `Fill the block with ${ZONES[s.zone].name.toLowerCase()}` : 'Clear zoning in this block'; }
        else r.setBrush(g.x, g.z, s.brush, col);
        break;
      }
      case 'district':
        r.setBrush(g.x, g.z, s.brush, s.dErase ? 0xff6a5a : 0xffffff);
        break;
      case 'terrain':
        r.setBrush(g.x, g.z, s.brush, s.water ? 0x4a9aff : 0x9ad06a);
        tip = ['raise', 'lower', 'level', 'smooth'].includes(s.terrainMode) ? `${s.terrainMode[0].toUpperCase() + s.terrainMode.slice(1)} ground · ₵3 per unit of earth · height ${this.w.heightAt(g.x, g.z).toFixed(1)}` : s.terrainMode==='levee'?'Build flood levees · ₵12/cell':s.terrainMode==='removeLevee'?'Remove levees':s.water?'Paint water':'Paint land';
        break;
      case 'util': case 'svc': case 'ind': {
        if (s.tool === 'util' && s.uline) {
          const L = ULINES[s.uline], h = this.ulineSnap(g);
          r.setBrush(h.x, h.z, 1.2, L.color);
          if (this.pts.length) {
            const a = this.pts[0], plan = this.w.planULine(s.uline, a.x, a.z, h.x, h.z), ok = plan.ok && this.sim.canAfford(plan.cost);
            r.setRoadPreview([a, h], 0.6, ok);
            tip = `${L.name} · ${Math.round(plan.len || 0)} m · ${fmtMoney(plan.cost || 0)}${!plan.ok ? ' — ' + plan.err : !ok ? ' — Not enough money' : ''}`;
          } else tip = `${L.name}: click to start a run (snaps to roads and other ${L.name.toLowerCase()}s) · ${fmtMoney(L.cost)}/m`;
          break;
        }
        const S = SERVICES[s.svc], plan = this.w.planService(s.svc, g.x, g.z, s.platform);
        r.setGhost(plan, S, plan.ok && this.sim.canAfford(S.cost));
        tip = `${S.name} · ${fmtMoney(S.cost)} (+${fmtMoney(S.upkeep)}/mo)${plan.err ? ' — ' + plan.err : !this.sim.canAfford(S.cost) ? ' — Not enough money' : ''}`;
        break;
      }
      case 'bulldoze': case 'inspect': {
        if (s.tool === 'bulldoze' && s.under) {   // the underground bulldozer only touches pipes, drains and lines
          this.hover = null; const u = this.w.nearestULine(g.x, g.z, 3, null, true);
          if (u) { this.hover = { u: u.l }; r.setBrush(u.x, u.z, 2.5, 0xff6a5a); tip = `Remove ${ULINES[u.l.kind].name.toLowerCase()} run (${Math.round(Math.hypot(u.l.b[0] - u.l.a[0], u.l.b[1] - u.l.a[1]))} m) · the city above is untouched`; }
          else tip = 'Underground bulldozer: click a pipe, drain or power line run';
          break;
        }
        const b = r.pickBuilding(this.mouse.x, this.mouse.y);
        this.hover = null;
        const jn = !b && s.tool === 'inspect' && this.w.net.nearestNode(g.x, g.z, 7);
        if (jn && jn.edges.size >= 3) { this.hover = { n: jn }; r.setBrush(jn.x, jn.z, 6, 0xffe25a); tip = `${JUNCTIONS[jn.control || 'auto'].name} junction · click for control`; break; }
        if (b) { r.setHighlight(b); this.hover = { b }; if (s.tool === 'bulldoze') tip = `Demolish ${this.bName(b)}${b.svc ? ` (refund ${fmtMoney(SERVICES[b.svc].cost * 0.4)})` : ''}`; }
        else {
          const h = this.w.net.nearestEdge(g.x, g.z, 1);
          if (h) { r.setEdgeHighlight(h.e, s.tool === 'inspect'); this.hover = { e: h.e }; if (s.tool === 'bulldoze') tip = `Remove ${ROADS[h.e.type].name.toLowerCase()} segment`; }
          else if (s.tool === 'bulldoze') { const u = this.w.nearestULine(g.x, g.z, 2.5); if (u) { this.hover = { u: u.l }; r.setBrush(u.x, u.z, 2, 0xff6a5a); tip = `Remove ${ULINES[u.l.kind].name.toLowerCase()} run`; } }
        }
        break;
      }
    }
    if (s.tool === 'inspect' && r.overlay !== 'none' && r.overlay !== 'districts') {
      const b = this.hover?.b, edge = this.hover?.e, o = r.overlay;
      const value = r.overlayValue(g.x, g.z, b);
      if (o === 'traffic') tip = edge ? `Traffic: ${Math.round(edge.flow || 0)} trips · ${Math.round((edge.cong || 0) * 100)}% capacity` : 'Hover a road for traffic';
      else if (o === 'level') tip = b && !b.svc ? `Building level ${b.level}` : 'No growable building';
      else if (o === 'age') tip = b ? `Building age: ${Math.max(0, this.sim.day - b.built)} days` : 'No building';
      else if (o === 'problems') tip = b ? `Problems: ${b.prob ? 'Service or access problem — click for details' : 'None'}` : 'No building';
      else tip = value == null ? 'No data here' : `${o}: ${Math.round(value * 100)}% (simulation index)`;
    }
    this.ui.tip(tip, this.mouse.x, this.mouse.y);
  }

  // line runs snap to another run of the same kind, else to the centre of a nearby road
  ulineSnap(g) {
    const u = this.w.nearestULine(g.x, g.z, 3, this.s.uline); if (u) return { x: u.t < 0.08 ? u.l.a[0] : u.t > 0.92 ? u.l.b[0] : u.x, z: u.t < 0.08 ? u.l.a[1] : u.t > 0.92 ? u.l.b[1] : u.z };
    const n = this.w.net.nearestNode(g.x, g.z, 3); if (n) return { x: n.x, z: n.z };
    return { x: g.x, z: g.z };
  }

  bName(b) { return b.svc ? SERVICES[b.svc].name : `${ZONES[b.zone].name} (L${b.level})`; }

  // ---------------------------------------------------------------- actions
  act(first) {
    const g = this.ground(); if (!g) return;
    const s = this.s, w = this.w, sim = this.sim;
    switch (s.tool) {
      case 'road': {
        if (s.upgrade) { this.upgradeAt(g); break; }
        if (!first) return;
        const h = this.roadSnap(g);
        if (!this.pts.length) { this.pts = [h]; break; }
        if (s.curve && this.pts.length === 1) { this.pts.push({ x: h.x, z: h.z }); break; }
        const plan = this.roadPlan(h);
        if (!plan.ok) { this.ui.toast(plan.err || 'Cannot build here', 'warn'); break; }
        w.beginTx(`${ROADS[s.road].name}`, { net: true });
        const res = w.buildRoad(plan.A, plan.C, plan.B, s.road, s.oneway ? 1 : 0, s.layer);
        // a one-way twin runs the other way, making a dual carriageway
        if (plan.twin) { if (s.oneway) w.buildRoad(plan.twin.B, plan.twin.C, plan.twin.A, s.road, 1, s.layer); else w.buildRoad(plan.twin.A, plan.twin.C, plan.twin.B, s.road, 0, s.layer); }
        w.commitTx(res.edges.length ? plan.cost.cost : 0);
        if (res.edges.length) {
          sim.spend(plan.cost.cost);
          this.ui.float(`-${fmtMoney(plan.cost.cost)}`, this.mouse.x, this.mouse.y);
          const end = w.net.nearestNode(plan.B.x, plan.B.z, 1);
          this.pts = end ? [{ x: end.x, z: end.z, node: end.id }] : [];
        }
        break;
      }
      case 'zone':
        if (s.place) {
          if (!first) break;
          w.beginTx('Place building'); const res = w.placeGrowable(g.x, g.z, s.place); w.commitTx();
          if (!res.ok) this.ui.toast(res.err, 'warn'); else if (res.capped) this.ui.toast(`${ZONES[res.b.zone].name} tops out at level ${res.b.level}`, 'info');
        } else if (s.fill) { if (first) { w.beginTx('Block fill'); w.fillZone(g.x, g.z, s.zone); w.commitTx(); } }
        else w.paintZone(g.x, g.z, s.brush, s.zone, this.keys.has('shift'));
        break;
      case 'terrain': {
        if (['raise', 'lower', 'level', 'smooth'].includes(s.terrainMode)) {
          if (first) this.levelTarget = w.heightAt(g.x, g.z);
          if (!sim.sandbox && !sim.canAfford(Math.PI * s.brush * s.brush * 0.6 * 3)) { this.ui.toast('Not enough money to move more earth.', 'warn'); break; }
          const vol = w.terraform(g.x, g.z, s.brush, s.terrainMode, this.levelTarget), cost = sim.sandbox ? 0 : Math.round(vol * 3);
          sim.spend(cost); this.strokeCost = (this.strokeCost || 0) + cost;
        } else if(s.terrainMode==='levee'||s.terrainMode==='removeLevee') {
          const on=s.terrainMode==='levee'?1:0;
          const upper=Math.ceil(Math.PI*(s.brush+2)**2)*12;
          if(on&&!sim.canAfford(upper)){this.ui.toast('Insufficient funds for this levee brush. Use a smaller brush.','warn');break;}
          const cost=w.paintLevee(g.x,g.z,s.brush,on)*(on?12:0);sim.spend(cost);this.strokeCost=(this.strokeCost||0)+cost;
        } else if(sim.sandbox) w.paintWater(g.x, g.z, s.brush, s.water);
        const now = performance.now();
        if (now - (this.terrT || 0) > 250) { this.terrT = now; w.finishTerrain(); }
        break;
      }
      case 'district': {
        if (!s.dErase && !s.district) {
          const d = w.newDistrict(); if (!d) { this.ui.toast('District limit reached', 'warn'); return; }
          s.district = d.id; this.ui.toolChanged(); this.ui.showDistrict(d.id);
        }
        w.paintDistrict(g.x, g.z, s.brush, s.dErase ? 0 : s.district);
        break;
      }
      case 'util': case 'svc': case 'ind': {
        if (!first) return;
        if (s.tool === 'util' && s.uline) {
          const h = this.ulineSnap(g);
          if (!this.pts.length) { this.pts = [h]; break; }
          const a = this.pts[0], plan = w.planULine(s.uline, a.x, a.z, h.x, h.z);
          if (!plan.ok) { this.ui.toast(plan.err, 'warn'); break; }
          if (!sim.canAfford(plan.cost)) { this.ui.toast('Not enough money', 'warn'); break; }
          w.beginTx(ULINES[s.uline].name); w.addULine(s.uline, a.x, a.z, h.x, h.z); w.commitTx(plan.cost);
          sim.spend(plan.cost); this.ui.float(`-${fmtMoney(plan.cost)}`, this.mouse.x, this.mouse.y);
          this.pts = [{ x: h.x, z: h.z }];   // runs chain on; right-click or Esc stops
          break;
        }
        const S = SERVICES[s.svc], plan = w.planService(s.svc, g.x, g.z, s.platform);
        const need = S.landmark || S.unlock;
        if (need && !sim.sandbox && sim.stats.pop < need) { this.ui.toast(`${S.name} unlocks at ${need.toLocaleString('en-US')} people`, 'warn'); break; }
        if (!plan.ok) { this.ui.toast(plan.err, 'warn'); break; }
        if (!sim.canAfford(S.cost)) { this.ui.toast('Not enough money', 'warn'); break; }
        w.beginTx(S.name); w.placeService(s.svc, plan); w.commitTx(S.cost);
        sim.spend(S.cost);
        this.ui.float(`-${fmtMoney(S.cost)}`, this.mouse.x, this.mouse.y);
        break;
      }
      case 'bulldoze': {
        if (!first || !this.hover) return;
        if (s.under && !this.hover.u) return;
        if (this.hover.b) {
          const b = this.hover.b, refund = b.svc ? SERVICES[b.svc].cost * 0.4 : 0;
          w.beginTx('Demolish'); w.removeBuilding(b.id); w.commitTx(-refund); sim.spend(-refund);
        } else if (this.hover.e) { w.beginTx('Remove road', { net: true }); w.removeRoad(this.hover.e.id); w.commitTx(); }
        else if (this.hover.u) { w.beginTx('Remove line'); w.removeULine(this.hover.u.id); w.commitTx(); }
        this.hover = null;
        break;
      }
      case 'lines': {
        if (!first) return;
        const b = this.r.pickBuilding(this.mouse.x, this.mouse.y);
        if (!b || b.svc !== TRANSIT[this.s.transitMode].stop) { this.ui.toast(`Click a ${TRANSIT[this.s.transitMode].name} stop from Services`, 'info'); break; }
        if (this.lineStops[this.lineStops.length - 1] !== b.id) this.lineStops.push(b.id);
        break;
      }
      case 'inspect': {
        if (!first) return;
        if (this.hover?.n) this.ui.inspectJunction(this.hover.n);
        else if (this.hover?.b) this.ui.inspectBuilding(this.hover.b);
        else if (this.hover?.e) this.ui.inspectRoad(this.hover.e);
        else this.ui.inspectCell(g.x, g.z);
        break;
      }
    }
    this.refresh();
  }
}
