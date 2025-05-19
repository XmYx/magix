// nav.js — global navigation bar with retro macOS style, mode toggle, blink-on-subitem
import { AboutFloat } from './aboutfloat.js';

// Primary links for the "Pages" menu
export const NAV_LINKS = [
  { href: 'index.html',  label: 'Home' },
  { href: 'gallery.html', label: 'Photo Gallery' },
  { href: 'resume.html',  label: 'Resume' },
  { href: 'about.html',  label: 'About' }
];

let aboutWindow;
export function injectNav() {
  const current = location.pathname.split('/').pop() || 'index.html';

  // Generate standard nav links
  const linksDesktop = NAV_LINKS.map(
    l => `<a href="${l.href}" class="px-3 py-2 rounded-md hover:text-indigo-600 ${l.href === current ? 'font-semibold text-indigo-600' : ''}">${l.label}</a>`
  ).join('');
  const linksMobile = NAV_LINKS.map(
    l => `<a href="${l.href}" class="block px-4 py-2 border-b border-gray-100 dark:border-gray-700 ${l.href === current ? 'font-semibold text-indigo-600' : ''}">${l.label}</a>`
  ).join('');

  // Inject CSS (retro look + blink for dropdown items)
  const style = document.createElement('style');
  style.textContent = `
    .retro-menubar {
      background: #eee;
      font-family: 'Chicago', sans-serif;
      font-size: 12px;
      color: #000;
      height: 22px;
      display: flex;
      align-items: center;
      padding: 0 4px;
      user-select: none;
    }
    .menu-list { display: flex; margin: 0; padding: 0; list-style: none; }
    .menu-item { position: relative; padding: 0 8px; cursor: default; }
    .dropdown {
      display: none;
      position: absolute; top: 100%; left: 0;
      background: #fff; border: 1px solid #999;
      box-shadow: 2px 2px 0 #999;
      min-width: 120px; z-index: 100; margin-top: -1px;
    }
    .dropdown li { padding: 4px 8px; cursor: default; white-space: nowrap; }
    .dropdown li:hover { background: #0a84ff; color: #fff; }
    .dropdown li a { text-decoration: none; color: inherit; display: block; }

    .retro-window {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 260px; background: #ddd;
      border: 2px solid #999; box-shadow: 4px 4px 0 #999;
      z-index: 1000; display: none;
    }
    .retro-window .title-bar {
      background: #000080; color: #fff;
      padding: 2px 4px; display: flex;
      justify-content: space-between; align-items: center;
      font-size: 12px;
    }
    .retro-window .title-bar .close { cursor: pointer; padding: 0 4px; }
    .retro-window .content { padding: 8px; font-size: 12px; overflow: auto; }
    .retro-window .resize-handle { position: absolute; width: 12px; height: 12px; bottom: 0; right: 0; cursor: se-resize; }

    @keyframes blink {
      0%,100% { opacity: 1; }
      50%      { opacity: 0; }
    }
    .dropdown li.blink {
      animation: blink 0.3s step-start 3;
    }
  `;
  document.head.appendChild(style);

  // Build standard + retro HTML
  const originalNavHTML = `
    <header id="originalNav" class="fixed top-0 inset-x-0 z-50 bg-white/70 dark:bg-gray-900/70 backdrop-blur shadow transition">
      <div class="max-w-6xl mx-auto flex items-center justify-between px-4 py-3 md:py-4">
        <a href="index.html" class="text-lg md:text-xl font-extrabold tracking-wide">Miklós Nagy</a>
        <nav class="hidden md:flex gap-4">${linksDesktop}</nav>
        <div class="flex items-center gap-4">
          <label class="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="sparkleToggleStandard" class="peer sr-only">
            <span class="relative h-6 w-10 rounded-full bg-gray-300 transition peer-checked:bg-indigo-600">
              <span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-4"></span>
            </span>
            <span class="select-none text-sm">Sparkles</span>
          </label>
          <label class="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="retroToggleStandard" class="peer sr-only">
            <span class="select-none text-sm">Retro Menubar</span>
          </label>
          <button id="menuToggleStandard" class="hamburger md:hidden" aria-label="Open menu">
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>
      <nav class="mobile-menu md:hidden">${linksMobile}</nav>
    </header>`;

  const retroNavHTML = `
    <header id="retroNav" class="retro-menubar">
      <ul class="menu-list">
        <li class="menu-item">
          <span id="spiralIcon">🌀</span>
          <ul class="dropdown">
            <li id="aboutMenuItem">About</li>
          </ul>
        </li>
        <li class="menu-item">
          <span>Pages</span>
          <ul class="dropdown">
            ${NAV_LINKS.map(l => `<li><a href="${l.href}">${l.label}</a></li>`).join('')}
          </ul>
        </li>
        <li class="menu-item">
          <span>Settings</span>
          <ul class="dropdown">
            <li>
              <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" id="sparkleToggle">
                Sparkles
              </label>
            </li>
            <li>
              <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" id="standardToggle">
                Classic Navbar
              </label>
            </li>
            <li>
              <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" id="retroToggle">
                Retro Menubar
              </label>
            </li>
          </ul>
        </li>
      </ul>
    </header>`;

  document.body.insertAdjacentHTML('afterbegin', originalNavHTML + retroNavHTML);

  // Restore sparkle & nav mode settings
  const sparkleStd = document.getElementById('sparkleToggleStandard');
  const sparkle   = document.getElementById('sparkleToggle');
  const savedSp   = localStorage.getItem('sparkles') === 'true';
  sparkleStd.checked = sparkle.checked = savedSp;
  document.body.classList.toggle('sparkles', savedSp);

  const stdT   = document.getElementById('standardToggle');
  const retT   = document.getElementById('retroToggle');
  const retTS  = document.getElementById('retroToggleStandard');
  const savedNav = localStorage.getItem('navMode') || 'standard';
  stdT.checked   = savedNav === 'standard';
  retT.checked   = savedNav === 'retro';
  retTS.checked  = savedNav === 'retro';

  function updateNav(mode) {
    document.getElementById('originalNav').style.display = mode === 'standard' ? '' : 'none';
    document.getElementById('retroNav').style.display    = mode === 'retro'    ? '' : 'none';
  }
  updateNav(savedNav);

  // Wire up standard <-> retro toggles
  sparkle.addEventListener('change', e => {
    localStorage.setItem('sparkles', e.target.checked);
    sparkleStd.checked = e.target.checked;
    document.body.classList.toggle('sparkles', e.target.checked);
  });
  sparkleStd.addEventListener('change', _ => sparkle.dispatchEvent(new Event('change')));

  stdT.addEventListener('change', e => {
    localStorage.setItem('navMode', e.target.checked ? 'standard' : 'retro');
    retT.checked = retTS.checked = !e.target.checked;
    updateNav(e.target.checked ? 'standard' : 'retro');
  });
  retT.addEventListener('change', e => {
    localStorage.setItem('navMode', e.target.checked ? 'retro' : 'standard');
    stdT.checked = !e.target.checked;
    retTS.checked = e.target.checked;
    updateNav(e.target.checked ? 'retro' : 'standard');
  });

    retTS.addEventListener('change', e => {
      const mode = e.target.checked ? 'retro' : 'standard';
      localStorage.setItem('navMode', mode);
      stdT.checked   = !e.target.checked;
      retT.checked   = e.target.checked;
      retTS.checked  = e.target.checked;
      updateNav(mode);
    });



  // --- retro-menu open/close on click+hover (no blink here) ---
  let menuActive = false;
  function closeAll() {
    document.querySelectorAll('.dropdown').forEach(d => d.style.display = 'none');
    document.querySelectorAll('.menu-item.active').forEach(mi => mi.classList.remove('active'));
    menuActive = false;
  }
  function openIt(mi) {
    mi.querySelector('.dropdown').style.display = 'block';
    mi.classList.add('active');
    menuActive = true;
  }

  document.querySelectorAll('#retroNav .menu-item').forEach(mi => {
    const span = mi.querySelector('span');
    span.addEventListener('click', e => {
      if (mi.classList.contains('active')) {
        closeAll();
      } else {
        closeAll();
        openIt(mi);
      }
      e.stopPropagation();
    });
    mi.addEventListener('mouseenter', () => {
      if (menuActive && !mi.classList.contains('active')) {
        closeAll();
        openIt(mi);
      }
    });
  });
  document.addEventListener('click', closeAll);

  // --- blink + action on final subitem click ---

  // Instantiate AboutFloat once
  aboutWindow = new AboutFloat({});

  // Wire up About menu item
  const aboutMenuItem = document.getElementById('aboutMenuItem');
  aboutMenuItem.addEventListener('click', e => {
    e.stopPropagation();
    aboutMenuItem.classList.add('blink');
    aboutMenuItem.addEventListener('animationend', function handler() {
      aboutMenuItem.classList.remove('blink');
      closeAll();
      aboutWindow.open();
      aboutMenuItem.removeEventListener('animationend', handler);
    });
  });

  // Any <a> in a dropdown
  document.querySelectorAll('#retroNav .dropdown li a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const li = a.parentElement;
      const href = a.getAttribute('href');
      li.classList.add('blink');
      li.addEventListener('animationend', function handler() {
        li.classList.remove('blink');
        closeAll();
        window.location.href = href;
        li.removeEventListener('animationend', handler);
      });
    });
  });
}
