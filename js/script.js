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
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('show');
          io.unobserve(e.target);
        }
      });
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

  /* ── 🌟 Sparkle‑cursor effect (all pages) ─────────── */
  const sparkleToggle = $('#sparkleToggle'); // add a <input type="checkbox" id="sparkleToggle"> somewhere in your markup
  let sparklesEnabled = false;
  let sparkleLayer;

  // Inject the sparkle CSS only once
  const ensureSparkleStyles = () => {
    if (document.getElementById('sparkleStyles')) return;
    const style = document.createElement('style');
    style.id = 'sparkleStyles';
    style.textContent = `
      .sparkle {
        position: absolute;
        width: 6px;
        height: 6px;
        background: radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0.8) 40%, rgba(255,255,255,0) 80%);
        border-radius: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        animation: sparkle-fade 700ms linear forwards;
      }
      @keyframes sparkle-fade {
        0%   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%,-50%) scale(0); }
      }
    `;
    document.head.appendChild(style);
  };

  const addSparkle = e => {
    if (!sparklesEnabled) return;
    const s = document.createElement('span');
    s.className = 'sparkle';
    s.style.left = `${e.clientX}px`;
    s.style.top = `${e.clientY}px`;
    sparkleLayer.appendChild(s);
    setTimeout(() => s.remove(), 700);
  };

  const enableSparkles = () => {
    if (sparklesEnabled) return;
    sparklesEnabled = true;
    ensureSparkleStyles();
    sparkleLayer = document.createElement('div');
    sparkleLayer.id = 'sparkleLayer';
    sparkleLayer.style.position = 'fixed';
    sparkleLayer.style.inset = '0';
    sparkleLayer.style.pointerEvents = 'none';
    sparkleLayer.style.zIndex = '9999';
    document.body.appendChild(sparkleLayer);
    window.addEventListener('mousemove', addSparkle, { passive: true });
  };

  const disableSparkles = () => {
    if (!sparklesEnabled) return;
    sparklesEnabled = false;
    window.removeEventListener('mousemove', addSparkle, { passive: true });
    sparkleLayer?.remove();
  };

  if (sparkleToggle) {
    const initSparkles = () => {
      if (localStorage.sparkles === 'on') {
        sparkleToggle.checked = true;
        enableSparkles();
      } else {
        sparkleToggle.checked = false;
        disableSparkles();
      }
    };
    initSparkles();

    sparkleToggle.addEventListener('change', () => {
      if (sparkleToggle.checked) {
        enableSparkles();
        localStorage.sparkles = 'on';
      } else {
        disableSparkles();
        localStorage.sparkles = 'off';
      }
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
