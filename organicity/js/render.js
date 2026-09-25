import { lineSegments, bridgeOpen } from './infrastructure.js';
import { residentLeg, routePosition } from './citizens.js';
// Organicity — rendering. Low-resolution WebGL with nearest-neighbour upscale
// for a pixel-art diorama look. The world's dirty flags drive incremental
// updates: ground texture regions, road mesh, per-chunk merged building meshes,
// instanced trees/vehicles/particles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { N, ZONES, SERVICES, ROADS, DISTRICT_COLORS, ULINES } from './config.js';
import { CH, CHN } from './world.js';
import { genBuilding, genBoxes, rgb, hex } from './procgen.js';
import { hash2, clamp, fbm } from './util.js';
import { technology, buildingFloors } from './eras.js';
import { frontAt, WEATHER } from './weather.js';
import { unb64 } from './tileview.js';
import { deposits, DEPOSITS, DEP_BY_ID } from './resources.js';
import { coverageMask, undergroundY } from './grid.js';
import { flowField, flowAt, flowTexture, waterRoute, routeLen, routeAt, ferryPairs } from './water.js';
import { Traffic, AgentSim, TYPE_IDS, POSE_STRIDE, deckHeight, AGENT_TYPES } from './agents.js';
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

const FREIGHT_COL = { timber: 0x8a5a32, lumber: 0xc8a070, coal: 0x2a2a2c, stone: 0xb8b2a0, iron: 0x9a4a32, ore: 0xc89a3a, cement: 0xd8d4cc, steel: 0x7a8a98, metals: 0xc87a3a, paper: 0xf2f0e8, furniture: 0xa8784a, machinery: 0x3a6ab8 };

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
    if (this.fx) { this.fx.composer.setPixelRatio(1 / this.pixel); this.fx.composer.setSize(innerWidth, innerHeight); this.fx.bloom?.resolution.set(innerWidth / this.pixel, innerHeight / this.pixel); }
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
    if (!height && this.ground) { const rc=new THREE.Raycaster();rc.ray.copy(ray);const hit=rc.intersectObject(this.ground)[0];if(hit)return {x:hit.point.x,z:hit.point.z}; }
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
    const S = 256, st = N / S;   // a vertex every 2 cells, fine enough to show levelled road bands
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

  // Ground vertices in a region follow graded terrain (roads and lots reshape it).
  refreshGround(x0, z0, x1, z1) {
    const w = this.w, S = this.groundS, st = N / S, pos = this.ground.geometry.attributes.position;
    const i0 = clamp(Math.floor(x0 / st) - 1, 0, S), i1 = clamp(Math.ceil(x1 / st) + 1, 0, S), j0 = clamp(Math.floor(z0 / st) - 1, 0, S), j1 = clamp(Math.ceil(z1 / st) + 1, 0, S);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const wd = w.wdist[clamp(Math.floor(j * st), 0, N - 1) * N + clamp(Math.floor(i * st), 0, N - 1)];
      pos.setY(j * (S + 1) + i, w.heightAt(i * st, j * st) + (wd < 0 ? Math.max(-3.2, wd * 0.5) - 0.4 : wd < 1.5 ? (-0.4 * (1.5 - wd)) / 1.5 : 0));
    }
    pos.needsUpdate = true; this.ground.geometry.computeVertexNormals();
  }

  // shoreline heights + natural ground colours; rerun after sandbox terrain edits
  refreshTerrain() {
    const w = this.w, S = this.groundS, st = N / S, pos = this.ground.geometry.attributes.position;
    w.dirty.grade = null;
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const wd = w.wdist[clamp(Math.floor(j * st), 0, N - 1) * N + clamp(Math.floor(i * st), 0, N - 1)];
      pos.setY(j * (S + 1) + i, w.heightAt(i*st,j*st) + (wd < 0 ? Math.max(-3.2, wd * 0.5) - 0.4 : wd < 1.5 ? (-0.4 * (1.5 - wd)) / 1.5 : 0));
    }
    pos.needsUpdate = true; this.ground.geometry.computeVertexNormals();this.ground.geometry.computeBoundingSphere();
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x, wd = w.wdist[i], h = hash2(x, z, 5), f = fbm(x * 0.03, z * 0.03, 77, 3);
      let c;
      if (wd < 0) c = mix([96, 150, 170], [44, 92, 132], clamp(-wd / 8, 0, 1));
      else if (wd < 2.2) c = h < 0.5 ? [214, 202, 150] : [204, 192, 142];
      else { c = mix([96, 146, 62], [128, 170, 80], f); if (h < 0.18) c = mix(c, [150, 186, 94], 0.5); else if (h > 0.9) c = mix(c, [80, 128, 56], 0.6); }
      if (wd >= 2.2) {   // bare rock on steep slopes and scattered over the heights
        const e = w.elevation, sl = Math.hypot((e[x < N - 1 ? i + 1 : i] - e[x ? i - 1 : i]), (e[z < N - 1 ? i + N : i] - e[z ? i - N : i])) / 2;
        const rock = h < 0.5 ? [126, 120, 110] : [104, 99, 92], k = clamp((sl - 0.5) * 1.8, 0, 0.92) + (e[i] > 18 ? clamp((e[i] - 18) / 12, 0, 0.5) * (f > 0.5 ? 1 : 0.3) : 0);
        if (k > 0) c = mix(c, rock, clamp(k, 0, 0.92));
      }
      this.base[i * 3] = c[0]; this.base[i * 3 + 1] = c[1]; this.base[i * 3 + 2] = c[2];
    }
    this.terrainVer = w.terrainVersion;
    this.refreshFlow();
  }

  refreshFlow() { if (!this.flowTex) return; this.flow = flowField(this.w); this.flowTex.image.data.set(flowTexture(this.flow)); this.flowTex.needsUpdate = true; this.boatKey = null; }
  // the ground as the season shows it: tinted grass, and snow above a snow line that drops in winter
  season() { return this.sim.weather.season; }
  seasonTint(c, s = this.season()) { return s === 'Autumn' ? mix(c, [156, 138, 70], 0.3) : s === 'Winter' ? mix(c, [146, 152, 140], 0.36) : s === 'Spring' ? mix(c, [118, 184, 82], 0.14) : c; }
  snowLine(s = this.season()) { return { Winter: 11, Spring: 22, Autumn: 25, Summer: 33 }[s] ?? 30; }
  landColor(c, h, x, z, s = this.season()) {
    c = this.seasonTint(c, s);
    const sl = this.snowLine(s) + (fbm(x * 0.05, z * 0.05, 91, 2) - 0.5) * 6;
    return h > sl ? mix(c, [236, 241, 245], clamp((h - sl) / 3, 0, 0.92)) : c;
  }
  natural(x, z) { return this.landColor(this.baseAt(x, z), this.w.elevation[z * N + x], x, z); }
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
      case 'elevation': return this.w.heightAt(x,z)/25;
      case 'flooding': return (this.w.flood[this.w.cellAt(x,z)]||0)/2;
      case 'snow': {const hit=this.w.net.nearestEdge(x,z,12);return hit?hit.e.snow||0:this.w.hazards.snow;}
      case 'transit': return s.at(s.cov.busstop, x, z);
      case 'desireR': case 'desireC': case 'desireI': case 'desireO': return b ? null : s.desirability(o.slice(-1), x, z);
      case 'power': return b ? (b.power ? 1 : 0) : null;
      case 'resources': return b && SERVICES[b.svc]?.chain ? b.indEff || 0 : null;
      case 'pipes': return b ? ((b.power ? 1 : 0) + (b.water ? 1 : 0) + (b.sewage ? 1 : 0)) / 3 : null;
      case 'water': return b ? (b.water && b.sewage ? 1 : b.water || b.sewage ? 0.5 : 0) : null;
      case 'health': return b ? (b.svc || !b.hh ? null : b.sick ? 0 : clamp(b.health ?? 0, 0, 1)) : s.at(s.cov.clinic, x, z);
      case 'seniors': return b ? (b.svc || !b.hh ? null : clamp((b.seniors || 0) / Math.max(1, (b.occ || 0) * 2.6) / 0.45, 0, 1)) : null;
      case 'higher': return Math.max(0.6 * s.at(s.cov.college, x, z), s.at(s.cov.university, x, z));
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
        c = mix(this.natural(x, z), ZONES[w.zone[i]].color, ((x + z) & 3) === 0 ? 0.62 : 0.4);
        if (w.accEdge[i] < 0) c = mix(c, [60, 60, 60], 0.35);
      } else c = this.natural(x, z);
      if (ov && !w.water[i]) {
        const v = this.overlayValue(x + 0.5, z + 0.5, b), l = (c[0] + c[1] + c[2]) / 3;
        if (v === null) c = [l * 0.7 + 30, l * 0.7 + 30, l * 0.7 + 30];
        else {
          c = mix([l, l, l], this.ramp(clamp(good ? v : 1 - v, 0, 1)), 0.78);
        }
      }
      if (this.overlay === 'pipes' && !w.water[i]) {   // underground: what the pipes and drains reach
        const cw = (this._covW ||= coverageMask(w, 'water'))[i], cs = (this._covS ||= coverageMask(w, 'sewer'))[i];
        if (cw) c = mix(c, [60, 140, 235], 0.55);
        if (cs && ((x + z) % 6 < 2 || !cw)) c = mix(c, [150, 110, 60], cw ? 0.6 : 0.5);
      }
      if (this.overlay === 'resources' && !w.water[i]) {   // deposits over a greyed map
        const dk = (this._depK ||= deposits(w)).kind[i];
        if (dk) { const r = this._depK.rich[i] / 255; c = mix(c, DEPOSITS[DEP_BY_ID[dk]].color, 0.45 + 0.45 * r); }
      }
      if (showD) {
        const d = w.district[i];
        if (d) {
          const edge = (x > 0 && w.district[i - 1] !== d) || (x < N - 1 && w.district[i + 1] !== d) || (z > 0 && w.district[i - N] !== d) || (z < N - 1 && w.district[i + N] !== d);
          c = mix(c, DISTRICT_COLORS[d], edge ? 0.9 : 0.28);
        }
      }
      if (w.hazards.snow>.01 && this.overlay === 'none' && !w.water[i]) {const edge=w.net.edges.get(w.accEdge[i]);c=mix(c,[230,239,245],w.road[i]?Math.min(.55,(edge?.snow||0)*.5):Math.min(.85,w.hazards.snow));}
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
    // the surface is drawn with a flow map: ripples travel the way the water runs (see water.js)
    this.flowTex = new THREE.DataTexture(new Uint8Array(128 * 128 * 4), 128, 128, THREE.RGBAFormat); this.flowTex.magFilter = this.flowTex.minFilter = THREE.LinearFilter;
    this.waterU = { uFlow: { value: this.flowTex }, uTime: { value: 0 }, uTile: { value: N } };
    const wm = new THREE.MeshLambertMaterial({ color: 0x4f94c8, map: t, transparent: true, opacity: 0.86 });
    wm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.waterU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform sampler2D uFlow; uniform float uTime; uniform float uTile;')
        .replace('#include <map_fragment>', `
          vec2 fuv = vWPos.xz / uTile; vec4 fs = (fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) ? texture2D(uFlow, fuv) : vec4(0.5, 0.5, 0.05, 0.0);
          vec2 fl = (fs.rg * 2.0 - 1.0) * (0.12 + fs.b * 1.6);
          float p0 = fract(uTime * 0.18), p1 = fract(uTime * 0.18 + 0.5);
          vec2 base = vWPos.xz / 19.0 + vec2(uTime * 0.004, uTime * 0.002);
          vec4 w0 = texture2D(map, base - fl * p0), w1 = texture2D(map, base - fl * p1 + 0.5);
          vec4 sampledDiffuseColor = mix(w0, w1, abs(p0 - 0.5) * 2.0);
          float foam = smoothstep(0.55, 1.0, fs.b) * smoothstep(0.93, 1.0, texture2D(map, base * 2.3 - fl * p0 * 1.7).r);   // streaks on fast water
          diffuseColor *= sampledDiffuseColor; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0), foam * 0.55 + fs.b * 0.06);`);
    };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(N * 3, N * 3), wm);
    this.refreshFlow();
    m.rotation.x = -Math.PI / 2; m.position.set(N / 2, -0.32, N / 2);
    m.receiveShadow = true;
    this.scene.add(m);
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(N * 3, N * 3), new THREE.MeshLambertMaterial({ color: 0x7aa85a }));
    skirt.rotation.x = -Math.PI / 2; skirt.position.set(N / 2, -4, N / 2);
    this.scene.add(skirt);
  }

  // ---------------------------------------------------------------- roads
  buildRoads() {
    const net = this.w.net, P = [], Nn = [], C = [], cables = [];
    this.signalHeads = []; this.lamps = [];
    this.roadEra = technology(this.w.year).style;
    this.edgeRange = new Map(); this.roadTrees = [];
    const up = [0, 1, 0];
    const tri = (a, b, c, col, n = up) => { P.push(...a, ...b, ...c); Nn.push(...n, ...n, ...n); C.push(...col, ...col, ...col); };
    const kAt = (e, s) => { let k = 0; while (k < e.n - 1 && e.cum[k + 1] < s) k++; return k; };
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
        const f = frame(e, s), yy = y + deckHeight(e, s) + (bridgeOpen(e,this.hour()) && e.struct?.[kAt(e,s)] === 2 ? 10 : 0);
        const L = [f.x + f.nx * o1, yy, f.z + f.nz * o1], R = [f.x + f.nx * o0, yy, f.z + f.nz * o0];
        if (prev) {
          tri(prev.R, prev.L, R, col); tri(R, prev.L, L, col);
          if (skirt) {
            const deck = e.layer > 0 || (e.struct && e.struct[kAt(e, s)] > 0);   // decks are a slab; graded roads sit on an embankment
            const nl = [f.nx, 0, f.nz], nr = [-f.nx, 0, -f.nz], yb = deck ? yy - 1.1 : -0.9;
            const pb = deck ? prev.L[1] - 1.1 : yb;
            tri(prev.L, [prev.L[0], pb, prev.L[2]], L, col, nl); tri(L, [prev.L[0], pb, prev.L[2]], [L[0], yb, L[2]], col, nl);
            tri([prev.R[0], pb, prev.R[2]], prev.R, R, col, nr); tri(R, prev.R, [R[0], yb, R[2]], col, nr);
            if ((e.layer > 0 || (e.struct && e.struct[kAt(e, s)] === 2)) && deckHeight(e, s) > 1) { // parapets on elevated decks and bridges
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
      y+=this.w.heightAt(x,z) + (this._lift || 0);
      const seg = 16;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], col);
      }
    };
    const fan = (x, z, pts, y, col) => { y+=this.w.heightAt(x,z) + (this._lift || 0); // convex junction polygon around a node
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
      if (e.layer > 0) for (let s = e.noRampA ? 6 : RAMP_LEN; s < e.len - (e.noRampB ? 6 : RAMP_LEN * 0.6); s += 12) { // pillars under the deck, down to the ground
        const f = frame(e, s), top = deckHeight(e, s) - 1.1, col = lin([158, 154, 146]), g0 = this.w.heightAt(f.x, f.z);
        if (top - g0 > 1) column(f.x, f.z, e.layer > 1 ? 0.9 : 0.7, g0 - 1, top, col);
      }
      if (e.struct?.includes(2)) { // bridges: piers into the water, railings, and towers with cables over long spans
        const pier = lin([160, 156, 148]), rail = lin([210, 206, 196]);
        let run0 = -1;
        for (let k = 0; k <= e.n; k++) {
          const on = e.struct[k] === 2;
          if (on && run0 < 0) run0 = k;
          if ((!on || k === e.n) && run0 >= 0) {
            const a = e.cum[run0], b = e.cum[on ? k : k - 1];
            for (let s = a + 4; s < b - 2; s += 14) { const f = frame(e, s), top = deckHeight(e, s) - 1.1; for (const sg of [-1, 1]) column(f.x + f.nx * hw * 0.6 * sg, f.z + f.nz * hw * 0.6 * sg, 0.65, -3, top, pier); }
            for (let s = a; s < b; s += 2.5) { const f = frame(e, s), y0 = deckHeight(e, s); for (const sg of [-1, 1]) column(f.x + f.nx * (hw + 1.05) * sg, f.z + f.nz * (hw + 1.05) * sg, 0.07, y0, y0 + 1.0, rail); }
            for (const sg of [-1, 1]) ribbonR(e, a, b, sg > 0 ? hw + 0.95 : -hw - 1.15, sg > 0 ? hw + 1.15 : -hw - 0.95, 1.0, rail);
            if (e.bridgeStyle === 'suspension' || ((!e.bridgeStyle || e.bridgeStyle === 'auto') && b - a > 70)) { // a suspension span: two towers, main cables sagging between them and down to the banks
              const t1 = a + (b - a) * 0.28, t2 = a + (b - a) * 0.72, H = 16, tc = lin([198, 90, 70]);
              for (const s of [t1, t2]) { const f = frame(e, s), y0 = deckHeight(e, s); for (const sg of [-1, 1]) column(f.x + f.nx * (hw + 1.6) * sg, f.z + f.nz * (hw + 1.6) * sg, 0.7, -3, y0 + H, tc); ribbonR(e, s - 0.7, s + 0.7, -hw - 2.3, hw + 2.3, H - 1, tc); }
              for (const sg of [-1, 1]) {
                const pts = [], at = (s, y) => { const f = frame(e, s); pts.push([f.x + f.nx * (hw + 1.6) * sg, y, f.z + f.nz * (hw + 1.6) * sg, deckHeight(e, s) + 1]); };
                for (let i = 0; i <= 24; i++) { const s = a + (t1 - a) * i / 24; at(s, deckHeight(e, a) + 1 + (deckHeight(e, t1) + H - deckHeight(e, a) - 1) * i / 24); }
                for (let i = 1; i <= 24; i++) { const u = i / 24, s = t1 + (t2 - t1) * u, sag = 4 * u * (1 - u) * (H - 2); at(s, deckHeight(e, s) + H - sag); }
                for (let i = 1; i <= 24; i++) { const s = t2 + (b - t2) * i / 24; at(s, deckHeight(e, t2) + H + (deckHeight(e, b) + 1 - deckHeight(e, t2) - H) * i / 24); }
                cables.push(pts);
              }
            }
            if (e.bridgeStyle === 'arch') for (const sg of [-1,1]) { const pts=[]; for(let i=0;i<=30;i++){const u=i/30, ss=a+(b-a)*u, f=frame(e,ss);pts.push([f.x+f.nx*(hw+1.6)*sg,deckHeight(e,ss)+2+12*4*u*(1-u),f.z+f.nz*(hw+1.6)*sg,deckHeight(e,ss)+1]);} cables.push(pts); }
            if (e.bridgeStyle === 'movable') for(const ss of [a,b]) { const f=frame(e,ss);for(const sg of [-1,1]) column(f.x+f.nx*(hw+2)*sg,f.z+f.nz*(hw+2)*sg,0.8,-3,deckHeight(e,ss)+14,pier); }
            run0 = -1;
          }
        }
      }
      if (e.layer === -1) for (const s of [RAMP_LEN, e.len - RAMP_LEN]) { // tunnel portals
        const f = frame(e, s), col = lin([96, 92, 86]), y0 = deckHeight(e, s);
        for (const sg of [-1, 1]) column(f.x + f.nx * (hw + 0.6) * sg, f.z + f.nz * (hw + 0.6) * sg, 0.6, y0, 1.2, col);
        ribbonR(e, s - 0.8, s + 0.8, -hw - 1.2, hw + 1.2, 1.2, col);
      }
      if (e.struct) { // automatic viaducts (piers down to the ground) and tunnel portals
        const col = lin([150, 146, 138]), kAt = (s) => { let k = 0; while (k < e.n - 1 && e.cum[k + 1] < s) k++; return k; };
        for (let s = 6; s < e.len - 6; s += 10) {
          const k = kAt(s); if (e.struct[k] !== 1 || e.struct[k + 1] !== 1) continue;
          const f = frame(e, s), top = deckHeight(e, s) - 0.9, base = this.w.heightAt(f.x, f.z);
          if (top - base > 1.5) column(f.x, f.z, 0.8, base - 1, top, col);
        }
        for (let k = 1; k <= e.n; k++) if ((e.struct[k] === -1) !== (e.struct[k - 1] === -1)) {
          const s = e.cum[k], f = frame(e, s), y0 = deckHeight(e, s), pc = lin([96, 92, 86]);
          for (const sg of [-1, 1]) column(f.x + f.nx * (hw + 0.6) * sg, f.z + f.nz * (hw + 0.6) * sg, 0.7, y0 - 0.5, y0 + 4.5, pc);
          ribbonR(e, s - 0.9, s + 0.9, -hw - 1.3, hw + 1.3, 4.5, pc);
        }
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
      // a joint between decks sits at the deck's height, not on the ground below
      { const e0 = net.edges.get([...n.edges][0]); this._lift = e0 && (e0.layer > 0 && (e0.a === n.id ? e0.noRampA : e0.noRampB) || (e0.struct && !e0.layer)) ? deckHeight(e0, e0.a === n.id ? 0 : e0.len) - this.w.heightAt(n.x, n.z) : 0; if (this._lift < 0.3) this._lift = 0; }
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
    this._lift = 0;
    if (this.cableMesh) { this.scene.remove(this.cableMesh); this.cableMesh.geometry.dispose(); this.cableMesh = null; }
    if (cables.length) {   // suspension cables with hangers down to the deck
      const seg = []; for (const pts of cables) for (let i = 1; i < pts.length; i++) { seg.push(...pts[i - 1].slice(0, 3), ...pts[i].slice(0, 3)); if (i % 2 === 0) seg.push(pts[i][0], pts[i][1], pts[i][2], pts[i][0], pts[i][3], pts[i][2]); }
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      this.cableMesh = new THREE.LineSegments(cg, this.cableMat ||= new THREE.LineBasicMaterial({ color: 0x3a3a40 })); this.scene.add(this.cableMesh);
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
        const dark = !b.svc && !b.power && b.occ > 0 && ['res', 'off', 'com', 'shop'].includes(k);   // no electricity: its windows stay dark at night
        (acc[dark ? k + ':dark' : k] || (acc[dark ? k + ':dark' : k] = [])).push({ ...s, building: b.id }); hasAny = true;
      }
    }
    const old = this.chunks[ch];
    if (old) { for (const m of old.children) m.geometry.dispose(); this.scene.remove(old); }
    if (this.lodBoxes?.[ch]) { this.lodBoxes[ch].geometry.dispose(); this.scene.remove(this.lodBoxes[ch]); this.lodBoxes[ch] = null; }
    this.chunks[ch] = null;
    if (!hasAny) return;
    // far-away stand-in: one lit box per building, swapped in by updateLod()
    const boxes = [];
    for (const b of list) if ((b.top || 0) > 0.5) {
      const S = b.svc ? [170, 168, 160] : ZONES[b.zone].color, y0 = b.baseY || 0;
      boxes.push(coloredBox((b.x1 - b.x0) * 0.8, b.top - y0, (b.z1 - b.z0) * 0.8, (b.x0 + b.x1) / 2, y0 + (b.top - y0) / 2, (b.z0 + b.z1) / 2, (Math.round(S[0] * 0.5 + 90) << 16) | (Math.round(S[1] * 0.5 + 90) << 8) | Math.round(S[2] * 0.5 + 90)));
    }
    if (boxes.length) {
      const m = new THREE.Mesh(mergeGeometries(boxes), this.lodMat ||= new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.visible = false; this.scene.add(m); (this.lodBoxes ||= [])[ch] = m;
    }
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
      const [mk, dk] = k.split(':'), base = this.mats[mk] || this.mats.plain;
      if (dk && !this.mats[k]) { this.mats[k] = base.clone(); this.mats[k].emissiveIntensity = 0; this.mats[k].emissiveMap = null; }
      const m = new THREE.Mesh(g, dk ? this.mats[k] : base);
      m.userData.baseColors = c.slice(); m.userData.spans = spans; m.userData.baseMaterial = m.material;
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    this.chunks[ch] = grp; this.scene.add(grp); this.tintPending.add(ch);
  }

  // Chunks far from the camera target (relative to zoom) draw as boxes instead of full detail.
  updateLod() {
    const c = this.cam, far = this.perfLow ? Math.max(160, c.dist * 1.1) : Math.max(260, c.dist * 1.6);
    for (let ch = 0; ch < this.chunks.length; ch++) {
      const g = this.chunks[ch]; if (!g) continue;
      const cx = (ch % CHN + 0.5) * CH, cz = (Math.floor(ch / CHN) + 0.5) * CH;
      const lo = this.lod && this.lodBoxes?.[ch] && Math.hypot(cx - c.x, cz - c.z) > far;
      g.visible = !lo; if (this.lodBoxes?.[ch]) this.lodBoxes[ch].visible = !!lo;
    }
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
  // seasonal foliage: spring blossom, summer green, autumn colours, winter bare (or snowy)
  treeColor(c, h, h2) {
    const season = this.sim.weather.season, snowy = (this.w.hazards?.snow || 0) > 0.05;
    if (season === 'Autumn') return h2 < 0.25 ? c.setRGB(0.3 + h * 0.1, 0.42 + h * 0.1, 0.14) : c.setRGB(0.75 + h * 0.2, 0.3 + h2 * 0.35, 0.08 + h * 0.06);
    if (season === 'Winter') return snowy ? c.setRGB(0.85, 0.88, 0.9) : h2 < 0.3 ? c.setRGB(0.16, 0.3, 0.16) : c.setRGB(0.38 + h * 0.08, 0.32 + h * 0.06, 0.26);
    if (season === 'Spring' && h2 < 0.2) return c.setRGB(0.95, 0.62 + h * 0.2, 0.75);
    return c.setRGB(0.22 + h * 0.14, 0.45 + h * 0.18, 0.16 + h * 0.06);
  }

  rebuildTrees() {
    this.treeSeason = `${this.sim.weather.season}:${(this.w.hazards?.snow || 0) > 0.05}`;
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
        q.setFromAxisAngle(Y, hash2(ix, iz, 8) * 1.57); s.set(sc, sc * (0.85 + hash2(ix, iz, 9) * 0.4), sc); p.set(x, w.heightAt(x,z), z);
        M.compose(p, q, s); m.setMatrixAt(k, M);
        m.setColorAt(k, this.treeColor(c, h, hash2(ix, iz, 12)));
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
    const tram=mergeGeometries([coloredBox(1.3,1.5,6.5,0,1,0,0xffffff),coloredBox(1.32,.6,5.7,0,1.3,0,0x243a46)]);
    const snowplow=mergeGeometries([coloredBox(1.2,1.2,2.8,0,.9,0,0xf2a126),coloredBox(2,.7,.4,0,.4,1.7,0xd3e4ea)]);
    const ambulance = mergeGeometries([coloredBox(1.1, 1.1, 3, 0, 0.8, 0, 0xffffff), coloredBox(1.12, 0.25, 3.02, 0, 0.7, 0, 0xd83a3a), coloredBox(0.6, 0.14, 0.3, 0, 1.42, 0.6, 0xffffff)]);
    const van = mergeGeometries([coloredBox(1.2, 1.3, 2.6, 0, 0.95, -0.35, 0xffffff), coloredBox(1.1, 0.8, 0.9, 0, 0.7, 1.2, 0x3a6ac8), coloredBox(1.22, 0.12, 2.62, 0, 1.2, -0.35, 0xe8a030)]);
    const geo = { car, truck, bus, fire, garbage, police, tram, snowplow, ambulance, van }, cap = { tram:80,snowplow:40, car: 1100, truck: 260, bus: 80, fire: 24, garbage: 40, police: 30, ambulance: 24, van: 40 };
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
    // rush hours: 07–09:30 and 16–19 fill the streets, nights are quiet; lines switch timetable
    const hr = this.hour(), peak = (hr >= 7 && hr < 9.5) || (hr >= 16 && hr < 19), rush = peak ? 1.6 : hr >= 22 || hr < 5.5 ? 0.35 : 1;
    if (this.aSampleVer !== `${sim.sampleVersion}:${rush}`) {
      this.aSampleVer = `${sim.sampleVersion}:${rush}`;
      let tot = 0; for (const e of net.edges.values()) tot += e.flow * e.len;
      H.post({ type: 'samples', samples: (sim.trafficSamples || []).filter(s=>s.kind !== 'car'), target: Math.min(this.perfLow ? 300 : 1000, Math.round((tot / 260) * rush)) });
    }
    const lineKey = `${sim.lineInfoVersion}:${this.w.lineVersion}:${peak}`;
    if (this.aLineVer !== lineKey) {
      this.aLineVer = lineKey;
      const lines = [];
      for (const l of this.w.lines) {
        const info = sim.lineInfo?.get(l.id);
        if (info?.ok && info.segs.length) lines.push({ id: l.id, mode:l.mode, segs: info.segs, len: info.len, color: l.color, headway: peak ? l.headway || 10 : l.offpeak || l.headway || 10, sig: `${peak}|` + info.segs.map((g) => `${g.edge}:${g.from.toFixed(1)}:${g.to.toFixed(1)}`).join('|') });
      }
      H.post({ type: 'lines', lines });
    }
    this.residentStages ||= new Map();
    const residentSpawns = [];
    for (const c of sim.residentTrips || []) {
      const leg = residentLeg(c,hr), key=c.home+':'+c.k, previous=this.residentStages.get(key);
      if (step && c.mode === 'car' && leg.segments.length && previous !== leg.state) residentSpawns.push({ segs:leg.segments, kind:'car', col:0x4a86bc });
      if (step) this.residentStages.set(key,leg.state);
    }
    const spawns = (sim.dispatches?.splice(0) || []).map((d) => ({ segs: d.segs, kind: d.kind, col: d.kind === 'ambulance' ? 0xf4f4f4 : d.kind === 'van' ? 0xf0e6d0 : 0xd8302a }));
    spawns.push(...residentSpawns);
    // garbage trucks and police patrols: routed here, simulated in the worker
    this.serviceT += step;
    if (this.serviceT > 3) {
      this.serviceT = 0;
      const blds = [...this.w.buildings.values()];
      for (const [svc, kind, want, col] of [['snowdepot','snowplow',b=>!b.svc&&this.w.hazards.snow>.05,0xf2a126],['landfill', 'garbage', (b) => !b.svc && (b.garb || 0) > 20, 0xd8d8c8], ['police', 'police', (b) => !b.svc && b.edge >= 0, 0xf2f4f8]]) {
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
    // industry freight: loads leave working mines and plants for the next plant in the chain, a
    // freight terminal or the highway, coloured by what they carry
    this.freightT = (this.freightT || 0) + step;
    if (this.freightT > 2.5 && this.sim.industryFlow) {
      this.freightT = 0;
      const blds = [...this.w.buildings.values()], works = blds.filter((b) => SERVICES[b.svc]?.out && (b.indEff || 0) > 0.15 && b.edge >= 0);
      if (works.length && (this.poseCounts?.truck || 0) < 30) {
        const from = works[(Math.random() * works.length) | 0], S = SERVICES[from.svc], c = S.out;
        const users = blds.filter((b) => SERVICES[b.svc]?.in?.[c] && b.edge >= 0 && b.comp === from.comp);
        const ports = blds.filter((b) => SERVICES[b.svc]?.freight && b.edge >= 0 && b.comp === from.comp);
        const exits = [...net.nodes.values()].filter((n) => n.outside && n.edges.size);
        let dest = users[(Math.random() * users.length) | 0] || ports[0], target = dest && { id: dest.id, edge: dest.edge, s: dest.s };
        if (!target && exits.length) { const n = exits[0], e = net.edges.get([...n.edges][0]); if (e) target = { id: -1, edge: e.id, s: e.a === n.id ? 0.5 : e.len - 0.5 }; }
        const go = target && fastestRoute(net, { edge: from.edge, s: from.s }, [target]);
        if (go?.segments?.length) spawns.push({ segs: go.segments, kind: 'truck', col: FREIGHT_COL[c] ?? 0xe8e8e0 });
      }
    }
    if (spawns.length) H.post({ type: 'spawn', list: spawns });
    H.post({type:'bridges', closed:[...net.edges.values()].filter(e=>bridgeOpen(e,hr)).map(e=>e.id)});
    H.step(step);
    this.drawMaintenance();
    const res = H.latest; if (!res) return;
    // Interpolate raw consecutive snapshots. Using lastDrawn here freezes cars
    // when every frame receives a new snapshot and resets the blend to zero.
    if (res !== this.drawnPoses) {
      const prev = new Map(), B0 = this.drawnPoses?.buf;
      if (B0) for (let i = 0; i < this.drawnPoses.n; i++) { const o = i * POSE_STRIDE; prev.set(B0[o + 7], [B0[o], B0[o + 1], B0[o + 2], B0[o + 3]]); }
      this.poseGap = clamp(this.time - (this.poseAt ?? this.time), 0.03, 0.5); this.poseAt = this.time;
      this.drawnPoses = res; this.prevPoses = prev; this.sigClock.clock = res.clock;
    }
    {
      const blend = this.reducedMotion ? 1 : clamp((this.time - this.poseAt) / (this.poseGap || 0.1), 0, 1), drawn = new Map();
      for (const k in this.vtypes) this.vtypes[k].n = 0;
      const counts = {};
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
      const flash = Math.floor(this.time * 6) % 2, flyer = sim.tech.flying, B = res.buf, X = new THREE.Vector3(1, 0, 0), qx = new THREE.Quaternion(), seen = new Set();
      this.pitches ||= new Map();
      for (let i = 0; i < res.n; i++) {
        const o = i * POSE_STRIDE, type = TYPE_IDS[B[o + 4]], V = this.vtypes[type];
        counts[type] = (counts[type] || 0) + 1;
        if (!V || V.n >= V.mesh.instanceMatrix.count) continue;
        const hover = flyer && type === 'car' ? 2.8 + Math.sin(this.time + B[o + 7]) * 0.3 : 0;
        const id = B[o + 7], was = this.prevPoses?.get(id);
        let x = B[o], y = B[o + 1], z = B[o + 2], h = B[o + 3];
        if (was && Math.hypot(was[0] - x, was[2] - z) < 25) {
          x = was[0] + (x - was[0]) * blend; y = was[1] + (y - was[1]) * blend; z = was[2] + (z - was[2]) * blend;
          let dh = h - was[3]; dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI; h = was[3] + dh * blend;
        }
        drawn.set(id, [x, y, z, h]);
        // on the ground, vehicles tilt with the slope along their heading (smoothed per vehicle)
        const L = AGENT_TYPES[type]?.len || 2, fx = Math.sin(h) * L * 0.5, fz = Math.cos(h) * L * 0.5, g0 = this.w.heightAt(x, z);
        const want = !hover && Math.abs(y - g0) < 0.8 ? clamp(-Math.atan2(this.w.heightAt(x + fx, z + fz) - this.w.heightAt(x - fx, z - fz), L), -0.45, 0.45) : 0;
        const pit = this.pitches.get(id) ?? want, pitch = pit + (want - pit) * Math.min(1, 0.25 + blend * 0.5); this.pitches.set(id, pitch); seen.add(id);
        p.set(x, 0.12 + y + hover, z); q.setFromAxisAngle(Y, h).multiply(qx.setFromAxisAngle(X, pitch)); M.compose(p, q, sc);
        V.mesh.setMatrixAt(V.n, M);
        c.setHex(B[o + 6] ? (type === 'fire' ? (flash ? 0xff2a2a : B[o + 5]) : (flash ? 0x2a6aff : 0xff2a2a)) : B[o + 5]);
        V.mesh.setColorAt(V.n, c); V.n++;
      }
      this.poseCounts = counts; this.lastDrawn = drawn;
      if (this.pitches.size > seen.size * 2 + 50) for (const k of this.pitches.keys()) if (!seen.has(k)) this.pitches.delete(k);
      for (const k in this.vtypes) { const m = this.vtypes[k].mesh; m.count = this.vtypes[k].n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
    if (this.signalHeads) for (const h of this.signalHeads) {
      const e = net.edges.get(h.edge); if (!e || !h.mesh) continue;
      h.mesh.material = this.sigMats[this.sigClock.phase(h.node) === this.sigClock.axis(net, h.node, e) ? 1 : 0];
    }
  }

  drawMaintenance() {
    if (!this.maintenanceMesh) { this.maintenanceMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6,1.5,3.4),new THREE.MeshLambertMaterial({color:0xf1a52a}),128);this.maintenanceMesh.frustumCulled=false;this.scene.add(this.maintenanceMesh); }
    let n=0; const M=new THREE.Matrix4(), q=new THREE.Quaternion(), Y=new THREE.Vector3(0,1,0);
    for(const v of this.sim.maintenance || []) { const g=v.segs[v.i],e=this.w.net.edges.get(g?.edge);if(!e || n>=128)continue;const p=this.w.net.sampleAt(e,v.s);M.compose(new THREE.Vector3(p.x,deckHeight(e,v.s)+0.8,p.z),q.setFromAxisAngle(Y,Math.atan2(p.tx,p.tz)),new THREE.Vector3(1,1,1));this.maintenanceMesh.setMatrixAt(n++,M); }
    this.maintenanceMesh.count=n;this.maintenanceMesh.instanceMatrix.needsUpdate=true;
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
    const speed = this.sim.paused || this.reducedMotion ? 0 : 1, P = this.parts;
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
      if (!s) { s = new THREE.Sprite(this.iconMats[k]); s.scale.set(3.4, 3.4, 1); s.layers.set(1); this.icons.push(s); this.scene.add(s); }
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

  setRoadPreview(pts, hw, ok, lift = 0) {
    if (!pts || pts.length < 2) { this.prevRoad.visible = false; return; }
    const P = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * hw, nz = (dx / l) * hw, y = 0.4;
      const L0 = [a.x + nx, y, a.z + nz], R0 = [a.x - nx, y, a.z - nz], L1 = [b.x + nx, y, b.z + nz], R1 = [b.x - nx, y, b.z - nz];
      for(const p of [R0,L0,R1,L1])p[1]+=lift > 0 ? Math.max(this.w.heightAt(p[0],p[2]) + lift * 0.5, lift + Math.min(this.w.heightAt(pts[0].x,pts[0].z), this.w.heightAt(pts[pts.length-1].x,pts[pts.length-1].z))) : this.w.heightAt(p[0],p[2]);   // elevated previews float at their level
      P.push(...R0, ...L0, ...R1, ...R1, ...L0, ...L1);
    }
    this.prevRoad.geometry.dispose();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    this.prevRoad.geometry = g; this.prevRoad.material = ok ? this.prevMatOk : this.prevMatBad; this.prevRoad.visible = true;
  }
  setSnap(p) { if (!p) { this.snapDot.visible = false; return; } this.snapDot.position.set(p.x, this.w.heightAt(p.x,p.z)+0.5, p.z); this.snapDot.visible = true; }
  setBrush(x, z, r, color = 0xffffff) {
    this.brush.position.set(x, this.w.heightAt(x,z)+0.5, z); this.brush.scale.set(r, 1, r); this.brush.material.color.setHex(color); this.brush.visible = true;
  }
  setGhost(plan, S, ok) {
    if (!plan || plan.cx === undefined) { this.ghost.visible = false; return; }
    this.ghost.scale.set(S.w, 3, S.d);
    this.ghost.position.set(plan.cx, (plan.y ?? this.w.heightAt(plan.cx,plan.cz))+1.5, plan.cz);
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
    const active = this.buildingTints && this.overlay !== 'none', ghost = this.overlay === 'pipes';   // the underground view sees through the city
    this.tintMaterial ||= new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const ch of [...this.tintPending].slice(0, 4)) {
      this.tintPending.delete(ch); const group = this.chunks[ch]; if (!group) continue;
      for (const mesh of group.children) {
        const attr = mesh.geometry.attributes.color, normals = mesh.geometry.attributes.normal.array;
        attr.array.set(mesh.userData.baseColors); mesh.material = ghost ? (this.ghostMaterial ||= new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false })) : active ? this.tintMaterial : mesh.userData.baseMaterial; mesh.castShadow = !ghost;
        for (const span of mesh.userData.spans) {
          const b = this.w.buildings.get(span.id); if (!b) continue;
          let color = null;
          if (active) {
            if (this.overlay === 'districts') color = lin(DISTRICT_COLORS[b.district] || [150,150,150]);
            else {
              const value = this.overlayValue(b.cx,b.cz,b);
              const t = value == null ? null : clamp(this.OVGOOD[this.overlay] ? value : 1-value,0,1);
              color = lin(t == null ? [145,145,145] : this.ramp(t));
            }
          }
          for (let i = span.start; i < span.end; i += 3) {
            if (color) attr.array.set(color,i);
            else if (this.w.hazards.snow>.05 && normals[i+1] > 0.6) {
              for (let c=0;c<3;c++) attr.array[i+c] = attr.array[i+c]*(1-Math.min(.8,this.w.hazards.snow)) + .9*Math.min(.8,this.w.hazards.snow);
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

  // overlay colour ramp, bad → good: red–yellow–green, or a colour-blind-safe purple–teal–yellow
  ramp(t) {
    return this.palette === 'cb' ? (t < 0.5 ? mix([68, 1, 84], [33, 145, 140], t * 2) : mix([33, 145, 140], [253, 231, 37], (t - 0.5) * 2))
      : t < 0.5 ? mix([214, 64, 52], [236, 204, 66], t * 2) : mix([236, 204, 66], [66, 184, 92], (t - 0.5) * 2);
  }
  // accessibility & presentation settings: { palette: 'default'|'cb', reducedMotion, lod }
  applySettings(o) {
    const pal = o.palette === 'cb' ? 'cb' : 'default';
    if (pal !== this.palette) { this.palette = pal; this.w.markGround(0, 0, N, N); this.tintKey = null; }
    this.reducedMotion = !!o.reducedMotion; this.lod = o.lod !== false;
    if (!!o.fullTiles !== !!this.fullTiles) { this.fullTiles = !!o.fullTiles; if (this.regionArgs) this.setRegion(...this.regionArgs); }
    // performance profile: 'auto' picks the light one on phones and small, low-memory devices
    const phone = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && ((navigator.deviceMemory || 8) <= 4 || innerWidth < 900);
    this.perfLow = o.perf === 'low' || ((o.perf || 'auto') === 'auto' && phone);
    this.r.shadowMap.enabled = !this.perfLow; this.sun.castShadow = !this.perfLow;
    this.setEffects(o.dither, o.glow).catch((e) => console.warn('Effects unavailable', e.message));
  }

  // Toll booths where the played tile's roads cross into a neighbouring tile: a booth and a
  // barrier on the outbound side of each portal (only where a toll is charged).
  updateBooths() {
    const econ = this.w.econ, key = econ ? `${this.w.net.version}:${econ.portals.map((p) => `${p.node}:${econ.tile(p.to)?.policy.toll}`).join(',')}` : 'none';
    if (key === this.boothKey) return; this.boothKey = key;
    if (this.boothGroup) { this.boothGroup.traverse((o) => o.geometry?.dispose()); this.scene.remove(this.boothGroup); this.boothGroup = null; }
    if (!econ) return;
    const boxes = [];
    for (const p of econ.portals) {
      if (p.tile !== econ.active || p.node == null || !(econ.tile(p.to)?.policy.toll > 0)) continue;
      const n = this.w.net.nodes.get(p.node); if (!n) continue;
      const e = this.w.net.edges.get([...n.edges][0]); if (!e) continue;
      const s = e.a === n.id ? Math.min(10, e.len / 2) : Math.max(0, e.len - 10), f = this.w.net.sampleAt(e, s), y = deckHeight(e, s), hw = e.hw;
      const nx = -f.tz, nz = f.tx;
      boxes.push(coloredBox(1.6, 2.6, 1.6, f.x + nx * (hw + 1.4), y + 1.3, f.z + nz * (hw + 1.4), 0xe8e0d0));
      boxes.push(coloredBox(2, 0.3, 2, f.x + nx * (hw + 1.4), y + 2.75, f.z + nz * (hw + 1.4), 0xd83a3a));
      for (let k = 0; k < 6; k++) { const o = -hw + (k + 0.5) * (2 * hw / 6); boxes.push(coloredBox(0.35, 0.25, 0.35, f.x + nx * o, y + 1.1, f.z + nz * o, k % 2 ? 0xd83a3a : 0xf4f4f4)); }
    }
    if (boxes.length) { this.boothGroup = new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshLambertMaterial({ vertexColors: true })); this.scene.add(this.boothGroup); }
  }

  // Pedestrians are residents on an errand: each leaves a real home for a real place (a stop at
  // rush hour, school in the morning, shops by day, a park in the afternoon, a festival or match
  // when one is on) along the fastest route, walking the pavement and turning at junctions.
  // Crowds gather and mill about at event venues. Fewer walk at night and in the rain.
  updatePeople(dt) {
    if (!this.people) {
      const geo = mergeGeometries([coloredBox(0.36, 0.72, 0.26, 0, 0.5, 0, 0xffffff), coloredBox(0.26, 0.26, 0.26, 0, 1.02, 0, 0xf0d0b0), coloredBox(0.3, 0.3, 0.2, 0, 0.14, 0, 0x33373d)]); geo.scale(1.7, 1.7, 1.7);   // a little larger than life, so they read from the usual zoom
      this.people = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), 600); this.people.count = 0; this.people.frustumCulled = false; this.scene.add(this.people);
      this.walkers = [];
    }
    const w = this.w, net = w.net, c = this.cam, L = this.walkers, sim = this.sim, run = sim.paused ? 0 : Math.min(sim.speed, 3);
    const hr = this.hour(), night = hr >= 22 || hr < 6 ? 0.2 : hr < 7.5 || hr >= 20 ? 0.6 : 1, wet = { rain: 0.45, storm: 0.2, snow: 0.6 }[sim.weather.type] || 1;
    const R = 70 + c.dist * 0.5, cap = this.perfLow ? 160 : 560, venue = sim.event && w.buildings.get(sim.event.venue);
    const want = Math.min(cap, Math.round((sim.stats.pop || 0) / 7 * night * wet * clamp(260 / c.dist, 0.3, 1.4)) + (venue ? 120 : 0));
    const walkable = (e) => e && !e.layer && !ROADS[e.type].noAccess && e.type !== 'highway';
    // Outward and return journeys are the same assignment used by the follow camera.
    L.length = 0;
    for (const resident of sim.residentTrips || []) {
      if (resident.mode !== 'walk') continue;
      const leg = residentLeg(resident, hr), pos = routePosition(net, leg.segments, leg.progress);
      if (!pos || !walkable(pos.edge)) continue;
      L.push({ resident, pos, home:resident.home, dest:resident.destination, col:0x3a6ac8 });
    }
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0), col = new THREE.Color(); let n = 0;
    for (const a of L) {
      const f=a.pos, e=f.edge, off=e.hw+0.9;
      if (n >= this.people.instanceMatrix.count) break;
      p.set(f.x-f.tz*off, deckHeight(e,f.s)+0.1, f.z+f.tx*off); q.setFromAxisAngle(Y,Math.atan2(f.tx*f.dir,f.tz*f.dir));
      M.compose(p,q,sc); this.people.setMatrixAt(n,M); this.people.setColorAt(n,col.setHex(a.col)); n++;
    }
    // Festival spectators remain at their actual venue, separate from commuting residents.
    if (venue) for(let i=0;i<Math.min(60,cap-n);i++) { const ang=i*2.4, rad=4+i%9; p.set(venue.cx+Math.cos(ang)*rad,w.heightAt(venue.cx,venue.cz)+0.1,venue.cz+Math.sin(ang)*rad); q.setFromAxisAngle(Y,ang); M.compose(p,q,sc); this.people.setMatrixAt(n,M);this.people.setColorAt(n,col.setHex(0xe8c040));n++; }
    this.people.count = n; this.people.instanceMatrix.needsUpdate = true; if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;
  }

  // cars on the neighbouring tiles: each drives from road cell to road cell of the tile's view,
  // never straight back unless it must, at a steady town speed
  updateNeighbourTraffic(dt) {
    const T = this.nbRoads || [], run = this.sim.paused ? 0 : Math.min(this.sim.speed, 3);
    if (!this.nbCars) { this.nbCars = new THREE.InstancedMesh(mergeGeometries([coloredBox(1.1, 0.5, 2, 0, 0.45, 0, 0xffffff), coloredBox(0.9, 0.4, 1, 0, 0.85, -0.1, 0x2a3440)]), new THREE.MeshLambertMaterial({ vertexColors: true }), 400); this.nbCars.count = 0; this.nbCars.frustumCulled = false; this.scene.add(this.nbCars); }
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0), col = new THREE.Color(); let n = 0;
    const night = this.hour() >= 22 || this.hour() < 6 ? 0.35 : 1;
    for (const t of T) {
      const road = (i, j) => i >= 0 && j >= 0 && i < t.S && j < t.S && t.cls[j * t.S + i] === 2;
      if (!t.cells) { t.cells = []; for (let j = 0; j < t.S; j++) for (let i = 0; i < t.S; i++) if (road(i, j)) t.cells.push([i, j]); }
      const want = Math.min(60, Math.round(t.cells.length / 12 * night));
      while (t.cars.length < want && t.cells.length) { const [i, j] = t.cells[Math.floor(Math.random() * t.cells.length)]; t.cars.push({ i, j, pi: i, pj: j, ni: i, nj: j, f: 1, v: 1.2 + Math.random() * 0.6, col: [0xd84a3a, 0x3a6ac8, 0xe8e8e8, 0x2a2a2a, 0xe8c040][Math.floor(Math.random() * 5)] }); }
      if (t.cars.length > want) t.cars.length = want;
      for (const c of t.cars) {
        c.f += dt * run * c.v;
        while (c.f >= 1) {
          c.f -= 1; c.pi = c.i; c.pj = c.j; c.i = c.ni; c.j = c.nj;
          const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [c.i + a, c.j + b]).filter(([a, b]) => road(a, b) && !(a === c.pi && b === c.pj));
          const nx = opts.length ? opts[Math.floor(Math.random() * opts.length)] : [c.pi, c.pj]; c.ni = nx[0]; c.nj = nx[1];
        }
        if (n >= 400) continue;
        const gx = c.i + (c.ni - c.i) * c.f, gz = c.j + (c.nj - c.j) * c.f, ci = Math.min(t.S - 1, Math.round(gx)), cj = Math.min(t.S - 1, Math.round(gz));
        p.set(t.ox + (gx + 0.5) * t.k, t.hgt[cj * t.S + ci] / 3 + 0.1, t.oz + (gz + 0.5) * t.k); q.setFromAxisAngle(Y, Math.atan2(c.ni - c.i, c.nj - c.j));
        M.compose(p, q, one); this.nbCars.setMatrixAt(n, M); this.nbCars.setColorAt(n, col.setHex(c.col)); n++;
      }
    }
    this.nbCars.count = n; this.nbCars.instanceMatrix.needsUpdate = true; if (this.nbCars.instanceColor) this.nbCars.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- boats
  // River boats drift downstream on the current, harbour ships sail out to sea and back,
  // and ferries shuttle between pairs of ferry piers.
  updateBoats(dt) {
    const w = this.w, F = this.flow; if (!F) return;
    if (!this.boatMesh) {
      const hull = (L, W, c) => coloredBox(W, 0.8, L, 0, 0.3, 0, c);
      const kinds = {
        barge: mergeGeometries([hull(9, 2.6, 0x3a3a40), coloredBox(2.2, 0.9, 5, 0, 1, -0.8, 0x8a5a32), coloredBox(1.8, 1.4, 1.6, 0, 1.3, 3.2, 0xe8e4dc)]),
        sail: mergeGeometries([hull(4, 1.4, 0xf2f2f2), coloredBox(0.12, 5, 0.12, 0, 2.9, 0.2, 0x8a7a6a), coloredBox(0.06, 3.8, 2.2, 0, 2.6, -0.8, 0xfaf6ea)]),
        ship: mergeGeometries([hull(22, 5, 0x2a4a6a), coloredBox(4.4, 1.6, 8, 0, 1.4, -2, 0xc84a3a), coloredBox(4.4, 1.6, 5, 0, 1.4, 5, 0x3a8ae0), coloredBox(3.6, 3.2, 3, 0, 2.2, -8.5, 0xf2f2ee)]),
        ferry: mergeGeometries([hull(12, 4, 0xf2f2ee), coloredBox(3.6, 1.8, 7, 0, 1.6, 0, 0x3a8ae0), coloredBox(3.8, 0.3, 7.4, 0, 2.6, 0, 0xf2f2ee)]),
      };
      this.boatMesh = {}; for (const [k, g] of Object.entries(kinds)) { const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }), 40); m.count = 0; m.frustumCulled = false; m.castShadow = true; this.scene.add(m); this.boatMesh[k] = m; }
      this.boats = [];
    }
    const run = this.sim.paused ? 0 : Math.min(this.sim.speed, 3), key = `${this.flowKey = (this.flowKey || 0)}:${w.svcVersion}:${w.terrainVersion}`;
    // harbour ships and ferries follow routes, rebuilt when services or water change
    if (key !== this.boatKey) {
      this.boatKey = key; this.boats = this.boats.filter((b) => b.kind === 'barge' || b.kind === 'sail');
      const blds = [...w.buildings.values()];
      for (const h of blds.filter((b) => b.svc === 'harbour' && !b.abandoned)) {
        const r = waterRoute(w, h.cx, h.cz, 'edge'); if (!r || r.length < 2) continue;
        for (let k = 0; k < 2; k++) this.boats.push({ kind: 'ship', route: r, len: routeLen(r), s: k * routeLen(r) * 0.5, dir: k ? -1 : 1, wait: 0, v: 5 });
      }
      for (const p of ferryPairs(w, blds.filter((b) => b.svc === 'ferry' && !b.abandoned))) this.boats.push({ kind: 'ferry', route: p.route, len: routeLen(p.route), s: 0, dir: 1, wait: 2, v: 7 });
    }
    // river traffic near the camera
    const c = this.cam, drifting = this.boats.filter((b) => b.kind === 'barge' || b.kind === 'sail').length;
    if (drifting < (this.perfLow ? 3 : 8) && run && Math.random() < dt * 0.8) {
      for (let t = 0; t < 12; t++) {
        const x = c.x + (Math.random() - 0.5) * 400, z = c.z + (Math.random() - 0.5) * 400, f = x > 2 && z > 2 && x < N - 2 && z < N - 2 ? flowAt(F, x, z) : null;
        if (f && !f.open && w.wdist[w.cellAt(x, z)] < -2) { this.boats.push({ kind: Math.random() < 0.6 ? 'barge' : 'sail', x, z, h: Math.atan2(f.x, f.z), age: 0, v: 2 + Math.random() * 2 }); break; }
      }
    }
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0), n = { barge: 0, sail: 0, ship: 0, ferry: 0 };
    for (let i = this.boats.length - 1; i >= 0; i--) {
      const b = this.boats[i]; let x, z, h;
      if (b.route) {
        const atBridge = routeAt(b.route, b.s + b.dir*10), crossing = w.net.nearestEdge(atBridge.x,atBridge.z,8,e=>e.bridgeStyle === 'movable');
        if (crossing && !bridgeOpen(crossing.e,this.hour())) { /* wait for the shipping window */ }
        else if (b.wait > 0) b.wait -= dt * run; else { b.s += b.dir * b.v * dt * run; if (b.s >= b.len || b.s <= 0) { b.s = clamp(b.s, 0, b.len); b.dir = -b.dir; b.wait = b.kind === 'ferry' ? 6 : 14; } }
        const a = routeAt(b.route, b.s); x = a.x; z = a.z; h = Math.atan2(a.hx * b.dir, a.hz * b.dir);
      } else {
        const f = flowAt(F, b.x, b.z); b.age += dt * run;
        if (!f || b.age > 240 || b.x < 1 || b.z < 1 || b.x > N - 1 || b.z > N - 1 || w.wdist[w.cellAt(b.x, b.z)] > -1) { this.boats.splice(i, 1); continue; }
        const crossing = w.net.nearestEdge(b.x+f.x*10,b.z+f.z*10,8,e=>e.bridgeStyle === 'movable');
        const sp = crossing && !bridgeOpen(crossing.e,this.hour()) ? 0 : b.v * (0.6 + f.speed) * dt * run; b.x += f.x * sp; b.z += f.z * sp;
        const want = Math.atan2(f.x, f.z); let d = want - b.h; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; b.h += d * Math.min(1, dt * 2); x = b.x; z = b.z; h = b.h;
      }
      const m = this.boatMesh[b.kind]; if (n[b.kind] >= 40) continue;
      p.set(x, -0.3 + Math.sin(this.time * 1.7 + i) * 0.08, z); q.setFromAxisAngle(Y, h); M.compose(p, q, one); m.setMatrixAt(n[b.kind]++, M);
    }
    for (const k in n) { this.boatMesh[k].count = n[k]; this.boatMesh[k].instanceMatrix.needsUpdate = true; }
  }

  // hour of the day from the visual clock (tod 0 = 06:00, 0.25 = noon)
  hour() { return (this.tod * 24 + 6) % 24; }
  // Following one resident: at home, on the way along their real route, at work, and back.
  updateFollow(dt) {
    const f = this.follow; if (!f) { if (this.followMark) this.followMark.visible = false; return; }
    const w = this.w, net = w.net, home = w.buildings.get(f.citizen.home); if (!home) { this.follow = null; return; }
    if (!this.followMark) {
      const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 1.2), new THREE.MeshBasicMaterial({ color: 0xffd23a })));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.25, 4, 16), new THREE.MeshBasicMaterial({ color: 0xffd23a })); ring.rotation.x = Math.PI / 2; ring.position.y = -0.8; g.add(ring);
      this.followMark = g; this.scene.add(g);
    }
    const c = this.sim.residentTrips?.find(c=>c.home===home.id && c.k===f.citizen.k);
    const leg = residentLeg(c,this.hour()), work = c && w.buildings.get(c.destination);
    f.work = c?.destination; f.minutes = c?.minutes; if (c) f.citizen = c;
    let pos = [home.cx, home.pad ?? home.baseY ?? 0, home.cz], state = leg.state;
    const at = routePosition(net,leg.segments,leg.progress);
    if (at) pos=[at.x,deckHeight(at.edge,at.s),at.z];
    else if (state === 'work' && work) pos=[work.cx,work.pad ?? work.baseY ?? 0,work.cz];
    f.state = state;
    this.followMark.visible = true; this.followMark.position.set(pos[0], pos[1] + 2.5 + Math.sin(this.time * 4) * 0.3, pos[2]);
    if (f.camera) { this.cam.x += (pos[0] - this.cam.x) * Math.min(1, dt * 3); this.cam.z += (pos[2] - this.cam.z) * Math.min(1, dt * 3); }
  }

  // Neighbouring cities of the region stand on the horizon beyond the map edge,
  // sized by their population (AI neighbours and your own other cities alike).
  setRegion(region, views = {}) {
    this.regionArgs = [region, views];
    if (this.regionGroup) { this.regionGroup.traverse((o) => { o.geometry?.dispose(); if (!o.userData.shared) { o.material?.map?.dispose(); o.material?.dispose?.(); } }); this.scene.remove(this.regionGroup); }
    this.nbRoads = [];
    const g = this.regionGroup = new THREE.Group(), here = region?.tiles[region.active]; this.scene.add(g);
    if (!here) return;
    const boxes = [];
    // where a neighbour's road reaches the shared border: amber posts mark the connection point
    for (const st of this.w.edgeStubs || []) {
      const x = st.side === 'west' ? 0.5 : st.side === 'east' ? N - 0.5 : st.pos, z = st.side === 'north' ? 0.5 : st.side === 'south' ? N - 0.5 : st.pos, y = this.w.heightAt(x, z);
      const along = st.side === 'west' || st.side === 'east';
      for (const o of [-5, 5]) boxes.push(coloredBox(0.6, 3, 0.6, x + (along ? 0 : o), y + 1.5, z + (along ? o : 0), 0xf0a030));
    }
    // every tile of the region, pregenerated land and all, laid out around this one
    for (const [key, t] of Object.entries(region.tiles)) {
      const dx = t.x - here.x, dz = t.z - here.z; if (!dx && !dz) continue;
      const v = views[key];
      if (v) g.add(this.neighbourMesh(v, dx * N, dz * N, Math.abs(dx) + Math.abs(dz) === 1 ? [dx, dz] : null));
      if (v?.n || !(t.kind === 'ai' || t.kind === 'city')) continue;
      // a city without a view yet (or a far AI city): a hazy skyline sized by population, on its land
      const pop = t.kind === 'ai' ? t.pop || 20000 : t.summary?.pop || 0; if (pop < 50) continue;
      const n = Math.round(clamp(pop / 1500, 10, 140)), top = clamp(Math.sqrt(pop) / 4, 8, 110), seed = t.x * 31 + t.z;
      const hv = v && unb64(v.hgt), groundAt = (x, z) => { if (!hv) return 0; const i = clamp(Math.floor((x - dx * N) / N * v.S), 0, v.S - 1), j = clamp(Math.floor((z - dz * N) / N * v.S), 0, v.S - 1); return hv[j * v.S + i] / 3; };
      const cx = N / 2 + dx * N, cz = N / 2 + dz * N;
      for (let i = 0; i < n; i++) {
        const a = hash2(i, seed, 401) * Math.PI * 2, r = Math.sqrt(hash2(i, seed, 402)) * N * 0.3, core = 1 - r / (N * 0.3);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const h = 3 + top * core * core * (0.3 + hash2(i, seed, 403) * 0.7), w = 5 + hash2(i, seed, 404) * 9;
        const shade = 150 + Math.round(hash2(i, seed, 405) * 40);
        boxes.push(coloredBox(w, h, w * (0.6 + hash2(i, seed, 406) * 0.8), x, groundAt(x, z) + h / 2 - 0.5, z, (shade << 16) | ((shade + 8) << 8) | (shade + 22)));
      }
    }
    if (boxes.length) { const m = new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshLambertMaterial({ vertexColors: true })); m.receiveShadow = false; g.add(m); }
  }
  // A neighbouring city from its view: ground (terrain, water, roads and zoned land coloured
  // like the map) and a lit box for every building, placed beyond the shared edge.
  neighbourMesh(view, ox, oz, side = null) {
    const S = view.S, k = N / S, cls = unb64(view.cls), hgt = unb64(view.hgt), bx = unb64(view.boxes, Int16Array), grp = new THREE.Group();
    // along the side it shares with this city, the ground eases onto this city's edge: no seam
    const stitch = (i, j, y) => {
      if (!side) return y;
      const [sx, sz] = side, dist = sx < 0 ? S - i : sx > 0 ? i : sz < 0 ? S - j : j; if (dist > 4) return y;
      const ex = sx < 0 ? 0.01 : sx > 0 ? N - 0.01 : ox + i * k, ez = sz < 0 ? 0.01 : sz > 0 ? N - 0.01 : oz + j * k;
      const mine = this.w.water[this.w.cellAt(ex, ez)] ? -1.4 : this.w.heightAt(ex, ez), f = dist / 4;
      return mine * (1 - f) + y * f;
    };
    // the same palette as this city's ground (its average grass), so the tiles meet without a seam
    if (!this.grass) { let r = 0, g2 = 0, b2 = 0, n = 0; for (let i = 0; i < N * N; i += 97) if (!this.w.water[i]) { r += this.base[i * 3]; g2 += this.base[i * 3 + 1]; b2 += this.base[i * 3 + 2]; n++; } this.grass = n ? [r / n, g2 / n, b2 / n] : [96, 146, 62]; }
    const G0 = this.grass, GROUND = [G0, [70, 124, 168], [150, 150, 146], ...[1, 2, 3, 4, 5, 6].map((z) => ZONES[z].color.map((c, i) => Math.round(c * 0.45 + G0[i] * 0.55))), [170, 168, 160], G0.map((c) => c * 0.62)];
    const lin = (v) => Math.pow(v / 255, 2.2);   // vertex colours are linear; the ground texture is sRGB
    // open land and woods next door get the same season, rock and snow as this tile's ground
    const season = this.season(), cellCol = (c, i, j) => {
      const k2 = cls[c], g = GROUND[k2] || GROUND[0]; if (k2 !== 0 && k2 !== 10) return g;
      const h = hgt[c] / 3, sl = Math.hypot(hgt[Math.min(S - 1, i + 1) + j * S] / 3 - h, hgt[i + Math.min(S - 1, j + 1) * S] / 3 - h) / k;
      const rocky = sl > 0.5 ? mix(g, [112, 106, 98], clamp((sl - 0.5) * 1.8, 0, 0.9)) : g;
      return this.landColor(rocky, h, ox + i * k, oz + j * k, season);
    };
    this._cellCol = cellCol;
    const pos = new Float32Array((S + 1) * (S + 1) * 3), col = new Float32Array((S + 1) * (S + 1) * 3), uv = new Float32Array((S + 1) * (S + 1) * 2), idx = [];
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const c = Math.min(S - 1, j) * S + Math.min(S - 1, i), v = j * (S + 1) + i, g = cellCol(c, i, j), sh = 0.92 + hash2(i, j, 91) * 0.1;
      pos.set([ox + i * k, stitch(i, j, cls[c] === 1 ? -1.4 : hgt[c] / 3), oz + j * k], v * 3); col.set(this.fullTiles ? [1, 1, 1] : [lin(g[0] * sh), lin(g[1] * sh), lin(g[2] * sh)], v * 3);
      uv.set([i / S, 1 - j / S], v * 2);
    }
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const a = j * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (this.fullTiles) { mat.map = this.tileTexture(cls, S, GROUND); mat.vertexColors = false; }
    const ground = new THREE.Mesh(geo, mat); ground.receiveShadow = true; ground.userData.ground = true; grp.add(ground);
    const WALL = { 3: 0xd8cfb8, 4: 0xc8c2b4, 5: 0x9fb4d8, 6: 0xd8cc9a, 7: 0xb4b8cc, 8: 0xd8b8c0, 9: 0xd0d0cc };
    const boxes = [], facades = [], KEY = { 3: 'res', 4: 'res', 5: 'com', 6: 'ind', 7: 'off', 8: 'shop' };
    for (let i = 0; i < bx.length; i += 7) {
      const x0 = bx[i], z0 = bx[i + 1], x1 = bx[i + 2], z1 = bx[i + 3], y0 = bx[i + 4] / 4, h = Math.max(0.6, bx[i + 5] / 4), w = Math.max(1, (x1 - x0) * 0.8), d = Math.max(1, (z1 - z0) * 0.8);
      // the tiles next door get windows (lit at night) and roofs; farther ones plain boxes
      if (side && KEY[bx[i + 6]]) facades.push({ x: ox + (x0 + x1) / 2, z: oz + (z0 + z1) / 2, w, d, y0, h, key: KEY[bx[i + 6]], col: WALL[bx[i + 6]], roof: 0x8a8580 });
      else boxes.push(coloredBox(w, h, d, ox + (x0 + x1) / 2, y0 + h / 2, oz + (z0 + z1) / 2, WALL[bx[i + 6]] || 0xcccccc));
    }
    if (facades.length) for (const [key, gp] of Object.entries(genBoxes(facades))) {
      if (!gp.p.length) continue;
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(gp.p, 3)); g2.setAttribute('normal', new THREE.Float32BufferAttribute(gp.n, 3));
      g2.setAttribute('color', new THREE.Float32BufferAttribute(gp.c, 3)); g2.setAttribute('uv', new THREE.Float32BufferAttribute(gp.u, 2));
      const fm = new THREE.Mesh(g2, this.mats[key] || this.mats.plain); fm.userData.shared = true; grp.add(fm);
    }
    // a little traffic on the neighbour's streets
    if (side) this.nbRoads.push({ ox, oz, S, k, cls, hgt, cars: [] });
    // woods next door: voxel trees on the tiles that share a side, with full texture on
    const tc = new THREE.Color(); this.regionSeason = `${this.sim.weather.season}:${(this.w.hazards?.snow || 0) > 0.05}`;
    if (this.fullTiles && side) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      if (cls[j * S + i] !== 10 || hash2(i, j, 93) > 0.45) continue;
      const x = ox + (i + hash2(i, j, 94)) * k, z = oz + (j + hash2(i, j, 95)) * k, h = 2 + hash2(i, j, 96) * 2.5, y = hgt[j * S + i] / 3;
      boxes.push(coloredBox(2.2, h, 2.2, x, y + 0.6 + h / 2, z, this.treeColor(tc, hash2(i, j, 97), hash2(i, j, 98)).getHex()));   // in this season's colours
    }
    if (boxes.length) { const m = new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshLambertMaterial({ vertexColors: true })); m.castShadow = false; grp.add(m); }
    return grp;
  }

  // Full texture for another tile: its map drawn pixel by pixel at 4× the view (ground grain,
  // lot edges, road markings, shorelines), like this city's own ground
  tileTexture(cls, S, GROUND) {
    const R = 4, T = S * R, data = new Uint8Array(T * T * 4);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const i = (y / R | 0) * S + (x / R | 0), c = cls[i], g = (this._cellCol?.(i, x / R | 0, y / R | 0)) || GROUND[c] || GROUND[0], lx = x % R, ly = y % R;
      let m = 0.9 + hash2(x, y, 77) * 0.14;
      if (c >= 3 && c <= 8 && (lx === 0 || ly === 0)) m *= 0.8;                          // lot edges
      if (c === 2) { const nb = (dx, dz) => cls[clamp((y / R | 0) + dz, 0, S - 1) * S + clamp((x / R | 0) + dx, 0, S - 1)] === 2; if ((nb(-1, 0) && nb(1, 0) && ly === 2) || (nb(0, -1) && nb(0, 1) && lx === 2)) m = 1.35; }   // lane marks
      if (c === 1 && hash2(x, y, 78) > 0.93) m = 1.2;                                       // glints
      if (c === 0 && hash2(x >> 1, y >> 1, 79) > 0.9) m *= 0.8;                              // tufts
      const o = ((T - 1 - y) * T + x) * 4; data[o] = clamp(g[0] * m, 0, 255); data[o + 1] = clamp(g[1] * m, 0, 255); data[o + 2] = clamp(g[2] * m, 0, 255); data[o + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, T, T); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
    return tex;
  }

  // Disasters and events on screen: the ground shakes after a quake, a funnel sweeps
  // along a tornado's track, and fireworks burst over a festival after dark.
  updateEvents(dt) {
    const s = this.sim, now = performance.now();
    if (s.quake && !this.reducedMotion) {
      const k = 1 - (now - s.quake.t) / 3000;
      if (k > 0) { const a = k * (s.quake.mag - 4.5) * 0.6; this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a; }
    }
    const tor = s.tornado, tk = tor ? (now - tor.t) / 9000 : 2;
    if (tk < 1) {
      if (!this.funnel) {
        const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color: 0x6f7378, transparent: true, opacity: 0.7, depthWrite: false });
        for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(1.5 + i * 1.3, 1 + i * 1.3, 5, 10, 1, true), m); c.position.y = 2.5 + i * 5; g.add(c); }
        this.funnel = g; this.scene.add(g);
      }
      const x = tor.x0 + (tor.x1 - tor.x0) * tk, z = tor.z0 + (tor.z1 - tor.z0) * tk;
      this.funnel.visible = true; this.funnel.position.set(x, this.w.heightAt(x, z), z);
      this.funnel.children.forEach((c, i) => { c.rotation.y += dt * (4 + i); c.position.x = Math.sin(now / 300 + i) * i * 0.4; });
    } else if (this.funnel) this.funnel.visible = false;
    // fireworks: short-lived bright sparks above the festival venue at night
    if (!this.sparks) {
      this.sparks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshBasicMaterial({ color: 0xffffff }), 600);
      this.sparks.count = 0; this.sparks.frustumCulled = false; this.scene.add(this.sparks); this.sparkList = [];
    }
    const v = s.event && this.w.buildings.get(s.event.venue), L = this.sparkList;
    if (v && this.night > 0.4 && !this.reducedMotion && !s.paused && Math.random() < dt * 1.6) {
      const col = [0xff5a5a, 0xffd23a, 0x5ad8ff, 0xb45aff, 0x5aff8a][Math.floor(Math.random() * 5)], y = (v.top || 10) + 25 + Math.random() * 20;
      for (let i = 0; i < 40 && L.length < 600; i++) { const a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1), sp = 8 + Math.random() * 4; L.push({ x: v.cx, y, z: v.cz, vx: Math.sin(b) * Math.cos(a) * sp, vy: Math.cos(b) * sp, vz: Math.sin(b) * Math.sin(a) * sp, age: 0, col }); }
    }
    const M = new THREE.Matrix4(), c = new THREE.Color(); let n = 0;
    for (let i = L.length - 1; i >= 0; i--) { const p = L[i]; p.age += dt; if (p.age > 1.6) { L.splice(i, 1); continue; } p.vy -= 9 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
    for (const p of L) { const k = 1 - p.age / 1.6; M.makeScale(k, k, k).setPosition(p.x, p.y, p.z); this.sparks.setMatrixAt(n, M); this.sparks.setColorAt(n, c.setHex(p.col)); n++; }
    this.sparks.count = n; this.sparks.instanceMatrix.needsUpdate = true; if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
  }

  // PNG of the current view (rendered now, so the drawing buffer is still intact)
  // upscaled with nearest-neighbour so the pixel art stays crisp at screen size
  capture() {
    this.draw();
    const src = this.r.domElement, k = Math.max(1, this.pixel), out = document.createElement('canvas');
    out.width = src.width * k; out.height = src.height * k;
    const g = out.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  setDayMode(m) { this.dayMode = m; try { localStorage.setItem('organicity-daynight', m); } catch { /* ignore */ } }

  // Day/night: a visual clock (3 min per day at 1×) dims the sun, rotates it,
  // and lights windows, streetlights and neon as the city goes dark.
  updateDayNight(dt) {
    if (!this.sim.paused) this.tod = (this.tod + dt * Math.min(this.sim.speed, 4) / 180) % 1;
    const t = this.photoTod != null ? this.photoTod : this.dayMode === 'day' ? 0.3 : this.dayMode === 'night' ? 0.8 : this.tod;
    const elev = Math.sin(t * Math.PI * 2), target = clamp((0.2 - elev) / 0.4, 0, 1);
    this.night += (target - this.night) * Math.min(1, dt * 3);
    const n = this.night, c = this.cam;
    this.sun.intensity *= 1 - 0.9 * n; this.hemi.intensity = 1.35 * (1 - 0.7 * n);
    const az = t * Math.PI * 2; this.sun.position.set(c.x + Math.cos(az) * 220, 60 + Math.max(0, elev) * 220, c.z + Math.sin(az) * 120 + 60);
    const nightSky = new THREE.Color(0x0b1026);
    this.scene.background.lerp(nightSky, n * 0.85); this.scene.fog.color.copy(this.scene.background);
    for (const k of ['res', 'off', 'com', 'shop']) this.mats[k].emissiveIntensity = n * 1.1;
    if (this.lampMat) this.lampMat.emissiveIntensity = n * (this.fx?.bloom ? 0.9 : 1.6);   // softer when the glow pass adds its own halo
    this.hemi.color.setRGB(0.91 - 0.5 * n, 0.95 - 0.45 * n, 1);
  }

  updateHazards() {
    const w=this.w,key=`${this.sim.day}:${w.leveeVersion||0}:${Math.floor(this.cam.x/40)}:${Math.floor(this.cam.z/40)}`;
    if(key===this.hazardKey)return;this.hazardKey=key;
    if(this.hazardDay!==this.sim.day){this.hazardDay=this.sim.day;if(['none','flooding','snow'].includes(this.overlay))w.markGround(0,0,N,N);}
    if(!this.hazardGroup) {
      this.hazardGroup=new THREE.Group();this.scene.add(this.hazardGroup);
      this.floodMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(4,.12,4),new THREE.MeshLambertMaterial({color:0x4d9eb8,transparent:true,opacity:.65}),16384);
      this.leveeMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,3,1),new THREE.MeshLambertMaterial({color:0x9a9675}),30000);
      this.floodMesh.frustumCulled=this.leveeMesh.frustumCulled=false;this.hazardGroup.add(this.floodMesh,this.leveeMesh);
    }
    const m=new THREE.Matrix4();let f=0,l=0;
    for(let z=Math.max(0,Math.floor(this.cam.z-200));z<Math.min(N,this.cam.z+200);z++)for(let x=Math.max(0,Math.floor(this.cam.x-200));x<Math.min(N,this.cam.x+200);x++) {
      const i=z*N+x;
      if(w.levees[i]&&l<30000){m.makeTranslation(x+.5,w.heightAt(x,z)+1.5,z+.5);this.leveeMesh.setMatrixAt(l++,m);}
      if(x%4===0&&z%4===0&&!w.water[i]&&w.flood[i]>.05&&f<16384){m.makeTranslation(x+2,w.heightAt(x,z)+w.flood[i],z+2);this.floodMesh.setMatrixAt(f++,m);}
    }
    this.floodMesh.count=f;this.leveeMesh.count=l;this.floodMesh.instanceMatrix.needsUpdate=this.leveeMesh.instanceMatrix.needsUpdate=true;
    const strike=w.hazards.lightning;
    if(this.bolt){this.scene.remove(this.bolt);this.bolt.geometry.dispose();this.bolt.material.dispose();this.bolt=null;}
    if(strike?.day===this.sim.day&&!this.reducedMotion) {
      const y=w.heightAt(strike.x,strike.z);this.bolt=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(strike.x,y+90,strike.z),new THREE.Vector3(strike.x+5,y+48,strike.z),new THREE.Vector3(strike.x-3,y+44,strike.z),new THREE.Vector3(strike.x,y,strike.z)]),new THREE.LineBasicMaterial({color:0xffffc7}));this.scene.add(this.bolt);
    }
  }

  updateWeather(dt) {
    this.updateHazards();
    if (this.weatherType !== this.sim.weather.type) { this.weatherType=this.sim.weather.type; this.w.markGround(0,0,N,N); }
    const w=this.sim.weather, snow=w.type==='snow', wet=snow || w.type==='rain' || w.type==='storm';
    this.scene.background.setHex(w.sky);this.scene.fog.color.setHex(w.sky);this.sun.intensity=w.light;
    // under the front it's darker; ahead of and behind it the sun breaks through
    const here = frontAt(w, this.cam.x, this.cam.z, this.sim.day + this.sim.acc);
    if (wet) { this.sun.intensity = WEATHER.clear.light + (w.light - WEATHER.clear.light) * here; this.scene.background.lerp(new THREE.Color(WEATHER.clear.sky), 1 - here); this.scene.fog.color.copy(this.scene.background); }
    if(this.sim.tech.style==='cyberpunk'){this.scene.background.lerp(new THREE.Color(0x252340),0.65);this.scene.fog.color.copy(this.scene.background);this.sun.intensity*=0.65;}
    if (w.type==='fog') { this.scene.fog.near=this.cam.dist*0.35;this.scene.fog.far=this.cam.dist*2+100; }
    this.ground.material.color.setHex(this.w.hazards.snow>.05 ? 0xe1e9ef : wet ? 0xa4b5bd : 0xffffff);
    this.regionGroup?.traverse((o) => { if (o.userData.ground) o.material.color.copy(this.ground.material.color); });   // the weather reaches the other tiles too
    // Rain and snow fall over the whole tile: three in five drops are spread over the
    // entire map (following the terrain), the rest crowd around the camera for close-ups.
    const COUNT = 6000;
    if (!this.precipitation) {
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(COUNT*6),3));
      this.precipitation=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xc8e3ff,transparent:true,opacity:0.65,depthWrite:false}));
      this.precipitation.frustumCulled=false;this.scene.add(this.precipitation);this.weatherClock=0;
      this.dropBase = new Float32Array(COUNT);   // ground height under each whole-tile drop, refreshed as terrain changes
      this.dropVer = -1;
    }
    this.precipitation.visible=wet && !this.reducedMotion;if(!wet || this.reducedMotion)return;
    if(!this.sim.paused)this.weatherClock+=dt;
    const a=this.precipitation.geometry.attributes.position, c=this.cam;
    const heavy = (w.type === 'storm' ? 1 : w.type === 'rain' ? 0.75 : 0.85) * (this.perfLow ? 0.35 : 1), n = Math.round(COUNT * heavy);
    this.precipitation.geometry.setDrawRange(0, n * 2);
    this.precipitation.material.color.setHex(snow?0xffffff:0xb8dfff);
    this.precipitation.material.opacity = clamp(0.35 + c.dist / 900, 0.45, 0.8);
    const gv = `${this.w.terrainVersion}:${this.w.net.version}`;
    if (this.dropVer !== gv) { this.dropVer = gv; for (let i = 0; i < COUNT; i++) this.dropBase[i] = this.w.heightAt(hash2(i, 2, 71) * N, hash2(i, 3, 71) * N); }
    const clock = this.sim.day + this.sim.acc;
    const near = clamp(c.dist * 0.9, 60, 260), streak = snow ? 0.3 : clamp(c.dist / 70, 2.5, 9), H = 90;
    const sx = Math.sin(w.direction) * (snow ? 0.35 : 0.2), sz = Math.cos(w.direction) * (snow ? 0.35 : 0.2);
    for(let i=0;i<n;i++) {
      const fall=snow?5:35, drop=H-((hash2(i,1,71)*H+this.weatherClock*fall*(0.85+hash2(i,4,71)*0.3))%H);
      let x, z, base;
      if (i % 5 < 3) { x = hash2(i,2,71)*N; z = hash2(i,3,71)*N; base = this.dropBase[i]; }
      else { x = c.x+(hash2(i,2,71)-0.5)*near*2; z = c.z+(hash2(i,3,71)-0.5)*near*2; base = (c.targetY || 0) + this.w.heightAt(c.x, c.z); }
      x += sx * drop; z += sz * drop;
      if (hash2(i, 5, 71) > frontAt(w, x, z, clock)) { a.setXYZ(i * 2, 0, -500, 0); a.setXYZ(i * 2 + 1, 0, -500, 0); continue; }   // dry outside the band
      const y = base + drop;
      a.setXYZ(i*2,x,y,z);a.setXYZ(i*2+1,x+(snow?0.3:sx*streak),y+(snow?0.3:streak),z+(snow?0:sz*streak));
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

  // utility lines: pylons and wires always; water pipes and drains only in the underground view
  updateULines() {
    const w = this.w, under = this.overlay === 'pipes', hot = [...(this.sim.lineLoad || new Map())].filter(([, v]) => v > 0.97).map(([k]) => k).join(','), key = `${w.ulineVersion || 0}:${under}:${w.ulines?.length || 0}:${undergroundY(w)}:${hot}`;
    if (key === this.ulKey) return; this.ulKey = key;
    if (this.ulGroup) { this.ulGroup.traverse((o) => { o.geometry?.dispose(); }); this.scene.remove(this.ulGroup); this.ulGroup = null; }
    if (!w.ulines?.length) return;
    const g = new THREE.Group(), pylons = [], wires = [], pipes = { water: [], sewer: [] }, hotWires = [];
    for (const l of w.ulines.flatMap(lineSegments)) {
      const [ax, az] = l.a, [bx, bz] = l.b, len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
      if (l.kind === 'power') {
        const n = Math.max(1, Math.round(len / 22)); let prev = null;
        for (let k = 0; k <= n; k++) {
          const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n, y = w.heightAt(x, z), c = w.cellAt(x, z);
          const top = new THREE.Vector3(x, y + (l.tier === 1 ? 11 : 7.4), z);
          if (!(c >= 0 && w.water[c] && k && k < n)) pylons.push([x, y, z, yaw, l.tier === 1 ? 1.48 : 1]);
          if (prev) for (const off of [-1.3, 1.3]) {   // two wires, sagging between pylons
            const dx = Math.cos(yaw) * off, dz = -Math.sin(yaw) * off, a = prev.clone().add(new THREE.Vector3(dx, 0, dz)), b = top.clone().add(new THREE.Vector3(dx, 0, dz));
            for (let q = 0; q < 4; q++) { const t0 = q / 4, t1 = (q + 1) / 4, s0 = 1.1 * 4 * t0 * (1 - t0), s1 = 1.1 * 4 * t1 * (1 - t1); wires.push(a.clone().lerp(b, t0).setY(a.y + (b.y - a.y) * t0 - s0), a.clone().lerp(b, t1).setY(a.y + (b.y - a.y) * t1 - s1)); }
          }
          prev = top;
        }
      } else if (under) pipes[l.kind].push([ax, az, bx, bz, len, yaw, (this.sim.lineLoad?.get(l.id) || 0) > 0.97, l.tier || 0]);
      if (l.kind === 'power' && (this.sim.lineLoad?.get(l.id) || 0) > 0.97) hotWires.push(l.id);
    }
    if (pylons.length) {
      const geo = mergeGeometries([coloredBox(0.5, 7.6, 0.5, 0, 3.8, 0, 0x8a8e94), coloredBox(3.4, 0.3, 0.3, 0, 7.2, 0, 0x8a8e94), coloredBox(1.6, 0.25, 0.25, 0, 5.6, 0, 0x8a8e94)]);
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), pylons.length), M = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      pylons.forEach(([x, y, z, yaw, scale], i) => m.setMatrixAt(i, M.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(Y, yaw), new THREE.Vector3(1,scale,1))));
      m.castShadow = true; g.add(m);
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wires), new THREE.LineBasicMaterial({ color: hotWires.length && under ? 0xd8402a : 0x2a2c30 })));   // overloaded lines show red underground
    }
    // pipes and drains lie on one flat level below the lowest ground, whatever the terrain above
    const uy = undergroundY(w);
    for (const kind of ['water', 'sewer']) for (const [ax, az, bx, bz, len, yaw, full, tier] of pipes[kind]) {
      const mat = new THREE.MeshBasicMaterial({ color: full ? 0xd8402a : ULINES[kind].color, depthTest: false, transparent: true, opacity: 0.92 });   // a run at capacity turns red
      const m = new THREE.Mesh(new THREE.BoxGeometry((kind === 'sewer' ? 1.8 : 1.2)*(tier ? 1.8 : 1), 0.8, len + 1), mat);
      m.position.set((ax + bx) / 2, uy + (kind === 'sewer' ? -1.4 : 0), (az + bz) / 2); m.rotation.y = yaw; m.renderOrder = 9; g.add(m);
      for (const [x, z] of [[ax, az], [bx, bz]]) { const j = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 2.2), mat); j.position.set(x, m.position.y, z); j.renderOrder = 9; g.add(j); }   // joints
    }
    this.ulGroup = g; this.scene.add(g);
  }

  // bus line routes, drawn above the roads while planning transit
  updateLines() {
    const show = this.overlay === 'transit' || this.uiTransit;
    const key = `${show}:${this.sim.lineInfoVersion}:${this.w.lineVersion}:${this.w.net.version}`;
    this.trainClock=(this.trainClock||0)+(this.sim.paused?0:this.lastTrainDt||0);
    for(const t of this.trains||[]) {let s=(this.trainClock*t.speed)%t.len;let k=0;while(k<t.points.length-2&&s>t.lengths[k])s-=t.lengths[k++];const a=t.points[k],b=t.points[k+1],f=s/(t.lengths[k]||1);t.mesh.position.copy(a).lerp(b,f);t.mesh.position.y+=1.15;t.mesh.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);}
    if (key === this.linesKey) return;
    this.linesKey = key;
    if (this.lineGroup) { this.lineGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); this.scene.remove(this.lineGroup); this.lineGroup = null; }
    this.trains=[];
    const net = this.w.net, g = new THREE.Group();
    this.w.lines.forEach((l, i) => {
      const info = this.sim.lineInfo?.get(l.id); if (!info?.ok) return;
      if(!show && (!l.mode || l.mode==='bus'||l.mode==='metro'))return;
      let pts = (info.track||[]).map(p=>new THREE.Vector3(p.x,this.w.heightAt(p.x,p.z)+(l.mode==='rail'?8:1.6),p.z));
      if(l.mode==='rail'&&pts.length) {
        let top=8;for(let j=1;j<pts.length;j++){const a=pts[j-1],b=pts[j],steps=Math.ceil(a.distanceTo(b)/4);for(let k=0;k<=steps;k++)top=Math.max(top,this.w.heightAt(a.x+(b.x-a.x)*k/steps,a.z+(b.z-a.z)*k/steps)+8);}
        pts.forEach(p=>p.y=top);
      }
      for (const seg of info.segs) {
        const e = net.edges.get(seg.edge); if (!e) continue;
        const n = Math.max(2, Math.ceil(Math.abs(seg.to - seg.from) / 3));
        for (let k = 0; k <= n; k++) { const s = seg.from + (seg.to - seg.from) * (k / n), p = net.sampleAt(e, s); pts.push(new THREE.Vector3(p.x, 1.6 + deckHeight(e, s) + i * 0.3, p.z)); }
      }
      if((l.mode==='rail'||l.mode==='metro')&&pts.length>1) {
        const lengths=pts.slice(1).map((p,k)=>p.distanceTo(pts[k]));
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,1.8,9),new THREE.MeshLambertMaterial({color:l.color,depthTest:l.mode!=='metro'}));mesh.position.copy(pts[0]);mesh.position.y+=1.15;g.add(mesh);
        this.trains.push({mesh,points:pts,lengths,len:lengths.reduce((a,b)=>a+b,0),speed:l.mode==='rail'?24:18});
        if(l.mode==='rail')for(let k=1;k<pts.length;k++) {
          const a=pts[k-1],b=pts[k],len=a.distanceTo(b),deck=new THREE.Mesh(new THREE.BoxGeometry(3.5,.5,len),new THREE.MeshLambertMaterial({color:0x777f89}));deck.position.copy(a).add(b).multiplyScalar(.5);deck.lookAt(b);g.add(deck);
          for(let d=0;d<len;d+=24){const p=a.clone().lerp(b,d/len),base=this.w.heightAt(p.x,p.z),h=p.y-base;const pier=new THREE.Mesh(new THREE.BoxGeometry(1.2,h,1.2),new THREE.MeshLambertMaterial({color:0x9ba1a3}));pier.position.set(p.x,base+h/2,p.z);g.add(pier);}
        }
      }
      if(l.mode==='tram')for(const side of [-.6,.6]) {
        const rail=pts.map((p,k)=>{const next=pts[Math.min(k+1,pts.length-1)],prev=pts[Math.max(0,k-1)],dx=next.x-prev.x,dz=next.z-prev.z,d=Math.hypot(dx,dz)||1;return new THREE.Vector3(p.x+dz/d*side,p.y-1.3,p.z-dx/d*side);});
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rail),new THREE.LineBasicMaterial({color:0xb7c5c9})));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: l.color, depthTest: false, transparent: true })));
      for (const id of l.stops) { const b = this.w.buildings.get(id); if (!b) continue; const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.4, 10), new THREE.MeshBasicMaterial({ color: l.color, depthTest: false, transparent: true })); m.position.set(b.cx, 3, b.cz); g.add(m); }
    });
    g.renderOrder = 8; this.lineGroup = g; this.scene.add(g);
  }

  // ---------------------------------------------------------------- frame
  setOverlay(o) { if (this.overlay === o) return; this.overlay = o; this._depK = null; this._covW = this._covS = null; this.w.markGround(0, 0, N, N); this.colorTraffic(); }
  setDistricts(on) { if (this.showDistricts === on) return; this.showDistricts = on; this.w.markGround(0, 0, N, N); }

  frame(dt) {
    this.time += dt; this.lastTrainDt=dt*Math.min(this.sim.speed,3);
    const w = this.w;
    if (this.terrainVer !== w.terrainVersion) this.refreshTerrain();
    this.gradeT = (this.gradeT || 0) + dt;
    if (w.dirty.grade && this.gradeT > 0.2) { const g = w.dirty.grade; w.dirty.grade = null; this.gradeT = 0; this.refreshGround(g[0], g[1], g[2], g[3]); }
    const liftState = [...w.net.edges.values()].filter(e=>bridgeOpen(e,this.hour())).map(e=>e.id).join(',');
    if(this.liftState !== liftState) { this.liftState=liftState; this.roadVer=-1; }
    if (this.roadVer !== w.net.version || this.roadEra !== this.sim.tech.style) this.buildRoads();
    if (this.flowVer !== this.sim.flowVersion && (this.overlay === 'traffic' || this.flowVer === -1)) this.colorTraffic();
    this.syncBuildings(); this.updateLod();
    this.updateBuildingTints(); this.updateRoute();
    if (this.treeSeason && this.treeSeason !== `${this.sim.weather.season}:${(this.w.hazards?.snow || 0) > 0.05}`) w.dirty.trees = true;
    if (this.regionArgs && this.regionSeason && this.regionSeason !== `${this.sim.weather.season}:${(this.w.hazards?.snow || 0) > 0.05}`) this.setRegion(...this.regionArgs);   // woods next door change with the seasons
    if (this.groundSeason !== this.season()) { this.groundSeason = this.season(); w.markGround(0, 0, N, N); }   // the season repaints the ground
    if (w.dirty.trees) { this.treeT = (this.treeT || 0) + dt; if (this.treeT > 0.3 || !this.treeMesh) { this.rebuildTrees(); w.dirty.trees = false; this.treeT = 0; } }
    const ov = this.overlay !== 'none' && this.overlay !== 'districts' && this.overlay !== 'traffic';
    if (ov) { const v = (this.sim.fieldVersion || 0) + ':' + this.sim.flowVersion; if (v !== this.overlayVer) { this.overlayVer = v; w.markGround(0, 0, N, N); } }
    if (w.dirty.ground) { const g = w.dirty.ground; w.dirty.ground = null; this.paintGround(g[0], g[1], g[2], g[3]); }
    this.syncExtras();
    for (const o of this.rotors.values()) o.userData.spin.rotation.z -= dt * (this.sim.paused ? 0 : 2.2 * this.sim.wind);
    this.waterU.uTime.value = this.time; this.updateBoats(dt);
    if (this.vehicleStyle !== this.sim.tech.style) { this.disposeVehicles(); this.initVehicles(); }
    this.updateVehicles(dt); this.updateFuture(dt); this.updateLines(); this.updateULines(); this.updateBridges(dt);
    this.updateParticles(dt);
    this.iconT += dt; if (this.iconT > 0.25) { this.iconT = 0; this.updateIcons(); }
    this.updateBooths(); this.updatePeople(dt); this.updateNeighbourTraffic(dt);
    // the underground view clears the surface clutter
    { const under = this.overlay === 'pipes'; for (const m of this.treeMeshes || []) m.visible = !under; if (this.people) this.people.visible = !under; }
    if (!this.photoTour?.playing) this.updateFollow(dt);
    this.photoTour?.beforeFrame(); this.updateCamera(); this.updateEvents(dt); this.updateWeather(dt); this.updateDayNight(dt);
    this.draw(); this.photoTour?.afterFrame();
  }
  draw() {
    if (!this.fx) { this.camera.layers.enableAll(); this.r.render(this.scene, this.camera); return; }
    if (this.fx.bloom) this.fx.bloom.strength = this.fx.glowBase + 0.7 * (this.night || 0);   // lit windows and neon glow after dark
    this.camera.layers.set(0); this.fx.composer.render();
    // signs float above the effects: drawn afterwards, never bloomed or dithered
    const ac = this.r.autoClear, bg = this.scene.background; this.r.autoClear = false; this.scene.background = null; this.camera.layers.set(1); this.r.setRenderTarget(null); this.r.clearDepth(); this.r.render(this.scene, this.camera); this.scene.background = bg; this.r.autoClear = ac; this.camera.layers.set(0);
  }
  // Optional post-processing: ordered (Bayer) dithering to a small palette for a retro look,
  // and a bloom "light" pass. Loaded only when switched on.
  async setEffects(dither, glow) {
    const key = `${!!dither}:${!!glow}`; if (key === this.fxKey) return; this.fxKey = key;
    if (!dither && !glow) { this.fx?.composer.dispose?.(); this.fx = null; return; }
    const [{ EffectComposer }, { RenderPass }, { ShaderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'), import('three/addons/postprocessing/ShaderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
    if (this.fxKey !== key) return;   // settings changed while loading
    const composer = new EffectComposer(this.r); composer.setPixelRatio(1 / this.pixel); composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(this.scene, this.camera));
    let bloom = null;
    if (glow) { bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / this.pixel, innerHeight / this.pixel), 0.3, 0.4, 0.86); composer.addPass(bloom); }
    composer.addPass(new OutputPass());
    if (dither) composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null }, levels: { value: 7 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float levels; varying vec2 vUv;
        float bayer(vec2 p){ int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4;
          int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return (float(m[i]) + 0.5) / 16.0 - 0.5; }
        void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = bayer(gl_FragCoord.xy) / levels;
          gl_FragColor = vec4(floor((c.rgb + d) * levels + 0.5) / levels, c.a); }`,
    }));
    this.fx = { composer, bloom, glowBase: 0.22 };
  }
}
Renderer.prototype.OVGOOD = { resources: true, pipes: true, elevation:true, transit: true, desireR: true, desireC: true, desireI: true, desireO: true, level: true, happiness: true, age: true, landvalue: true, access: true, power: true, water: true, garbage: true, fire: true, police: true, clinic: true, school: true, park: true, health: true, higher: true };
