#!/usr/bin/env node
// Organicity signalling relay (optional). By default players connect through the public PeerJS
// relay; run this to use your own instead (give its address under Connection settings, host and
// players alike). It only passes the short WebRTC handshake messages (offer, answer, network
// candidates) between two ids until the players are connected, keeps everything in memory, and
// forgets a mailbox a minute after its owner stops polling. No dependencies.
//   node scripts/organicity-signal.mjs [port]          (default 8787)
// Endpoints (CORS open, JSON):
//   GET  /m/<id>?wait=0      claim or touch the mailbox <id>, returns [] at once
//   GET  /m/<id>             long-poll (up to 25 s) → [{ type, src, payload }, …]
//   POST /m/<to>             { src, type, payload } → 204, or 404 when nobody holds <to>
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const PORT = +(process.argv[2] || process.env.PORT || 8787), TTL = 60e3, MAX = 64 * 1024, QUEUE = 200, WAIT = 25e3;
const ID = /^[\w-]{4,80}$/, TYPES = new Set(['OFFER', 'ANSWER', 'CANDIDATE', 'LEAVE']);
const boxes = new Map();   // id → { seen, q: [], waiters: [] }
const box = (id) => { let b = boxes.get(id); if (!b) boxes.set(id, (b = { seen: Date.now(), q: [], waiters: [] })); return b; };
setInterval(() => { const now = Date.now(); for (const [k, b] of boxes) if (now - b.seen > TTL && !b.waiters.length) boxes.delete(k); }, 10e3).unref();

const send = (res, code, body = '') => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok, fail) => {
  let n = 0; const parts = [];
  req.on('data', (c) => { n += c.length; if (n > MAX) { fail(new Error('too large')); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts).toString('utf8'))); req.on('error', fail);
});

export const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const u = new URL(req.url, 'http://x'), m = u.pathname.match(/^\/m\/([^/]+)$/), id = m && decodeURIComponent(m[1]);
  if (!id || !ID.test(id)) return send(res, 404, { error: 'Organicity signalling relay' });
  try {
    if (req.method === 'GET') {
      const b = box(id); b.seen = Date.now();
      if (b.q.length || u.searchParams.get('wait') === '0') return send(res, 200, b.q.splice(0));
      let done = false;
      const reply = (msgs) => { if (done) return; done = true; clearTimeout(t); b.seen = Date.now(); send(res, 200, msgs); };
      const t = setTimeout(() => { b.waiters = b.waiters.filter((w) => w !== reply); reply([]); }, WAIT);
      b.waiters.push(reply); req.on('close', () => { if (!done) { done = true; clearTimeout(t); b.waiters = b.waiters.filter((w) => w !== reply); } });
      return;
    }
    if (req.method === 'POST') {
      const b = boxes.get(id); if (!b || Date.now() - b.seen > TTL) return send(res, 404, { error: 'nobody holds that id' });
      const d = JSON.parse(await readBody(req));
      if (!TYPES.has(d.type) || typeof d.src !== 'string' || !ID.test(d.src)) return send(res, 400, { error: 'not a handshake message' });
      if (b.q.length >= QUEUE) return send(res, 429, { error: 'mailbox full' });
      const msg = { type: d.type, src: d.src, payload: d.payload ?? null };
      const w = b.waiters.shift(); if (w) w([msg]); else b.q.push(msg);
      return send(res, 204);
    }
    return send(res, 405, { error: 'method' });
  } catch (e) { return send(res, 400, { error: e.message }); }
});

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) server.listen(PORT, () => console.log(`Organicity signalling relay on http://localhost:${PORT}`));
