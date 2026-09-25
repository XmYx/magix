// Organicity desktop — the browser game in its own window, for Linux, macOS and Windows.
// The game files are served from an app:// protocol (ES modules need a real origin), with
// three.js from the bundled copy instead of the CDN, so the game runs fully offline.
// Saves live in the app's own profile (IndexedDB and localStorage), exactly as in a browser.
const { app, BrowserWindow, protocol, shell, Menu, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const HOST = 'game';
// the game and three.js: packaged under resources/app, or taken from the repository when run with `npm start`
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
const THREE_DIR = app.isPackaged ? path.join(ROOT, 'vendor', 'three') : path.join(__dirname, 'node_modules', 'three');
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };

// map an app://game/… path to a file, refusing anything outside the game and three.js folders
function resolve(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (rel.startsWith('vendor/three/')) { const f = path.resolve(THREE_DIR, rel.slice('vendor/three/'.length)); return f.startsWith(THREE_DIR + path.sep) ? f : null; }
  const base = path.join(ROOT, 'organicity'), f = path.resolve(base, rel.replace(/^organicity\//, ''));
  return f.startsWith(base + path.sep) || f === base ? f : null;
}

async function serve(request) {
  const u = new URL(request.url);
  let file = resolve(u.pathname === '/' ? '/organicity/index.html' : u.pathname);
  if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (path.basename(file) === 'index.html') {   // point the import map at the bundled three.js
    const html = fs.readFileSync(file, 'utf8').split(THREE_CDN).join(`app://${HOST}/vendor/three/`);
    return new Response(html, { headers: { 'content-type': type } });
  }
  const res = await net.fetch(pathToFileURL(file).toString());
  return new Response(res.body, { headers: { 'content-type': type } });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, title: 'Organicity', backgroundColor: '#161b24',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(`app://${HOST}/organicity/index.html`);
  // ORGANICITY_SMOKE=1: found a city, check it runs without errors, print the result and quit (CI)
  if (process.env.ORGANICITY_SMOKE) {
    const errors = [];
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    win.webContents.once('did-finish-load', async () => {
      try {
        await win.webContents.executeJavaScript("document.getElementById('introGo').click()");
        await new Promise((r) => setTimeout(r, 9000));
        const state = await win.webContents.executeJavaScript('({ city: !!window.city, buildings: window.city?.world.buildings.size ?? -1, edges: window.city?.world.net.edges.size ?? -1, three: !!document.querySelector("canvas"), desktop: !!window.organicityDesktop })');
        console.log(JSON.stringify({ ...state, errors }));
        app.exit(state.city && !errors.length ? 0 : 1);
      } catch (e) { console.log(JSON.stringify({ error: String(e), errors })); app.exit(1); }
    });
  }
  // links out of the game open in the system browser; the game window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(`app://${HOST}/organicity/`)) return;
    e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url);
  });
  return win;
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { label: 'Game', submenu: [{ role: 'reload', label: 'Restart' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' }] },
  { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }])] },
]));

app.whenReady().then(() => {
  protocol.handle('app', serve);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
