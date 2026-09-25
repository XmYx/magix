// Organicity — multiplayer. Players share one region over peer-to-peer WebRTC data channels.
// The host keeps the region (tiles, owners, AI governors, contracts) and relays; every player
// runs their own city at full fidelity and sends its numbers and view each month, so everyone
// sees everyone's cities grow next door. Chat, trades (money, commodity and utility contracts),
// tile claims and a leaderboard ride along.
// Connecting: the host gets a short access code (ABCD-EFGH) and gives it to friends; a guest
// types it in and the two browsers find each other through a signalling relay (the public
// PeerJS server by default, or scripts/organicity-signal.mjs), which only passes the WebRTC
// offer, answer and network candidates. After that the game runs peer to peer. Without any
// relay, codes can still be pasted both ways. Everything a peer sends is checked before use.
import { encodeSave, decodeSave } from './share.js';

export const PROTOCOL = 1;
export const COLORS = ['#e05a4a', '#3a8ae0', '#e8c040', '#5ab86a', '#9a5ac8', '#e07a30', '#40c0c0', '#e060a8'];
export const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
// STUN and TURN servers as typed: space-separated, a TURN server's login as turn:user:password@host:port
export function parseIce(text) {
  const out = [];
  for (const tok of String(text || '').split(/[\s,]+/)) {
    const m = /^(stuns?|turns?):(?:([^:@\s]+):([^@\s]+)@)?([^@\s]+)$/.exec(tok); if (!m) continue;
    const s = { urls: `${m[1]}:${m[4]}` }; if (m[2]) { s.username = decodeURIComponent(m[2]); s.credential = decodeURIComponent(m[3]); }
    out.push(s);
  }
  return out;
}
const CHUNK = 48000, MAX_MSG = 8e6;

// ---------------------------------------------------------------- checking what peers send
const str = (v, n = 64) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v, lo = -1e12, hi = 1e12) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : 0);
export const isKey = (k) => typeof k === 'string' && /^\d{1,2},\d{1,2}$/.test(k);
export function cleanSummary(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  for (const k of ['pop', 'jobs', 'jobsFree', 'unemployed', 'year', 'money', 'growth', 'day']) out[k] = num(s[k]);
  out.name = str(s.name, 24);
  out.thumb = typeof s.thumb === 'string' && s.thumb.startsWith('data:image/png;base64,') && s.thumb.length < 60000 ? s.thumb : null;
  if (s.edges && typeof s.edges === 'object') { out.edges = {}; for (const side of ['west', 'east', 'north', 'south']) if (Array.isArray(s.edges[side]) && s.edges[side].length <= 512) out.edges[side] = s.edges[side].map((v) => num(v, -100, 1000)); }
  if (Array.isArray(s.exits)) out.exits = s.exits.slice(0, 32).map((e) => ({ side: ['west', 'east', 'north', 'south'].includes(e?.side) ? e.side : 'west', pos: num(e?.pos, 0, 1024) }));
  if (s.surplus) out.surplus = { power: num(s.surplus.power), water: num(s.surplus.water) };
  if (Array.isArray(s.services)) out.services = s.services.filter((x) => typeof x === 'string').slice(0, 16).map((x) => x.slice(0, 24));
  if (s.industry && typeof s.industry === 'object') {
    const obj = (o) => Object.fromEntries(Object.entries(o || {}).slice(0, 24).map(([k, v]) => [str(k, 16), num(v, 0, 1e7)]));
    out.industry = { sold: obj(s.industry.sold), bought: obj(s.industry.bought), exchange: !!s.industry.exchange };
  }
  return out;
}
export function cleanView(v) {
  if (!v || typeof v !== 'object' || v.S !== 128 || typeof v.cls !== 'string' || typeof v.hgt !== 'string' || typeof v.boxes !== 'string') return null;
  if (v.cls.length > 30000 || v.hgt.length > 30000 || v.boxes.length > 400000) return null;
  if (!/^[A-Za-z0-9+/=]*$/.test(v.cls + v.hgt + v.boxes)) return null;
  return { S: 128, cls: v.cls, hgt: v.hgt, boxes: v.boxes, n: num(v.n, 0, 30000) };
}
export function cleanBlocks(b) {
  if (!b || !Array.isArray(b.housing) || !Array.isArray(b.jobs)) return null;
  const row = (r, keys) => Object.fromEntries(keys.map((k) => [k, num(r?.[k], -1e6, 1e6)]));
  return {
    housing: b.housing.slice(0, 6000).map((h) => row(h, ['id', 'units', 'occ', 'quality', 'x', 'z', 'appeal', 'pollution', 'crime', 'services'])),
    jobs: b.jobs.slice(0, 6000).map((j) => ({ ...row(j, ['id', 'slots', 'filled', 'level', 'x', 'z']), kind: ['C', 'I', 'O'].includes(j?.kind) ? j.kind : 'C' })),
  };
}

// ---------------------------------------------------------------- links: JSON messages over a channel, chunked
export class Link {
  constructor(ch, pc = null) {
    this.ch = ch; this.pc = pc; this.parts = new Map(); this.onmsg = null; this.onclose = null; this.closed = false; this.lastSeen = Date.now();   // (holding pc keeps it from being collected)
    const gone = this.gone = () => { if (this.closed) return; this.closed = true; this.onclose?.(); };
    ch.onmessage = (e) => this.recv(typeof e === 'string' ? e : e.data);
    ch.onclose = gone;
    if (pc) pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) gone(); });
  }
  send(msg) {
    const s = JSON.stringify(msg);
    if (s.length <= CHUNK) { this.ch.send(s); return; }
    const id = Math.random().toString(36).slice(2), n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) this.ch.send(JSON.stringify({ type: '_chunk', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  recv(s) {
    this.lastSeen = Date.now();
    if (typeof s !== 'string' || s.length > CHUNK * 2 + 200) return;
    let m; try { m = JSON.parse(s); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.type === '_chunk') {
      const n = Math.floor(num(m.n, 1, MAX_MSG / CHUNK)), p = this.parts.get(m.id) || { got: 0, d: new Array(n) };
      if (typeof m.d !== 'string' || !(m.i >= 0 && m.i < n) || p.d[m.i] != null) return;
      p.d[m.i] = m.d; p.got++; this.parts.set(m.id, p);
      if (p.got === n) { this.parts.delete(m.id); let big; try { big = JSON.parse(p.d.join('')); } catch { return; } if (big && typeof big === 'object') this.onmsg?.(big); }
      return;
    }
    this.onmsg?.(m);
  }
  close() { try { this.ch.close(); } catch { /* already closed */ } try { this.pc?.close(); } catch { /* already closed */ } }
  drop() { this.close(); this.gone(); }   // closed from our side, and reported like a lost link
}
// two connected in-memory channels (tests)
export function channelPair() {
  const a = { readyState: 'open', send: (s) => queueMicrotask(() => b.onmessage?.({ data: s })), close: () => { a.onclose?.(); b.onclose?.(); } };
  const b = { readyState: 'open', send: (s) => queueMicrotask(() => a.onmessage?.({ data: s })), close: () => { a.onclose?.(); b.onclose?.(); } };
  return [a, b];
}

// ---------------------------------------------------------------- WebRTC with pasted codes (no relay)
const iceDone = (pc) => new Promise((ok) => {
  if (pc.iceGatheringState === 'complete') return ok();
  const t = setTimeout(ok, 8000);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); } });
});
export const NO_ROUTE = 'Could not connect: your networks would not let the two computers reach each other directly. Add a TURN server under Connection settings (both players), or play on the same network.';
// the channel opens, or the connection fails (or takes too long) with a reason
export const opened = (ch, pc = null, ms = 30000) => new Promise((ok, fail) => {
  if (ch.readyState === 'open') return ok(ch);
  const t = setTimeout(() => fail(new Error(NO_ROUTE)), ms), done = (f, v) => { clearTimeout(t); f(v); };
  ch.onopen = () => done(ok, ch); ch.onerror = () => done(fail, new Error('The connection broke while opening.'));
  pc?.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') done(fail, new Error(NO_ROUTE)); });
});
// guest: a join code to send to the host; then accept the host's answer code
export async function makeJoinCode(ice = DEFAULT_ICE) {
  const pc = new RTCPeerConnection({ iceServers: ice }), ch = pc.createDataChannel('organicity', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer()); await iceDone(pc);
  return { pc, ch, code: 'OJ' + await encodeSave({ v: PROTOCOL, sdp: pc.localDescription.sdp }) };
}
export async function acceptAnswer(pc, code) {
  const c = String(code).trim(); if (!c.startsWith('OA')) throw new Error('That is not an answer code from a host.');
  const a = await decodeSave(c.slice(2)); await pc.setRemoteDescription({ type: 'answer', sdp: str(a.sdp, 20000) });
}
// host: answer a guest's join code; the channel opens when the guest accepts the answer
export async function answerJoinCode(code, ice = DEFAULT_ICE) {
  const c = String(code).trim(); if (!c.startsWith('OJ')) throw new Error('That is not a join code.');
  const o = await decodeSave(c.slice(2)); if (o.v !== PROTOCOL) throw new Error('That player runs a different version of the game.');
  const pc = new RTCPeerConnection({ iceServers: ice }), channel = new Promise((ok) => { pc.ondatachannel = (e) => ok(e.channel); });
  await pc.setRemoteDescription({ type: 'offer', sdp: str(o.sdp, 20000) }); await pc.setLocalDescription(await pc.createAnswer()); await iceDone(pc);
  return { pc, channel, code: 'OA' + await encodeSave({ v: PROTOCOL, sdp: pc.localDescription.sdp }) };
}

// ---------------------------------------------------------------- relays: passing the handshake
// A relay carries short messages { type, src, payload } between two ids until the peers are
// connected. PeerRelay speaks the public PeerJS server's protocol over a WebSocket; HttpRelay
// long-polls a self-hosted scripts/organicity-signal.mjs. Both: open(id), send(to, type,
// payload), onmsg, close(). A message to an id nobody holds comes back as { type: 'EXPIRE' }.
export const PEERJS_HOST = 'wss://0.peerjs.com/peerjs';
const rid = (n = 12) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map((x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join(''); };
// The public server checks every message against the PeerJS client's own shapes (and silently
// stops relaying for a socket that sends anything else), so ours travel dressed as those.
export function toPeerJs(type, p = {}, conn = 'dc_organicity') {
  if (type === 'OFFER') return { sdp: { sdp: str(p.sdp, 20000), type: 'offer' }, type: 'data', connectionId: conn, label: conn, reliable: true, serialization: 'json', metadata: { v: p.v } };
  if (type === 'ANSWER') return { sdp: { sdp: str(p.sdp, 20000) || 'v=0\r\n', type: 'answer' }, type: 'data', connectionId: conn, browser: 'organicity', metadata: { v: p.v, err: p.err || null } };
  if (type === 'CANDIDATE') return { candidate: p.c, type: 'data', connectionId: conn };
  return p;
}
export function fromPeerJs(type, p) {
  if (!p || typeof p !== 'object') return {};
  if (type === 'OFFER') return { v: p.metadata?.v, sdp: p.sdp?.sdp };
  if (type === 'ANSWER') return p.metadata?.err ? { v: p.metadata?.v, err: p.metadata.err } : { v: p.metadata?.v, sdp: p.sdp?.sdp };
  if (type === 'CANDIDATE') return { c: p.candidate };
  return p;
}
export class PeerRelay {
  constructor(url = PEERJS_HOST) { this.url = url; this.ws = null; this.onmsg = null; this.onclose = null; this.beat = null; this.conn = `dc_${rid(10)}`; }
  open(id) {
    return new Promise((ok, fail) => {
      let opened = false;
      const ws = this.ws = new WebSocket(`${this.url}?key=peerjs&id=${encodeURIComponent(id)}&token=${rid()}&version=1.5.4`);
      const t = setTimeout(() => { if (!opened) { fail(new Error('The signalling relay did not answer. Check your internet connection.')); try { ws.close(); } catch { /* */ } } }, 12000);
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'OPEN') { opened = true; clearTimeout(t); this.beat = setInterval(() => { try { ws.send('{"type":"HEARTBEAT"}'); } catch { /* closing */ } }, 5000); ok(this); }
        else if (m.type === 'ID-TAKEN') { clearTimeout(t); fail(Object.assign(new Error('That access code is already in use.'), { taken: true })); }
        else if (m.type === 'ERROR' && !opened) { clearTimeout(t); fail(new Error(`The signalling relay refused: ${m.payload?.msg || 'error'}`)); }
        else if (m.type !== 'HEARTBEAT') this.onmsg?.({ type: m.type, src: m.src, payload: fromPeerJs(m.type, m.payload) });
      };
      ws.onerror = () => { if (!opened) { clearTimeout(t); fail(new Error('Could not reach the signalling relay. Check your internet connection.')); } };
      ws.onclose = () => { clearInterval(this.beat); if (opened) this.onclose?.(); };
    });
  }
  send(to, type, payload) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type, payload: toPeerJs(type, payload, this.conn), dst: to })); }
  close() { clearInterval(this.beat); this.onclose = null; try { this.ws?.close(); } catch { /* already closed */ } }
}
export class HttpRelay {
  constructor(url) { this.url = String(url).replace(/\/+$/, ''); this.onmsg = null; this.onclose = null; this.stop = false; }
  async open(id) {
    this.id = id;
    const r = await fetch(`${this.url}/m/${encodeURIComponent(id)}?wait=0`).catch(() => null);
    if (!r?.ok) throw new Error(r?.status === 409 ? 'That access code is already in use.' : 'Could not reach the signalling server.');
    (async () => {   // long-poll for messages until closed
      while (!this.stop) {
        try {
          const q = await fetch(`${this.url}/m/${encodeURIComponent(id)}`);
          if (q.ok) for (const m of await q.json()) this.onmsg?.(m); else await new Promise((ok) => setTimeout(ok, 1500));
        } catch { await new Promise((ok) => setTimeout(ok, 1500)); }
      }
    })();
    return this;
  }
  async send(to, type, payload) {
    try {
      const r = await fetch(`${this.url}/m/${encodeURIComponent(to)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src: this.id, type, payload }) });
      if (r.status === 404) this.onmsg?.({ type: 'EXPIRE', src: to });
    } catch { /* the server is away: the handshake times out */ }
  }
  close() { this.stop = true; }
}
// the self-hosted relay's lobby of open games (the public PeerJS relay has none)
export const hasLobby = (url) => !!url && /^https?:\/\//.test(url);
export async function lobbyList(url) { const r = await fetch(`${String(url).replace(/\/+$/, '')}/lobby`); if (!r.ok) throw new Error('The relay has no lobby.'); const l = await r.json(); return Array.isArray(l) ? l.slice(0, 100).filter((g) => normCode(g.code)) : []; }
export async function lobbyPost(url, listing) { try { await fetch(`${String(url).replace(/\/+$/, '')}/lobby`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(listing) }); } catch { /* the relay is away: try again next time */ } }
export const makeRelay = (url) => (url && /^https?:\/\//.test(url) ? new HttpRelay(url) : new PeerRelay(url && /^wss?:\/\//.test(url) ? url : undefined));

// ---------------------------------------------------------------- access codes and the handshake
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I to mix up
export function newAccessCode() { const b = new Uint8Array(8); crypto.getRandomValues(b); const c = [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join(''); return `${c.slice(0, 4)}-${c.slice(4)}`; }
export function normCode(c) { const t = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return t.length === 8 && [...t].every((x) => CODE_CHARS.includes(x)) ? `${t.slice(0, 4)}-${t.slice(4)}` : null; }
export const hostId = (code) => `organicity-${normCode(code).replace('-', '').toLowerCase()}`;
const cand = (c) => (c ? { candidate: str(c.candidate, 2000), sdpMid: c.sdpMid == null ? null : str(c.sdpMid, 64), sdpMLineIndex: c.sdpMLineIndex == null ? null : num(c.sdpMLineIndex, 0, 64) } : null);
// candidates can arrive before the description they belong to: hold them until it is set
function candidateQueue(pc) {
  const q = []; let ready = false;
  return {
    add(c) { if (!c?.candidate) return; if (ready) pc.addIceCandidate(c).catch(() => { /* a stale candidate */ }); else q.push(c); },
    ready() { ready = true; for (const c of q.splice(0)) pc.addIceCandidate(c).catch(() => { /* a stale candidate */ }); },
  };
}

// host: listens on the relay under its access code and answers every guest's offer
export class HostGate {
  constructor({ relay, code, ice = DEFAULT_ICE, onLink, onFail = () => {} }) { this.relay = relay; this.code = normCode(code); this.ice = ice; this.onLink = onLink; this.onFail = onFail; this.peers = new Map(); this.early = new Map(); }
  async open() { this.relay.onmsg = (m) => this.msg(m).catch(() => { /* a broken handshake is dropped */ }); await this.relay.open(hostId(this.code)); return this; }
  async msg(m) {
    const src = typeof m.src === 'string' ? m.src.slice(0, 80) : null; if (!src) return;
    const p = m.payload || {};
    if (m.type === 'OFFER') {
      if (p.v !== PROTOCOL) { this.relay.send(src, 'ANSWER', { v: PROTOCOL, err: 'The host runs a different version of the game.' }); return; }
      this.peers.get(src)?.pc.close();
      const pc = new RTCPeerConnection({ iceServers: this.ice }), q = candidateQueue(pc), peer = { pc, q }; this.peers.set(src, peer);
      for (const c of this.early.get(src) || []) q.add(c); this.early.delete(src);
      pc.onicecandidate = (e) => { if (e.candidate) this.relay.send(src, 'CANDIDATE', { c: e.candidate.toJSON() }); };
      pc.ondatachannel = (e) => opened(e.channel, pc).then((ch) => { this.peers.delete(src); this.onLink(new Link(ch, pc)); }, (err) => { this.peers.delete(src); pc.close(); this.onFail(err); });
      await pc.setRemoteDescription({ type: 'offer', sdp: str(p.sdp, 20000) }); q.ready();
      await pc.setLocalDescription(await pc.createAnswer());
      this.relay.send(src, 'ANSWER', { v: PROTOCOL, sdp: pc.localDescription.sdp });
    } else if (m.type === 'CANDIDATE') {
      const peer = this.peers.get(src);
      if (peer) peer.q.add(cand(p.c));
      else if (this.early.size < 64) { const l = this.early.get(src) || []; if (l.length < 32) l.push(cand(p.c)); this.early.set(src, l); }   // ahead of its offer
    }
  }
  close() { this.relay.close(); for (const p of this.peers.values()) p.pc.close(); this.peers.clear(); }
}
// guest: reach the host with this access code; resolves with the open channel and its connection
export async function dialHost({ relay, code, ice = DEFAULT_ICE, onStatus = () => {}, answerMs = 20000, openMs = 30000 }) {
  const c = normCode(code); if (!c) throw new Error('That is not an access code (it looks like ABCD-EFGH).');
  onStatus('Reaching the signalling relay…');
  await relay.open(`organicity-g${rid(14)}`);
  const to = hostId(c), pc = new RTCPeerConnection({ iceServers: ice }), ch = pc.createDataChannel('organicity', { ordered: true }), q = candidateQueue(pc);
  try {
    const answer = new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('No host answered with that code. Check the code, and that the host is in the game with Multiplayer open.')), answerMs);
      relay.onmsg = (m) => {
        if (m.src !== to) return;
        if (m.type === 'ANSWER') { clearTimeout(t); if (m.payload?.err) fail(new Error(str(m.payload.err, 200))); else ok(m.payload); }
        else if (m.type === 'CANDIDATE') q.add(cand(m.payload?.c));
        else if (m.type === 'EXPIRE') { clearTimeout(t); fail(new Error('No host is online with that code.')); }
      };
    });
    let held = [];   // our candidates follow the offer
    pc.onicecandidate = (e) => { if (!e.candidate) return; const c = { c: e.candidate.toJSON() }; if (held) held.push(c); else relay.send(to, 'CANDIDATE', c); };
    await pc.setLocalDescription(await pc.createOffer());
    await relay.send(to, 'OFFER', { v: PROTOCOL, sdp: pc.localDescription.sdp });
    for (const c of held) relay.send(to, 'CANDIDATE', c); held = null;
    onStatus('Waiting for the host…');
    const a = await answer;
    await pc.setRemoteDescription({ type: 'answer', sdp: str(a.sdp, 20000) }); q.ready();
    onStatus('Connecting to the host…');
    await opened(ch, pc, openMs);
    return { pc, ch };
  } catch (e) { pc.close(); throw e; }
  finally { setTimeout(() => relay.close(), 3000); }   // late candidates are harmless once connected
}

// ---------------------------------------------------------------- the session
// hooks (all optional): regionSnapshot(), views(), assignTile(player, want) → key|null,
// applyCity(key, summary, view, blocks), tileState(key), applyTile(key, tile, view), onWelcome(msg),
// onPlayers(list), onChat(line), onOffer(offer, from), onDecision(offer, accept), setDeals(deals),
// addDeal(deal) → deals, pay(amount, note), claim(player, key) → bool, onBye(reason),
// onDrop() (guest: the link died without a goodbye; the game reconnects)
export const BEAT_MS = 5000, STALE_MS = 20000;
export class Session {
  constructor({ role, name, color = COLORS[0], hooks = {} }) {
    this.role = role; this.hooks = hooks; this.links = new Map(); this.nextId = 2; this.offers = new Map(); this.chat = []; this.banned = new Set();
    this.tokens = new Map(); this.token = null; this.beat = null;   // rejoin tokens: host keeps one per player name, a guest its own
    this.me = { id: role === 'host' ? 'p1' : null, name: str(name, 24) || 'Mayor', color, tile: null };
    this.players = role === 'host' ? [this.me] : [];
  }
  get connected() { return this.role === 'host' ? this.links.size > 0 : !!this.host; }
  // ---- host
  // both sides ping every few seconds; a link that stays silent is closed, which a guest takes as a drop
  startBeat() {
    if (this.beat) return;
    this.beat = setInterval(() => this.pulse(), BEAT_MS);
    this.beat.unref?.();
  }
  pulse(now = Date.now()) {
    for (const l of this.role === 'host' ? [...this.links.values()] : this.host ? [this.host] : []) {
      if (now - (l.lastSeen || now) > STALE_MS) { l.drop(); continue; }
      try { l.send({ type: 'ping' }); } catch { /* closing */ }
    }
  }
  addPeer(link) {
    this.startBeat();
    const id = 'p' + this.nextId++; this.links.set(id, link);
    link.onmsg = (m) => this.fromGuest(id, m);
    link.onclose = () => {
      const p = this.players.find((q) => q.id === id); this.links.delete(id); this.players = this.players.filter((q) => q.id !== id);
      this.broadcast({ type: 'players', players: this.players }); this.hooks.onPlayers?.(this.players); if (p) this.say(`${p.name} left.`, null);
    };
    return id;
  }
  broadcast(msg, except = null) { for (const [id, l] of this.links) if (id !== except) try { l.send(msg); } catch { /* peer gone */ } }
  fromGuest(id, m) {
    const p = this.players.find((q) => q.id === id), H = this.hooks;
    if (m.type === 'hello') {
      if (p) return;
      if (m.v !== PROTOCOL) { this.links.get(id)?.send({ type: 'bye', reason: 'Different game version.' }); return; }
      if (this.banned.has(str(m.name, 24).trim().toLowerCase())) { this.links.get(id)?.send({ type: 'bye', reason: 'The host removed you from this game.' }); setTimeout(() => this.links.get(id)?.close(), 200); return; }
      // a player coming back with their token takes over their old place (the old link may not have noticed it died)
      const nameKey = str(m.name, 24).trim().toLowerCase(), tok = str(m.want?.token, 40), resumed = !!tok && this.tokens.get(nameKey) === tok;
      if (resumed) {
        const old = this.players.find((q) => q.id !== this.me.id && q.name.toLowerCase() === nameKey);
        if (old) { const ol = this.links.get(old.id); this.links.delete(old.id); this.players = this.players.filter((q) => q !== old); if (ol) { ol.onclose = null; ol.close(); } }
      }
      const taken = new Set(this.players.map((q) => q.color));
      let nm = str(m.name, 24).trim() || `Mayor ${id}`; while (this.players.some((q) => q.name === nm)) nm = `${nm.slice(0, 21)} ${id}`;   // names are unique: they own land
      const player = { id, name: nm, color: COLORS.includes(m.color) && !taken.has(m.color) ? m.color : COLORS.find((c) => !taken.has(c)) || COLORS[0], tile: null };
      player.tile = H.assignTile?.(player, { tile: isKey(m.want?.tile) ? m.want.tile : null, rid: str(m.want?.rid, 40) }) ?? null;
      this.players.push(player);
      const token = resumed ? tok : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); this.tokens.set(player.name.toLowerCase(), token); if (!resumed) H.tokensChanged?.(Object.fromEntries(this.tokens));
      this.links.get(id)?.send({ type: 'welcome', v: PROTOCOL, you: player, token, region: H.regionSnapshot?.(), views: H.views?.(), players: this.players, chat: this.chat.slice(-30), rules: H.rules?.() || null });
      this.broadcast({ type: 'players', players: this.players }, id); H.onPlayers?.(this.players);
      if (player.tile) this.broadcast({ type: 'tile', key: player.tile, tile: H.tileState?.(player.tile) }, id);
      this.say(resumed ? `${player.name} reconnected.` : `${player.name} joined the region${player.tile ? '' : ' (no free tile)'}.`, null);
      return;
    }
    if (!p) return;
    if (m.type === 'city' && isKey(m.key) && m.key === p.tile) {
      const summary = cleanSummary(m.summary), view = cleanView(m.view), blocks = cleanBlocks(m.blocks);
      H.applyCity?.(m.key, summary, view, blocks);
      p.pop = summary?.pop ?? p.pop; p.money = summary?.money ?? p.money;
      this.broadcast({ type: 'tile', key: m.key, tile: H.tileState?.(m.key), view }, id);
      this.broadcast({ type: 'players', players: this.players }); H.onPlayers?.(this.players);
    } else if (m.type === 'chat') this.say(str(m.text, 300), p);
    else if (m.type === 'offer') this.routeOffer({ ...this.cleanOffer(m), from: id });
    else if (m.type === 'decision') this.decide(str(m.id, 40), !!m.accept, id);
    else if (m.type === 'cancelDeal') this.cancelDeal(num(m.id, 0, 1e9), p);
    else if (m.type === 'buyCity' && isKey(m.key)) {
      const r = H.buyCity?.(p, m.key, num(m.price, 0, 1e12)) || { ok: false, err: 'Not for sale.' };
      this.links.get(id)?.send({ type: 'bought', key: m.key, ok: !!r.ok, price: r.price || 0, err: r.err || null, code: r.ok ? r.code || null : null });
      if (r.ok) { this.broadcast({ type: 'tile', key: m.key, tile: H.tileState?.(m.key) }); this.say(`${p.name} bought the city of ${r.name || 'an AI governor'} for ₵${Math.round(r.price).toLocaleString('en-US')}.`, null); }
    }
    else if (m.type === 'claim' && isKey(m.key)) { if (H.claim?.(p, m.key)) { this.broadcast({ type: 'tile', key: m.key, tile: H.tileState?.(m.key) }); this.say(`${p.name} claimed a new tile.`, null); } }
  }
  say(text, p) {
    if (!text) return;
    const line = { from: p ? p.name : null, color: p ? p.color : null, text, t: Date.now() };
    this.chat.push(line); if (this.chat.length > 200) this.chat.shift();
    this.broadcast({ type: 'chat', line }); this.hooks.onChat?.(line);
  }
  cleanOffer(m) {
    const o = { id: str(m.id, 40) || Math.random().toString(36).slice(2), to: str(m.to, 8), money: num(m.money, 0, 1e9) };
    if (m.deal && typeof m.deal === 'object') o.deal = { kind: str(m.deal.kind, 16), amount: num(m.deal.amount, 1, 1e6), price: num(m.deal.price, 0, 1e6), role: m.deal.role === 'buy' ? 'buy' : 'sell' };
    return o;
  }
  routeOffer(o) {   // host: pass an offer to whoever it is for
    if (!this.players.some((q) => q.id === o.to) || o.to === o.from) return;
    this.offers.set(o.id, o);
    const from = this.players.find((q) => q.id === o.from);
    if (o.to === this.me.id) this.hooks.onOffer?.(o, from);
    else this.links.get(o.to)?.send({ type: 'offer', offer: o, from });
  }
  decide(id, accept, by) {   // host: the recipient's answer
    const o = this.offers.get(id); if (!o || o.to !== by) return;
    this.offers.delete(id);
    if (o.from === this.me.id) this.onDecisionLocal(o, accept); else this.links.get(o.from)?.send({ type: 'decision', offer: o, accept });
    if (!accept) return;
    const f = this.players.find((q) => q.id === o.from), t = this.players.find((q) => q.id === o.to);
    if (o.deal && f?.tile && t?.tile) {   // a monthly contract between the two players' tiles
      const deal = { seller: o.deal.role === 'sell' ? f.tile : t.tile, buyer: o.deal.role === 'sell' ? t.tile : f.tile, kind: o.deal.kind, amount: o.deal.amount, price: o.deal.price, players: [f.name, t.name] };
      const deals = this.hooks.addDeal?.(deal); this.broadcast({ type: 'deals', deals });
    }
    this.say(`${t?.name} accepted ${f?.name}'s ${o.deal ? (o.deal.kind === 'tollfree' ? 'toll-free border' : `${o.deal.kind} contract`) : `payment of ₵${Math.round(o.money).toLocaleString('en-US')}`}.`, null);
  }
  onDecisionLocal(o, accept) { if (accept && o.money && !o.deal) this.hooks.pay?.(-o.money, 'sent'); this.hooks.onDecision?.(o, accept); }
  // host: remove a player (they can't rejoin under that name this session; their land stays theirs)
  kick(id, reason = 'The host removed you from this game.') {
    const p = this.players.find((q) => q.id === id), l = this.links.get(id); if (!p || id === this.me.id) return false;
    this.banned.add(p.name.trim().toLowerCase());
    try { l?.send({ type: 'bye', reason }); } catch { /* gone */ }
    this.links.delete(id); this.players = this.players.filter((q) => q.id !== id);
    setTimeout(() => l?.close(), 200);
    this.broadcast({ type: 'players', players: this.players }); this.hooks.onPlayers?.(this.players);
    this.say(`${p.name} was removed by the host.`, null);
    return true;
  }
  // host: either party can end a contract between players
  cancelDeal(id, p = this.me) {
    const r = this.hooks.cancelDeal?.(p, id); if (!r) return false;
    this.broadcast({ type: 'deals', deals: r.deals }); this.say(`${p.name} ended the ${r.kind} contract.`, null);
    return true;
  }
  // ---- guest
  attach(link) {
    this.host = link; this.ended = false; this.startBeat();
    link.onmsg = (m) => this.fromHost(m);
    link.onclose = () => {
      if (this.host !== link) return; this.host = null;
      if (this.ended) return;
      if (this.hooks.onDrop) this.hooks.onDrop(); else this.hooks.onBye?.('The host left the game.');
    };
  }
  hello(want = {}) { this.host?.send({ type: 'hello', v: PROTOCOL, name: this.me.name, color: this.me.color, want }); }
  fromHost(m) {
    const H = this.hooks;
    if (m.type === 'welcome') {
      this.me = { ...this.me, ...m.you }; if (typeof m.token === 'string') this.token = m.token.slice(0, 40); this.players = Array.isArray(m.players) ? m.players.slice(0, 16) : [];
      this.chat = Array.isArray(m.chat) ? m.chat.slice(-30) : [];
      const views = {}; for (const [k, v] of Object.entries(m.views || {})) { const cv = cleanView(v); if (isKey(k) && cv) views[k] = cv; }
      H.onWelcome?.({ you: this.me, token: this.token, region: m.region, views, players: this.players, chat: this.chat, rules: m.rules && typeof m.rules === 'object' ? m.rules : null });
    } else if (m.type === 'tile' && isKey(m.key)) H.applyTile?.(m.key, m.tile || {}, cleanView(m.view));
    else if (m.type === 'players' && Array.isArray(m.players)) { this.players = m.players.slice(0, 16); const me = this.players.find((p) => p.id === this.me.id); if (me) this.me = { ...this.me, tile: me.tile }; H.onPlayers?.(this.players); }
    else if (m.type === 'chat' && m.line) { const line = { from: str(m.line.from, 24) || null, color: COLORS.includes(m.line.color) ? m.line.color : null, text: str(m.line.text, 300), t: num(m.line.t) }; this.chat.push(line); H.onChat?.(line); }
    else if (m.type === 'offer' && m.offer) { const o = { ...this.cleanOffer(m.offer), from: str(m.offer.from, 8) }; this.offers.set(o.id, o); H.onOffer?.(o, m.from); }
    else if (m.type === 'decision' && m.offer) { const o = { ...this.cleanOffer(m.offer), from: this.me.id }; this.onDecisionLocal(o, !!m.accept); }
    else if (m.type === 'deals' && Array.isArray(m.deals)) H.setDeals?.(m.deals.slice(0, 200));
    else if (m.type === 'bought' && isKey(m.key)) H.onBought?.({ key: m.key, ok: !!m.ok, price: num(m.price, 0, 1e12), err: str(m.err, 200), code: typeof m.code === 'string' && m.code.length < 4e6 ? m.code : null });
    else if (m.type === 'rules' && m.rules && typeof m.rules === 'object') H.onRules?.(m.rules);
    else if (m.type === 'bye') { this.ended = true; H.onBye?.(str(m.reason, 200)); }
  }
  // ---- either side
  sendCity(key, summary, view, blocks) {
    if (this.role === 'host') { this.me.pop = summary?.pop; this.me.money = summary?.money; this.broadcast({ type: 'tile', key, tile: this.hooks.tileState?.(key), view }); this.broadcast({ type: 'players', players: this.players }); this.hooks.onPlayers?.(this.players); }
    else this.host?.send({ type: 'city', key, summary, view, blocks });
  }
  sendRules(rules) { if (this.role === 'host') this.broadcast({ type: 'rules', rules }); }
  sendTile(key, view) { if (this.role === 'host') this.broadcast({ type: 'tile', key, tile: this.hooks.tileState?.(key), view }); }
  sendChat(text) { text = str(text, 300).trim(); if (!text) return; if (this.role === 'host') this.say(text, this.me); else this.host?.send({ type: 'chat', text }); }
  propose(to, { money = 0, deal = null } = {}) {
    const o = this.cleanOffer({ id: Math.random().toString(36).slice(2), to, money, deal });
    if (this.role === 'host') this.routeOffer({ ...o, from: this.me.id }); else this.host?.send({ type: 'offer', ...o });
    return o;
  }
  answer(id, accept) {
    const o = this.offers.get(id); if (!o) return;
    if (accept && o.money && !o.deal) this.hooks.pay?.(o.money, 'received');
    if (this.role === 'host') this.decide(id, accept, this.me.id); else { this.offers.delete(id); this.host?.send({ type: 'decision', id, accept }); }
  }
  endContract(id) { if (this.role === 'host') this.cancelDeal(id); else this.host?.send({ type: 'cancelDeal', id }); }
  buyCity(key, price) {
    if (this.role === 'guest') { this.host?.send({ type: 'buyCity', key, price }); return; }
    const r = this.hooks.buyCity?.(this.me, key, price) || { ok: false, err: 'Not for sale.' };
    this.hooks.onBought?.({ key, ...r, code: null });
    if (r.ok) { this.sendTile(key); this.say(`${this.me.name} bought the city of ${r.name || 'an AI governor'} for ₵${Math.round(r.price).toLocaleString('en-US')}.`, null); }
  }
  claim(key) { if (this.role === 'host') { if (this.hooks.claim?.(this.me, key)) this.sendTile(key); } else this.host?.send({ type: 'claim', key }); }
  close() { clearInterval(this.beat); this.beat = null; this.ended = true; for (const l of this.links.values()) l.close(); this.host?.close(); }
}

// a leaderboard from the players' cities
export function standings(players) {
  return players.map((p) => ({ ...p, score: Math.round((p.pop || 0) + Math.max(0, p.money || 0) / 50) })).sort((a, b) => b.score - a.score);
}
