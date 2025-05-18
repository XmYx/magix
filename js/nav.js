/* nav.js — global navigation bar */
export const NAV_LINKS = [
  { href: 'index.html',  label: 'Home' },
  { href: 'gallery.html', label: 'Photo Gallery' },
  { href: 'resume.html',  label: 'Resume' }
];

export function injectNav() {
  const current = location.pathname.split('/').pop() || 'index.html';

  const linksDesktop = NAV_LINKS.map(
    l => `<a href="${l.href}" class="px-3 py-2 rounded-md hover:text-indigo-600
                ${l.href === current ? 'font-semibold text-indigo-600' : ''}">
            ${l.label}
          </a>`
  ).join('');

  const linksMobile = NAV_LINKS.map(
    l => `<a href="${l.href}" class="block px-4 py-2 border-b border-gray-100 dark:border-gray-700
                ${l.href === current ? 'font-semibold text-indigo-600' : ''}">
            ${l.label}
          </a>`
  ).join('');

  document.body.insertAdjacentHTML(
    'afterbegin',
    `<header id="siteHeader"
             class="fixed top-0 inset-x-0 z-50 bg-white/70 dark:bg-gray-900/70
                    backdrop-blur shadow transition">
       <div class="max-w-6xl mx-auto flex items-center justify-between px-4 py-3 md:py-4">
         <a href="index.html" class="text-lg md:text-xl font-extrabold tracking-wide">Miklós Nagy</a>

         <div class="flex items-center gap-4">
           <label class="inline-flex items-center gap-2 cursor-pointer">
             <input type="checkbox" id="sparkleToggle" class="peer sr-only">
             <span class="relative h-6 w-10 rounded-full bg-gray-300 transition
                          peer-checked:bg-indigo-600">
               <span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition
                            peer-checked:translate-x-4"></span>
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
     </header>`
  );
}
