/* script.js — shared site logic — v6
   (c) 2025 Miklós Nagy
   ░░ Global navbar injected so it persists across every page ░░
   ░░ Mobile-friendly media fixes & modal viewer ░░
   ░░ Nav-link sparkle rectangle animation ░░
   ░░ Gallery: parse .txt link lists (images, videos, YouTube) ░░
*/

// ────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────
const isTouchDevice = () =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;

const $ = sel => document.querySelector(sel);

// YouTube helpers
const YT_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|v\/))([\w-]{11})/i;
const getYoutubeId = url => (url.match(YT_REGEX) || [])[1] || null;
const ytThumb = id => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

// ────────────────────────────────────────────────────────────────
// Simple media modal (img / video / YouTube)
// ────────────────────────────────────────────────────────────────
function openMediaModal(src, type = 'img') {
  if (document.getElementById('mediaOverlay')) return; // prevent duplicates

  const overlay = Object.assign(document.createElement('div'), { id: 'mediaOverlay' });
  Object.assign(overlay.style, {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.9)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 10000
  });

  const close = () => {
    document.body.style.overflow = '';
    overlay.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = e => e.key === 'Escape' && close();
  window.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  let media, nodeToAppend;
  if (type === 'youtube') {
    // Responsive 16:9 wrapper so the player always fills the largest
    // possible rectangle inside the viewport while keeping aspect ratio.
    const id = getYoutubeId(src);
    if (!id) return;

    const wrap = Object.assign(document.createElement('div'), { className: 'yt-wrap' });
    Object.assign(wrap.style, {
      position: 'relative',
      borderRadius: '8px',
      overflow: 'hidden'
    });

    const fit = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(vw, vh * 16 / 9);
      const h = Math.min(vh, vw * 9 / 16);
      wrap.style.width = `${w}px`;
      wrap.style.height = `${h}px`;
    };
    fit();
    window.addEventListener('resize', fit, { passive: true });

    media = document.createElement('iframe');
    Object.assign(media, {
      src: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      frameBorder: 0,
      allowFullscreen: true
    });
    Object.assign(media.style, {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%'
    });

    wrap.appendChild(media);
    nodeToAppend = wrap;
  } else if (type === 'video') {
    media = document.createElement('video');
    Object.assign(media, { src, autoplay: true, controls: true, playsInline: true });
    Object.assign(media.style, { maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px' });
    nodeToAppend = media;
  } else {
    media = document.createElement('img');
    media.src = src;
    Object.assign(media.style, { maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px' });
    nodeToAppend = media;
  }

  overlay.appendChild(nodeToAppend);
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
  const linksDesktop = NAV_LINKS.map(l => `\n      <a href="${l.href}" class="px-3 py-2 rounded-md hover:text-indigo-600 ${l.href===current?'font-semibold text-indigo-600':''}">${l.label}</a>`).join('');
  const linksMobile = NAV_LINKS.map(l => `\n      <a href="${l.href}" class="block px-4 py-2 border-b border-gray-100 dark:border-gray-700 ${l.href===current?'font-semibold text-indigo-600':''}">${l.label}</a>`).join('');
  document.body.insertAdjacentHTML('afterbegin', `\n<header id="siteHeader" class="fixed top-0 inset-x-0 z-50 bg-white/70 dark:bg-gray-900/70 backdrop-blur shadow transition">\n  <div class="max-w-6xl mx-auto flex items-center justify-between px-4 py-3 md:py-4">\n    <a href="index.html" class="text-lg md:text-xl font-extrabold tracking-wide">Miklós Nagy</a>\n    <div class="flex items-center gap-4">\n      <label class="inline-flex items-center gap-2 cursor-pointer">\n        <input type="checkbox" id="sparkleToggle" class="peer sr-only">\n        <span class="relative h-6 w-10 rounded-full bg-gray-300 transition peer-checked:bg-indigo-600">\n          <span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-4"></span>\n        </span>\n        <span class="select-none text-sm">Sparkles</span>\n      </label>\n      <button id="menuToggle" class="hamburger md:hidden" aria-label="Open menu"><span></span><span></span><span></span></button>\n    </div>\n    <nav id="desktopMenu" class="hidden md:flex gap-4">${linksDesktop}</nav>\n  </div>\n  <nav id="mobileMenu" class="mobile-menu md:hidden">${linksMobile}</nav>\n</header>`);
}

// ────────────────────────────────────────────────────────────────
// DOM Ready
// ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  injectNav();

  // Header height CSS var
  const setHeaderVar = () => {
    const h = document.getElementById('siteHeader');
    if (h) {
      document.documentElement.style.setProperty('--site-header-h', `${h.offsetHeight}px`);
      $('#introHeader')?.style?.setProperty('top', 'var(--site-header-h)');
    }
  };
  setHeaderVar();
  window.addEventListener('resize', setHeaderVar);

  // Mobile menu toggle
  const menuToggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => mobileMenu.classList.toggle('open'));
    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => mobileMenu.classList.remove('open')));
  }

  // Reveal-on-scroll
  const io = new IntersectionObserver(es => es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('show');io.unobserve(e.target);}}),{threshold:.15});
  document.querySelectorAll('.fade-in').forEach(el=>io.observe(el));

  // Parallax intro header
  const introHeader = $('#introHeader');
  if (introHeader) {
    const parallax = () => introHeader.style.transform = `translateY(${window.scrollY*0.3}px)`;
    window.addEventListener('scroll', parallax, { passive: true });
    parallax();
  }

  // Theme toggle
  const themeToggle = $('#themeToggle');
  const root = document.documentElement;
  const applyTheme = dark => dark ? root.classList.add('dark') : root.classList.remove('dark');
  if (themeToggle) {
    const initTheme = () => applyTheme(localStorage.theme==='dark'||(!localStorage.theme&&matchMedia('(prefers-color-scheme: dark)').matches));
    initTheme();
    themeToggle.checked = root.classList.contains('dark');
    themeToggle.addEventListener('change',()=>{applyTheme(themeToggle.checked);localStorage.theme=themeToggle.checked?'dark':'light';});
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', initTheme);
  }

  // Sparkle cursor & nav-link rectangles
  const sparkleToggle = $('#sparkleToggle');
  let sparklesEnabled = false; let sparkleLayer;
  const ensureSparkleStyles = () => {
    if (document.getElementById('sparkleStyles')) return;
    const css=`.sparkle{position:absolute;width:6px;height:6px;background:radial-gradient(circle,#fff 0%,rgba(255,255,255,.8) 40%,rgba(255,255,255,0) 80%);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;animation:sparkle 700ms linear forwards}@keyframes sparkle{to{opacity:0;transform:translate(-50%,-50%) scale(.2)}}`;
    Object.assign(document.head.appendChild(document.createElement('style')), { id:'sparkleStyles', textContent:css });
  };
  const ensureLayer = () => {
    if (sparkleLayer) return;
    sparkleLayer = Object.assign(document.createElement('div'),{ id:'sparkleLayer' });
    Object.assign(sparkleLayer.style,{ position:'fixed',inset:0,pointerEvents:'none',zIndex:9999 });
    document.body.appendChild(sparkleLayer);
  };
  const spawnSparkle = (x,y) => {
    if(!sparklesEnabled) return;
    ensureSparkleStyles();ensureLayer();
    const s=Object.assign(document.createElement('span'),{className:'sparkle'});
    s.style.left=`${x}px`;s.style.top=`${y}px`;
    sparkleLayer.appendChild(s);
    setTimeout(()=>s.remove(),700);
  };
  const cursorSparkle=e=>spawnSparkle(e.clientX,e.clientY);
  const enableSparkles=()=>{if(sparklesEnabled) return; sparklesEnabled=true; window.addEventListener('mousemove',cursorSparkle,{passive:true});};
  const disableSparkles=()=>{if(!sparklesEnabled) return; sparklesEnabled=false; window.removeEventListener('mousemove',cursorSparkle,{passive:true}); sparkleLayer?.remove();sparkleLayer=null;};
  if(sparkleToggle){
    const init=()=>{localStorage.sparkles==='on'? (sparkleToggle.checked=true,enableSparkles()) : disableSparkles();};
    init();
    sparkleToggle.addEventListener('change',()=>{sparkleToggle.checked?(localStorage.sparkles='on',enableSparkles()):(localStorage.sparkles='off',disableSparkles());});
  }
  // Nav rectangles
  document.querySelectorAll('#desktopMenu a').forEach(link=>{
    let raf=null;
    const loop=ts=>{
      if(!sparklesEnabled){raf=requestAnimationFrame(loop);return;}
      const {left,top,width:w,height:h}=link.getBoundingClientRect();
      const peri=2*(w+h);const t=(ts%1800)/1800; let d=t*peri; let x,y;
      if(d<w){x=left+d;y=top;} else if(d<w+h){d-=w;x=left+w;y=top+d;} else if(d<2*w+h){d-=(w+h);x=left+w-d;y=top+h;} else {d-=(2*w+h);x=left;y=top+h-d;}
      spawnSparkle(x,y); raf=requestAnimationFrame(loop);
    };
    const stop=()=>{if(raf) cancelAnimationFrame(raf); raf=null;};
    link.addEventListener('mouseenter',()=>{if(!raf) raf=requestAnimationFrame(loop);});
    link.addEventListener('mouseleave',stop);
  });

  // PDF button
  $('#pdfBtn')?.addEventListener('click',()=>window.print());

  // Resume header collapse
  introHeader && window.addEventListener('scroll',()=>introHeader.classList.toggle('collapsed',window.scrollY>100));

  // Grid/List toggle
  const layoutToggle=$('#layoutToggle');
  if(layoutToggle){
    const gridIcon=$('#gridIcon');const listIcon=$('#listIcon');
    layoutToggle.addEventListener('click',()=>{document.body.classList.toggle('list-view');gridIcon.classList.toggle('hidden');listIcon.classList.toggle('hidden');});
  }

  // Gallery populate
  const galleryGrid=$('#galleryGrid');
  if(galleryGrid) loadGallery(galleryGrid);
});

// ────────────────────────────────────────────────────────────────
// Gallery loader (images, videos, YouTube & link-lists)
// ────────────────────────────────────────────────────────────────
async function loadGallery(container){
  const owner='XmYx'; // ✏️ adjust
  const repo='magix-photos';
  const paths={photos:'photos',videos:'videos',links:'links'}; // optional links dir

  const fetchDir=async(dir)=>{
    const api=`https://api.github.com/repos/${owner}/${repo}/contents/${dir}`;
    const res=await fetch(api);
    if(!res.ok) throw new Error(res.status);
    return res.json();
  };

  const IMG_EXT=['.jpg','.jpeg','.png','.gif','.webp'];
  const VID_EXT=['.mp4','.webm','.mov'];
  const TXT_EXT=['.txt'];

  const classify=(name)=>{
    const lower=name.toLowerCase();
    if(IMG_EXT.some(e=>lower.endsWith(e))) return 'img';
    if(VID_EXT.some(e=>lower.endsWith(e))) return 'video';
    if(TXT_EXT.some(e=>lower.endsWith(e))) return 'txt';
    return null;
  };

  // Fetch directories in parallel
  const [photoEntries, videoEntries, linkEntries] = await Promise.all([
    fetchDir(paths.photos).catch(()=>[]),
    fetchDir(paths.videos).catch(()=>[]),
    fetchDir(paths.links).catch(()=>[])
  ]);

  // Flatten entries and process txt later
  const images = photoEntries.filter(f=>classify(f.name)==='img');
  const videos = videoEntries.filter(f=>classify(f.name)==='video');
  const txts   = [...photoEntries, ...videoEntries, ...linkEntries].filter(f=>classify(f.name)==='txt');

  // Builders
  const addImg=({download_url,name})=>{
    const img=Object.assign(document.createElement('img'),{src:download_url,alt:name,loading:'lazy'});
    img.className='w-full h-auto object-cover rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer';
    img.addEventListener('click',()=>openMediaModal(img.src,'img'));
    container.appendChild(img);
  };
  const addVid=({download_url,name})=>{
    const vid=document.createElement('video');
    Object.assign(vid,{src:download_url,muted:true,loop:true,playsInline:true,preload:'metadata',title:name});
    vid.className='w-full h-auto object-cover rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer';
    vid.style.aspectRatio='16/9';
    if(isTouchDevice()){
      vid.controls=true;
      vid.addEventListener('click',e=>{if(vid.paused)return;e.preventDefault();openMediaModal(vid.src,'video');});
    }else{
      vid.addEventListener('mouseenter',()=>vid.play());
      vid.addEventListener('mouseleave',()=>{vid.pause();vid.currentTime=0;});
      vid.addEventListener('click',()=>openMediaModal(vid.src,'video'));
    }
    container.appendChild(vid);
  };
  const addYT=url=>{
    const id=getYoutubeId(url); if(!id) return;
    const wrapper=document.createElement('div');
    wrapper.className='relative cursor-pointer';
    wrapper.style.aspectRatio='16/9';
    const img=document.createElement('img');
    img.src=ytThumb(id); img.alt='YouTube thumbnail'; img.loading='lazy';
    img.className='w-full h-full object-cover rounded-lg shadow hover:shadow-lg transition-shadow';
    wrapper.appendChild(img);
    const playIcon=document.createElement('div');
    playIcon.className='absolute inset-0 flex items-center justify-center text-white/90';
    playIcon.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" class="w-14 h-14 drop-shadow-lg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    wrapper.appendChild(playIcon);
    wrapper.addEventListener('click',()=>openMediaModal(url,'youtube'));
    container.appendChild(wrapper);
  };

  images.forEach(addImg);
  videos.forEach(addVid);

  // Parse txt files for extra links
  for(const file of txts){
    try{
      const raw=await fetch(file.download_url).then(r=>r.text());
      raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).forEach(link=>{
        const type=classify(link)|| (getYoutubeId(link)?'youtube':null);
        if(type==='img') addImg({download_url:link,name:link});
        else if(type==='video') addVid({download_url:link,name:link});
        else if(type==='youtube') addYT(link);
      });
    }catch(e){console.error('txt parse',file.name,e);} }

  if(!container.children.length){
    container.innerHTML='<p class="col-span-full text-center py-10 text-red-600">Unable to load gallery.</p>';
  }
}