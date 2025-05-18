/* gallery.js — GitHub‑powered photo / video / embed / link gallery
   v3.2 — 2025‑05‑18 — Miklós Nagy
   ✔ videos autoplay on hover (desktop)
   ✔ click or second tap opens a full‑screen modal
   ✔ share overlay no longer intercepts pointer events,
     so autoplay & clicks work as expected
   ✔ NEW: simple iframe embeds via the `iframe:` prefix
     (optionally followed by an aspect‑ratio, e.g. `iframe:https://example.com 4/3`)
   ✔ regular http/https links in .txt lists now always fall back to a card preview
*/

import { isTouchDevice, getYoutubeId, ytThumb } from './utils.js';
import { openMediaModal } from './modal.js';               // img / video / YouTube

/* ─────────── config ─────────── */
const owner = 'XmYx';          // ✏️ GitHub user/org
const repo  = 'magix-photos';  // ✏️ repo
const paths = { photos: 'photos', videos: 'videos', links: 'links' };

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const VID_EXT = ['.mp4', '.webm', '.mov'];
const TXT_EXT = ['.txt'];

/* ─────────── helpers ─────────── */
const classify = str => {
  const s = str.trim().toLowerCase();
  // full <iframe …>…</iframe> embed
  if (s.startsWith('<iframe'))                    return 'iframe';
  // “iframe:URL [ratio]” shorthand
  if (s.startsWith('iframe:'))                    return 'iframe';
  if (IMG_EXT.some(e => s.endsWith(e)))           return 'img';
  if (VID_EXT.some(e => s.endsWith(e)))           return 'video';
  if (TXT_EXT.some(e => s.endsWith(e)))           return 'txt';
  if (getYoutubeId(str))                          return 'youtube';
  if (/vimeo\.com\/\d+/i.test(str))               return 'vimeo';
  if (/instagram\.com\/(?:p|reel)\//i.test(str))   return 'instagram';
  if (/codepen\.io\/[^/]+\/pen\//i.test(str))      return 'codepen';
  if (/codesandbox\.io\/s\//i.test(str))           return 'codesandbox';
  return 'link';
};

const fetchDir = async dir => {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dir}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status);
  return res.json();
};

/* ░░ Share buttons — pointer‑events‑safe ░░ */
const makeShareOverlay = url => {
  const ov = document.createElement('div');
  ov.className =
    'absolute inset-0 flex items-end justify-end opacity-0 hover:opacity-100 transition';
  ov.style.pointerEvents = 'none';                          // ← allow events to reach media

  ov.innerHTML = `
    <div class="bg-black/60 backdrop-blur px-2 py-1 m-2 rounded flex gap-3">
      <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}"
         target="_blank" rel="noopener"
         class="text-white hover:text-indigo-300" title="Share on Facebook"
         style="pointer-events:auto">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5"
             viewBox="0 0 24 24" fill="currentColor">
          <path d="M22 12c0-5.522-4.477-10-10-10S2 6.478 2 12c0 5.006 3.676 9.128 8.438 9.877v-6.987H7.898v-2.89h2.54V9.845c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.463h-1.26c-1.242 0-1.63.771-1.63 1.562v1.875h2.773l-.443 2.89h-2.33v6.987C18.324 21.128 22 17.006 22 12z"/>
        </svg>
      </a>
      <button class="text-white hover:text-indigo-300" title="Share on Instagram"
              style="pointer-events:auto" data-ig>
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5"
             viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 2C4.243 2 2 4.243 2 7v10c0 2.757 2.243 5 5 5h10c2.757 0 5-2.243 5-5V7c0-2.757-2.243-5-5-5H7zm10 2c1.654 0 3 1.346 3 3v10c0 1.654-1.346 3-3 3H7c-1.654 0-3-1.346-3-3V7c0-1.654 1.346-3 3-3h10zm-5 3a5 5 0 100 10 5 5 0 000-10zm6.5-.5a1.5 1.5 0 11-3.001.001A1.5 1.5 0 0118.5 6.5zM12 9a3 3 0 110 6 3 3 0 010-6z"/>
        </svg>
      </button>
    </div>`;
  ov.querySelector('[data-ig]').addEventListener('click', async e => {
    e.preventDefault(); e.stopPropagation();
    if (navigator.share) {
      await navigator.share({ url });
    } else {
      try { await navigator.clipboard.writeText(url); alert('Link copied!'); }
      catch { window.open(url, '_blank'); }
    }
  });

  return ov;
};

/* lightweight modal for iframes & embeds */
const openIframeModal = (src, ratio = '16/9') => {
  if (document.getElementById('mediaOverlay')) return;

  const overlay = Object.assign(document.createElement('div'), { id: 'mediaOverlay' });
  Object.assign(overlay.style, {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.9)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
  });

  const close = () => { document.body.style.overflow = ''; overlay.remove(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  window.addEventListener('keydown', e => e.key === 'Escape' && close(), { once: true });

  const shell = document.createElement('div');
  Object.assign(shell.style, { position: 'relative', borderRadius: '8px', overflow: 'hidden' });

  const fit = () => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const [wR, hR] = ratio.split('/').map(Number);
    const h = Math.min(vh, vw * (hR / wR));
    shell.style.width  = `${h * (wR / hR)}px`;
    shell.style.height = `${h}px`;
  };
  fit(); window.addEventListener('resize', fit, { passive: true });

  const iframe = Object.assign(document.createElement('iframe'),
    { src, frameBorder: 0, allowFullscreen: true });
  Object.assign(iframe.style, { position: 'absolute', inset: 0, width: '100%', height: '100%' });

  shell.appendChild(iframe); overlay.appendChild(shell);
  document.body.appendChild(overlay); document.body.style.overflow = 'hidden';
};

/* ─────────── builders ─────────── */
const buildImg = (url, name, container) => {
  const box = document.createElement('div'); box.className = 'relative';
  const img = Object.assign(document.createElement('img'), {
    src: url, alt: name, loading: 'lazy',
    className: 'w-full h-auto object-cover rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer'
  });
  img.addEventListener('click', () => openMediaModal(url, 'img'));
  box.append(img, makeShareOverlay(url)); container.appendChild(box);
};

const buildVideo = (url, name, container) => {
  const box = document.createElement('div'); box.className = 'relative';
  const vid = document.createElement('video');
  Object.assign(vid, { src: url, muted: true, loop: true, playsInline: true, preload: 'metadata', title: name });
  vid.className = 'w-full h-auto object-cover rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer';
  vid.style.aspectRatio = '16/9';

  if (isTouchDevice()) {
    vid.controls = true;
    vid.addEventListener('click', e => {
      if (vid.paused) return;                   // 1st tap = play, 2nd tap = modal
      e.preventDefault(); openMediaModal(url, 'video');
    });
  } else {
    vid.addEventListener('mouseenter', () => vid.play());
    vid.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
    vid.addEventListener('click', () => openMediaModal(url, 'video'));
  }
  box.append(vid, makeShareOverlay(url)); container.appendChild(box);
};

const buildYouTube = (rawUrl, container) => {
  const id = getYoutubeId(rawUrl); if (!id) return;
  const box = document.createElement('div'); box.className = 'relative cursor-pointer'; box.style.aspectRatio = '16/9';

  const thumb = Object.assign(document.createElement('img'), {
    src: ytThumb(id), loading: 'lazy', alt: 'YouTube thumbnail',
    className: 'w-full h-full object-cover rounded-lg shadow hover:shadow-lg transition-shadow'
  });
  const play = document.createElement('div');
  play.className = 'absolute inset-0 flex items-center justify-center text-white/90';
  play.innerHTML  = '<svg xmlns="http://www.w3.org/2000/svg" class="w-14 h-14 drop-shadow-lg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

  box.addEventListener('click', () => openMediaModal(rawUrl, 'youtube'));
  box.append(thumb, play, makeShareOverlay(rawUrl)); container.appendChild(box);
};

const buildIframe = (url, ratio, container) => {
  const box = document.createElement('div'); box.className = 'relative rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden';
  box.style.aspectRatio = ratio;

  const iframe = Object.assign(document.createElement('iframe'),
    { src: url, frameBorder: 0, allowFullscreen: true, loading: 'lazy' });
  Object.assign(iframe.style, { position: 'absolute', inset: 0, width: '100%', height: '100%' });

  box.addEventListener('click', () => openIframeModal(url, ratio));
  box.append(iframe, makeShareOverlay(url)); container.appendChild(box);
};

const buildLinkCard = async (url, container) => {
  const card = document.createElement('a');
  Object.assign(card, { href: url, target: '_blank', rel: 'noopener' });
  card.className =
    'relative block rounded-lg shadow hover:shadow-lg transition p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700';
  card.style.breakInside = 'avoid';

  const host = (new URL(url)).hostname.replace(/^www\./, '');
  let title = host;
  try {
    const res = await fetch(`https://r.jina.ai/http://${host}`);
    if (res.ok) {
      const text = await res.text();
      const m = text.match(/<title>([^<]+)<\/title>/i);
      if (m) title = m[1].trim().slice(0, 100);
    }
  } catch { /* sniff failure – ignore */ }

  card.innerHTML = `
    <div class="flex items-center gap-3">
      <img src="https://www.google.com/s2/favicons?domain=${host}" class="w-5 h-5 opacity-80" alt="">
      <div class="font-semibold">${title}</div>
    </div>
    <div class="text-xs text-gray-500 mt-1">${host}</div>`;
  card.append(makeShareOverlay(url)); container.appendChild(card);
};

/* ─────────── loader ─────────── */
export async function loadGallery(container) {
  /* 1 ◾ repo listing */
  const [photos, videos, linksDir] = await Promise.all([
    fetchDir(paths.photos).catch(() => []),
    fetchDir(paths.videos).catch(() => []),
    fetchDir(paths.links).catch(() => [])
  ]);
  const txtFiles = [...photos, ...videos, ...linksDir].filter(f => classify(f.name) === 'txt');

  /* 2 ◾ direct media */
  photos.filter(f => classify(f.name) === 'img')
        .forEach(f => buildImg(f.download_url, f.name, container));
  videos.filter(f => classify(f.name) === 'video')
        .forEach(f => buildVideo(f.download_url, f.name, container));

  /* 3 ◾ links in .txt lists */
  for (const file of txtFiles) {
    try {
      const lines = (await fetch(file.download_url).then(r => r.text()))
                    .split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const raw of lines) {
        const type = classify(raw);
        switch (type) {
          case 'img':        buildImg(raw, raw, container);          break;
          case 'video':      buildVideo(raw, raw, container);        break;
          case 'youtube':    buildYouTube(raw, container);          break;
          case 'vimeo': {
            const id = raw.match(/vimeo\.com\/(\d+)/i)[1];
            buildIframe(`https://player.vimeo.com/video/${id}`, '16/9', container); break; }
          case 'instagram':  buildIframe(`${raw}embed/`, '1/1', container); break;
          case 'codepen':
          case 'codesandbox':buildIframe(raw, '16/9', container);   break;

          case 'iframe': {
            let src;
            let ratio = '16/9';

            if (raw.trim().toLowerCase().startsWith('<iframe')) {
              // extract src, width, height from the full <iframe> tag
              const mSrc = raw.match(/src=(["'])(.*?)\1/i);
              const mW   = raw.match(/width=(["'])(\d+)\1/i);
              const mH   = raw.match(/height=(["'])(\d+)\1/i);
              if (!mSrc) break;
              src = mSrc[2];
              if (mW && mH) {
                ratio = `${mW[2]}/${mH[2]}`;
              }
            } else {
              // “iframe:URL [ratio]” shorthand
              const parts = raw.split(/\s+/);
              src = parts[0].replace(/^iframe:/i, '');
              const r = parts.find(p => /^\d+\/\d+$/.test(p));
              if (r) ratio = r;
            }

            buildIframe(src, ratio, container);
            break;
          }
          default:           await buildLinkCard(raw, container);   break;
        }
      }
    } catch (e) { console.error('txt parse', file.name, e); }
  }

  /* 4 ◾ fallback */
  if (!container.children.length) {
    container.innerHTML =
      '<p class="col-span-full text-center py-10 text-red-600">Unable to load gallery.</p>';
  }
}
