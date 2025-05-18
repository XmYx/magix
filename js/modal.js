/* modal.js — simple media overlay */
import { getYoutubeId } from './utils.js';

export function openMediaModal(src, type = 'img') {
  if (document.getElementById('mediaOverlay')) return;          // prevent duplicates

  const overlay = Object.assign(document.createElement('div'), { id: 'mediaOverlay' });
  Object.assign(overlay.style, {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.9)',
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
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  let nodeToAppend;

  switch (type) {
    case 'youtube': {
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

      const iframe = document.createElement('iframe');
      Object.assign(iframe, {
        src: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        frameBorder: 0,
        allowFullscreen: true
      });
      Object.assign(iframe.style, { position: 'absolute', inset: 0, width: '100%', height: '100%' });

      wrap.appendChild(iframe);
      nodeToAppend = wrap;
      break;
    }

    case 'video': {
      const video = document.createElement('video');
      Object.assign(video, { src, autoplay: true, controls: true, playsInline: true });
      Object.assign(video.style, { maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px' });
      nodeToAppend = video;
      break;
    }

    default: {                                            // image
      const img = document.createElement('img');
      img.src = src;
      Object.assign(img.style, { maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px' });
      nodeToAppend = img;
    }
  }

  overlay.appendChild(nodeToAppend);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}
