// browse.js — renders Browse mode from data/works.json

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const repoUrl = e => e.url || `https://github.com/XmYx/${e.repo}`;
const year = d => (d ? d.slice(0, 4) : '');

export function renderBrowse(data, { reduced = false } = {}) {
  const { person, links, tags } = data;

  /* hero links */
  $('heroLinks').innerHTML = [
    [links.github, 'GitHub'],
    [links.imdb, 'IMDb'],
    [links.linkedin, 'LinkedIn'],
    ...links.instagram.map(i => [i.href, `IG ${i.handle}`]),
    [`mailto:${person.email}`, person.email],
  ].map(([href, label]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`).join('');

  /* featured */
  $('featuredGrid').innerHTML = data.featured.map((f, i) => `
    <a class="card featured tilt" href="${esc(repoUrl(f))}" target="_blank" rel="noopener">
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
      <h3>${esc(f.title)}</h3>
      <p>${esc(f.blurb)}</p>
      <div class="meta">
        ${f.stars ? `<span class="stars">★ ${f.stars}</span>` : ''}
        ${f.language ? `<span>${esc(f.language)}</span>` : ''}
        ${f.pushed ? `<span>updated ${year(f.pushed)}</span>` : ''}
      </div>
      <div class="meta">${f.tags.map(t => `<span class="tag">${esc(tags[t] || t)}</span>`).join('')}</div>
    </a>`).join('');

  /* archive + filters */
  const usedTags = [...new Set(data.archive.flatMap(a => a.tags))];
  let active = 'all', query = '';
  $('archiveFilters').innerHTML =
    ['all', ...usedTags].map(t =>
      `<button class="chip" type="button" data-tag="${esc(t)}" aria-pressed="${t === 'all'}">${esc(t === 'all' ? 'All' : tags[t] || t)}</button>`).join('') +
    `<input class="search" type="search" placeholder="Search…" aria-label="Search the archive" />`;
  const drawArchive = () => {
    const q = query.toLowerCase();
    const items = data.archive.filter(a =>
      (active === 'all' || a.tags.includes(active)) &&
      (!q || `${a.repo} ${a.blurb || ''} ${a.description || ''}`.toLowerCase().includes(q)));
    $('archiveList').innerHTML = items.length
      ? items.map(a => `
        <a class="archive-item" href="${esc(repoUrl(a))}" target="_blank" rel="noopener">
          <b>${esc(a.repo)}</b>
          ${a.blurb || a.description ? `<small>${esc(a.blurb || a.description)}</small>` : ''}
          <small>${[a.language, year(a.pushed), a.stars ? `★ ${a.stars}` : ''].filter(Boolean).map(esc).join(' · ')}</small>
        </a>`).join('')
      : `<p class="empty">Nothing matches that — yet.</p>`;
  };
  $('archiveFilters').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    active = b.dataset.tag;
    $('archiveFilters').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === b));
    drawArchive();
  });
  $('archiveFilters').querySelector('.search').addEventListener('input', e => { query = e.target.value; drawArchive(); });
  drawArchive();

  /* film */
  $('creditList').innerHTML = data.film.credits.map(c => `
    <li>
      <span class="yr">${esc(c.years)}</span>
      <span><span class="t">${esc(c.title)}</span><br /><span class="r">${esc(c.role)} · ${esc(c.kind)}</span></span>
      <span class="n">${esc(c.note || '')}</span>
    </li>`).join('');
  $('filmFoot').innerHTML =
    `Also on ${data.film.other.map(esc).join(', ')}. ` +
    `<a href="${esc(data.film.imdb)}" target="_blank" rel="noopener">Full filmography on IMDb →</a>`;

  /* lab */
  $('labGrid').innerHTML = data.lab.map((l, i) => `
    <a class="lab-item" href="${esc(l.href)}" style="--h:${(i * 47 + 250) % 360}">
      <b>${esc(l.label)}</b>${l.blurb ? `<small>${esc(l.blurb)}</small>` : ''}
    </a>`).join('');

  /* pages */
  $('pagesGrid').innerHTML = data.pages.map(p => `
    <a class="card tilt" href="${esc(p.href)}"><h3>${esc(p.label)}</h3><p>${esc(p.blurb)}</p></a>`).join('');

  /* book */
  $('bookLink').href = links.book;
  $('paypalId').value = links.paypalButtonId;
  $('year').textContent = new Date().getFullYear();

  wireReveal(reduced);
  if (!reduced && matchMedia('(pointer: fine)').matches) { wireTilt(); wireSparkles(); }
}

function wireReveal(reduced) {
  const els = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.08 });
  els.forEach(e => io.observe(e));
}

function wireTilt() {
  document.addEventListener('pointermove', e => {
    const card = e.target.closest?.('.tilt');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--ry', `${(x - 0.5) * 6}deg`);
    card.style.setProperty('--rx', `${(0.5 - y) * 6}deg`);
    card.style.setProperty('--mx', `${x * 100}%`);
    card.style.setProperty('--my', `${y * 100}%`);
  }, { passive: true });
  document.addEventListener('pointerout', e => {
    const card = e.target.closest?.('.tilt');
    if (card && !card.contains(e.relatedTarget)) { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); }
  });
}

function wireSparkles() {
  const hero = document.querySelector('.hero');
  let last = 0;
  hero.addEventListener('pointermove', e => {
    if (e.timeStamp - last < 35) return;
    last = e.timeStamp;
    const s = document.createElement('span');
    s.className = 'spark';
    const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 30;
    s.style.left = `${e.clientX - 3}px`;
    s.style.top = `${e.clientY - 3}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    document.body.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }, { passive: true });
}
