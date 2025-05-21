import { $, isTouchDevice }       from './utils.js';
import { injectNav }              from './nav.js';
import { loadGallery }            from './gallery.js';
import { initTerminal }           from './about.js';

document.addEventListener('DOMContentLoaded', () => {
  initTerminal();
  injectNav();

  /* header height var */
  const setHeaderVar = () => {
    const h = document.getElementById('siteHeader');
    if (h) {
      document.documentElement.style.setProperty('--site-header-h', `${h.offsetHeight}px`);
      $('#introHeader')?.style?.setProperty('top', 'var(--site-header-h)');
    }
  };
  setHeaderVar();
  window.addEventListener('resize', setHeaderVar);

  /* mobile menu */
  const menuToggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => mobileMenu.classList.toggle('open'));
    mobileMenu.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => mobileMenu.classList.remove('open'))
    );
  }

  /* fade-in on scroll */
  const io = new IntersectionObserver(
    es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); } }),
    { threshold: 0.15 }
  );
  document.querySelectorAll('.fade-in').forEach(el => io.observe(el));

  /* parallax intro header */
  const introHeader = $('#introHeader');
  if (introHeader) {
    const parallax = () => { introHeader.style.transform = `translateY(${window.scrollY * 0.3}px)`; };
    window.addEventListener('scroll', parallax, { passive: true });
    parallax();
  }

  /* theme toggle */
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

  /* sparkle cursor effect */
  const sparkleToggle = $('#sparkleToggleStandard');
  let sparklesEnabled = false, sparkleLayer;

  const ensureSparkleStyles = () => {
    if (document.getElementById('sparkleStyles')) return;
//    const css =
//      `.sparkle{position:absolute;width:6px;height:6px;background:radial-gradient(circle,#fff 0%,rgba(255,255,255,.8) 40%,rgba(255,255,255,0) 80%);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;animation:sparkle 700ms linear forwards}@keyframes sparkle{to{opacity:0;transform:translate(-50%,-50%) scale(.2)}}`;
      const css = `.sparkle{
        position:absolute;
        width:4px;height:4px;
        background:radial-gradient(circle,#fff 0%,rgba(255,255,255,0) 80%);
        border-radius:50%;
        pointer-events:none;
        animation:sparkleFade .6s ease-out forwards
      }
      @keyframes sparkleFade{
        0%   {opacity:1;transform:scale(1) translate(0,0)}
        100% {opacity:0;transform:scale(2) translate(var(--dx),var(--dy))}
      }`;


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
//    if (!sparklesEnabled) return;
//    ensureSparkleStyles();
//    ensureLayer();
//    const s = Object.assign(document.createElement('span'), { className: 'sparkle' });
//    s.style.left = `${x}px`;
//    s.style.top  = `${y}px`;
//    sparkleLayer.appendChild(s);
//    setTimeout(() => s.remove(), 700);
    if (!sparklesEnabled) return;
    ensureSparkleStyles();
    ensureLayer();

    const s = Object.assign(document.createElement('span'), { className: 'sparkle' });
    const size = Math.random() * 4 + 2;        // 2 – 6 px
    s.style.width  = `${size}px`;
    s.style.height = `${size}px`;
    s.style.left   = `${x - size / 2}px`;
    s.style.top    = `${y - size / 2}px`;

    const angle    = Math.random() * Math.PI * 2;
    const distance = Math.random() * 30 + 10;  // 10 – 40 px
    s.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    s.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);

    sparkleLayer.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  };

  const cursorSparkle = e => spawnSparkle(e.clientX, e.clientY);
  const enableSparkles  = () => {
    if (sparklesEnabled) return;
    sparklesEnabled = true;
    window.addEventListener('mousemove', cursorSparkle, { passive: true });
  };
  const disableSparkles = () => {
    if (!sparklesEnabled) return;
    sparklesEnabled = false;
    window.removeEventListener('mousemove', cursorSparkle, { passive: true });
    sparkleLayer?.remove();
    sparkleLayer = null;
  };

  const initSparkles = () => {
    const saved = localStorage.getItem('sparkles') === 'on';
    if (saved) enableSparkles();
    else disableSparkles();
    if (sparkleToggle) sparkleToggle.checked = saved;
  };
  initSparkles();

  if (sparkleToggle) {
    sparkleToggle.addEventListener('change', e => {
      const on = e.target.checked;
      localStorage.setItem('sparkles', on ? 'on' : 'off');
      on ? enableSparkles() : disableSparkles();
    });
  }

  /* nav-link sparkle rectangle on hover */
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

  const galleryGrid = $('#galleryGrid');
  if (galleryGrid) loadGallery(galleryGrid);
});
