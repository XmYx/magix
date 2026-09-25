#!/usr/bin/env node
// Organicity gallery server (optional, opt-in). Players who turn the gallery on in Settings can
// submit a city (its share code, a screenshot and a few numbers); nothing appears until a
// moderator approves it. Anyone can report an entry, and enough reports hide it until a moderator
// looks again. Data lives in plain files under ./gallery-data. No dependencies.
//   GALLERY_ADMIN_TOKEN=… node scripts/organicity-gallery.mjs [port]     (default 8788)
// Public endpoints (CORS open):
//   GET  /api/gallery                   → [{ id, title, author, stats, created, likes }] approved
//        ?sort=new|top  &size=512|768|1024  &era=1800|1900|2000|2100 (the century of its year)  &q=text in title or author
//   GET  /api/gallery/<id>              → { …entry, code } the city's share code
//   GET  /api/gallery/<id>/shot.png     → the screenshot
//   POST /api/gallery                   { title, author, code, shot: 'data:image/png;base64,…', stats, consent: true } → 202 { id, status: 'pending' }
//   POST /api/gallery/<id>/report       { reason } → { ok }
//   POST /api/gallery/<id>/like         → { likes } (one like per visitor; again takes it back)
// Moderation (Authorization: Bearer <GALLERY_ADMIN_TOKEN>), and a page for it at /admin:
//   GET  /api/admin/entries             → every entry with its status and reports
//   POST /api/admin/<id>/<approve|reject|hide>
//   DELETE /api/admin/<id>
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIMITS = { body: 3 * 1024 * 1024, code: 2 * 1024 * 1024, shot: 1024 * 1024, title: 60, author: 40, reason: 200, perHour: 6, reportsPerHour: 30, likesPerHour: 120, hideAfter: 3, pending: 200 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// plain text: no control characters or markup, trimmed to a length
export const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, max) => { const x = Math.round(+v); return Number.isFinite(x) ? Math.max(0, Math.min(max, x)) : 0; };

export function createGallery({ dir = 'gallery-data', token = process.env.GALLERY_ADMIN_TOKEN || '', limits = {}, trustProxy = false } = {}) {
  const L = { ...LIMITS, ...limits }, files = join(dir, 'files'), db = join(dir, 'entries.json');
  mkdirSync(files, { recursive: true });
  let entries = existsSync(db) ? JSON.parse(readFileSync(db, 'utf8')) : [];
  const save = () => { writeFileSync(db + '.tmp', JSON.stringify(entries, null, 1)); renameSync(db + '.tmp', db); };
  const saltFile = join(dir, 'visitor-salt');
  if (!existsSync(saltFile)) writeFileSync(saltFile, randomBytes(32), { mode: 0o600 });
  const salt = readFileSync(saltFile);   // reporters and submitters are remembered by a salted hash, never their address
  const who = (req) => createHash('sha256').update(salt).update((trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '').digest('hex').slice(0, 16);
  const hits = new Map();   // rate limits: key → times in the last hour
  const limited = (key, n) => { const now = Date.now(), t = (hits.get(key) || []).filter((x) => now - x < 3600e3); if (t.length >= n) { hits.set(key, t); return true; } t.push(now); hits.set(key, t); return false; };
  const isAdmin = (req) => { if (!token) return false; const a = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, '')), b = Buffer.from(token); return a.length === b.length && timingSafeEqual(a, b); };
  const pub = ({ id, title, author, stats, created, likes }) => ({ id, title, author, stats, created, likes: likes?.length || 0 });
  // the approved list, filtered and sorted as asked
  function listing(q) {
    const size = +q.get('size') || 0, era = +q.get('era') || 0, text = clean(q.get('q'), 60).toLowerCase(), top = q.get('sort') === 'top';
    return entries.filter((e) => e.status === 'approved' && (!size || e.stats.size === size) && (!era || Math.floor(e.stats.year / 100) * 100 === era) && (!text || `${e.title} ${e.author}`.toLowerCase().includes(text)))
      .sort((a, b) => (top ? (b.likes?.length || 0) - (a.likes?.length || 0) : 0) || b.created.localeCompare(a.created)).slice(0, 200).map(pub);
  }
  const send = (res, code, body = '', type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readJson = (req) => new Promise((ok, fail) => {
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > L.body) { fail(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { fail(Object.assign(new Error('not JSON'), { status: 400 })); } });
    req.on('error', fail);
  });

  async function submit(req, res) {
    const d = await readJson(req);
    if (d.consent !== true) return send(res, 400, { error: 'consent required' });
    const title = clean(d.title, L.title), author = clean(d.author, L.author) || 'Anonymous', code = String(d.code || '');
    if (!title) return send(res, 400, { error: 'a title is required' });
    if (!code || code.length > L.code || !/^[A-Za-z0-9_-]+$/.test(code)) return send(res, 400, { error: 'not a city share code' });
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(d.shot || '')), png = m && Buffer.from(m[1], 'base64');
    if (!png || png.length > L.shot || !png.subarray(0, 8).equals(PNG)) return send(res, 400, { error: 'the screenshot must be a PNG under 1 MB' });
    if (entries.filter((e) => e.status === 'pending').length >= L.pending) return send(res, 503, { error: 'the moderation queue is full, try again later' });
    if (limited('s' + who(req), L.perHour)) return send(res, 429, { error: 'too many submissions, try again in an hour' });
    const s = d.stats || {}, id = randomBytes(6).toString('hex');
    writeFileSync(join(files, id + '.code'), code); writeFileSync(join(files, id + '.png'), png);
    entries.push({ id, title, author, stats: { pop: num(s.pop, 1e8), buildings: num(s.buildings, 1e7), year: num(s.year, 9999), size: num(s.size, 4096) }, created: new Date().toISOString(), status: 'pending', reports: [], by: who(req) });
    save(); return send(res, 202, { id, status: 'pending' });
  }
  function remove(id) { entries = entries.filter((e) => e.id !== id); for (const x of ['.code', '.png']) try { unlinkSync(join(files, id + x)); } catch { /* already gone */ } save(); }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      const url = new URL(req.url, 'http://x'), path = url.pathname;
      if (path === '/admin' && req.method === 'GET') return send(res, 200, ADMIN_PAGE, 'text/html; charset=utf-8');
      if (path === '/api/gallery' && req.method === 'GET') return send(res, 200, listing(url.searchParams));
      if (path === '/api/gallery' && req.method === 'POST') return await submit(req, res);
      let m = path.match(/^\/api\/gallery\/([0-9a-f]{12})(\/shot\.png|\/report|\/like)?$/);
      if (m) {
        const e = entries.find((x) => x.id === m[1]), admin = isAdmin(req);
        if (!e || (e.status !== 'approved' && !admin)) return send(res, 404, { error: 'not found' });
        if (!m[2] && req.method === 'GET') return send(res, 200, { ...pub(e), code: readFileSync(join(files, e.id + '.code'), 'utf8') });
        if (m[2] === '/shot.png' && req.method === 'GET') return send(res, 200, readFileSync(join(files, e.id + '.png')), 'image/png');
        if (m[2] === '/like' && req.method === 'POST') {
          const r = who(req); if (limited('l' + r, L.likesPerHour)) return send(res, 429, { error: 'too many likes' });
          e.likes ||= []; const i = e.likes.indexOf(r); if (i >= 0) e.likes.splice(i, 1); else e.likes.push(r);
          save(); return send(res, 200, { likes: e.likes.length, liked: i < 0 });
        }
        if (m[2] === '/report' && req.method === 'POST') {
          const d = await readJson(req).catch(() => ({})), r = who(req);
          if (limited('r' + r, L.reportsPerHour)) return send(res, 429, { error: 'too many reports' });
          if (!e.reports.some((x) => x.by === r)) e.reports.push({ by: r, reason: clean(d.reason, L.reason), at: new Date().toISOString() });
          if (e.reports.length >= L.hideAfter) e.status = 'hidden';   // out of the gallery until a moderator looks again
          save(); return send(res, 200, { ok: true });
        }
      }
      if (path.startsWith('/api/admin/')) {
        if (!isAdmin(req)) return send(res, 401, { error: 'moderator token required' });
        if (path === '/api/admin/entries' && req.method === 'GET') return send(res, 200, entries.map(({ by, ...e }) => e));
        m = path.match(/^\/api\/admin\/([0-9a-f]{12})(?:\/(approve|reject|hide))?$/);
        const e = m && entries.find((x) => x.id === m[1]); if (!e) return send(res, 404, { error: 'not found' });
        if (req.method === 'DELETE' && !m[2]) { remove(e.id); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && m[2]) { e.status = { approve: 'approved', reject: 'rejected', hide: 'hidden' }[m[2]]; if (m[2] === 'approve') e.reports = []; save(); return send(res, 200, { ok: true, status: e.status }); }
      }
      return send(res, 404, { error: 'Organicity gallery' });
    } catch (err) { return send(res, err.status || 500, { error: err.status ? err.message : 'server error' }); }
  });
  return { server, entries: () => entries };
}

const ADMIN_PAGE = `<!doctype html><meta charset="utf-8"><title>Gallery moderation</title><meta name="viewport" content="width=device-width">
<style>body{font:14px system-ui;margin:16px;background:#161b24;color:#e8e4d8}input,button{font:inherit}.e{display:flex;gap:12px;border:1px solid #3a4250;padding:8px;margin:8px 0;flex-wrap:wrap}.e img{width:240px;max-width:100%;image-rendering:pixelated}.pending{border-color:#d8a038}.hidden{border-color:#c8423a}small{color:#9aa}</style>
<h1>Organicity gallery</h1><p><input id=t type=password placeholder="moderator token" size=40> <button id=go>Load</button></p><div id=list></div>
<script>
const $=(s)=>document.querySelector(s),auth=()=>({authorization:'Bearer '+$('#t').value}),api=(p,o={})=>fetch(p,{...o,headers:auth()}).then(r=>r.ok?r.json():Promise.reject(r.status));
const esc=(s)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
async function load(){const L=await api('/api/admin/entries').catch(e=>{alert('Error '+e);return[]});L.sort((a,b)=>(b.status==='pending')-(a.status==='pending')||b.created.localeCompare(a.created));
$('#list').innerHTML=L.map(e=>'<div class="e '+e.status+'"><img data-id="'+e.id+'" alt=""><div><b>'+esc(e.title)+'</b> by '+esc(e.author)+'<br><small>'+e.status+' · '+e.created+' · pop '+e.stats.pop+' · '+e.reports.length+' reports</small><br>'+e.reports.map(r=>'<small>“'+esc(r.reason)+'”</small>').join('<br>')+'<p>'+['approve','reject','hide'].map(a=>'<button data-a="'+a+'" data-id="'+e.id+'">'+a+'</button>').join(' ')+' <button data-del="'+e.id+'">delete</button></p></div></div>').join('')||'<p>No entries.</p>';
for(const i of document.querySelectorAll('img[data-id]'))fetch('/api/gallery/'+i.dataset.id+'/shot.png',{headers:auth()}).then(r=>r.blob()).then(b=>i.src=URL.createObjectURL(b));
for(const b of document.querySelectorAll('[data-a]'))b.onclick=()=>api('/api/admin/'+b.dataset.id+'/'+b.dataset.a,{method:'POST'}).then(load);
for(const b of document.querySelectorAll('[data-del]'))b.onclick=()=>confirm('Delete for good?')&&api('/api/admin/'+b.dataset.del,{method:'DELETE'}).then(load);}
$('#go').onclick=load;
</script>`;

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = +(process.argv[2] || process.env.PORT || 8788);
  if (!process.env.GALLERY_ADMIN_TOKEN) console.warn('GALLERY_ADMIN_TOKEN is not set: submissions queue up, but nobody can approve them.');
  createGallery({ trustProxy: process.env.GALLERY_TRUST_PROXY === '1' }).server.listen(port, () => console.log(`Organicity gallery on http://localhost:${port} (moderation at /admin)`));
}
