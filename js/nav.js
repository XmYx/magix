/* nav.js — global navigation bar with retro macOS style and mode toggle */

// Primary links for the "Pages" menu
export const NAV_LINKS = [
  { href: 'index.html',  label: 'Home' },
  { href: 'gallery.html', label: 'Photo Gallery' },
  { href: 'resume.html',  label: 'Resume' },
  { href: 'about.html',  label: 'About' }
];

export function injectNav() {
  const current = location.pathname.split('/').pop() || 'index.html';

  // Generate original nav links
  const linksDesktop = NAV_LINKS.map(
    l => `<a href="${l.href}" class="px-3 py-2 rounded-md hover:text-indigo-600 ${l.href === current ? 'font-semibold text-indigo-600' : ''}">${l.label}</a>`
  ).join('');
  const linksMobile = NAV_LINKS.map(
    l => `<a href="${l.href}" class="block px-4 py-2 border-b border-gray-100 dark:border-gray-700 ${l.href === current ? 'font-semibold text-indigo-600' : ''}">${l.label}</a>`
  ).join('');

  // Inject retro macOS-style CSS
  const style = document.createElement('style');
  style.textContent = `
    .retro-menubar { background: #eee; font-family: 'Chicago', sans-serif; font-size: 12px; color: #000; height: 22px; display: flex; align-items: center; padding: 0 4px; user-select: none; }
    .menu-list { display: flex; margin: 0; padding: 0; list-style: none; }
    .menu-item { position: relative; padding: 0 8px; cursor: default; }
    .menu-item:hover .dropdown { display: block; }
    .dropdown { display: none; position: absolute; top: 100%; left: 0; background: #fff; border: 1px solid #999; box-shadow: 2px 2px 0 #999; min-width: 120px; z-index: 100; margin-top: -1px; }
    .dropdown li { padding: 4px 8px; cursor: default; white-space: nowrap; }
    .dropdown li:hover { background: #0a84ff; color: #fff; }
    .dropdown li a { text-decoration: none; color: inherit; display: block; }
    .retro-window { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 260px; background: #ddd; border: 2px solid #999; box-shadow: 4px 4px 0 #999; z-index: 1000; display: none; }
    .retro-window .title-bar { background: #000080; color: #fff; padding: 2px 4px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
    .retro-window .title-bar .close { cursor: pointer; padding: 0 4px; }
    .retro-window .content { padding: 8px; font-size: 12px; }
  `;
  document.head.appendChild(style);

  // Build original navbar HTML
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

  // Build retro menubar HTML with mode toggles
  const retroNavHTML = `
    <header id="retroNav" class="retro-menubar">
      <ul class="menu-list">
        <li class="menu-item"><span id="spiralIcon">🌀</span>
          <ul class="dropdown">
            <li id="aboutMenuItem">About</li>
          </ul>
        </li>
        <li class="menu-item"><span>Pages</span>
          <ul class="dropdown">
            ${NAV_LINKS.map(l => `<li><a href="${l.href}">${l.label}</a></li>`).join('')}
          </ul>
        </li>
        <li class="menu-item"><span>Settings</span>
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

  // Insert both navbars
  document.body.insertAdjacentHTML('afterbegin', originalNavHTML + retroNavHTML);

  // Create the retro "About" window
  const aboutWindow = document.createElement('div');
  aboutWindow.id = 'aboutWindow';
  aboutWindow.className = 'retro-window';
  aboutWindow.innerHTML = `
    <div class="title-bar">
      <span>About This App</span>
      <span class="close" id="closeAbout">✕</span>
    </div>
    <div class="content">
      <p>This is a demo of a retro macOS‐style menu bar.</p>
      <p>Version 1.0.0</p>
    </div>
  `;
  document.body.appendChild(aboutWindow);

  // Restore sparkle settings
  const sparkleToggle = document.getElementById('sparkleToggle');
  const sparkleToggleStandard = document.getElementById('sparkleToggleStandard');
  const sparkleSaved = localStorage.getItem('sparkles') === 'true';
  sparkleToggle.checked = sparkleSaved;
  sparkleToggleStandard.checked = sparkleSaved;
  document.body.classList.toggle('sparkles', sparkleSaved);

  // Restore nav mode
  const standardToggle = document.getElementById('standardToggle');
  const retroToggle = document.getElementById('retroToggle');
  const savedNav = localStorage.getItem('navMode') || 'retro';
  standardToggle.checked = savedNav === 'standard';
  retroToggle.checked = savedNav === 'retro';
  function updateNav(mode) {
    const orig = document.getElementById('originalNav');
    const retro = document.getElementById('retroNav');
    if (mode === 'standard') {
      orig.style.display = '';
      retro.style.display = 'none';
    } else {
      orig.style.display = 'none';
      retro.style.display = '';
    }
  }
  updateNav(savedNav);
    // Wire up the new Classic-mode “Retro” switch
    const retroToggleStandard = document.getElementById('retroToggleStandard');
    // initialize its state to match savedNav
    retroToggleStandard.checked = savedNav === 'retro';

    retroToggleStandard.addEventListener('change', e => {
      if (e.target.checked) {
        // switch to retro
        localStorage.setItem('navMode','retro');
        standardToggle.checked = false;
        retroToggle.checked    = true;
        updateNav('retro');
      } else {
        // switch back to standard
        localStorage.setItem('navMode','standard');
        standardToggle.checked = true;
        retroToggle.checked    = false;
        updateNav('standard');
      }
    });
  // Event listeners
  document.getElementById('aboutMenuItem').addEventListener('click', () => {
    aboutWindow.style.display = 'block';
  });
  document.getElementById('closeAbout').addEventListener('click', () => {
    aboutWindow.style.display = 'none';
  });
  sparkleToggle.addEventListener('change', e => {
    localStorage.setItem('sparkles', e.target.checked);
    sparkleToggleStandard.checked = e.target.checked;
    document.body.classList.toggle('sparkles', e.target.checked);
  });
  sparkleToggleStandard.addEventListener('change', e => {
    localStorage.setItem('sparkles', e.target.checked);
    sparkleToggle.checked = e.target.checked;
    document.body.classList.toggle('sparkles', e.target.checked);
  });
  standardToggle.addEventListener('change', e => {
    if (e.target.checked) {
      retroToggle.checked = false;
      localStorage.setItem('navMode','standard');
      updateNav('standard');
    } else {
      retroToggle.checked = true;
      localStorage.setItem('navMode','retro');
      updateNav('retro');
    }
  });
  retroToggle.addEventListener('change', e => {
    if (e.target.checked) {
      standardToggle.checked = false;
      localStorage.setItem('navMode','retro');
      updateNav('retro');
    } else {
      standardToggle.checked = true;
      localStorage.setItem('navMode','standard');
      updateNav('standard');
    }
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', e => {
    const withinMenu = e.target.closest('.menu-item');
    document.querySelectorAll('.dropdown').forEach(d => {
      if (!withinMenu || !d.parentElement.contains(withinMenu)) d.style.display = 'none';
    });
  });
  document.querySelectorAll('.menu-item > span').forEach(span => {
    span.addEventListener('click', e => {
      const dd = span.parentElement.querySelector('.dropdown');
      dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
      e.stopPropagation();
    });
  });
}