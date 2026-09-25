#!/usr/bin/env node
// Organicity signalling server (optional). Multiplayer works without any server by pasting join
// and answer codes; run this to swap them automatically instead. It only relays those short codes
// (WebRTC connection offers) between players who know the same room name, keeps everything in
// memory, and forgets a room after 30 minutes. No dependencies.
//   node scripts/organicity-signal.mjs [port]          (default 8787)
// Endpoints (CORS open, bodies are plain text up to 64 KB):
//   POST /r/<room>/join            body: join code   → { "id": "…" }
//   GET  /r/<room>/pending         → [{ "id", "code" }] joins not yet answered (the host polls)
//   POST /r/<room>/answer/<id>     body: answer code
//   GET  /r/<room>/answer/<id>     → 200 answer code, or 204 while waiting (the guest polls)
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const PORT = +(process.argv[2] || process.env.PORT || 8787), TTL = 30 * 60e3, MAX = 64 * 1024;
const rooms = new Map();
const room = (name) => { let r = rooms.get(name); if (!r) rooms.set(name, (r = { seen: Date.now(), joins: new Map() })); r.seen = Date.now(); return r; };
setInterval(() => { const now = Date.now(); for (const [k, r] of rooms) if (now - r.seen > TTL) rooms.delete(k); }, 60e3).unref();

const send = (res, code, body = '', type = 'text/plain') => {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' });
  res.end(body);
};
const readBody = (req) => new Promise((ok, fail) => {
  let n = 0; const parts = [];
  req.on('data', (c) => { n += c.length; if (n > MAX) { fail(new Error('too large')); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts).toString('utf8'))); req.on('error', fail);
});

export const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const m = new URL(req.url, 'http://x').pathname.match(/^\/r\/([\w-]{1,48})\/(join|pending|answer)(?:\/([\w-]{1,48}))?$/);
  if (!m) return send(res, 404, 'Organicity signalling server');
  const [, name, what, id] = m, r = room(name);
  try {
    if (what === 'join' && req.method === 'POST') {
      if (r.joins.size > 32) return send(res, 429, 'room full');
      const code = (await readBody(req)).trim(); if (!code.startsWith('OJ')) return send(res, 400, 'not a join code');
      const jid = randomUUID(); r.joins.set(jid, { code, answer: null, t: Date.now() });
      return send(res, 200, JSON.stringify({ id: jid }), 'application/json');
    }
    if (what === 'pending' && req.method === 'GET') return send(res, 200, JSON.stringify([...r.joins].filter(([, j]) => !j.answer).map(([jid, j]) => ({ id: jid, code: j.code }))), 'application/json');
    if (what === 'answer' && id && r.joins.has(id)) {
      const j = r.joins.get(id);
      if (req.method === 'POST') { const a = (await readBody(req)).trim(); if (!a.startsWith('OA')) return send(res, 400, 'not an answer code'); j.answer = a; return send(res, 204); }
      if (req.method === 'GET') { if (!j.answer) return send(res, 204); const a = j.answer; r.joins.delete(id); return send(res, 200, a); }
    }
    return send(res, 404, 'unknown');
  } catch (e) { return send(res, 400, e.message); }
});

if (import.meta.url === pathToFileURL(process.argv[1]).href) server.listen(PORT, () => console.log(`Organicity signalling on http://localhost:${PORT}`));
