// Organicity — boot, save/load and the frame loop.
import { World } from './world.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { Tools } from './tools.js';
import { UI } from './ui.js';
import { SAVE_KEY, makeSave, loadSave } from './save.js';
import { CityAudio } from './audio.js';
import { SCENARIOS, setupScenario } from './scenarios.js';
import { readShared } from './share.js';

const BOOT_KEY = 'organicity-boot';
const $ = (id) => document.getElementById(id);

function readSave() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

// opts: { mode: 'new' | 'load' | 'shared', seed?, sandbox?, scenario?, save? }
function boot(opts) {
  let world, sim;
  if (opts.mode === 'load' || opts.mode === 'shared') {
    try { ({ world, sim } = loadSave(opts.mode === 'shared' ? opts.save : readSave())); }
    catch (e) { alert(`Could not load the ${opts.mode === 'shared' ? 'shared' : 'saved'} city: ${e.message}\nStarting a new one instead.`); opts = { mode: 'new' }; }
  }
  if (!world) {
    const scen = !opts.sandbox && SCENARIOS[opts.scenario] ? opts.scenario : null;
    const seed = SCENARIOS[scen]?.seed ?? (Number.isFinite(opts.seed) ? opts.seed : (Math.random() * 1e6) | 0);
    world = new World(seed, opts.mapPreset || 'river'); world.newGame();
    sim = new Sim(world, { sandbox: opts.sandbox ? {} : null, scenario: scen, startYear: opts.startYear, eraPace: opts.eraPace });
    if (scen) setupScenario(world, sim, scen);
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
  const audio = new CityAudio(sim, rend);
  ui.tools = tools; ui.audio = audio; ui.applySettings();
  ui.toolChanged(); ui.hud();
  window.city = { world, sim, rend, tools, ui, audio };
  if (sim.sandbox) ui.toast(`Sandbox mode · seed ${world.seed}`, 'info');
  if (sim.scenario && SCENARIOS[sim.scenario]) ui.toast(`${SCENARIOS[sim.scenario].name}: ${SCENARIOS[sim.scenario].desc}`, 'info');

  let last = performance.now(), saveT = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    sim.update(dt);
    tools.update(dt);
    rend.frame(dt);
    ui.update(dt);
    audio.update(dt);
    saveT += dt;
    if (saveT > 120 && world.buildings.size) { saveT = 0; try { store(); } catch { /* quota exceeded — keep playing */ } }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function newOpts() {
  const raw = $('optSeed').value.trim();
  const seed = raw === '' ? NaN : /^\d+$/.test(raw) ? +raw : [...raw].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1e6;
  return { mode: 'new', seed, mapPreset: $('optMap').value, sandbox: $('optSandbox').checked, scenario: $('optScenario').value || null, startYear: +$('optEra').value, eraPace: +$('optPace').value };
}

$('optScenario').innerHTML = `<option value="">Free play</option>${Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}" title="${s.desc}">${s.name}</option>`).join('')}`;

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

let pending = null;
try { pending = JSON.parse(sessionStorage.getItem(BOOT_KEY) || 'null'); } catch { pending = null; }
sessionStorage.removeItem(BOOT_KEY);
if (location.hash.startsWith('#city=')) {
  const code = location.hash; history.replaceState(null, '', location.pathname + location.search);
  importCity(code);
} else if (pending && pending.mode) { $('intro').hidden = true; boot(pending); }
else {
  $('introLoad').hidden = !readSave();
  $('introGo').onclick = () => { $('intro').hidden = true; boot(newOpts()); };
  $('introLoad').onclick = () => { $('intro').hidden = true; boot({ mode: 'load' }); };
}
