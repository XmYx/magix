// Organicity service worker: plays offline once visited. Game files are fetched fresh
// when online (network first, so updates show up immediately) and served from the
// cache when offline; three.js and fonts from CDNs are cached on first use.
const CACHE = 'organicity-v7';
const SHELL = ['./', 'index.html', 'city.css', 'manifest.webmanifest', 'icon.svg', 'packs/index.json', 'packs/sample-pack.json',
  ...['aviation', 'citizens', 'infrastructure', 'photo', 'water', 'main', 'world', 'sim', 'render', 'tools', 'ui', 'save', 'audio', 'scenarios', 'share', 'region', 'disasters', 'terrain', 'transit', 'config', 'eras',
    'core', 'worker', 'assign', 'agents', 'agent-worker', 'procgen', 'roads', 'routes', 'util', 'weather', 'i18n', 'packs',
    'builder', 'tile-worker', 'tilehost', 'tileview', 'regionsim', 'families', 'presidents', 'grid', 'resources', 'preview', 'saves', 'mp', 'mpgame', 'phrases', 'gallery'].map((f) => `js/${f}.js`)];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url), same = url.origin === self.location.origin;
  if (same) {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  } else if (/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
  }
});
