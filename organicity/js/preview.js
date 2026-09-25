// Organicity — pictures of what you can build. Every buildable (services, utilities, industry,
// roads and their levels, zones, power lines and pipes) gets an icon rendered from its real
// model, and hovering a button shows a card with the model turning in 3D and all its numbers.
// One small offscreen WebGL renderer does both; icons are made lazily and cached.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SERVICES, ROADS, ZONES, ULINES, LAYERS, FLOOR_H } from './config.js';
import { genBuilding, genBoxes } from './procgen.js';
import { COMMODITIES, DEPOSITS } from './resources.js';
import { fmtMoney } from './util.js';

const box = (sx, sy, sz, x, y, z, color) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const hashKey = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const ZONE_KEY = { 1: 'res', 2: 'res', 3: 'com', 4: 'ind', 5: 'off', 6: 'shop' };
const partsMesh = (s, mat) => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(s.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(s.n, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(s.c, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(s.u, 2));
  return new THREE.Mesh(geo, mat);
};

export class Preview {
  constructor(world, mats) {
    this.w = world; this.mats = mats; this.icons = new Map(); this.queue = []; this.ok = true;
    try {
      this.r = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
      this.r.setPixelRatio(1); this.r.outputColorSpace = THREE.SRGBColorSpace;
    } catch { this.ok = false; return; }
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x6a6050, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.2); sun.position.set(30, 50, 20); this.scene.add(sun);
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.5, 2000);
    this.plain = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  // ---------------------------------------------------------------- models
  model(kind, key) {
    const g = new THREE.Group(), add = (geo, mat = this.plain) => { const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
    if (kind === 'svc') {
      const S = SERVICES[key]; if (!S) return g;
      const b = { id: -1, svc: key, seed: hashKey(key), cx: 0, cz: 0, fx: 0, fz: 1, cells: [], level: 1, zone: 0, x0: -S.w / 2, x1: S.w / 2, z0: -S.d / 2, z1: S.d / 2 };
      let gen = null; try { gen = genBuilding(b, this.w); } catch { gen = null; }
      add(box(S.w + 1, 0.3, S.d + 1, 0, -0.15, 0, S.park ? 0x6aa84a : 0xa8a49a));
      if (gen) for (const [k, s] of Object.entries(gen.g)) if (s.p.length) g.add(partsMesh(s, this.mats?.[k] || this.plain));
    } else if (kind === 'road') {
      const [type, lv] = key.split('@'), R = ROADS[type] || ROADS.street, L = +(lv || 0), y = L > 0 ? LAYERS[L].y * 0.5 : 0, len = 30, hw = R.width / 2, parts = [];
      parts.push(box(len + 6, 0.2, R.width + 10, 0, -0.1, 0, L < 0 ? 0x7a7060 : 0x7ab04a));
      parts.push(box(len, 0.3, R.width + 2.4, 0, y + 0.15, 0, type === 'highway' ? 0x7a7a76 : 0xb2b2aa));
      parts.push(box(len, 0.32, R.width, 0, y + 0.2, 0, type === 'alley' ? 0x988c7a : 0x484a4f));
      if (type === 'boulevard') parts.push(box(len, 0.4, 2.2, 0, y + 0.25, 0, 0x60964a));
      else for (let x = -len / 2 + 2; x < len / 2 - 1; x += 4) parts.push(box(2, 0.34, 0.25, x, y + 0.22, 0, type === 'avenue' || type === 'highway' ? 0xecc43c : 0xecece2));
      if (L > 0) { for (const x of [-9, 0, 9]) parts.push(box(1.2, y, 1.2, x, y / 2, 0, 0x9e9a92)); for (const s of [-1, 1]) parts.push(box(len, 0.8, 0.3, 0, y + 0.6, s * (hw + 1.1), 0xd2cec4)); }
      if (L < 0) { parts.push(box(2, 4, R.width + 3, -len / 2 + 1, 2, 0, 0x605c56)); parts.push(box(1.2, 0.8, R.width + 3, -len / 2 + 1, 4.2, 0, 0x605c56)); }
      add(mergeGeometries(parts));
    } else if (kind === 'zone') {
      const Z = ZONES[+key];
      if (!Z) { add(box(22, 0.3, 16, 0, -0.15, 0, 0x8a8a84)); add(box(12, 0.4, 1.6, 0, 0.2, 0, 0xe05a4a)); add(box(1.6, 0.4, 12, 0, 0.2, 0, 0xe05a4a)); return g; }
      const hs = { R: [4, 6, 5], C: [7, 10, 6], I: [5, 5, 7], O: [12, 16, 9], M: [9, 12, 8] }[Z.kind] || [5, 5, 5];
      const col = ((Z.color[0] * 0.3 + 170) << 16) | ((Z.color[1] * 0.3 + 170) << 8) | (Z.color[2] * 0.3 + 170);
      add(box(22, 0.3, 16, 0, -0.15, 0, (Z.color[0] << 16) | (Z.color[1] << 8) | Z.color[2]));
      const list = [[-6, -3, 7, 7], [3, -3, 7, 6], [-2, 4, 9, 6]].map(([x, z, w, d], i) => ({ x, z, w, d, y0: 0, h: +key === 1 ? hs[i] * 0.7 : hs[i] + (+key === 2 ? i * 3 : 0), key: ZONE_KEY[+key], col, roof: 0x8a8580 }));
      for (const [k, s] of Object.entries(genBoxes(list))) if (s.p.length) g.add(partsMesh(s, this.mats?.[k] || this.plain));
    } else if (kind === 'uline') {
      const L = ULINES[key], parts = [box(26, 0.3, 10, 0, -0.15, 0, 0x7ab04a)];
      if (key === 'power') { for (const x of [-9, 9]) parts.push(box(0.5, 7.6, 0.5, x, 3.8, 0, 0x8a8e94), box(0.3, 0.3, 3.4, x, 7.2, 0, 0x8a8e94)); for (const s of [-1.3, 1.3]) parts.push(box(18, 0.08, 0.08, 0, 6.9, s, 0x2a2c30)); }
      else { parts.push(box(24, key === 'sewer' ? 1.6 : 1.1, key === 'sewer' ? 1.6 : 1.1, 0, -1.2, 0, L.color)); for (const x of [-10, 10]) parts.push(box(2, 2, 2, x, -1.2, 0, L.color)); parts.push(box(1.2, 1.6, 1.2, -10, 0, 0, 0x6a6e72)); }
      add(mergeGeometries(parts));
    }
    return g;
  }

  frameCamera(g, yaw) {
    const bb = new THREE.Box3().setFromObject(g), c = bb.getCenter(new THREE.Vector3()), r = Math.max(4, bb.getSize(new THREE.Vector3()).length() / 2);
    const d = r / Math.sin((this.cam.fov * Math.PI) / 360);
    this.cam.position.set(c.x + Math.sin(yaw) * d * 0.8, c.y + d * 0.55, c.z + Math.cos(yaw) * d * 0.8); this.cam.lookAt(c);
  }
  draw(g, w, h, yaw) {
    this.scene.add(g); this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    this.frameCamera(g, yaw); this.r.render(this.scene, this.cam); this.scene.remove(g);
  }
  dispose(g) { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }

  // ---------------------------------------------------------------- icons
  // The cached picture, or null (it is queued and filled in when made).
  icon(kind, key) {
    const id = `${kind}:${key}`; if (!this.ok) return null;
    if (this.icons.has(id)) return this.icons.get(id);
    if (!this.queue.includes(id)) this.queue.push(id);
    if (!this.pumping) { this.pumping = true; requestAnimationFrame(() => this.pump()); }
    return null;
  }
  pump() {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 12) {
      const id = this.queue.shift(), i = id.indexOf(':'), kind = id.slice(0, i), key = id.slice(i + 1);
      const g = this.model(kind, key); this.draw(g, 72, 72, 0.7); this.icons.set(id, this.r.domElement.toDataURL('image/png')); this.dispose(g);
      for (const img of document.querySelectorAll(`img[data-icon="${CSS.escape(id)}"]`)) img.src = this.icons.get(id);
    }
    if (this.queue.length) requestAnimationFrame(() => this.pump()); else this.pumping = false;
  }
  // fill every <img data-icon> under el
  fill(el) {
    for (const img of el.querySelectorAll('img[data-icon]')) { const id = img.dataset.icon, i = id.indexOf(':'), src = this.icon(id.slice(0, i), id.slice(i + 1)); if (src) img.src = src; }
  }

  // ---------------------------------------------------------------- the hover card
  // A live, slowly turning view of the model, drawn into the card's own canvas.
  showCard(card, kind, key) {
    if (!this.ok) return;
    this.hideCard();
    const cv = card.querySelector('canvas'); if (!cv) return;
    const g = this.model(kind, key), ctx = cv.getContext('2d'), t0 = performance.now();
    this.liveModel = g;
    const tick = () => {
      if (!card.isConnected || card.hidden || this.liveModel !== g) return;
      this.draw(g, cv.width, cv.height, 0.7 + (performance.now() - t0) / 2400);
      ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(this.r.domElement, 0, 0);
      this.live = requestAnimationFrame(tick);
    };
    tick();
  }
  hideCard() { if (this.live) cancelAnimationFrame(this.live); this.live = null; if (this.liveModel) { this.dispose(this.liveModel); this.liveModel = null; } }
}

// ---------------------------------------------------------------- properties
const pct = (v) => `${Math.round(v * 100)}%`;
export function propsOf(kind, key, sim) {
  const rows = [], add = (k, v) => { if (v !== undefined && v !== null && v !== '' && v !== false) rows.push([k, v]); };
  if (kind === 'svc') {
    const S = SERVICES[key]; if (!S) return { title: key, rows, desc: '' };
    add('Cost', fmtMoney(S.cost)); add('Upkeep', `${fmtMoney(S.upkeep)} / month`); add('Footprint', `${Math.round(S.w * 1.5)} × ${Math.round(S.d * 1.5)} m`);
    if (S.jobs) add('Jobs', S.jobs);
    if (S.power) add('Electricity', `${S.power} MW${key === 'wind' ? ' (with the wind)' : ''}`);
    if (S.water) add('Water', `${S.water} units${key === 'tower' ? ' · lifts water 30 above itself' : key === 'pump' ? ' · lifts water 18 above itself' : ''}`);
    if (S.sewage) add('Sewage treated', `${S.sewage} units`);
    if (S.capBoost) add('Grid import', `+${S.capBoost} MW`);
    if (S.parking) add('Parking spaces', S.parking);
    if (S.treatment) add('Pump contamination removed', `${Math.round(S.treatment*100)}%`);
    if (S.treatmentLevel) add('Sewage pollution removed', `${Math.round(S.treatmentLevel*100)}%`);
    if (S.radius) add('Coverage', `${Math.round(S.radius * 1.5)} m by road`);
    if (S.park) add('Appeal radius', `${Math.round(S.park * 1.5)} m`);
    if (S.seats) add('Seats', S.seats);
    if (S.patients) add('Patients', S.patients);
    if (S.storage) add('Storage', S.storage);
    if (S.freight) add('Freight capacity', `${S.freight} loads`);
    if (S.exportBonus) add('Export prices', `+${pct(S.exportBonus)}`);
    if (S.tourism) add('Tourism', `${fmtMoney(S.tourism)} / month`);
    if (S.dep) add('Needs deposit', `${DEPOSITS[S.dep].name} within ${Math.round((S.reach || 18) * 1.5)} m`);
    if (S.in) add('Inputs', Object.entries(S.in).map(([c, r]) => `${r} ${COMMODITIES[c].name.toLowerCase()}`).join(' + '));
    if (S.out) add('Output', `${S.rate} ${COMMODITIES[S.out].name.toLowerCase()} / month`);
    if (S.stock) add('Stock', `${S.stock} per commodity`);
    if (S.pollution) add('Pollution', pct(S.pollution));
    if (S.noise) add('Noise', pct(S.noise));
    if (S.nearWater) add('Placement', 'on the shoreline');
    const need = S.landmark || S.unlock; if (need) add('Unlocks at', `${need.toLocaleString('en-US')} people${sim && sim.stats.pop < need ? ` (now ${Math.round(sim.stats.pop).toLocaleString('en-US')})` : ' ✓'}`);
    if (S.chain) add('Needs', 'road, power, water, workers, and a highway or freight terminal to sell');
    return { title: S.name, rows, desc: S.desc || '' };
  }
  if (kind === 'road') {
    const [type, lv] = key.split('@'), R = ROADS[type], L = +(lv || 0);
    add('Cost', `${fmtMoney(R.cost * (L ? LAYERS[L].cost : 1))} / m${L ? ` (×${LAYERS[L].cost} ${LAYERS[L].name.toLowerCase()})` : ''}`); add('Upkeep', `${fmtMoney(R.upkeep * 100 * 2)} per 100 m / month`);
    add('Width', `${Math.round(R.width * 1.5)} m`); add('Speed', `${Math.round(R.speed * 5)} km/h`); add('Capacity', `${R.capacity.toLocaleString('en-US')} vehicles / peak`);
    add('Zoning access', R.noAccess ? 'none' : 'both sides'); if (R.oneway) add('Direction', 'one way');
    if (L) add('Level', `${LAYERS[L].name}; crosses other levels without a junction and holds its height between joints`);
    else add('Over water', 'becomes a bridge (piers, railings; towers on long spans)');
    return { title: `${R.name}${L ? ` · ${LAYERS[L].name}` : ''}`, rows, desc: R.desc || '' };
  }
  if (kind === 'zone') {
    const Z = ZONES[+key]; if (!Z) return { title: 'Dezone', rows, desc: 'Clears zoning; buildings on it are demolished.' };
    add('Kind', { R: 'Residential', C: 'Commercial', I: 'Industrial', O: 'Offices', M: 'Homes over shops' }[Z.kind]); add('Levels', `1 – ${Z.maxLevel}`);
    add('Typical lot', `${Math.round(Z.frontage * 1.5)} × ${Math.round(Z.depth * 1.5)} m`);
    const d = sim?.demand?.[Z.kind === 'M' ? 'C' : Z.kind]; if (d != null) add('Demand now', `${d > 0 ? '+' : ''}${Math.round(d)}`);
    add('Floor height', `${Math.round(FLOOR_H * 15) / 10} m`);
    return { title: Z.name, rows, desc: 'Paint along a road; lots follow the streets and buildings grow to fit.' };
  }
  if (kind === 'uline') {
    const L = ULINES[key];
    add('Cost', `${fmtMoney(L.cost)} / m`); add('Upkeep', `${fmtMoney(L.upkeep * 100)} per 100 m / month`); add('Carries', `${L.cap} ${key === 'power' ? 'MW' : 'units'} per run`);
    add('Reach', `${Math.round(L.reach * 1.5)} m either side (strict grid)`); add('Layer', key === 'power' ? 'overhead, on pylons' : 'underground, one flat level');
    return { title: L.name, rows, desc: L.desc };
  }
  return { title: key, rows, desc: '' };
}
