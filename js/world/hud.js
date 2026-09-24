// hud.js — DOM overlay for the world: crosshair, proximity card, home arrow, menu.
import { ZONES } from './field.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Hud {
  constructor(host, { onPlay, onExit, onReroll, onSettings, settings }) {
    this.el = document.createElement('div');
    this.el.className = 'w-hud';
    this.el.innerHTML = `
      <div class="w-top">
        <div class="w-title">magix world<small>seed <span data-seed></span></small></div>
        <button class="btn small" type="button" data-exit>Classic view</button>
      </div>
      <div class="w-cross"></div>
      <div class="w-card" role="status" aria-live="polite"><div class="k"></div><h3></h3><p></p><div class="go"></div></div>
      <div class="w-home" aria-hidden="true"><i></i><span></span></div>
      <div class="w-hint"><kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>Shift</kbd> run · <kbd>E</kbd> open · <kbd>H</kbd> home · <kbd>Esc</kbd> menu</div>`;

    this.menu = document.createElement('div');
    this.menu.className = 'w-menu';
    this.menu.innerHTML = `
      <div class="w-panel" role="dialog" aria-modal="true" aria-labelledby="wMenuTitle">
        <h2 id="wMenuTitle"></h2>
        <p data-sub></p>
        <button class="btn primary" type="button" data-play></button>
        <button class="btn" type="button" data-reroll>New world ✦</button>
        <button class="btn" type="button" data-exit>Classic view</button>
        <label>Mouse sensitivity <input type="range" min="0.4" max="3" step="0.1" data-sens /></label>
        <label>Invert mouse Y <input type="checkbox" data-invert /></label>
      </div>`;
    host.append(this.el, this.menu);

    const q = s => this.menu.querySelector(s);
    q('[data-sens]').value = settings.sens;
    q('[data-invert]').checked = settings.invert;
    q('[data-play]').addEventListener('click', onPlay);
    q('[data-reroll]').addEventListener('click', onReroll);
    this.menu.querySelectorAll('[data-exit]').forEach(b => b.addEventListener('click', onExit));
    this.el.querySelector('[data-exit]').addEventListener('click', onExit);
    q('[data-sens]').addEventListener('input', e => onSettings({ sens: Number(e.target.value) }));
    q('[data-invert]').addEventListener('change', e => onSettings({ invert: e.target.checked }));

    this.card = this.el.querySelector('.w-card');
    this.cross = this.el.querySelector('.w-cross');
    this.arrow = this.el.querySelector('.w-home i');
    this.dist = this.el.querySelector('.w-home span');
    this.current = undefined;
  }

  showMenu(mode, note) {
    if (!mode) { this.menu.hidden = true; return; }
    const start = mode === 'start';
    this.menu.hidden = false;
    this.menu.querySelector('h2').textContent = start ? 'magix world' : 'Paused';
    this.menu.querySelector('[data-sub]').textContent = note || (start
      ? 'A small universe of works. Walk off any edge — gravity follows the surface.'
      : 'Take a breath. The world will wait.');
    const play = this.menu.querySelector('[data-play]');
    play.textContent = start ? 'Start walking' : 'Resume';
    play.focus();
  }

  setSeed(seed) { this.el.querySelector('[data-seed]').textContent = seed; }

  setCard(ex) {
    if (ex === this.current) return;
    this.current = ex;
    this.cross.classList.toggle('hot', !!ex?.item.href);
    if (!ex) { this.card.classList.remove('show'); return; }
    const z = ZONES[ex.zone];
    this.card.style.setProperty('--zone', `#${z.glow.toString(16).padStart(6, '0')}`);
    this.card.querySelector('.k').textContent = z.label;
    this.card.querySelector('h3').textContent = ex.item.title;
    this.card.querySelector('p').textContent = ex.item.blurb || '';
    this.card.querySelector('.go').innerHTML = [
      ex.item.meta ? esc(ex.item.meta) : '',
      ex.item.href ? 'Press <kbd>E</kbd> or click to open ↗' : '',
    ].filter(Boolean).join(' · ');
    this.card.classList.add('show');
  }

  setHome(angle, meters) {
    this.arrow.style.transform = `rotate(${angle}rad)`;
    this.dist.textContent = meters < 4 ? 'home' : `${Math.round(meters)} m`;
  }

  dispose() { this.el.remove(); this.menu.remove(); }
}
