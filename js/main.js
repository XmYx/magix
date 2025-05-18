import { $, isTouchDevice }       from './utils.js';
import { injectNav }              from './nav.js';
import { loadGallery }            from './gallery.js';

/* -------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  /* ----- global nav bar ----- */
  injectNav();

  /* ----- header height var for CSS ----- */
  const setHeaderVar = () => {
    const h = document.getElementById('siteHeader');
    if (h) {
      document.documentElement.style.setProperty('--site-header-h', `${h.offsetHeight}px`);
      $('#introHeader')?.style?.setProperty('top', 'var(--site-header-h)');
    }
  };
  setHeaderVar();
  window.addEventListener('resize', setHeaderVar);

  /* ----- mobile menu ----- */
  const menuToggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => mobileMenu.classList.toggle('open'));
    mobileMenu.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => mobileMenu.classList.remove('open'))
    );
  }

  /* ----- reveal-on-scroll fades ----- */
  const io = new IntersectionObserver(
    es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); } }),
    { threshold: 0.15 }
  );
  document.querySelectorAll('.fade-in').forEach(el => io.observe(el));

  /* ----- parallax intro header ----- */
  const introHeader = $('#introHeader');
  if (introHeader) {
    const parallax = () => { introHeader.style.transform = `translateY(${window.scrollY * 0.3}px)`; };
    window.addEventListener('scroll', parallax, { passive: true });
    parallax();
  }

  /* ----- theme toggle (light / dark) ----- */
  const themeToggle = $('#themeToggle');
  const root = document.documentElement;
  const applyTheme = dark => dark ? root.classList.add('dark') : root.classList.remove('dark');
  if (themeToggle) {
    const initTheme = () => applyTheme(
      localStorage.theme === 'dark' ||
      (!localStorage.theme && matchMedia('(prefers-color-scheme: dark)').matches)
    );
    initTheme();
    themeToggle.checked = root.classList.contains('dark');
    themeToggle.addEventListener('change', () => {
      applyTheme(themeToggle.checked);
      localStorage.theme = themeToggle.checked ? 'dark' : 'light';
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', initTheme);
  }

  /* ----- sparkle cursor + nav link rectangles ----- */
  const sparkleToggle = $('#sparkleToggle');
  let sparklesEnabled = false, sparkleLayer;

  const ensureSparkleStyles = () => {
    if (document.getElementById('sparkleStyles')) return;
    const css =
      `.sparkle{position:absolute;width:6px;height:6px;background:radial-gradient(circle,#fff 0%,rgba(255,255,255,.8) 40%,rgba(255,255,255,0) 80%);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;animation:sparkle 700ms linear forwards}@keyframes sparkle{to{opacity:0;transform:translate(-50%,-50%) scale(.2)}}`;
    Object.assign(document.head.appendChild(document.createElement('style')), {
      id: 'sparkleStyles',
      textContent: css
    });
  };

  const ensureLayer = () => {
    if (sparkleLayer) return;
    sparkleLayer = Object.assign(document.createElement('div'), { id: 'sparkleLayer' });
    Object.assign(sparkleLayer.style, { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 });
    document.body.appendChild(sparkleLayer);
  };

  const spawnSparkle = (x, y) => {
    if (!sparklesEnabled) return;
    ensureSparkleStyles();
    ensureLayer();
    const s = Object.assign(document.createElement('span'), { className: 'sparkle' });
    s.style.left = `${x}px`; s.style.top = `${y}px`;
    sparkleLayer.appendChild(s);
    setTimeout(() => s.remove(), 700);
  };

  const cursorSparkle = e => spawnSparkle(e.clientX, e.clientY);
  const enableSparkles  = () => { if (sparklesEnabled) return; sparklesEnabled = true;  window.addEventListener('mousemove', cursorSparkle, { passive: true }); };
  const disableSparkles = () => { if (!sparklesEnabled) return; sparklesEnabled = false; window.removeEventListener('mousemove', cursorSparkle, { passive: true }); sparkleLayer?.remove(); sparkleLayer = null; };

  if (sparkleToggle) {
    const initSparkles = () => {
      localStorage.sparkles === 'on'
        ? (sparkleToggle.checked = true, enableSparkles())
        : disableSparkles();
    };
    initSparkles();
    sparkleToggle.addEventListener('change', () => {
      sparkleToggle.checked
        ? (localStorage.sparkles = 'on',  enableSparkles())
        : (localStorage.sparkles = 'off', disableSparkles());
    });
  }

  /* ----- nav-link rectangle animation ----- */
  document.querySelectorAll('#desktopMenu a').forEach(link => {
    let raf = null;
    const loop = ts => {
      if (!sparklesEnabled) { raf = requestAnimationFrame(loop); return; }
      const { left, top, width: w, height: h } = link.getBoundingClientRect();
      const peri = 2 * (w + h);
      const t = (ts % 1800) / 1800;
      let d = t * peri, x, y;
      if (d < w)            { x = left + d;     y = top; }
      else if (d < w + h)   { d -= w;           x = left + w; y = top + d; }
      else if (d < 2*w + h) { d -= (w + h);     x = left + w - d; y = top + h; }
      else                  { d -= (2*w + h);   x = left; y = top + h - d; }
      spawnSparkle(x, y);
      raf = requestAnimationFrame(loop);
    };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = null; };
    link.addEventListener('mouseenter', () => { if (!raf) raf = requestAnimationFrame(loop); });
    link.addEventListener('mouseleave', stop);
  });

  /* ----- extras ----- */
  $('#pdfBtn')?.addEventListener('click', () => window.print());

  if (introHeader) {
    window.addEventListener('scroll', () =>
      introHeader.classList.toggle('collapsed', window.scrollY > 100));
  }

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

  /* ----- gallery populate ----- */
  const galleryGrid = $('#galleryGrid');
  if (galleryGrid) loadGallery(galleryGrid);
});
