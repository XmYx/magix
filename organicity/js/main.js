// Organicity — boot, save/load and the frame loop.
import { World } from './world.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { Tools } from './tools.js';
import { UI } from './ui.js';
import { SAVE_KEY, makeSave, loadSave } from './save.js';

const BOOT_KEY = 'organicity-boot';
const $ = (id) => document.getElementById(id);

function readSave() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

// opts: { mode: 'new' | 'load', seed?, sandbox? }
function boot(opts) {
  let world, sim;
  if (opts.mode === 'load') {
    try { ({ world, sim } = loadSave(readSave())); }
    catch (e) { alert(`Could not load the saved city: ${e.message}\nStarting a new one instead.`); opts = { mode: 'new' }; }
  }
  if (!world) {
    const seed = Number.isFinite(opts.seed) ? opts.seed : (Math.random() * 1e6) | 0;
    world = new World(seed); world.newGame();
    sim = new Sim(world, { sandbox: opts.sandbox ? {} : null, scenario: opts.sandbox ? null : opts.scenario, startYear: opts.startYear, eraPace: opts.eraPace });
  }
  const rend = new Renderer($('view'), world, sim);
  const store = () => localStorage.setItem(SAVE_KEY, JSON.stringify(makeSave(world, sim)));
  const ui = new UI(world, sim, rend, {
    save() {
      try { store(); ui.toast('City saved in this browser.', 'good'); } catch (e) { ui.toast('Could not save: ' + e.message, 'bad'); }
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
  ui.tools = tools;
  ui.toolChanged(); ui.hud();
  window.city = { world, sim, rend, tools, ui };
  if (sim.sandbox) ui.toast(`Sandbox mode · seed ${world.seed}`, 'info');

  let last = performance.now(), saveT = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    sim.update(dt);
    tools.update(dt);
    rend.frame(dt);
    ui.update(dt);
    saveT += dt;
    if (saveT > 120 && world.buildings.size) { saveT = 0; try { store(); } catch { /* quota exceeded — keep playing */ } }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function newOpts() {
  const raw = $('optSeed').value.trim();
  const seed = raw === '' ? NaN : /^\d+$/.test(raw) ? +raw : [...raw].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1e6;
  return { mode: 'new', seed, sandbox: $('optSandbox').checked, scenario: $('optScenario').value || null, startYear: +$('optEra').value, eraPace: +$('optPace').value };
}

let pending = null;
try { pending = JSON.parse(sessionStorage.getItem(BOOT_KEY) || 'null'); } catch { pending = null; }
sessionStorage.removeItem(BOOT_KEY);
if (pending && pending.mode) { $('intro').hidden = true; boot(pending); }
else {
  $('introLoad').hidden = !readSave();
  $('introGo').onclick = () => { $('intro').hidden = true; boot(newOpts()); };
  $('introLoad').onclick = () => { $('intro').hidden = true; boot({ mode: 'load' }); };
}
