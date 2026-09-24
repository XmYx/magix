// Organicity — rendering. Low-resolution WebGL with nearest-neighbour upscale
// for a pixel-art diorama look. The world's dirty flags drive incremental
// updates: ground texture regions, road mesh, per-chunk merged building meshes,
// instanced trees/vehicles/particles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { N, ZONES, SERVICES, ROADS, DISTRICT_COLORS } from './config.js';
import { CHN } from './world.js';
import { genBuilding, rgb, hex } from './procgen.js';
import { hash2, clamp, fbm } from './util.js';
import { technology, buildingFloors } from './eras.js';
import { Traffic, AgentSim, TYPE_IDS, POSE_STRIDE, deckHeight } from './agents.js';
import { netSnapshot } from './core.js';

// Runs the visible-traffic simulation in a worker (agent-worker.js), or in-thread.
class AgentHost {
  constructor() {
    this.latest = null; this.busy = false; this.acc = 0; this.worker = null; this.local = null;
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./agent-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => { this.latest = e.data; this.busy = false; };
        this.worker.onerror = (e) => { console.warn('Traffic worker failed; running in-thread.', e.message); this.worker.terminate(); this.worker = null; this.local = new AgentSim(); this.busy = false; };
      } catch { this.worker = null; }
    }
    if (!this.worker) this.local = new AgentSim();
  }
  get mode() { return this.worker ? 'worker' : 'in-thread'; }
  post(m) { if (this.worker) this.worker.postMessage(m); else this.local.handle(m); }
  step(dt) {
    this.acc += dt;
    if (this.worker) { if (!this.busy) { this.busy = true; this.worker.postMessage({ type: 'step', dt: Math.min(this.acc, 0.5) }); this.acc = 0; } }
    else { this.latest = this.local.step(Math.min(this.acc, 0.5)); this.acc = 0; }
  }
}
import { fastestRoute } from './routes.js';
import { RAMP_LEN } from './config.js';
import { PROB } from './sim.js';

const SKY = 0xa9d3ec;
const lin = (c) => rgb(c[0], c[1], c[2]);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const px = (g, c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

function makeTextures() {
  const res = canvasTex(16, 16, (g) => {
    px(g, '#ffffff', 0, 0, 16, 16);
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const X = tx * 8, Y = ty * 8, lit = tx === 1 && ty === 0;
      px(g, '#e4e4e4', X, Y + 7, 8, 1);
      px(g, lit ? '#ffd98a' : '#3d4b62', X + 2, Y + 2, 4, 4);
      px(g, lit ? '#fff0c0' : '#8ea6c6', X + 2, Y + 2, 1, 1);
      px(g, '#c8c8c8', X + 1, Y + 6, 6, 1);
    }
  });
  const off = canvasTex(16, 16, (g) => {
    px(g, '#5b7ea4', 0, 0, 16, 16);
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const X = tx * 8, Y = ty * 8;
      px(g, '#d9e1ea', X, Y, 8, 2); px(g, '#d9e1ea', X, Y, 1, 8);
      px(g, tx === ty ? '#86a8cc' : '#6f93ba', X + 1, Y + 2, 7, 6);
      px(g, '#b8d0e8', X + 2, Y + 3, 1, 2);
    }
    px(g, '#ffe7a8', 9, 10, 7, 6);
  });
  const com = canvasTex(16, 16, (g) => {
    px(g, '#ffffff', 0, 0, 16, 16);
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const X = tx * 8, Y = ty * 8;
      px(g, '#dcdcdc', X, Y + 7, 8, 1);
      px(g, tx !== ty ? '#ffe2a0' : '#465f7a', X + 1, Y + 2, 6, 4);
      px(g, '#9fb7cf', X + 1, Y + 2, 6, 1);
    }
  });
  const shop = canvasTex(16, 16, (g) => {
    px(g, '#ffffff', 0, 0, 16, 16);
    for (let x = 0; x < 16; x += 2) px(g, '#bdbdbd', x, 0, 1, 3);
    px(g, '#9a9a9a', 0, 3, 16, 1);
    px(g, '#35495f', 1, 6, 14, 9);
    px(g, '#ffe3a3', 2, 8, 3, 2); px(g, '#ffe3a3', 10, 9, 3, 2); px(g, '#8fb0cc', 2, 6, 12, 1);
    px(g, '#222a33', 6, 7, 3, 9);
    px(g, '#888888', 0, 15, 16, 1);
  });
  const ind = canvasTex(16, 16, (g) => {
    for (let x = 0; x < 16; x++) px(g, x % 2 ? '#e4e4e4' : '#ffffff', x, 0, 1, 16);
    for (let x = 1; x < 16; x += 4) px(g, '#5f7182', x, 2, 2, 2);
    px(g, '#bdbdbd', 0, 15, 16, 1);
  });
  // night glow maps: dark window pixels become lit (warm, some cool) in a seeded pattern; walls stay black
  const glow = (t, seed) => {
    const src = t.image, c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const lum = (p[i] + p[i + 1] + p[i + 2]) / 3, px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width);
      const on = lum < 150 && hash2(px >> 3, py >> 3, seed) < 0.6;
      const cool = hash2(px >> 3, py >> 3, seed + 1) < 0.25;
      p[i] = on ? (cool ? 150 : 255) : 0; p[i + 1] = on ? (cool ? 200 : 205) : 0; p[i + 2] = on ? (cool ? 255 : 120) : 0; p[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    const e = new THREE.CanvasTexture(c); e.magFilter = THREE.NearestFilter; e.minFilter = THREE.NearestMipmapLinearFilter; e.colorSpace = THREE.SRGBColorSpace; e.wrapS = e.wrapT = THREE.RepeatWrapping;
    return e;
  };
  return { res, off, com, shop, ind, glow: { res: glow(res, 1), off: glow(off, 2), com: glow(com, 3), shop: glow(shop, 4) } };
}

function iconMaterials() {
  const icons = {
    fire: (g) => { px(g, '#3a1a0a', 3, 3, 10, 10); px(g, '#ff7a1a', 5, 5, 6, 7); px(g, '#ffd23a', 7, 7, 2, 4); px(g, '#ff7a1a', 6, 3, 2, 2); },
    abandoned: (g) => { px(g, '#2a2a2a', 3, 3, 10, 10); px(g, '#cfcfcf', 5, 5, 6, 5); px(g, '#2a2a2a', 6, 6, 1, 2); px(g, '#2a2a2a', 9, 6, 1, 2); px(g, '#cfcfcf', 6, 10, 4, 2); },
    road: (g) => { px(g, '#5a0a0a', 3, 3, 10, 10); px(g, '#ff4a4a', 4, 7, 8, 2); px(g, '#ffffff', 5, 7, 1, 2); px(g, '#ffffff', 9, 7, 1, 2); },
    outside: (g) => { px(g, '#4a1a4a', 3, 3, 10, 10); px(g, '#ff8aff', 5, 5, 3, 3); px(g, '#ff8aff', 8, 8, 3, 3); px(g, '#ff8aff', 7, 7, 2, 2); },
    power: (g) => { px(g, '#2a2a0a', 3, 3, 10, 10); px(g, '#ffe23a', 8, 4, 2, 3); px(g, '#ffe23a', 6, 7, 4, 1); px(g, '#ffe23a', 6, 8, 2, 4); },
    water: (g) => { px(g, '#0a1a3a', 3, 3, 10, 10); px(g, '#4ab0ff', 7, 4, 2, 2); px(g, '#4ab0ff', 6, 6, 4, 3); px(g, '#4ab0ff', 5, 8, 6, 3); px(g, '#c0e8ff', 6, 8, 1, 1); },
    sewage: (g) => { px(g, '#1a1a0a', 3, 3, 10, 10); px(g, '#8a7a3a', 5, 6, 6, 5); px(g, '#c0a860', 6, 5, 4, 1); },
    garbage: (g) => { px(g, '#1a120a', 3, 3, 10, 10); px(g, '#8a6a3a', 5, 6, 6, 6); px(g, '#6a4a2a', 7, 4, 2, 2); px(g, '#aa8a5a', 6, 7, 1, 3); },
  };
  const mats = {};
  for (const k in icons) {
    const t = canvasTex(16, 16, (g) => { g.clearRect(0, 0, 16, 16); px(g, '#ffffff', 2, 2, 12, 12); icons[k](g); }, false);
    t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    mats[k] = new THREE.SpriteMaterial({ map: t, transparent: true });
  }
  return mats;
}

function coloredBox(sx, sy, sz, x, y, z, c) {
  const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z);
  const n = g.attributes.position.count, col = new Float32Array(n * 3), cc = hex(c);
  for (let i = 0; i < n; i++) col.set(cc, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Renderer {
  constructor(canvas, world, sim) {
    this.w = world; this.sim = sim;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.BasicShadowMap;
    this.pixel = 3;
    try { this.pixel = +(localStorage.getItem('organicity-pixel') || 3); } catch { /* storage unavailable */ }
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 400, 1200);
    this.camera = new THREE.PerspectiveCamera(30, 1, 2, 3000);
    this.cam = { x: 150, z: 262, yaw: 0.75, pitch: 0.9, dist: 210 };
    this.hemi = new THREE.HemisphereLight(0xe8f2ff, 0x6a7a4a, 1.35);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    const tex = makeTextures();
    const mk = (map) => new THREE.MeshLambertMaterial({ vertexColors: true, map: map || null });
    this.mats = { plain: mk(), res: mk(tex.res), off: mk(tex.off), com: mk(tex.com), shop: mk(tex.shop), ind: mk(tex.ind) };
    for (const k in tex.glow) { const m = this.mats[k]; m.emissiveMap = tex.glow[k]; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0; }
    this.dayMode = 'cycle'; try { this.dayMode = localStorage.getItem('organicity-daynight') || 'cycle'; } catch { /* storage unavailable */ }
    this.tod = 0.3; this.night = 0;
    this.mats.neon = new THREE.MeshBasicMaterial({vertexColors:true});
    this.iconMats = iconMaterials();
    this.buildingTints = true; this.tintPending = new Set(); this.routeKind = 'job';
    this.overlay = 'none'; this.showDistricts = false; this.overlayVer = -1;
    this.initGround();
    this.initWater();
    this.roadMesh = null; this.roadVer = -1; this.flowVer = -1;
    this.chunks = new Array(CHN * CHN).fill(null);
    this.bgeo = new Map();
    this.treeMesh = null; this.roadTrees = [];
    this.initVehicles();
    this.initParticles();
    this.icons = []; this.iconT = 0;
    this.rotors = new Map();
    this.initPreview();
    this.time = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setPixel(p) { this.pixel = p; try { localStorage.setItem('organicity-pixel', p); } catch { /* ignore */ } this.resize(); }
  resize() {
    this.r.setPixelRatio(1 / this.pixel);
    this.r.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- camera
  updateCamera() {
    const c = this.cam, cp = Math.cos(c.pitch);
    c.x = clamp(c.x, 0, N); c.z = clamp(c.z, 0, N);
    this.camera.position.set(c.x + Math.sin(c.yaw) * cp * c.dist, (c.targetY || 0) + Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(c.x, c.targetY || 0, c.z);
    this.sun.position.set(c.x - 140, (c.targetY || 0)+260, c.z + 90);
    this.sun.target.position.set(c.x, c.targetY || 0, c.z);
    const ext = Math.round(clamp(c.dist * 0.95, 60, 360) / 10) * 10, sc = this.sun.shadow.camera;
    if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 10; sc.far = 700; sc.updateProjectionMatrix(); }
    this.scene.fog.near = c.dist * 1.4; this.scene.fog.far = c.dist * 4 + 300;
  }

  rayAt(cx, cy) {
    const v = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    return rc.ray;
  }
  groundAt(cx, cy, height = 0) {
    const ray = this.rayAt(cx, cy);
    if (ray.direction.y > -1e-4) return null;
    const t = (height - ray.origin.y) / ray.direction.y;
    if(t<0)return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }
  // Elevation-aware picking, including services whose footprints overlap the ground city.
  pickBuilding(cx, cy) {
    const ray=this.rayAt(cx,cy),box=new THREE.Box3(),hit=new THREE.Vector3();let found=null,distance=Infinity;
    for(const b of this.w.buildings.values()) {
      box.min.set(b.x0,b.baseY || 0,b.z0);box.max.set(b.x1,b.top || (b.baseY || 0)+3,b.z1);
      if(ray.intersectBox(box,hit)){const d=hit.distanceToSquared(ray.origin);if(d<distance){found=b;distance=d;}}
    }
    return found;
  }

  // ---------------------------------------------------------------- ground
  initGround() {
    const S = 128, st = N / S;
    this.groundS = S;
    const pos = new Float32Array((S + 1) * (S + 1) * 3), uv = new Float32Array((S + 1) * (S + 1) * 2);
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) { const k = j * (S + 1) + i; pos.set([i * st, 0, j * st], k * 3); uv.set([(i * st) / N, (j * st) / N], k * 2); }
    const idx = [];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = j * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.gpx = new Uint8Array(N * N * 4);
    this.gtex = new THREE.DataTexture(this.gpx, N, N, THREE.RGBAFormat);
    this.gtex.colorSpace = THREE.SRGBColorSpace;
    this.gtex.magFilter = THREE.NearestFilter; this.gtex.minFilter = THREE.LinearMipmapLinearFilter; this.gtex.generateMipmaps = true;
    this.ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: this.gtex }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.base = new Uint8Array(N * N * 3);
    this.refreshTerrain();
  }

  // shoreline heights + natural ground colours; rerun after sandbox terrain edits
  refreshTerrain() {
    const w = this.w, S = this.groundS, st = N / S, pos = this.ground.geometry.attributes.position;
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const wd = w.wdist[clamp(Math.floor(j * st), 0, N - 1) * N + clamp(Math.floor(i * st), 0, N - 1)];
      pos.setY(j * (S + 1) + i, wd < 0 ? Math.max(-3.2, wd * 0.5) - 0.4 : wd < 1.5 ? (-0.4 * (1.5 - wd)) / 1.5 : 0);
    }
    pos.needsUpdate = true; this.ground.geometry.computeVertexNormals();
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x, wd = w.wdist[i], h = hash2(x, z, 5), f = fbm(x * 0.03, z * 0.03, 77, 3);
      let c;
      if (wd < 0) c = mix([96, 150, 170], [44, 92, 132], clamp(-wd / 8, 0, 1));
      else if (wd < 2.2) c = h < 0.5 ? [214, 202, 150] : [204, 192, 142];
      else { c = mix([96, 146, 62], [128, 170, 80], f); if (h < 0.18) c = mix(c, [150, 186, 94], 0.5); else if (h > 0.9) c = mix(c, [80, 128, 56], 0.6); }
      this.base[i * 3] = c[0]; this.base[i * 3 + 1] = c[1]; this.base[i * 3 + 2] = c[2];
    }
    this.terrainVer = w.terrainVersion;
  }

  baseAt(x, z) { const i = (z * N + x) * 3; return [this.base[i], this.base[i + 1], this.base[i + 2]]; }
  lotColor(b, x, z) {
    const h = hash2(x, z, 3) < 0.5;
    if (b.svc) {
      if (SERVICES[b.svc].park) return h ? [104, 172, 74] : [96, 164, 68];
      if (b.svc === 'landfill') return h ? [124, 104, 74] : [116, 96, 70];
      if (b.svc === 'wind') return this.baseAt(x, z);
      return h ? [170, 168, 160] : [162, 160, 152];
    }
    const key = ZONES[b.zone].key;
    let c = key === 'rl' ? (h ? [128, 180, 88] : [120, 172, 82]) : key === 'rh' ? [150, 168, 132] : key === 'c' ? [190, 186, 176] :
      key === 'o' ? [178, 182, 188] : key === 'm' ? [184, 176, 164] : h ? [140, 136, 126] : [132, 128, 120];
    if (b.abandoned) c = mix(c, [110, 96, 80], 0.5);
    return c;
  }

  overlayValue(x, z, b) {
    const s = this.sim, o = this.overlay;
    switch (o) {
      case 'traffic': return b ? b.cong || 0 : null;
      case 'level': return b && !b.svc ? b.level / 5 : null;
      case 'happiness': return b && !b.svc ? b.happy : null;
      case 'problems': return b ? (b.prob ? 1 : 0) : null;
      case 'age': return b ? Math.min(1, (s.day - b.built) / 365) : null;
      case 'landvalue': return s.at(s.f.lv, x, z);
      case 'pollution': return s.at(s.f.pollution, x, z);
      case 'noise': return s.at(s.f.noise, x, z);
      case 'crime': return s.at(s.f.crime, x, z);
      case 'access': return s.at(s.f.access, x, z);
      case 'fire': case 'police': case 'clinic': case 'school': return s.at(s.cov[o], x, z);
      case 'garbage': return b ? (b.svc ? null : b.garbOk ? 1 : 0) : s.at(s.cov.landfill, x, z) > 0.02 ? 0.75 : null;
      case 'park': return s.at(s.cov.park, x, z);
      case 'waterpol': return s.f.waterPol && this.w.wdist[this.w.cellAt(x, z)] < 30 ? s.at(s.f.waterPol, x, z) : null;
      case 'transit': return s.at(s.cov.busstop, x, z);
      case 'desireR': case 'desireC': case 'desireI': case 'desireO': return b ? null : s.desirability(o.slice(-1), x, z);
      case 'power': return b ? (b.power ? 1 : 0) : null;
      case 'water': return b ? (b.water && b.sewage ? 1 : b.water || b.sewage ? 0.5 : 0) : null;
      default: return null;
    }
  }

  paintGround(x0, z0, x1, z1) {
    const w = this.w, g = this.gpx, ov = this.overlay !== 'none' && this.overlay !== 'districts' && this.overlay !== 'traffic';
    const good = ov && this.OVGOOD[this.overlay];
    const showD = this.showDistricts || this.overlay === 'districts';
    x0 = clamp(x0, 0, N); z0 = clamp(z0, 0, N); x1 = clamp(x1, 0, N); z1 = clamp(z1, 0, N);
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const i = z * N + x; let c;
      const bid = w.bld[i], b = bid ? w.buildings.get(bid) : null;
      if (w.water[i]) c = w.wdist[i] < 0 ? this.baseAt(x, z) : [70, 124, 168];
      else if (w.wdist[i] < 0) c = [196, 186, 140];
      else if (w.road[i]) c = [150, 150, 146];
      else if (b) c = this.lotColor(b, x, z);
      else if (w.zone[i]) {
        c = mix(this.baseAt(x, z), ZONES[w.zone[i]].color, ((x + z) & 3) === 0 ? 0.62 : 0.4);
        if (w.accEdge[i] < 0) c = mix(c, [60, 60, 60], 0.35);
      } else c = this.baseAt(x, z);
      if (ov && !w.water[i]) {
        const v = this.overlayValue(x + 0.5, z + 0.5, b), l = (c[0] + c[1] + c[2]) / 3;
        if (v === null) c = [l * 0.7 + 30, l * 0.7 + 30, l * 0.7 + 30];
        else {
          const t = clamp(good ? v : 1 - v, 0, 1);
          const rc = t < 0.5 ? mix([214, 64, 52], [236, 204, 66], t * 2) : mix([236, 204, 66], [66, 184, 92], (t - 0.5) * 2);
          c = mix([l, l, l], rc, 0.78);
        }
      }
      if (showD) {
        const d = w.district[i];
        if (d) {
          const edge = (x > 0 && w.district[i - 1] !== d) || (x < N - 1 && w.district[i + 1] !== d) || (z > 0 && w.district[i - N] !== d) || (z < N - 1 && w.district[i + N] !== d);
          c = mix(c, DISTRICT_COLORS[d], edge ? 0.9 : 0.28);
        }
      }
      if (this.sim.weather.type === 'snow' && this.overlay === 'none' && !w.water[i]) c = mix(c,[230,239,245],w.road[i]?0.25:0.8);
      const o = i * 4; g[o] = c[0]; g[o + 1] = c[1]; g[o + 2] = c[2]; g[o + 3] = 255;
    }
    this.gtex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- water
  initWater() {
    const t = canvasTex(32, 32, (g) => {
      px(g, '#ffffff', 0, 0, 32, 32);
      for (let k = 0; k < 40; k++) px(g, k % 3 ? '#e6f2ff' : '#d2e6f8', (hash2(k, 1, 9) * 32) | 0, (hash2(k, 2, 9) * 32) | 0, 2 + (k % 3), 1);
    });
    t.repeat.set(40, 40);
    this.waterTex = t;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(N * 3, N * 3), new THREE.MeshLambertMaterial({ color: 0x4f94c8, map: t, transparent: true, opacity: 0.86 }));
    m.rotation.x = -Math.PI / 2; m.position.set(N / 2, -0.32, N / 2);
    m.receiveShadow = true;
    this.scene.add(m);
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(N * 3, N * 3), new THREE.MeshLambertMaterial({ color: 0x7aa85a }));
    skirt.rotation.x = -Math.PI / 2; skirt.position.set(N / 2, -4, N / 2);
    this.scene.add(skirt);
  }

  // ---------------------------------------------------------------- roads
  buildRoads() {
    const net = this.w.net, P = [], Nn = [], C = [];
    this.signalHeads = []; this.lamps = [];
    this.roadEra = technology(this.w.year).style;
    this.edgeRange = new Map(); this.roadTrees = [];
    const up = [0, 1, 0];
    const tri = (a, b, c, col, n = up) => { P.push(...a, ...b, ...c); Nn.push(...n, ...n, ...n); C.push(...col, ...col, ...col); };
    const frame = (e, s) => {
      const p = net.sampleAt(e, s), a = net.sampleAt(e, s - 0.8), b = net.sampleAt(e, s + 0.8);
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      return { x: p.x, z: p.z, nx: -tz, nz: tx };
    };
    const ribbon = (e, s0, s1, o0, o1, y, col, skirt = false) => {
      if (e.layer === -1) { // tunnels: only the portals and ramps are visible
        const a = Math.max(s0, 0), b = Math.min(s1, RAMP_LEN);
        if (s0 < RAMP_LEN && s1 > RAMP_LEN) { ribbonR(e, a, b, o0, o1, y, col, skirt); ribbonR(e, Math.max(s0, e.len - RAMP_LEN), s1, o0, o1, y, col, skirt); return; }
        if (s0 >= RAMP_LEN && s1 <= e.len - RAMP_LEN) return;
      }
      ribbonR(e, s0, s1, o0, o1, y, col, skirt);
    };
    const ribbonR = (e, s0, s1, o0, o1, y, col, skirt = false) => {
      if (s1 - s0 < 0.05) return;
      const ss = [s0]; for (let i = 1; i < e.n; i++) if (e.cum[i] > s0 + 0.05 && e.cum[i] < s1 - 0.05) ss.push(e.cum[i]); ss.push(s1);
      if (e.layer) for (let k = 1; k < 8; k++) for (const s of [k * RAMP_LEN / 8, e.len - k * RAMP_LEN / 8]) if (s > s0 && s < s1) ss.push(s);
      ss.sort((p, q) => p - q);
      let prev = null;
      for (const s of ss) {
        const f = frame(e, s), yy = y + deckHeight(e, s);
        const L = [f.x + f.nx * o1, yy, f.z + f.nz * o1], R = [f.x + f.nx * o0, yy, f.z + f.nz * o0];
        if (prev) {
          tri(prev.R, prev.L, R, col); tri(R, prev.L, L, col);
          if (skirt) {
            const nl = [f.nx, 0, f.nz], nr = [-f.nx, 0, -f.nz], yb = e.layer === 1 ? yy - 1.1 : -0.9;
            const pb = e.layer === 1 ? prev.L[1] - 1.1 : yb;
            tri(prev.L, [prev.L[0], pb, prev.L[2]], L, col, nl); tri(L, [prev.L[0], pb, prev.L[2]], [L[0], yb, L[2]], col, nl);
            tri([prev.R[0], pb, prev.R[2]], prev.R, R, col, nr); tri(R, prev.R, [R[0], yb, R[2]], col, nr);
            if (e.layer === 1 && deckHeight(e, s) > 1) { // parapets on the deck
              const h = 0.7;
              tri([prev.L[0], prev.L[1] + h, prev.L[2]], prev.L, L, col, nr); tri([prev.L[0], prev.L[1] + h, prev.L[2]], L, [L[0], L[1] + h, L[2]], col, nr);
              tri(prev.R, [prev.R[0], prev.R[1] + h, prev.R[2]], R, col, nl); tri(R, [prev.R[0], prev.R[1] + h, prev.R[2]], [R[0], R[1] + h, R[2]], col, nl);
            }
          }
        }
        prev = { L, R };
      }
    };
    const disc = (x, z, r, y, col) => {
      const seg = 16;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], col);
      }
    };
    const fan = (x, z, pts, y, col) => { // convex junction polygon around a node
      pts.sort((a, b) => Math.atan2(a[1] - z, a[0] - x) - Math.atan2(b[1] - z, b[0] - x));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const A = [a[0], y, a[1]], B = [b[0], y, b[1]], O = [x, y, z];
        if ((a[1] - z) * (b[0] - x) - (a[0] - x) * (b[1] - z) > 0) tri(O, A, B, col); else tri(O, B, A, col);
      }
    };
    const column = (x, z, r, y0, y1, col) => {
      const c = [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]];
      for (let i = 0; i < 4; i++) {
        const p0 = c[i], p1 = c[(i + 1) % 4], n = [(p1[1] - p0[1]) / (2 * r), 0, -(p1[0] - p0[0]) / (2 * r)];
        tri([p1[0], y0, p1[1]], [p0[0], y0, p0[1]], [p0[0], y1, p0[1]], col, n); tri([p1[0], y0, p1[1]], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]], col, n);
      }
    };
    const dashes = (e, s0, s1, off, w, y, col, on = 2, gap = 2) => { for (let s = s0 + 1; s < s1 - 1; s += on + gap) ribbon(e, s, Math.min(s + on, s1 - 1), off - w / 2, off + w / 2, y, col); };
    const WHITE = lin([236, 236, 226]), YEL = lin([236, 196, 60]), SIDE = lin([178, 178, 170]), MED = lin([96, 150, 70]), ASPH = lin(this.w.year<1900?[110,91,71]:[72,74,79]);
    const nodeR = (n) => { let r = 0; for (const id of n.edges) { const e = net.edges.get(id); if (e) r = Math.max(r, e.hw); } return r; };
    for (const e of net.edges.values()) {
      const A = net.nodes.get(e.a), B = net.nodes.get(e.b), hw = e.hw;
      const dA = A.edges.size, dB = B.edges.size;
      const tA = dA >= 3 ? nodeR(A) + 0.6 : 0, tB = dB >= 3 ? nodeR(B) + 0.6 : 0;
      const s0 = Math.min(tA, e.len / 2), s1 = Math.max(e.len - tB, e.len / 2);
      ribbon(e, 0, e.len, -hw - 1.2, hw + 1.2, 0.08, e.type === 'highway' ? lin([120, 120, 116]) : SIDE, true);
      const cond = e.cond ?? 1;
      const base = e.type === 'alley' ? [152, 140, 122] : e.type === 'highway' ? [62, 64, 68] : [72, 74, 79];
      const asph = lin(mix(base, [128, 116, 100], (1 - cond) * 0.6));
      const start = P.length / 3;
      ribbon(e, s0, s1, -hw, hw, 0.14, asph);
      this.edgeRange.set(e.id, [start, P.length / 3, asph]);
      const y = 0.17;
      if (e.oneway) {
        const d = e.oneway;
        for (let s = s0 + 5; s < s1 - 4; s += 11) {
          const f = frame(e, s), tx = f.nz * d, tz = -f.nx * d;   // travel direction
          const ya = 0.18 + deckHeight(e, s); if (e.layer === -1 && ya < -1) continue;
          const tip = [f.x + tx * 1.6, ya, f.z + tz * 1.6], l = [f.x - tx * 0.6 + f.nx * 0.9, ya, f.z - tz * 0.6 + f.nz * 0.9], r = [f.x - tx * 0.6 - f.nx * 0.9, ya, f.z - tz * 0.6 - f.nz * 0.9];
          if ((l[2] - tip[2]) * (r[0] - tip[0]) - (l[0] - tip[0]) * (r[2] - tip[2]) > 0) tri(tip, l, r, WHITE); else tri(tip, r, l, WHITE);
          ribbon(e, d > 0 ? s - 2.2 : s + 0.6, d > 0 ? s - 0.6 : s + 2.2, -0.2, 0.2, y, WHITE);
        }
      } else if (e.type === 'street') dashes(e, s0, s1, 0, 0.25, y, WHITE);
      else if (e.type === 'avenue') { ribbon(e, s0 + 1, s1 - 1, -0.35, -0.15, y, YEL); ribbon(e, s0 + 1, s1 - 1, 0.15, 0.35, y, YEL); dashes(e, s0, s1, hw / 2, 0.22, y, WHITE); dashes(e, s0, s1, -hw / 2, 0.22, y, WHITE); }
      else if (e.type === 'boulevard') {
        ribbon(e, s0 + 0.5, s1 - 0.5, -1.4, 1.4, 0.22, lin([190, 190, 180]));
        ribbon(e, s0 + 0.5, s1 - 0.5, -1.1, 1.1, 0.26, MED);
        for (const k of [1, 2]) { const o = 1.4 + ((hw - 1.4) * k) / 3; dashes(e, s0, s1, o, 0.22, y, WHITE); dashes(e, s0, s1, -o, 0.22, y, WHITE); }
        for (let s = s0 + 4; s < s1 - 3; s += 7) { const f = frame(e, s); this.roadTrees.push([f.x, f.z, 0.8]); }
      } else if (e.type === 'highway') {
        ribbon(e, s0, s1, -0.35, -0.15, y, YEL); ribbon(e, s0, s1, 0.15, 0.35, y, YEL);
        dashes(e, s0, s1, hw / 2, 0.22, y, WHITE, 3, 3); dashes(e, s0, s1, -hw / 2, 0.22, y, WHITE, 3, 3);
        ribbon(e, s0, s1, hw - 0.5, hw - 0.3, y, WHITE); ribbon(e, s0, s1, -hw + 0.3, -hw + 0.5, y, WHITE);
      }
      if (e.type !== 'highway') for (const [deg, s, dir] of [[dA, s0, 1], [dB, s1, -1]]) {
        if (deg < 3) continue;
        const a = dir > 0 ? s + 0.3 : s - 1.8;
        for (let o = -hw + 0.5; o < hw - 0.4; o += 1.1) ribbon(e, a, a + 1.5, o, o + 0.55, y, WHITE);
      }
      if (!e.layer && e.type !== 'highway' && e.type !== 'alley') for (let s = s0 + 6; s < s1 - 4; s += 16) { const f = frame(e, s), sg = (Math.floor(s / 16) % 2) ? 1 : -1; this.lamps.push([f.x + f.nx * (hw + 0.9) * sg, f.z + f.nz * (hw + 0.9) * sg]); }
      if (e.busLane) { const BUS = lin([168, 58, 48]); ribbon(e, s0 + 0.5, s1 - 0.5, hw - 2.2, hw - 0.4, 0.155, BUS); if (!e.oneway) ribbon(e, s0 + 0.5, s1 - 0.5, -hw + 0.4, -hw + 2.2, 0.155, BUS); }
      if (e.layer === 1) for (let s = RAMP_LEN; s < e.len - RAMP_LEN * 0.6; s += 12) { // pillars under the deck
        const f = frame(e, s), top = deckHeight(e, s) - 1.1, col = lin([158, 154, 146]);
        column(f.x, f.z, 0.7, -3, top, col);
      }
      if (e.layer === -1) for (const s of [RAMP_LEN, e.len - RAMP_LEN]) { // tunnel portals
        const f = frame(e, s), col = lin([96, 92, 86]), y0 = deckHeight(e, s);
        for (const sg of [-1, 1]) column(f.x + f.nx * (hw + 0.6) * sg, f.z + f.nz * (hw + 0.6) * sg, 0.6, y0, 1.2, col);
        ribbonR(e, s - 0.8, s + 0.8, -hw - 1.2, hw + 1.2, 1.2, col);
      }
      if (e.layer) continue;
      for (let s = 3; s < e.len - 3; s += 9) { // bridge piers
        const f = frame(e, s), ci = this.w.cellAt(f.x, f.z);
        if (ci < 0 || !this.w.water[ci]) continue;
        const col = lin([150, 146, 138]), tx = f.nz, tz = -f.nx, W2 = hw + 1, T = 0.6;
        const c = [[-W2, -T], [W2, -T], [W2, T], [-W2, T]].map(([u, v]) => [f.x + f.nx * u + tx * v, f.z + f.nz * u + tz * v]);
        for (let i = 0; i < 4; i++) {
          const p0 = c[i], p1 = c[(i + 1) % 4], nx = p1[1] - p0[1], nz = -(p1[0] - p0[0]), l = Math.hypot(nx, nz) || 1;
          let n = [nx / l, 0, nz / l];
          const out = (p0[0] + p1[0]) / 2 - f.x, outz = (p0[1] + p1[1]) / 2 - f.z;
          const a0 = [p0[0], -4, p0[1]], a1 = [p0[0], 0.05, p0[1]], b0 = [p1[0], -4, p1[1]], b1 = [p1[0], 0.05, p1[1]];
          if (out * n[0] + outz * n[2] > 0) { tri(b0, a0, a1, col, n); tri(b0, a1, b1, col, n); }
          else { n = n.map((v) => -v); tri(a0, b0, b1, col, n); tri(a0, b1, a1, col, n); }
        }
      }
    }
    for (const n of net.nodes.values()) {
      const deg = n.edges.size; if (!deg) continue;
      const r = nodeR(n);
      if (deg >= 3) {
        const inner = [], outer = [];
        for (const id of n.edges) {
          const e = net.edges.get(id); if (!e) continue;
          const tr = Math.min(r + 0.6, e.len / 2), s = e.a === n.id ? tr : e.len - tr, f = frame(e, s);
          for (const sg of [-1, 1]) {
            inner.push([f.x + f.nx * e.hw * sg, f.z + f.nz * e.hw * sg]);
            outer.push([f.x + f.nx * (e.hw + 1.2) * sg, f.z + f.nz * (e.hw + 1.2) * sg]);
          }
        }
        fan(n.x, n.z, outer, 0.081, SIDE); fan(n.x, n.z, inner, 0.145, ASPH);
        if (n.control === 'roundabout') {
          disc(n.x, n.z, r * 0.95, 0.15, lin([226, 226, 216])); disc(n.x, n.z, r * 0.85, 0.2, lin([196, 196, 186])); disc(n.x, n.z, r * 0.75, 0.24, MED);
          this.roadTrees.push([n.x, n.z, 0.9]);
        }
        if (n.control === 'stop' || n.control === 'signal') for (const id of n.edges) {  // stop lines + furniture
          const e = net.edges.get(id); if (!e || e.layer) continue;
          const tr = Math.min(r + 0.6, e.len / 2), atA = e.a === n.id, sA = atA ? tr + 2.0 : e.len - tr - 2.0, f = frame(e, sA);
          const side = atA ? -1 : 1; // the approaching lane is on the driver's right
          ribbon(e, sA - 0.2, sA + 0.2, side > 0 ? 0 : -e.hw, side > 0 ? e.hw : 0, 0.18, WHITE);
          const px = f.x + f.nx * (e.hw + 1.4) * side, pz = f.z + f.nz * (e.hw + 1.4) * side;
          column(px, pz, 0.08, 0, 2.6, lin([70, 70, 74]));
          if (n.control === 'stop') column(px, pz, 0.35, 2.3, 2.9, lin([200, 40, 36]));
          else this.signalHeads.push({ node: n.id, edge: e.id, x: px, z: pz });
        }
      } else if (deg === 2) {
        let mn = 1e9; for (const id of n.edges) { const e = net.edges.get(id); if (e) mn = Math.min(mn, e.hw); }
        disc(n.x, n.z, mn + 1.2, 0.079, SIDE); disc(n.x, n.z, mn, 0.138, ASPH);
      } else if (!n.outside) { disc(n.x, n.z, r + 2.6, 0.081, SIDE); disc(n.x, n.z, r + 1.3, 0.145, ASPH); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    if (this.roadMesh) { this.scene.remove(this.roadMesh); this.roadMesh.geometry.dispose(); }
    else this.roadMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.roadMesh = new THREE.Mesh(g, this.roadMat);
    this.roadMesh.receiveShadow = true;
    this.scene.add(this.roadMesh);
    this.roadVer = net.version; this.flowVer = -1;
    this.w.dirty.trees = true;
    if (this.signalGroup) { this.scene.remove(this.signalGroup); this.signalGroup.traverse((o) => o.geometry?.dispose()); }
    this.signalGroup = new THREE.Group();
    this.sigMats ||= [new THREE.MeshBasicMaterial({ color: 0xff3a2a }), new THREE.MeshBasicMaterial({ color: 0x3aff6a })];
    const headGeo = new THREE.BoxGeometry(0.45, 0.8, 0.45);
    for (const h of this.signalHeads) { h.mesh = new THREE.Mesh(headGeo, this.sigMats[0]); h.mesh.position.set(h.x, 2.9, h.z); this.signalGroup.add(h.mesh); }
    this.scene.add(this.signalGroup);
    if (this.lampMesh) { this.scene.remove(this.lampMesh); this.lampMesh.dispose(); }
    const lampGeo = mergeGeometries([coloredBox(0.14, 3.2, 0.14, 0, 1.6, 0, 0x55585c), coloredBox(0.5, 0.25, 0.5, 0, 3.3, 0, 0xfff2c0)]);
    this.lampMat ||= new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffe2a0, emissiveIntensity: 0 });
    this.lampMesh = new THREE.InstancedMesh(lampGeo, this.lampMat, Math.max(1, this.lamps.length));
    const LM = new THREE.Matrix4(); this.lamps.forEach(([x, z], i) => { LM.makeTranslation(x, 0, z); this.lampMesh.setMatrixAt(i, LM); });
    this.lampMesh.count = this.lamps.length; this.scene.add(this.lampMesh);
  }

  colorTraffic() {
    if (!this.roadMesh) return;
    const col = this.roadMesh.geometry.attributes.color, a = col.array, net = this.w.net, on = this.overlay === 'traffic';
    for (const [id, [s, e, base]] of this.edgeRange) {
      const ed = net.edges.get(id); if (!ed) continue;
      let c = base;
      if (on) { const t = clamp(ed.cong ?? 0, 0, 1.2) / 1.2; c = lin(t < 0.5 ? mix([70, 190, 90], [240, 210, 60], t * 2) : mix([240, 210, 60], [220, 50, 40], (t - 0.5) * 2)); }
      for (let i = s; i < e; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
    }
    col.needsUpdate = true;
    this.flowVer = this.sim.flowVersion;
  }

  // ---------------------------------------------------------------- buildings
  rebuildChunk(ch, list) {
    const acc = {};
    let hasAny = false;
    for (const b of list) {
      let cache = this.bgeo.get(b.id);
      if (!cache || cache.v !== b.geoVersion || cache.ab !== b.abandoned) {
        const gen = genBuilding(b, this.w);
        cache = { v: b.geoVersion, ab: b.abandoned, gen };
        this.bgeo.set(b.id, cache);
      }
      b.top = cache.gen.top;
      for (const k in cache.gen.g) {
        const s = cache.gen.g[k]; if (!s.p.length) continue;
        (acc[k] || (acc[k] = [])).push({ ...s, building: b.id }); hasAny = true;
      }
    }
    const old = this.chunks[ch];
    if (old) { for (const m of old.children) m.geometry.dispose(); this.scene.remove(old); }
    this.chunks[ch] = null;
    if (!hasAny) return;
    const grp = new THREE.Group();
    for (const k in acc) {
      let n = 0; for (const s of acc[k]) n += s.p.length;
      const p = new Float32Array(n), nn = new Float32Array(n), c = new Float32Array(n), u = new Float32Array((n / 3) * 2);
      let o = 0, ou = 0; const spans = [];
      for (const s of acc[k]) { spans.push({ id: s.building, start: o, end: o + s.p.length }); p.set(s.p, o); nn.set(s.n, o); c.set(s.c, o); u.set(s.u, ou); o += s.p.length; ou += s.u.length; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.mats[k] || this.mats.plain);
      m.userData.baseColors = c.slice(); m.userData.spans = spans; m.userData.baseMaterial = m.material;
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    this.chunks[ch] = grp; this.scene.add(grp); this.tintPending.add(ch);
  }

  syncBuildings(budget = 4) {
    const d = this.w.dirty.chunks; if (!d.size) return;
    const todo = [...d].slice(0, budget), want = new Set(todo), lists = new Map();
    for (const c of todo) lists.set(c, []);
    for (const b of this.w.buildings.values()) if (want.has(b.chunk)) lists.get(b.chunk).push(b);
    for (const c of todo) { this.rebuildChunk(c, lists.get(c)); d.delete(c); }
    if (this.bgeo.size > this.w.buildings.size + 200) for (const id of this.bgeo.keys()) if (!this.w.buildings.has(id)) this.bgeo.delete(id);
    this.w.dirty.extras = true;
  }

  // ---------------------------------------------------------------- trees
  rebuildTrees() {
    const w = this.w, C = 64, CN = N / C;
    if (!this.treeGeo) {
      this.treeGeo = mergeGeometries([coloredBox(0.36, 0.9, 0.36, 0, 0.45, 0, 0x7a5a3a), coloredBox(1.7, 1.5, 1.7, 0, 1.6, 0, 0xffffff)]);
      this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      this.treeMeshes = [];
    }
    const lists = Array.from({ length: CN * CN }, () => []);
    const add = (x, z, sc) => lists[Math.min(CN - 1, (z / C) | 0) * CN + Math.min(CN - 1, (x / C) | 0)].push([x, z, sc]);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (!w.tree[i] || w.bld[i] || w.road[i] || hash2(x, z, 21) > 0.4) continue;
      add(x + 0.2 + hash2(x, z, 2) * 0.6, z + 0.2 + hash2(x, z, 3) * 0.6, 0.75 + hash2(x, z, 4) * 0.7);
    }
    for (const t of this.roadTrees) add(...t);
    for (const m of this.treeMeshes) { this.scene.remove(m); m.dispose(); }
    this.treeMeshes = [];
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
    for (const list of lists) {
      if (!list.length) continue;
      const m = new THREE.InstancedMesh(this.treeGeo, this.treeMat, list.length);
      list.forEach(([x, z, sc], k) => {
        const ix = Math.floor(x * 7), iz = Math.floor(z * 7), h = hash2(ix, iz, 10);
        q.setFromAxisAngle(Y, hash2(ix, iz, 8) * 1.57); s.set(sc, sc * (0.85 + hash2(ix, iz, 9) * 0.4), sc); p.set(x, 0, z);
        M.compose(p, q, s); m.setMatrixAt(k, M);
        c.setRGB(0.22 + h * 0.14, 0.45 + h * 0.18, 0.16 + h * 0.06); m.setColorAt(k, c);
      });
      m.computeBoundingSphere();
      m.castShadow = true; m.receiveShadow = true;
      this.treeMeshes.push(m); this.scene.add(m);
    }
    this.treeMesh = true;
  }

  // ---------------------------------------------------------------- vehicles
  initVehicles() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const heritage = this.w.year < 1900;
    this.vehicleStyle = technology(this.w.year).style;
    const car = heritage
      ? mergeGeometries([coloredBox(1.1, 0.5, 1.7, 0, 0.55, 0, 0x83552e), coloredBox(0.55, 0.7, 1.1, 0, 0.5, 1.5, 0x704526), coloredBox(1.4, 0.25, 0.3, 0, 0.2, -0.5, 0x25221e)])
      : mergeGeometries([coloredBox(0.95, 0.45, 1.9, 0, 0.42, 0, 0xffffff), coloredBox(0.8, 0.38, 1.0, 0, 0.83, -0.1, 0x2a3440)]);
    const truck = mergeGeometries([coloredBox(1.1, 0.9, 1.0, 0, 0.7, 1.15, 0xffffff), coloredBox(1.15, 1.25, 2.4, 0, 0.87, -0.55, 0xe8e8e0)]);
    const bus = mergeGeometries([coloredBox(1.15, 1.2, 4.2, 0, 0.85, 0, 0xffffff), coloredBox(1.18, 0.35, 3.8, 0, 1.05, 0, 0x2a3440)]);
    const fire = mergeGeometries([coloredBox(1.15, 1.1, 3.4, 0, 0.8, 0, 0xffffff), coloredBox(0.9, 0.2, 2.2, 0, 1.45, -0.4, 0xd8d8d0), coloredBox(0.8, 0.2, 0.3, 0, 1.45, 1.1, 0xffffff)]);
    const garbage = mergeGeometries([coloredBox(1.1, 0.9, 0.9, 0, 0.7, 1.2, 0xffffff), coloredBox(1.2, 1.4, 2.3, 0, 0.95, -0.5, 0x6a7a5a)]);
    const police = mergeGeometries([coloredBox(0.95, 0.45, 1.9, 0, 0.42, 0, 0xffffff), coloredBox(0.8, 0.38, 1.0, 0, 0.83, -0.1, 0x2a3440), coloredBox(0.7, 0.14, 0.3, 0, 1.08, -0.1, 0xffffff)]);
    const geo = { car, truck, bus, fire, garbage, police }, cap = { car: 1100, truck: 260, bus: 80, fire: 24, garbage: 40, police: 30 };
    this.vtypes = {};
    for (const k in geo) {
      const mesh = new THREE.InstancedMesh(geo[k], mat, cap[k]);
      mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false; this.scene.add(mesh);
      this.vtypes[k] = { mesh, n: 0 };
    }
    this.agentHost ||= new AgentHost();
    this.sigClock ||= new Traffic();   // phase/axis helpers for drawing signal heads
    this.serviceT = 0; this.aEra = null;
  }

  disposeVehicles() {
    for (const k in this.vtypes) { this.scene.remove(this.vtypes[k].mesh); this.vtypes[k].mesh.geometry.dispose(); }
    Object.values(this.vtypes)[0]?.mesh.material.dispose();
  }

  // Feed the traffic worker with network, sampled routes, bus lines and spawns;
  // draw the packed poses it sends back (one step in flight at a time).
  updateVehicles(dt) {
    const net = this.w.net, sim = this.sim, H = this.agentHost;
    const speed = sim.paused ? 0 : Math.min(sim.speed, 3), step = dt * speed;
    if (this.aNetKey !== `${net.version}:${sim.flowVersion}`) { this.aNetKey = `${net.version}:${sim.flowVersion}`; H.post({ type: 'net', net: netSnapshot(net) }); }
    if (this.aEra !== this.vehicleStyle) { this.aEra = this.vehicleStyle; H.post({ type: 'era', heritage: this.w.year < 1900 }); }
    if (this.aSampleVer !== sim.sampleVersion) {
      this.aSampleVer = sim.sampleVersion;
      let tot = 0; for (const e of net.edges.values()) tot += e.flow * e.len;
      H.post({ type: 'samples', samples: sim.trafficSamples || [], target: Math.min(1000, Math.round(tot / 260)) });
    }
    if (this.aLineVer !== sim.lineInfoVersion) {
      this.aLineVer = sim.lineInfoVersion;
      const lines = [];
      for (const l of this.w.lines) {
        const info = sim.lineInfo?.get(l.id);
        if (info?.ok && info.segs.length) lines.push({ id: l.id, segs: info.segs, len: info.len, color: l.color, sig: info.segs.map((g) => `${g.edge}:${g.from.toFixed(1)}:${g.to.toFixed(1)}`).join('|') });
      }
      H.post({ type: 'lines', lines });
    }
    const spawns = (sim.dispatches?.splice(0) || []).map((d) => ({ segs: d.segs, kind: d.kind, col: 0xd8302a }));
    // garbage trucks and police patrols: routed here, simulated in the worker
    this.serviceT += step;
    if (this.serviceT > 3) {
      this.serviceT = 0;
      const blds = [...this.w.buildings.values()];
      for (const [svc, kind, want, col] of [['landfill', 'garbage', (b) => !b.svc && (b.garb || 0) > 20, 0xd8d8c8], ['police', 'police', (b) => !b.svc && b.edge >= 0, 0xf2f4f8]]) {
        const depots = blds.filter((b) => b.svc === svc && !b.abandoned && b.edge >= 0);
        if (!depots.length || (this.poseCounts?.[kind] || 0) >= Math.min(8, depots.length * 3)) continue;
        const from = depots[(Math.random() * depots.length) | 0], cands = blds.filter((b) => want(b) && b.comp === from.comp);
        if (!cands.length) continue;
        const to = cands[(Math.random() * cands.length) | 0];
        const go = fastestRoute(net, { edge: from.edge, s: from.s }, [{ id: to.id, edge: to.edge, s: to.s }]);
        const back = go && fastestRoute(net, { edge: to.edge, s: to.s }, [{ id: from.id, edge: from.edge, s: from.s }]);
        if (go && back) spawns.push({ segs: [...go.segments, ...back.segments], kind, col });
      }
    }
    if (spawns.length) H.post({ type: 'spawn', list: spawns });
    H.step(step);
    const res = H.latest; if (!res) return;
    if (res !== this.drawnPoses) {                       // rebuild instances only when a new pose set arrives
      this.drawnPoses = res; this.sigClock.clock = res.clock;
      for (const k in this.vtypes) this.vtypes[k].n = 0;
      const counts = {};
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
      const flash = Math.floor(this.time * 6) % 2, flyer = sim.tech.flying, B = res.buf;
      for (let i = 0; i < res.n; i++) {
        const o = i * POSE_STRIDE, type = TYPE_IDS[B[o + 4]], V = this.vtypes[type];
        counts[type] = (counts[type] || 0) + 1;
        if (!V || V.n >= V.mesh.instanceMatrix.count) continue;
        const hover = flyer && type === 'car' ? 2.8 + Math.sin(this.time + B[o + 7]) * 0.3 : 0;
        p.set(B[o], 0.12 + B[o + 1] + hover, B[o + 2]); q.setFromAxisAngle(Y, B[o + 3]); M.compose(p, q, sc);
        V.mesh.setMatrixAt(V.n, M);
        c.setHex(B[o + 6] ? (type === 'fire' ? (flash ? 0xff2a2a : B[o + 5]) : (flash ? 0x2a6aff : 0xff2a2a)) : B[o + 5]);
        V.mesh.setColorAt(V.n, c); V.n++;
      }
      this.poseCounts = counts;
      for (const k in this.vtypes) { const m = this.vtypes[k].mesh; m.count = this.vtypes[k].n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
    if (this.signalHeads) for (const h of this.signalHeads) {
      const e = net.edges.get(h.edge); if (!e || !h.mesh) continue;
      h.mesh.material = this.sigMats[this.sigClock.phase(h.node) === this.sigClock.axis(net, h.node, e) ? 1 : 0];
    }
  }

  // ---------------------------------------------------------------- particles
  initParticles() {
    const smokeMat = new THREE.MeshLambertMaterial({ color: 0xcfcfcf, transparent: true, opacity: 0.75, depthWrite: false });
    this.smoke = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), smokeMat, 500);
    this.smoke.count = 0; this.smoke.frustumCulled = false; this.scene.add(this.smoke);
    this.flames = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), 400);
    this.flames.count = 0; this.flames.frustumCulled = false; this.scene.add(this.flames);
    this.parts = [];
  }

  updateParticles(dt) {
    const speed = this.sim.paused ? 0 : 1, P = this.parts;
    if (speed) for (const [bid, cache] of this.bgeo) {
      if (!cache.gen.emit.length || cache.ab || !this.w.buildings.has(bid)) continue;
      for (const [x, y, z] of cache.gen.emit) if (Math.random() < dt * 2.2 && P.length < 500) P.push({ x, y, z, vx: 0.6 + Math.random() * 0.4, vy: 1.6 + Math.random(), vz: 0.3, age: 0, life: 3 + Math.random() * 2 });
    }
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const o = P[i]; o.age += dt * speed;
      if (o.age > o.life) { P.splice(i, 1); continue; }
      o.x += o.vx * dt * speed; o.y += o.vy * dt * speed; o.z += o.vz * dt * speed;
      const k = 0.7 + (o.age / o.life) * 1.8;
      p.set(o.x, o.y, o.z); s.set(k, k, k); M.compose(p, q, s); this.smoke.setMatrixAt(n++, M);
    }
    this.smoke.count = n; this.smoke.instanceMatrix.needsUpdate = true;
    let f = 0; const c = new THREE.Color();
    for (const b of this.w.buildings.values()) {
      if (!b.fire) continue;
      for (let k = 0; k < 10 && f < 400; k++) {
        const x = b.x0 + hash2(b.id, k, 1) * (b.x1 - b.x0), z = b.z0 + hash2(b.id, k, 2) * (b.z1 - b.z0);
        const h = (b.top || 3) * (0.5 + hash2(b.id, k, 3) * 0.6), fl = 0.6 + Math.random() * 1.1;
        p.set(x, h + fl * 0.5, z); s.set(fl, fl * 1.5, fl); M.compose(p, q, s); this.flames.setMatrixAt(f, M);
        c.setRGB(1, 0.35 + Math.random() * 0.5, 0.05); this.flames.setColorAt(f, c); f++;
      }
    }
    this.flames.count = f; this.flames.instanceMatrix.needsUpdate = true; if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- wind rotors
  syncExtras() {
    if (!this.w.dirty.extras) return;
    this.w.dirty.extras = false;
    const seen = new Set();
    for (const b of this.w.buildings.values()) {
      if (b.svc !== 'wind') continue;
      seen.add(b.id);
      if (this.rotors.has(b.id)) continue;
      const ex = this.bgeo.get(b.id)?.gen.extras.find((x) => x.type === 'rotor'); if (!ex) continue;
      const g = new THREE.Group(), mat = this.mats.plain;
      g.add(new THREE.Mesh(coloredBox(0.6, 0.6, 0.5, 0, 0, 0, 0xf0f0f0), mat));
      for (let k = 0; k < 3; k++) { const bl = new THREE.Mesh(coloredBox(0.35, 5.5, 0.12, 0, 2.9, 0, 0xf4f4f4), mat); bl.rotation.z = (k * Math.PI * 2) / 3; g.add(bl); }
      const outer = new THREE.Group(); outer.add(g);
      outer.position.set(ex.x, ex.y, ex.z); outer.rotation.y = Math.atan2(ex.fx, ex.fz);
      outer.userData.spin = g; outer.traverse((o) => { o.castShadow = true; });
      this.scene.add(outer); this.rotors.set(b.id, outer);
    }
    for (const [id, o] of this.rotors) if (!seen.has(id)) { this.scene.remove(o); this.rotors.delete(id); }
  }

  // ---------------------------------------------------------------- problem icons
  updateIcons() {
    const far = this.cam.dist > 520;
    let n = 0;
    if (!far) for (const b of this.w.buildings.values()) {
      const p = b.prob; if (!p || n >= 500) continue;
      const k = p & PROB.fire ? 'fire' : p & PROB.abandoned ? 'abandoned' : p & PROB.road ? 'road' : p & PROB.outside ? 'outside' :
        p & PROB.power ? 'power' : p & PROB.water ? 'water' : p & PROB.sewage ? 'sewage' : p & PROB.garbage ? 'garbage' : null;
      if (!k) continue;
      let s = this.icons[n];
      if (!s) { s = new THREE.Sprite(this.iconMats[k]); s.scale.set(3.4, 3.4, 1); this.icons.push(s); this.scene.add(s); }
      s.material = this.iconMats[k]; s.visible = true;
      s.position.set(b.cx, (b.top || 3) + 3 + Math.sin(this.time * 3 + b.id) * 0.3, b.cz);
      n++;
    }
    for (let i = n; i < this.icons.length; i++) this.icons[i].visible = false;
  }

  // ---------------------------------------------------------------- previews
  initPreview() {
    this.prevMatOk = new THREE.MeshBasicMaterial({ color: 0x6aff9a, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
    this.prevMatBad = new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
    this.prevRoad = new THREE.Mesh(new THREE.BufferGeometry(), this.prevMatOk); this.prevRoad.renderOrder = 5; this.prevRoad.frustumCulled = false;
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.prevMatOk); this.ghost.renderOrder = 5;
    const ring = []; for (let i = 0; i <= 64; i++) ring.push(Math.cos((i / 64) * Math.PI * 2), 0, Math.sin((i / 64) * Math.PI * 2));
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));
    this.brush = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    this.brush.renderOrder = 6;
    this.snapDot = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.3, 12), new THREE.MeshBasicMaterial({ color: 0xffe25a, depthTest: false, transparent: true, opacity: 0.9 }));
    this.snapDot.renderOrder = 7;
    this.hlBox = new THREE.Box3Helper(new THREE.Box3(), 0xffe25a);
    for (const o of [this.prevRoad, this.ghost, this.brush, this.snapDot, this.hlBox]) { o.visible = false; this.scene.add(o); }
  }
  clearPreview() { for (const o of [this.prevRoad, this.ghost, this.brush, this.snapDot, this.hlBox]) o.visible = false; }

  setRoadPreview(pts, hw, ok) {
    if (!pts || pts.length < 2) { this.prevRoad.visible = false; return; }
    const P = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * hw, nz = (dx / l) * hw, y = 0.4;
      const L0 = [a.x + nx, y, a.z + nz], R0 = [a.x - nx, y, a.z - nz], L1 = [b.x + nx, y, b.z + nz], R1 = [b.x - nx, y, b.z - nz];
      P.push(...R0, ...L0, ...R1, ...R1, ...L0, ...L1);
    }
    this.prevRoad.geometry.dispose();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    this.prevRoad.geometry = g; this.prevRoad.material = ok ? this.prevMatOk : this.prevMatBad; this.prevRoad.visible = true;
  }
  setSnap(p) { if (!p) { this.snapDot.visible = false; return; } this.snapDot.position.set(p.x, 0.5, p.z); this.snapDot.visible = true; }
  setBrush(x, z, r, color = 0xffffff) {
    this.brush.position.set(x, 0.5, z); this.brush.scale.set(r, 1, r); this.brush.material.color.setHex(color); this.brush.visible = true;
  }
  setGhost(plan, S, ok) {
    if (!plan || plan.cx === undefined) { this.ghost.visible = false; return; }
    this.ghost.scale.set(S.w, 3, S.d);
    this.ghost.position.set(plan.cx, (plan.y || 0)+1.5, plan.cz);
    this.ghost.rotation.set(0, Math.atan2(plan.tx, plan.tz) - Math.PI / 2, 0);
    this.ghost.material = ok ? this.prevMatOk : this.prevMatBad; this.ghost.visible = true;
  }
  setHighlight(b) {
    if (!b) { this.hlBox.visible = false; return; }
    this.hlBox.box.min.set(b.x0, b.baseY || 0, b.z0); this.hlBox.box.max.set(b.x1, (b.top || 3) + 0.3, b.z1); this.hlBox.visible = true;
  }
  setEdgeHighlight(e, ok = false) {
    if (!e) { this.prevRoad.visible = false; return; }
    const pts = []; for (let i = 0; i <= e.n; i++) pts.push({ x: e.pts[2 * i], z: e.pts[2 * i + 1] });
    this.setRoadPreview(pts, e.hw + 0.6, ok);
  }

  // Recolour the existing buffers, never the cached procedural source geometry.
  updateBuildingTints() {
    const key = `${this.overlay}:${this.buildingTints}:${this.sim.fieldVersion}:${this.sim.day}:${this.w.bldVersion}:${this.w.districtVersion}:${this.sim.weather.type}`;
    if (key !== this.tintKey) { this.tintKey = key; for (let i = 0; i < this.chunks.length; i++) if (this.chunks[i]) this.tintPending.add(i); }
    const active = this.buildingTints && this.overlay !== 'none';
    this.tintMaterial ||= new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const ch of [...this.tintPending].slice(0, 4)) {
      this.tintPending.delete(ch); const group = this.chunks[ch]; if (!group) continue;
      for (const mesh of group.children) {
        const attr = mesh.geometry.attributes.color, normals = mesh.geometry.attributes.normal.array;
        attr.array.set(mesh.userData.baseColors); mesh.material = active ? this.tintMaterial : mesh.userData.baseMaterial;
        for (const span of mesh.userData.spans) {
          const b = this.w.buildings.get(span.id); if (!b) continue;
          let color = null;
          if (active) {
            if (this.overlay === 'districts') color = lin(DISTRICT_COLORS[b.district] || [150,150,150]);
            else {
              const value = this.overlayValue(b.cx,b.cz,b);
              const t = value == null ? null : clamp(this.OVGOOD[this.overlay] ? value : 1-value,0,1);
              color = lin(t == null ? [145,145,145] : t < 0.5 ? mix([214,64,52],[236,204,66],t*2) : mix([236,204,66],[66,184,92],(t-0.5)*2));
            }
          }
          for (let i = span.start; i < span.end; i += 3) {
            if (color) attr.array.set(color,i);
            else if (this.sim.weather.type === 'snow' && normals[i+1] > 0.6) {
              for (let c=0;c<3;c++) attr.array[i+c] = attr.array[i+c]*0.2 + 0.72;
            }
          }
        }
        attr.needsUpdate = true;
      }
    }
  }

  updateRoute() {
    const result = this.sim.routes;
    const valid = result && result.origin === this.sim.routeOrigin && result.netVersion === this.w.net.version && result.bldVersion === this.w.bldVersion;
    const route = valid && this.routeKind !== 'none' ? result[this.routeKind] : null;
    if (this.drawnRoute === route) return; this.drawnRoute = route;
    if (this.routeGroup) { this.routeGroup.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); this.scene.remove(this.routeGroup); }
    this.routeGroup = null;
    if (!route) return;
    const origin = this.w.buildings.get(result.origin); if (!origin) return;
    const color = this.routeKind === 'job' ? 0x39d9ff : 0xffc34b, points = [new THREE.Vector3(origin.cx,1.4,origin.cz)], arrows=[];
    for (const seg of route.segments) {
      const e = this.w.net.edges.get(seg.edge); if (!e) return;
      const steps = Math.max(1,Math.ceil(Math.abs(seg.to-seg.from)/2));
      for (let i=0;i<=steps;i++) {
        const p=this.w.net.sampleAt(e,seg.from+(seg.to-seg.from)*i/steps); points.push(new THREE.Vector3(p.x,1.4,p.z));
        if (i>0 && i%6===0) {
          const dir=seg.to>seg.from?1:-1, tx=p.tx*dir, tz=p.tz*dir;
          arrows.push(p.x+tx*1.6,1.5,p.z+tz*1.6,p.x-tx+tz,1.5,p.z-tz-tx,p.x-tx-tz,1.5,p.z-tz+tx);
        }
      }
    }
    const dest = this.routeKind==='job' ? this.w.buildings.get(route.destination) : this.w.net.nodes.get(route.destination);
    if (dest) points.push(new THREE.Vector3(dest.cx ?? dest.x,1.4,dest.cz ?? dest.z));
    const group = new THREE.Group();
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,depthTest:false,transparent:true})); line.renderOrder=30; group.add(line);
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(arrows,3));
    const arrowMesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,depthTest:false,transparent:true})); arrowMesh.renderOrder=31; group.add(arrowMesh);
    for (const p of [points[0],points.at(-1)]) { const marker=new THREE.Mesh(new THREE.BoxGeometry(1.8,2,1.8),new THREE.MeshBasicMaterial({color,depthTest:false,transparent:true}));marker.position.copy(p); marker.renderOrder=32; group.add(marker); }
    this.routeGroup=group;this.scene.add(group);
  }

  setDayMode(m) { this.dayMode = m; try { localStorage.setItem('organicity-daynight', m); } catch { /* ignore */ } }

  // Day/night: a visual clock (3 min per day at 1×) dims the sun, rotates it,
  // and lights windows, streetlights and neon as the city goes dark.
  updateDayNight(dt) {
    if (!this.sim.paused) this.tod = (this.tod + dt * Math.min(this.sim.speed, 4) / 180) % 1;
    const t = this.dayMode === 'day' ? 0.3 : this.dayMode === 'night' ? 0.8 : this.tod;
    const elev = Math.sin(t * Math.PI * 2), target = clamp((0.2 - elev) / 0.4, 0, 1);
    this.night += (target - this.night) * Math.min(1, dt * 3);
    const n = this.night, c = this.cam;
    this.sun.intensity *= 1 - 0.9 * n; this.hemi.intensity = 1.35 * (1 - 0.7 * n);
    const az = t * Math.PI * 2; this.sun.position.set(c.x + Math.cos(az) * 220, 60 + Math.max(0, elev) * 220, c.z + Math.sin(az) * 120 + 60);
    const nightSky = new THREE.Color(0x0b1026);
    this.scene.background.lerp(nightSky, n * 0.85); this.scene.fog.color.copy(this.scene.background);
    for (const k of ['res', 'off', 'com', 'shop']) this.mats[k].emissiveIntensity = n * 1.1;
    if (this.lampMat) this.lampMat.emissiveIntensity = n * 2.5;
    this.hemi.color.setRGB(0.91 - 0.5 * n, 0.95 - 0.45 * n, 1);
  }

  updateWeather(dt) {
    if (this.weatherType !== this.sim.weather.type) { this.weatherType=this.sim.weather.type; this.w.markGround(0,0,N,N); }
    const w=this.sim.weather, snow=w.type==='snow', wet=snow || w.type==='rain' || w.type==='storm';
    this.scene.background.setHex(w.sky);this.scene.fog.color.setHex(w.sky);this.sun.intensity=w.light;
    if(this.sim.tech.style==='cyberpunk'){this.scene.background.lerp(new THREE.Color(0x252340),0.65);this.scene.fog.color.copy(this.scene.background);this.sun.intensity*=0.65;}
    if (w.type==='fog') { this.scene.fog.near=this.cam.dist*0.35;this.scene.fog.far=this.cam.dist*2+100; }
    this.ground.material.color.setHex(snow ? 0xe1e9ef : wet ? 0xa4b5bd : 0xffffff);
    if (!this.precipitation) {
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(600*6),3));
      this.precipitation=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xc8e3ff,transparent:true,opacity:0.65,depthWrite:false}));
      this.precipitation.frustumCulled=false;this.scene.add(this.precipitation);this.weatherClock=0;
    }
    this.precipitation.visible=wet;if(!wet)return;
    if(!this.sim.paused)this.weatherClock+=dt;
    const a=this.precipitation.geometry.attributes.position;
    this.precipitation.material.color.setHex(snow?0xffffff:0xb8dfff);
    for(let i=0;i<600;i++) {
      const fall=snow?5:35, y=65-((hash2(i,1,71)*65+this.weatherClock*fall)%65);
      const x=this.cam.x+(hash2(i,2,71)-0.5)*180 + Math.sin(w.direction)*y*0.2;
      const z=this.cam.z+(hash2(i,3,71)-0.5)*180 + Math.cos(w.direction)*y*0.2;
      a.setXYZ(i*2,x,y,z);a.setXYZ(i*2+1,x+(snow?0.3:0.6),y+(snow?0.3:3),z);
    }
    a.needsUpdate=true;
  }

  updateFuture(dt) {
    const key=`${this.sim.skyVersion}:${this.w.platformVersion}`;
    if(key!==this.futureKey){
      this.futureKey=key;
      if(this.futureGroup){this.futureGroup.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.scene.remove(this.futureGroup);}
      const group=new THREE.Group();this.futureGroup=group;this.scene.add(group);
      const block=(x,y,z,w,h,d,color,neon=false)=>{
        const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),neon?new THREE.MeshBasicMaterial({color}):new THREE.MeshLambertMaterial({color}));
        m.position.set(x,y,z);m.castShadow=!neon;group.add(m);return m;
      };
      for(const p of this.w.platforms.values()){
        const x=(p.x0+p.x1)/2,z=(p.z0+p.z1)/2,w=p.x1-p.x0,d=p.z1-p.z0;
        block(x,p.y-0.6,z,w,1.2,d,0x66798a);
        for(const sign of [-1,1]){
          block(x,p.y+0.6,z+sign*(d/2-0.2),w,0.25,0.25,0x3ce3eb,true);
          block(x+sign*(w/2-0.2),p.y+0.6,z,0.25,0.25,d,0x3ce3eb,true);
        }
        const host=this.w.buildings.get(p.host);
        if(host)for(const sign of [-1,1])block(host.cx+sign*2,p.y-4,host.cz,0.8,7,0.8,0x536878);
      }
      // Flying vehicles need no roads: corridors are only hinted by faint floating
      // light markers, and each hub tower gets a small landing beacon.
      const faint = new THREE.MeshBasicMaterial({ color: 0x38e6ff, transparent: true, opacity: 0.22, depthWrite: false });
      for (const link of this.sim.sky.links) {
        const len = Math.hypot(link.x1 - link.x0, link.z1 - link.z0);
        for (let d = 12; d < len - 6; d += 24) {
          const t = d / len, m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), faint);
          m.position.set(link.x0 + (link.x1 - link.x0) * t, link.y + Math.sin(t * Math.PI) * 6, link.z0 + (link.z1 - link.z0) * t); group.add(m);
        }
      }
      this.skyHubs = []; this.hubPads = []; this.padAirVer = -1;
      for (const id of this.sim.sky.hubs) {
        const b = this.w.buildings.get(id); if (!b) continue;
        const top = b.top || buildingFloors(b, this.w) * 1.6;
        this.skyHubs.push({ id, x: b.cx, z: b.cz, y: top + 3 });
        this.hubPads.push({ b, m: block(b.cx, top + 0.45, b.cz, 3, 0.15, 3, 0xf542dc, true) });
      }
    }
    if (this.hubPads && this.padAirVer !== this.sim.airVersion) {   // busy pads glow amber, full ones red
      this.padAirVer = this.sim.airVersion;
      for (const { b, m } of this.hubPads) { const u = (this.sim.air?.load.get(b.id) || 0) / Math.max(1, this.sim.hubCap(b)); m.material.color.setHex(u > 0.9 ? 0xff3a3a : u > 0.5 ? 0xffb03a : 0xf542dc); }
    }
    if(!this.airCars){
      const geo=mergeGeometries([coloredBox(1.3,0.5,2.5,0,0,0,0xc1dded),coloredBox(0.9,0.3,1.2,0,0.4,0,0x243750),coloredBox(1.4,0.15,0.3,0,-0.2,-1,0x39f2ff)]);
      this.airCars=new THREE.InstancedMesh(geo,new THREE.MeshBasicMaterial({vertexColors:true}),128);this.airCars.frustumCulled=false;this.scene.add(this.airCars);this.airTime=0;
    }
    if(!this.sim.paused)this.airTime+=dt*Math.sqrt(this.sim.speed);
    // air cars fly free arcs between hub pairs, in proportion to the modelled air trips,
    // each at its own altitude and bearing
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0); let count = 0;
    const H = this.skyHubs || [], byId = new Map(H.map((h) => [h.id, h])), prev = new THREE.Vector3();
    const pairs = (this.sim.air?.od || []).filter(([a, b]) => byId.has(a) && byId.has(b)), trips = pairs.reduce((s, p) => s + p[2], 0);
    const cars = trips > 0 ? Math.min(128, Math.round(8 + trips * 0.6)) : 0;
    for (let i = 0, cum = 0, pi = 0; i < cars; i++) {
      const want = ((i + 0.5) / cars) * trips;
      while (pi < pairs.length - 1 && cum + pairs[pi][2] < want) cum += pairs[pi++][2];
      const flip = hash2(i, 1, 51) < 0.5, a = byId.get(pairs[pi][flip ? 1 : 0]), b = byId.get(pairs[pi][flip ? 0 : 1]);
      const alt = 8 + hash2(i, 3, 51) * 30, side = (hash2(i, 4, 51) - 0.5) * 60, spd = 0.6 + hash2(i, 5, 51) * 0.8;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      const cx = (a.x + b.x) / 2 + nx * side, cz = (a.z + b.z) / 2 + nz * side, cy = Math.max(a.y, b.y) + alt;
      const at = (t) => { const u = 1 - t; return [u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y, u * u * a.z + 2 * u * t * cz + t * t * b.z]; };
      const raw = (this.airTime * 10 * spd / len + hash2(i, 6, 51)) % 2, t = raw > 1 ? 2 - raw : raw; // there and back
      const p = at(t), pn = at(Math.min(1, t + 0.01) === t ? t - 0.01 : t + (raw > 1 ? -0.01 : 0.01));
      pos.set(p[0], p[1], p[2]); prev.set(pn[0], pn[1], pn[2]);
      q.setFromAxisAngle(Y, Math.atan2(prev.x - pos.x, prev.z - pos.z)); M.compose(pos, q, scale); this.airCars.setMatrixAt(count++, M);
    }
    this.airCars.count=count;this.airCars.instanceMatrix.needsUpdate=true;
  }

  // Skybridges: neighbouring towers in the modern and cyberpunk eras get joined
  // by glass links at a shared height (rebuilt at most every few seconds).
  updateBridges(dt) {
    this.bridgeT = (this.bridgeT || 0) + dt;
    const style = this.sim.tech.style, key = `${this.w.bldVersion}:${style}`;
    if (key === this.bridgeKey || this.bridgeT < 3) return;
    this.bridgeKey = key; this.bridgeT = 0;
    if (this.bridgeGroup) { this.bridgeGroup.traverse((o) => o.geometry?.dispose()); this.scene.remove(this.bridgeGroup); this.bridgeGroup = null; }
    if (style !== 'modern' && style !== 'cyberpunk') return;
    const g = new THREE.Group(), glass = this.bridgeGlass ||= new THREE.MeshLambertMaterial({ color: 0x9ec4dc }), neon = this.bridgeNeon ||= new THREE.MeshBasicMaterial({ color: 0xf542dc });
    for (const l of this.sim.bridges()) {                  // same links the simulation uses
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, l.len), glass);
      m.position.set((l.x0 + l.x1) / 2, l.y, (l.z0 + l.z1) / 2); m.rotation.y = Math.atan2(l.x1 - l.x0, l.z1 - l.z0); m.castShadow = true; g.add(m);
      if (style === 'cyberpunk') { const n = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, l.len), neon); n.position.copy(m.position); n.position.y -= 0.95; n.rotation.y = m.rotation.y; g.add(n); }
    }
    this.bridgeGroup = g; this.scene.add(g);
  }

  // bus line routes, drawn above the roads while planning transit
  updateLines() {
    const show = this.overlay === 'transit' || this.uiTransit;
    const key = show ? `${this.sim.lineInfoVersion}:${this.w.lineVersion}:${this.w.net.version}` : 'off';
    if (key === this.linesKey) return;
    this.linesKey = key;
    if (this.lineGroup) { this.lineGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); this.scene.remove(this.lineGroup); this.lineGroup = null; }
    if (!show) return;
    const net = this.w.net, g = new THREE.Group();
    this.w.lines.forEach((l, i) => {
      const info = this.sim.lineInfo?.get(l.id); if (!info?.ok) return;
      const pts = [];
      for (const seg of info.segs) {
        const e = net.edges.get(seg.edge); if (!e) continue;
        const n = Math.max(2, Math.ceil(Math.abs(seg.to - seg.from) / 3));
        for (let k = 0; k <= n; k++) { const s = seg.from + (seg.to - seg.from) * (k / n), p = net.sampleAt(e, s); pts.push(new THREE.Vector3(p.x, 1.6 + deckHeight(e, s) + i * 0.3, p.z)); }
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: l.color, depthTest: false, transparent: true })));
      for (const id of l.stops) { const b = this.w.buildings.get(id); if (!b) continue; const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.4, 10), new THREE.MeshBasicMaterial({ color: l.color, depthTest: false, transparent: true })); m.position.set(b.cx, 3, b.cz); g.add(m); }
    });
    g.renderOrder = 8; this.lineGroup = g; this.scene.add(g);
  }

  // ---------------------------------------------------------------- frame
  setOverlay(o) { if (this.overlay === o) return; this.overlay = o; this.w.markGround(0, 0, N, N); this.colorTraffic(); }
  setDistricts(on) { if (this.showDistricts === on) return; this.showDistricts = on; this.w.markGround(0, 0, N, N); }

  frame(dt) {
    this.time += dt;
    const w = this.w;
    if (this.terrainVer !== w.terrainVersion) this.refreshTerrain();
    if (this.roadVer !== w.net.version || this.roadEra !== this.sim.tech.style) this.buildRoads();
    if (this.flowVer !== this.sim.flowVersion && (this.overlay === 'traffic' || this.flowVer === -1)) this.colorTraffic();
    this.syncBuildings();
    this.updateBuildingTints(); this.updateRoute();
    if (w.dirty.trees) { this.treeT = (this.treeT || 0) + dt; if (this.treeT > 0.3 || !this.treeMesh) { this.rebuildTrees(); w.dirty.trees = false; this.treeT = 0; } }
    const ov = this.overlay !== 'none' && this.overlay !== 'districts' && this.overlay !== 'traffic';
    if (ov) { const v = (this.sim.fieldVersion || 0) + ':' + this.sim.flowVersion; if (v !== this.overlayVer) { this.overlayVer = v; w.markGround(0, 0, N, N); } }
    if (w.dirty.ground) { const g = w.dirty.ground; w.dirty.ground = null; this.paintGround(g[0], g[1], g[2], g[3]); }
    this.syncExtras();
    for (const o of this.rotors.values()) o.userData.spin.rotation.z -= dt * (this.sim.paused ? 0 : 2.2 * this.sim.wind);
    this.waterTex.offset.x = (this.time * 0.004) % 1; this.waterTex.offset.y = (this.time * 0.002) % 1;
    if (this.vehicleStyle !== this.sim.tech.style) { this.disposeVehicles(); this.initVehicles(); }
    this.updateVehicles(dt); this.updateFuture(dt); this.updateLines(); this.updateBridges(dt);
    this.updateParticles(dt);
    this.iconT += dt; if (this.iconT > 0.25) { this.iconT = 0; this.updateIcons(); }
    this.updateCamera(); this.updateWeather(dt); this.updateDayNight(dt);
    this.r.render(this.scene, this.camera);
  }
}
Renderer.prototype.OVGOOD = { transit: true, desireR: true, desireC: true, desireI: true, desireO: true, level: true, happiness: true, age: true, landvalue: true, access: true, power: true, water: true, garbage: true, fire: true, police: true, clinic: true, school: true, park: true };
