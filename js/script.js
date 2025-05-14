// js/script.js – shared site logic

// ░░░ Helper: run only when selector exists ░░░
const $ = sel => document.querySelector(sel);

// ░░░ DOM ready ░░░
document.addEventListener('DOMContentLoaded', () => {
  /* ── Mobile menu toggle ───────────────────────────── */
  const menuToggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => mobileMenu.classList.toggle('open'));
    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => mobileMenu.classList.remove('open')));
  }

  /* ── Reveal‑on‑scroll ─────────────────────────────── */
  const faders = document.querySelectorAll('.fade-in');
  if (faders.length) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    faders.forEach(el => io.observe(el));
  }

  /* ── Parallax header (resume) ─────────────────────── */
  const header = $('#introHeader');
  if (header) {
    const parallax = () => { header.style.transform = `translateY(${window.scrollY * 0.3}px)`; };
    window.addEventListener('scroll', parallax, { passive: true });
    parallax();
  }

  /* ── Theme toggle (all pages) ─────────────────────── */
  const themeToggle = $('#themeToggle');
  const root = document.documentElement;
  const applyTheme = isDark => { isDark ? root.classList.add('dark') : root.classList.remove('dark'); };
  if (themeToggle) {
    const init = () => applyTheme(localStorage.theme === 'dark' || (!localStorage.theme && window.matchMedia('(prefers-color-scheme: dark)').matches));
    init();
    themeToggle.checked = root.classList.contains('dark');
    themeToggle.addEventListener('change', () => { applyTheme(themeToggle.checked); localStorage.theme = themeToggle.checked ? 'dark' : 'light'; });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', init);
  }

  /* ── PDF download (resume) ────────────────────────── */
  $('#pdfBtn')?.addEventListener('click', () => window.print());

  /* ── Collapsing résumé header on scroll ───────────── */
  if (header) {
    window.addEventListener('scroll', () => { header.classList.toggle('collapsed', window.scrollY > 100); });
  }

  /* ── Grid/List toggle (resume) ────────────────────── */
  const layoutToggle = $('#layoutToggle');
  if (layoutToggle) {
    const gridIcon = $('#gridIcon');
    const listIcon = $('#listIcon');
    layoutToggle.addEventListener('click', () => {
      document.body.classList.toggle('list-view');
      gridIcon.classList.toggle('hidden');
      listIcon.classList.toggle('hidden');
    });
  }

  /* ── Auto‑populate gallery ────────────────────────── */
  const galleryGrid = $('#galleryGrid');
  if (galleryGrid) loadGallery(galleryGrid);
});

// ╭─────────────────────────────────────────────────────────╮
// │  Load images from /photos via the GitHub REST API       │
// ╰─────────────────────────────────────────────────────────╯
async function loadGallery(container) {
  // ✏️  EDIT these two lines to match your repo (or infer from location)
  const owner = 'XmYx';
  const repo = 'magix-photos';
  const path = 'photos';

  try {
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const res = await fetch(api);
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const files = await res.json();
    const images = files.filter(f => f.type === 'file' && /\.(jpe?g|png|gif|webp)$/i.test(f.name));
    images.forEach(({ download_url, name }) => {
      const img = document.createElement('img');
      img.src = download_url;
      img.alt = name;
      img.loading = 'lazy';
      img.className = 'w-full h-auto object-cover rounded-lg shadow hover:shadow-lg transition-shadow';
      container.appendChild(img);
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="col-span-full text-center py-10 text-red-600">Unable to load gallery.</p>';
  }
}