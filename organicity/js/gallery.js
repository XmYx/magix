// Organicity — the opt-in gallery of shared cities (scripts/organicity-gallery.mjs). Off until the
// player gives a gallery server in Settings; nothing is sent anywhere unless they submit a city
// themselves, and a submission waits for a moderator before anyone sees it.
const KEY = 'organicity-gallery-url';

export function galleryUrl() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
export function setGalleryUrl(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw new Error('The gallery address must start with http:// or https://');
  try { if (u) localStorage.setItem(KEY, u); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  return u;
}

async function call(url, path, opts = {}) {
  const res = await fetch(url + path, { ...opts, headers: opts.body ? { 'content-type': 'application/json' } : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The gallery answered ${res.status}`);
  return data;
}
export const listCities = (url = galleryUrl(), filters = {}) => {
  const q = new URLSearchParams();
  for (const k of ['q', 'size', 'era', 'sort']) if (filters[k]) q.set(k, filters[k]);
  return call(url, '/api/gallery?' + q);
};
export const likeCity = (url, id) => call(url, `/api/gallery/${encodeURIComponent(id)}/like`, { method: 'POST' });
export function cityLink(url, id, base = location.href) {
  const link = new URL(base);
  if (!['http:', 'https:'].includes(link.protocol)) throw new Error('Use the web game address for a shareable link.');
  link.hash = new URLSearchParams({ gallery: url, entry: id }).toString();
  return link.href;
}
export function readGalleryLink(hash) {
  const q = new URLSearchParams(hash.replace(/^#/, '')), url = q.get('gallery'), id = q.get('entry');
  if (!url || !/^[0-9a-f]{12}$/.test(id || '')) return null;
  try { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null; return { url: url.replace(/\/+$/, ''), id }; } catch { return null; }
}
export const fetchCity = (url, id) => call(url, `/api/gallery/${encodeURIComponent(id)}`);
export const shotUrl = (url, id) => `${url}/api/gallery/${encodeURIComponent(id)}/shot.png`;
export const reportCity = (url, id, reason) => call(url, `/api/gallery/${encodeURIComponent(id)}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
export const submitCity = (url, entry) => call(url, '/api/gallery', { method: 'POST', body: JSON.stringify({ ...entry, consent: entry.consent === true }) });

// a screenshot small enough for the gallery: at most 800 pixels wide, as a PNG
export function smallShot(dataUrl, max = 800) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / img.width), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/png'));
    };
    img.onerror = () => fail(new Error('Could not read the screenshot'));
    img.src = dataUrl;
  });
}
