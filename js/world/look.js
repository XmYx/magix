// look.js — materials and atmosphere: iridescent grid surfaces, nebula sky,
// stars, fireflies and the home beacon. All colours are linear (OutputPass converts).
import * as THREE from 'three';
import { ZONES } from './field.js';

export const FOG_COLOR = new THREE.Color(0x0b0620);

export function sharedUniforms() {
  return {
    uTime: { value: 0 },
    uFogColor: { value: FOG_COLOR },
    uFogDensity: { value: 0.0065 },
  };
}

const surfaceVert = /* glsl */`
  varying vec3 vLocal; varying vec3 vNL; varying vec3 vNW; varying vec3 vW;
  void main() {
    vLocal = position; vNL = normal;
    vNW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const surfaceFrag = /* glsl */`
  uniform vec3 uColor; uniform vec3 uGlow; uniform float uTime; uniform float uCell;
  uniform vec3 uFogColor; uniform float uFogDensity;
  varying vec3 vLocal; varying vec3 vNL; varying vec3 vNW; varying vec3 vW;
  float grid(vec2 p) {
    vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), 1e-4);
    return 1.0 - clamp(min(g.x, g.y) * 1.2, 0.0, 1.0);
  }
  void main() {
    vec3 N = normalize(vNW);
    vec3 V = normalize(cameraPosition - vW);
    vec3 w = pow(abs(normalize(vNL)), vec3(4.0)); w /= (w.x + w.y + w.z);
    vec3 p = vLocal / uCell;
    float line = grid(p.yz) * w.x + grid(p.xz) * w.y + grid(p.xy) * w.z;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float diff = 0.55 + 0.45 * dot(N, normalize(vec3(0.4, 0.8, 0.3)));
    vec3 irid = 0.5 + 0.5 * cos(6.2831 * (fres * 0.8 + vec3(0.0, 0.33, 0.67) + uTime * 0.02));
    float pulse = 0.75 + 0.25 * sin(uTime * 1.3 - length(vW) * 0.08);
    vec3 col = uColor * diff + irid * fres * 0.55 + uGlow * line * pulse;
    float dist = length(cameraPosition - vW);
    float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  }`;

export function surfaceMaterials(shared) {
  const mats = {};
  for (const [key, z] of Object.entries(ZONES)) {
    mats[key] = new THREE.ShaderMaterial({
      vertexShader: surfaceVert,
      fragmentShader: surfaceFrag,
      uniforms: {
        ...shared,
        uColor: { value: new THREE.Color(z.color).multiplyScalar(key === 'hub' ? 0.16 : 0.26) },
        uGlow: { value: new THREE.Color(z.glow).multiplyScalar(key === 'hub' ? 0.8 : 1.15) },
        uCell: { value: 1.5 },
      },
    });
  }
  return mats;
}

export function makeSky(shared) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTime: shared.uTime },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float n1 = fbm(d * 2.2 + vec3(0.0, uTime * 0.004, 0.0));
        float n2 = fbm(d * 3.1 + 7.3);
        vec3 neb = vec3(0.30, 0.10, 0.75) * smoothstep(0.45, 0.85, n1)
                 + vec3(0.03, 0.40, 0.55) * smoothstep(0.5, 0.9, n2) * 0.8
                 + vec3(0.85, 0.25, 0.50) * smoothstep(0.55, 0.95, n1 * n2 * 1.7) * 0.6;
        gl_FragColor = vec4(vec3(0.010, 0.005, 0.030) + neb * 0.28, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  return sky;
}

export function makeStars(rand) {
  const n = 2500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([s * Math.cos(th) * 850, u * 850, s * Math.sin(th) * 850], i * 3);
    const c = new THREE.Color().setHSL(0.6 + rand() * 0.35, 0.6, 0.6 + rand() * 0.4).multiplyScalar(1 + rand() * 1.5);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false,
  }));
  stars.renderOrder = -1;
  stars.frustumCulled = false;
  return stars;
}

export function makeFireflies(bodies, rand, shared) {
  const n = 700, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), seed = new Float32Array(n);
  const p = new THREE.Vector3(), nrm = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const b = bodies[Math.floor(rand() * bodies.length)];
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    b.surfacePoint(dir.set(s * Math.cos(th), u, s * Math.sin(th)), p);
    b.normal(p, nrm);
    p.addScaledVector(nrm, 0.6 + rand() * 3.5);
    pos.set([p.x, p.y, p.z], i * 3);
    const c = new THREE.Color(ZONES[b.zone].glow);
    col.set([c.r, c.g, c.b], i * 3);
    seed[i] = rand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: shared.uTime, uScale: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSeed; uniform float uTime; uniform float uScale;
      varying vec3 vC; varying float vA;
      void main() {
        float t = uTime + aSeed * 40.0;
        vec3 p = position + vec3(sin(t * 0.31), sin(t * 0.23 + 2.0), cos(t * 0.27)) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (5.0 + 3.0 * sin(t * 2.1)) * uScale * (22.0 / max(-mv.z, 0.1));
        gl_Position = projectionMatrix * mv;
        vC = aColor; vA = 0.55 + 0.45 * sin(t * 1.7);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vC * 1.6, smoothstep(0.5, 0.0, d) * vA);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

/** a tall light pillar rising from the hub, visible from anywhere */
export function makeBeacon(hub) {
  const g = new THREE.Group();
  const h = 140;
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, h, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(ZONES.hub.glow).multiplyScalar(1.8), fog: false }));
  const halo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, h, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(ZONES.hub.glow).multiplyScalar(0.4), transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
  g.add(core, halo);
  g.position.set(0, hub.params.hy + 16 + h / 2, 0); // floats above the hub so it never blocks the view
  return g;
}
