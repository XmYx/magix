// app.js — boots the home page: theme, aurora, Browse render, portal and the world.
import { renderBrowse } from './browse.js';
import { startAurora } from './aurora.js';

const MODE_KEY = 'magix.mode';
const THEME_KEY = 'magix.theme';
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const root = document.documentElement;
const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const worldBlocker = (() => {
  if (!matchMedia('(pointer: fine)').matches) return 'The world needs a mouse and keyboard.';
  try { if (!document.createElement('canvas').getContext('webgl2')) return 'The world needs WebGL2.'; }
  catch { return 'The world needs WebGL2.'; }
  return null;
})();

/* ── theme ─────────────────────────────────────────── */
const savedTheme = store.get(THEME_KEY);
if (savedTheme) root.dataset.theme = savedTheme;
const isDark = () => root.dataset.theme
  ? root.dataset.theme === 'dark'
  : matchMedia('(prefers-color-scheme: dark)').matches;

const aurora = startAurora($('aurora'), { reduced });

$('themeBtn').addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  store.set(THEME_KEY, root.dataset.theme);
  aurora.refresh();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => aurora.refresh());

/* ── portal ────────────────────────────────────────── */
const portal = $('portal');
const showPortal = () => { portal.classList.remove('hidden'); $('choiceWorld').focus(); };
const hidePortal = () => portal.classList.add('hidden');

$('choiceBrowse').addEventListener('click', () => {
  if ($('rememberChoice').checked) store.set(MODE_KEY, 'browse');
  hidePortal();
});
$('choiceWorld').addEventListener('click', () => {
  if ($('rememberChoice').checked) store.set(MODE_KEY, 'world');
  enterWorld();
});
portal.addEventListener('keydown', e => { if (e.key === 'Escape') hidePortal(); });

/* ── world ─────────────────────────────────────────── */
let data = null, world = null, loading = false;

async function enterWorld() {
  if (world || loading || worldBlocker || !data) return;
  loading = true;
  hidePortal();
  aurora.pause();
  document.body.classList.add('in-world');
  const host = document.createElement('div');
  host.id = 'world';
  host.innerHTML = '<div class="w-loading">Summoning the world…</div>';
  document.body.appendChild(host);
  if (location.hash !== '#world') history.pushState({ world: true }, '', '#world');

  try {
    const { createWorld } = await import('../world/world.js');
    world = await createWorld(host, data, { onExit: () => exitWorld() });
    host.querySelector('.w-loading')?.remove();
  } catch (err) {
    console.error(err);
    host.innerHTML = `<div class="w-menu"><div class="w-panel"><h2>The world didn't load</h2>
      <p>${String(err?.message || err).replace(/</g, '&lt;')}</p>
      <button class="btn primary" type="button">Back to Browse</button></div></div>`;
    host.querySelector('button').addEventListener('click', () => leaveWorldShell());
  } finally {
    loading = false;
  }
}

function leaveWorldShell() {
  $('world')?.remove();
  document.body.classList.remove('in-world');
  aurora.resume();
  if (location.hash === '#world') history.replaceState(null, '', location.pathname + location.search);
}

function exitWorld() {
  if (!world) return;
  world.dispose();
  world = null;
  store.set(MODE_KEY, 'browse');
  leaveWorldShell();
}

addEventListener('popstate', () => {
  if (location.hash === '#world') enterWorld();
  else if (world) exitWorld();
});

for (const id of ['enterWorldHeader', 'enterWorldHero']) {
  const b = $(id);
  if (worldBlocker) { b.hidden = true; continue; }
  b.addEventListener('click', () => { store.set(MODE_KEY, 'world'); enterWorld(); });
}
if (worldBlocker) {
  $('choiceWorld').disabled = true;
  $('choiceWorld').querySelector('span').textContent = worldBlocker;
}

/* ── boot ──────────────────────────────────────────── */
(async () => {
  try {
    data = await (await fetch('data/works.json')).json();
  } catch (err) {
    console.error('works.json failed to load', err);
    return;
  }
  renderBrowse(data, { reduced });
  // content just changed height, so re-apply any section anchor
  if (location.hash.length > 1 && location.hash !== '#world') {
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' });
  }

  const params = new URLSearchParams(location.search);
  if (location.hash === '#world') return enterWorld();
  // a section link (#works, #film…) or ?mode=browse always lands in Browse
  if (params.get('mode') === 'browse' || location.hash || worldBlocker || reduced) return;
  const pref = store.get(MODE_KEY);
  if (pref === 'world') enterWorld();
  else if (pref !== 'browse') showPortal();
})();
