// Organicity — multiplayer. Players share one region over peer-to-peer WebRTC data channels.
// The host keeps the region (tiles, owners, AI governors, contracts) and relays; every player
// runs their own city at full fidelity and sends its numbers and view each month, so everyone
// sees everyone's cities grow next door. Chat, trades (money, commodity and utility contracts),
// tile claims and a leaderboard ride along.
// Connecting needs no server: a guest makes a join code, the host pastes it and hands back an
// answer code. Optionally a tiny self-hosted signalling server (scripts/organicity-signal.mjs)
// swaps the codes automatically. Everything a peer sends is checked before it is used.
import { encodeSave, decodeSave } from './share.js';

export const PROTOCOL = 1;
export const COLORS = ['#e05a4a', '#3a8ae0', '#e8c040', '#5ab86a', '#9a5ac8', '#e07a30', '#40c0c0', '#e060a8'];
export const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
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
  if (Array.isArray(s.exits)) out.exits = s.exits.slice(0, 32).map((e) => ({ side: ['west', 'east', 'north', 'south'].includes(e?.side) ? e.side : 'west', pos: num(e?.pos, 0, 512) }));
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
  constructor(ch) {
    this.ch = ch; this.parts = new Map(); this.onmsg = null; this.onclose = null;
    ch.onmessage = (e) => this.recv(typeof e === 'string' ? e : e.data);
    ch.onclose = () => this.onclose?.();
  }
  send(msg) {
    const s = JSON.stringify(msg);
    if (s.length <= CHUNK) { this.ch.send(s); return; }
    const id = Math.random().toString(36).slice(2), n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) this.ch.send(JSON.stringify({ type: '_chunk', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  recv(s) {
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
  close() { try { this.ch.close(); } catch { /* already closed */ } }
}
// two connected in-memory channels (tests)
export function channelPair() {
  const a = { readyState: 'open', send: (s) => queueMicrotask(() => b.onmessage?.({ data: s })), close: () => { a.onclose?.(); b.onclose?.(); } };
  const b = { readyState: 'open', send: (s) => queueMicrotask(() => a.onmessage?.({ data: s })), close: () => { a.onclose?.(); b.onclose?.(); } };
  return [a, b];
}

// ---------------------------------------------------------------- WebRTC with pasted codes
const iceDone = (pc) => new Promise((ok) => {
  if (pc.iceGatheringState === 'complete') return ok();
  const t = setTimeout(ok, 5000);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); } });
});
export const opened = (ch) => new Promise((ok, fail) => { if (ch.readyState === 'open') return ok(ch); ch.onopen = () => ok(ch); ch.onerror = (e) => fail(e); });
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

// ---------------------------------------------------------------- the optional signalling server
const roomUrl = (url, room) => `${String(url).replace(/\/+$/, '')}/r/${encodeURIComponent(room)}`;
export async function signalJoin(url, room, joinCode, { tries = 120 } = {}) {
  const r = await fetch(`${roomUrl(url, room)}/join`, { method: 'POST', body: joinCode }); if (!r.ok) throw new Error('The signalling server refused the join.');
  const { id } = await r.json();
  for (let i = 0; i < tries; i++) { const a = await fetch(`${roomUrl(url, room)}/answer/${id}`); if (a.status === 200) return a.text(); await new Promise((ok) => setTimeout(ok, 1500)); }
  throw new Error('The host did not answer.');
}
export function signalHost(url, room, answer) {
  let stop = false; const seen = new Set();
  (async () => {
    while (!stop) {
      try {
        const r = await fetch(`${roomUrl(url, room)}/pending`);
        if (r.ok) for (const { id, code } of await r.json()) {
          if (seen.has(id)) continue; seen.add(id);
          try { const ans = await answer(code); await fetch(`${roomUrl(url, room)}/answer/${id}`, { method: 'POST', body: ans }); } catch { /* a bad join code */ }
        }
      } catch { /* server away: keep trying */ }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  })();
  return () => { stop = true; };
}

// ---------------------------------------------------------------- the session
// hooks (all optional): regionSnapshot(), views(), assignTile(player, want) → key|null,
// applyCity(key, summary, view, blocks), tileState(key), applyTile(key, tile, view), onWelcome(msg),
// onPlayers(list), onChat(line), onOffer(offer, from), onDecision(offer, accept), setDeals(deals),
// addDeal(deal) → deals, pay(amount, note), claim(player, key) → bool, onBye(reason)
export class Session {
  constructor({ role, name, color = COLORS[0], hooks = {} }) {
    this.role = role; this.hooks = hooks; this.links = new Map(); this.nextId = 2; this.offers = new Map(); this.chat = []; this.banned = new Set();
    this.me = { id: role === 'host' ? 'p1' : null, name: str(name, 24) || 'Mayor', color, tile: null };
    this.players = role === 'host' ? [this.me] : [];
  }
  get connected() { return this.role === 'host' ? this.links.size > 0 : !!this.host; }
  // ---- host
  addPeer(link) {
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
      const taken = new Set(this.players.map((q) => q.color));
      let nm = str(m.name, 24).trim() || `Mayor ${id}`; while (this.players.some((q) => q.name === nm)) nm = `${nm.slice(0, 21)} ${id}`;   // names are unique: they own land
      const player = { id, name: nm, color: COLORS.includes(m.color) && !taken.has(m.color) ? m.color : COLORS.find((c) => !taken.has(c)) || COLORS[0], tile: null };
      player.tile = H.assignTile?.(player, { tile: isKey(m.want?.tile) ? m.want.tile : null, rid: str(m.want?.rid, 40) }) ?? null;
      this.players.push(player);
      this.links.get(id)?.send({ type: 'welcome', v: PROTOCOL, you: player, region: H.regionSnapshot?.(), views: H.views?.(), players: this.players, chat: this.chat.slice(-30) });
      this.broadcast({ type: 'players', players: this.players }, id); H.onPlayers?.(this.players);
      if (player.tile) this.broadcast({ type: 'tile', key: player.tile, tile: H.tileState?.(player.tile) }, id);
      this.say(`${player.name} joined the region${player.tile ? '' : ' (no free tile)'}.`, null);
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
    this.say(`${t?.name} accepted ${f?.name}'s ${o.deal ? `${o.deal.kind} contract` : `payment of ₵${Math.round(o.money).toLocaleString('en-US')}`}.`, null);
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
    this.host = link;
    link.onmsg = (m) => this.fromHost(m);
    link.onclose = () => { this.host = null; this.hooks.onBye?.('The host left the game.'); };
  }
  hello(want = {}) { this.host?.send({ type: 'hello', v: PROTOCOL, name: this.me.name, color: this.me.color, want }); }
  fromHost(m) {
    const H = this.hooks;
    if (m.type === 'welcome') {
      this.me = { ...this.me, ...m.you }; this.players = Array.isArray(m.players) ? m.players.slice(0, 16) : [];
      this.chat = Array.isArray(m.chat) ? m.chat.slice(-30) : [];
      const views = {}; for (const [k, v] of Object.entries(m.views || {})) { const cv = cleanView(v); if (isKey(k) && cv) views[k] = cv; }
      H.onWelcome?.({ you: this.me, region: m.region, views, players: this.players });
    } else if (m.type === 'tile' && isKey(m.key)) H.applyTile?.(m.key, m.tile || {}, cleanView(m.view));
    else if (m.type === 'players' && Array.isArray(m.players)) { this.players = m.players.slice(0, 16); const me = this.players.find((p) => p.id === this.me.id); if (me) this.me = { ...this.me, tile: me.tile }; H.onPlayers?.(this.players); }
    else if (m.type === 'chat' && m.line) { const line = { from: str(m.line.from, 24) || null, color: COLORS.includes(m.line.color) ? m.line.color : null, text: str(m.line.text, 300), t: num(m.line.t) }; this.chat.push(line); H.onChat?.(line); }
    else if (m.type === 'offer' && m.offer) { const o = { ...this.cleanOffer(m.offer), from: str(m.offer.from, 8) }; this.offers.set(o.id, o); H.onOffer?.(o, m.from); }
    else if (m.type === 'decision' && m.offer) { const o = { ...this.cleanOffer(m.offer), from: this.me.id }; this.onDecisionLocal(o, !!m.accept); }
    else if (m.type === 'deals' && Array.isArray(m.deals)) H.setDeals?.(m.deals.slice(0, 200));
    else if (m.type === 'bought' && isKey(m.key)) H.onBought?.({ key: m.key, ok: !!m.ok, price: num(m.price, 0, 1e12), err: str(m.err, 200), code: typeof m.code === 'string' && m.code.length < 4e6 ? m.code : null });
    else if (m.type === 'bye') H.onBye?.(str(m.reason, 200));
  }
  // ---- either side
  sendCity(key, summary, view, blocks) {
    if (this.role === 'host') { this.me.pop = summary?.pop; this.me.money = summary?.money; this.broadcast({ type: 'tile', key, tile: this.hooks.tileState?.(key), view }); this.broadcast({ type: 'players', players: this.players }); this.hooks.onPlayers?.(this.players); }
    else this.host?.send({ type: 'city', key, summary, view, blocks });
  }
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
  close() { for (const l of this.links.values()) l.close(); this.host?.close(); }
}

// a leaderboard from the players' cities
export function standings(players) {
  return players.map((p) => ({ ...p, score: Math.round((p.pop || 0) + Math.max(0, p.money || 0) / 50) })).sort((a, b) => b.score - a.score);
}
