/* script.js — shared site logic — v4
   (c) 2025 Miklós Nagy
   ░░ Global navbar injected so it persists across every page ░░
   ░░ Added mobile‑friendly media fixes & modal viewer ░░
*/

// ────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────
const isTouchDevice = () =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;

const $ = sel => document.querySelector(sel);

// Simple media modal (images & videos)
function openMediaModal(src, type = 'img') {
  // Prevent multiple overlays
  if (document.getElementById('mediaOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'mediaOverlay';
  Object.assign(overlay.style, {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000
  });

  const close = () => {
    document.body.style.overflow = '';
    overlay.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = e => e.key === 'Escape' && close();
  window.addEventListener('keydown', onKey);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  let media;
  if (type === 'img') {
    media = document.createElement('img');
    media.src = src;
  } else {
    media = document.createElement('video');
    media.src = src;
    media.autoplay = true;
    media.controls = true;
    media.style.maxHeight = '90vh';
    media.style.maxWidth = '90vw';
  }
  Object.assign(media.style, { maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px' });
  overlay.appendChild(media);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

// ────────────────────────────────────────────────────────────────
// Global navigation
// ────────────────────────────────────────────────────────────────
const NAV_LINKS = [
  { href: 'index.html', label: 'Home' },
  { href: 'gallery.html', label: 'Photo Gallery' },
  { href: 'resume.html', label: 'Resume' }
];

function injectNav() {
  const current = location.pathname.split('/').pop() || 'index.html';

  const linksDesktop = NAV_LINKS.map(l => `
      <a href="${l.href}" class="px-3 py-2 rounded-md hover:text-indigo-600 ${l.href === current ? 'font-semibold text-indigo-600' : ''}">${l.label}</a>`).join('');

  const linksMobile = NAV_LINKS.map(l => `
      <a href="${l.href}" class="block px-4 py-2 border-b border-gray-100 dark:border-gray-700 ${l.href === current ? 'font-semibold text-indigo-600' : ''}">${l.label}</a>`).join('');

  const navHTML = `
<header id="siteHeader" class="fixed top-0 inset-x-0 z-50 bg-white/70 dark:bg-gray-900/70 backdrop-blur shadow transition">
  <div class="max-w-6xl mx-auto flex items-center justify-between px-4 py-3 md:py-4">
    <a href="index.html" class="text-lg md:text-xl font-extrabold tracking-wide">Miklós Nagy</a>
    <div class="flex items-center gap-4">
      <label class="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" id="sparkleToggle" class="peer sr-only">
        <span class="relative h-6 w-10 rounded-full bg-gray-300 transition peer-checked:bg-indigo-600">
          <span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-4"></span>
        </span>
        <span class="select-none text-sm">Sparkles</span>
      </label>
      <button id="menuToggle" class="hamburger md:hidden" aria-label="Open menu">
        <span></span><span></span><span></span>
      </button>
    </div>
    <nav id="desktopMenu" class="hidden md:flex gap-4">${linksDesktop}</nav>
  </div>
  <nav id="mobileMenu" class="mobile-menu md:hidden">${linksMobile}</nav>
</header>`;

  document.body.insertAdjacentHTML('afterbegin', navHTML);
}

// ────────────────────────────────────────────────────────────────
// DOM Ready
// ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Inject navigation first so subsequent logic can measure it
  injectNav();

  /* Sync CSS var for header height so introHeader never overlaps */
  const setHeaderVar = () => {
    const siteHeader = document.getElementById('siteHeader');
    if (!siteHeader) return;
    document.documentElement.style.setProperty('--site-header-h', siteHeader.offsetHeight + 'px');
    const introHeader = $('#introHeader');
    if (introHeader) introHeader.style.top = 'var(--site-header-h)';
  };
  setHeaderVar();
  window.addEventListener('resize', setHeaderVar);

  /* Mobile menu toggle */
  const menuToggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => mobileMenu.classList.toggle('open'));
    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => mobileMenu.classList.remove('open')));
  }

  /* Reveal‑on‑scroll */
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

  /* Parallax header (resume) */
  const header = $('#introHeader');
  if (header) {
    const parallax = () => { header.style.transform = `translateY(${window.scrollY * 0.3}px)`; };
    window.addEventListener('scroll', parallax, { passive: true });
    parallax();
  }

  /* Theme toggle */
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

  /* Sparkle cursor */
  const sparkleToggle = $('#sparkleToggle');
  let sparklesEnabled = false;
  let sparkleLayer;

  const ensureSparkleStyles = () => {
    if (document.getElementById('sparkleStyles')) return;
    const style = document.createElement('style');
    style.id = 'sparkleStyles';
    style.textContent = `
      .sparkle { position:absolute;width:6px;height:6px;background:radial-gradient(circle,rgba(255,255,255,1) 0%,rgba(255,255,255,0.8) 40%,rgba(255,255,255,0) 80%);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;animation:sparkle-fade 700ms linear forwards; }
      @keyframes sparkle-fade { 0%{opacity:1;transform:translate(-50%,-50%) scale(1);} 100%{opacity:0;transform:translate(-50%,-50%) scale(0);} }
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

  /* PDF download */
  $('#pdfBtn')?.addEventListener('click', () => window.print());

  /* Collapsing résumé header */
  if (header) {
    window.addEventListener('scroll', () => { header.classList.toggle('collapsed', window.scrollY > 100); });
  }

  /* Grid/List toggle (resume) */
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

  /* Auto‑populate gallery */
  const galleryGrid = $('#galleryGrid');
  if (galleryGrid) loadGallery(galleryGrid);
});

// ────────────────────────────────────────────────────────────────
// Gallery loader (images & videos)
// ────────────────────────────────────────────────────────────────
async function loadGallery(container) {
  const owner = 'XmYx';      // ✏️  adjust to your GitHub user/org
  const repo  = 'magix-photos';
  const paths = { photos: 'photos', videos: 'videos' };

  const fetchFiles = async (dir, exts) => {
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${dir}`;
    try {
      const res = await fetch(api);
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const files = await res.json();
      return files.filter(f => f.type === 'file' && exts.some(ext => f.name.toLowerCase().endsWith(ext)));
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const VID_EXTS = ['.mp4', '.webm', '.mov'];

  const [imageFiles, videoFiles] = await Promise.all([
    fetchFiles(paths.photos, IMG_EXTS),
    fetchFiles(paths.videos, VID_EXTS)
  ]);

  // --- DOM builders ------------------------------------------------
  const addImg = ({ download_url, name }) => {
    const img = document.createElement('img');
    img.src = download_url;
    img.alt = name;
    img.loading = 'lazy';
    img.className = 'w-full h-auto object-cover rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer';
    img.addEventListener('click', () => openMediaModal(img.src, 'img'));
    container.appendChild(img);
  };

  const addVid = ({ download_url, name }) => {
    const vid = document.createElement('video');
    vid.src = download_url;
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    vid.title = name;
    vid.className = 'w-full h-auto object-cover rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer';
    vid.style.aspectRatio = '16/9'; // helps prevent collapsing height on mobile

    if (isTouchDevice()) {
      // Touch devices: show controls + tap to fullscreen modal
      vid.controls = true;
      vid.addEventListener('click', e => {
        // If not yet playing, let default controls handle
        if (vid.paused) return;
        // If already playing, open fullscreen modal for better UX
        e.preventDefault();
        openMediaModal(vid.src, 'video');
      });
    } else {
      // Desktop: hover play/pause
      vid.addEventListener('mouseenter', () => vid.play());
      vid.addEventListener('mouseleave', () => {
        vid.pause();
        vid.currentTime = 0;
      });
      vid.addEventListener('click', () => openMediaModal(vid.src, 'video'));
    }

    container.appendChild(vid);
  };

  imageFiles.forEach(addImg);
  videoFiles.forEach(addVid);

  if (!imageFiles.length && !videoFiles.length) {
    container.innerHTML = '<p class="col-span-full text-center py-10 text-red-600">Unable to load gallery.</p>';
  }
}
