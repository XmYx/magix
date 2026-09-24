// world.js — the first-person, gravity-bending portfolio world.
// createWorld(host, data, { onExit }) → { dispose }
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { generateWorld, mulberry32 } from './field.js';
import { Player } from './player.js';
import { FOG_COLOR, sharedUniforms, surfaceMaterials, makeSky, makeStars, makeFireflies, makeBeacon } from './look.js';
import { buildExhibits } from './exhibits.js';
import { Hud } from './hud.js';

const STEP = 1 / 120;
const DEFAULT_SEED = 1111;
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

function disposeTree(root, keep) {
  root.traverse(o => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (keep.has(m)) continue;
      m.map?.dispose();
      m.dispose();
    }
  });
}

export async function createWorld(host, data, { onExit }) {
  const ac = new AbortController();
  const signal = ac.signal;
  const params = new URLSearchParams(location.search);
  try { await document.fonts?.load('600 64px Fraunces'); } catch { /* labels fall back to Georgia */ }

  /* renderer + post */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(host.clientWidth, host.clientHeight);
  const canvas = renderer.domElement;
  host.prepend(canvas);

  const scene = new THREE.Scene();
  scene.background = FOG_COLOR.clone();
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0065);
  const camera = new THREE.PerspectiveCamera(75, host.clientWidth / host.clientHeight, 0.05, 2000);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(host.clientWidth, host.clientHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), 0.7, 0.5, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* shared look */
  const shared = sharedUniforms();
  const mats = surfaceMaterials(shared);
  const keep = new Set(Object.values(mats));
  const sky = makeSky(shared);
  const stars = makeStars(mulberry32(7));
  scene.add(sky, stars);

  /* settings + HUD */
  const settings = {
    sens: Number(store.get('magix.sens')) || 1,
    invert: store.get('magix.invertY') === '1',
  };
  let playing = false, dragLook = false;
  const hud = new Hud(host, {
    settings,
    onPlay: () => play(),
    onExit: () => onExit(),
    onReroll: () => { build(Math.floor(Math.random() * 1e6)); play(); },
    onSettings: s => {
      Object.assign(settings, s);
      store.set('magix.sens', String(settings.sens));
      store.set('magix.invertY', settings.invert ? '1' : '0');
    },
  });

  /* world build (re-runnable for "New world") */
  let world, player, exhibits, worldGroup;
  function build(seed) {
    if (worldGroup) { scene.remove(worldGroup); disposeTree(worldGroup, keep); }
    world = generateWorld(seed);
    worldGroup = new THREE.Group();
    for (const b of world.bodies) {
      const mesh = new THREE.Mesh(b.geometry(), mats[b.zone]);
      mesh.position.copy(b.pos);
      mesh.quaternion.copy(b.quat);
      worldGroup.add(mesh);
    }
    exhibits = buildExhibits(world, data, world.rand);
    worldGroup.add(exhibits.group, makeFireflies(world.bodies, world.rand, shared), makeBeacon(world.hub));
    scene.add(worldGroup);
    if (player) { player.field = world.field; player.spawn = world.spawn; player.reset(); }
    else player = new Player(world.field, world.spawn);
    hud.setSeed(seed);
  }
  build(Number(params.get('seed')) || DEFAULT_SEED);

  /* input */
  const keys = new Set();
  const input = { x: 0, z: 0, sprint: false, jump: false };
  let current = null;

  const interact = () => {
    if (current?.item.href) window.open(current.item.href, '_blank', 'noopener');
  };
  const pause = note => {
    playing = false;
    keys.clear();
    hud.showMenu('pause', note);
  };
  const startDragLook = () => {
    dragLook = true;
    playing = true;
    hud.showMenu(null);
  };
  function play() {
    if (dragLook || !canvas.requestPointerLock) return startDragLook();
    const r = canvas.requestPointerLock();
    r?.catch?.(() => hud.showMenu('pause', 'Click once more to grab the mouse.'));
  }

  addEventListener('keydown', e => {
    if (!playing) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) input.jump = true; }
    if (e.code === 'KeyE' && !e.repeat) interact();
    if (e.code === 'KeyH' && !e.repeat) player.reset();
    if (e.code === 'Escape' && dragLook) pause();
    keys.add(e.code);
  }, { signal });
  addEventListener('keyup', e => keys.delete(e.code), { signal });
  addEventListener('blur', () => keys.clear(), { signal });
  document.addEventListener('mousemove', e => {
    if (!playing) return;
    if (document.pointerLockElement !== canvas && !(dragLook && e.buttons)) return;
    const k = 0.0022 * settings.sens;
    player.look(e.movementX * k, e.movementY * k * (settings.invert ? -1 : 1));
  }, { signal });
  canvas.addEventListener('click', () => {
    if (playing && document.pointerLockElement === canvas) interact();
  }, { signal });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) { playing = true; hud.showMenu(null); }
    else if (!dragLook) pause();
  }, { signal });
  document.addEventListener('pointerlockerror', () => {
    hud.showMenu('pause', 'Click once more to grab the mouse.');
  }, { signal });

  /* resize */
  const ro = new ResizeObserver(() => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(host);

  /* loop */
  const camQ = new THREE.Quaternion(), pitchQ = new THREE.Quaternion(), invQ = new THREE.Quaternion();
  const up = new THREE.Vector3(), toHome = new THREE.Vector3();
  const t0 = performance.now();
  let last = t0, acc = 0, raf = 0, ema = 16, lastAdapt = t0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    shared.uTime.value = t;

    if (playing) {
      input.x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      input.z = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      acc += dt;
      while (acc >= STEP) { player.step(STEP, input); acc -= STEP; }
    }

    /* camera = interpolated body frame + pitch + a whisper of head bob */
    const alpha = playing ? acc / STEP : 1;
    camQ.slerpQuaternions(player.prevFrame, player.frame, alpha);
    up.copy(Y).applyQuaternion(camQ);
    const bob = player.grounded && player.speed > 0.5 ? Math.sin(player.walked * 1.9) * 0.045 : 0;
    camera.position.lerpVectors(player.prevPos, player.pos, alpha).addScaledVector(up, player.eye + bob);
    camera.quaternion.copy(camQ).multiply(pitchQ.setFromAxisAngle(X, player.pitch));
    const fovTarget = 75 + (input.sprint && playing ? Math.min(1, player.speed / 11) * 8 : 0);
    if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    }
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);

    /* exhibits + HUD */
    current = exhibits.update(t, player.pos);
    hud.setCard(current);
    toHome.copy(world.spawn.pos).sub(camera.position).applyQuaternion(invQ.copy(camera.quaternion).invert());
    hud.setHome(Math.atan2(toHome.x, toHome.z > 0 ? -1e-3 - Math.abs(toHome.y) : toHome.y),
      player.pos.distanceTo(world.spawn.pos));

    composer.render(dt);

    /* adaptive quality: drop resolution, then bloom, if frames run long */
    ema = ema * 0.95 + dt * 1000 * 0.05;
    if (now - lastAdapt > 2000) {
      lastAdapt = now;
      if (ema > 24 && pixelRatio > 0.75) {
        pixelRatio -= 0.25;
        renderer.setPixelRatio(pixelRatio);
        composer.setPixelRatio(pixelRatio);
      } else if (ema > 24 && bloom.enabled) {
        bloom.enabled = false;
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }, { signal });

  hud.showMenu('start');
  raf = requestAnimationFrame(frame);

  const api = {
    dispose() {
      cancelAnimationFrame(raf);
      ac.abort();
      ro.disconnect();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      disposeTree(scene, new Set());
      composer.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss();
      hud.dispose();
      canvas.remove();
      if (window.__magixWorld === api) delete window.__magixWorld;
    },
  };
  if (params.has('debug')) {
    // inspection hook for testing without pointer lock: ?debug
    Object.defineProperties(api, {
      player: { get: () => player },
      world: { get: () => world },
      exhibits: { get: () => exhibits },
    });
    Object.assign(api, { input, camera, start: startDragLook });
    window.__magixWorld = api;
  }
  return api;
}
