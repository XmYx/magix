// Organicity — multiplayer in the game (the protocol is in mp.js). A host opens the region they
// are playing; each joining player gets a tile of their own (nearest free land first) and builds
// their city on it at the same time as everyone else. The host's background runner keeps the AI
// governors going and sends their cities; every player sends their own city each month, so the
// world map, the tiles next door and the regional economy show everyone's progress.
import { Session, Link, makeJoinCode, acceptAnswer, answerJoinCode, opened, DEFAULT_ICE, COLORS, standings, isKey, cleanSummary, cleanView, parseIce, makeRelay, HostGate, dialHost, newAccessCode, normCode, hasLobby, lobbyPost } from './mp.js';
import { saveRegion, loadRegion, summarize, addDeal, removeDeal, neighbours, cityKey } from './region.js';
import { storeView, loadView } from './tilehost.js';
import { viewSnapshot, cityBlocks } from './tileview.js';

const ICE_KEY = 'organicity-stun', NAME_KEY = 'organicity-mp-name', RELAY_KEY = 'organicity-relay';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
export function iceServers() { const v = ls.get(ICE_KEY); return v == null ? DEFAULT_ICE : parseIce(v); }
export const iceText = () => ls.get(ICE_KEY) ?? DEFAULT_ICE.map((s) => s.urls).join(' ');
export const setIce = (text) => ls.set(ICE_KEY, String(text).slice(0, 400));
// the signalling relay: empty for the public PeerJS relay, or a self-hosted organicity-signal.mjs (http…)
export const relayText = () => ls.get(RELAY_KEY) || '';
export const setRelay = (text) => ls.set(RELAY_KEY, String(text).trim().slice(0, 200));
export const savedName = () => ls.get(NAME_KEY) || '';
export const saveName = (n) => ls.set(NAME_KEY, String(n).slice(0, 24));

// ---------------------------------------------------------------- session rules
// The host sets them when opening the region: whether new players start in sandbox, the era they
// found in, and a race: first to a population, or the best treasury after some years.
export const GOALS = { none: 'Free play', pop: 'First to a population', money: 'Best treasury after some years' };
export function cleanRules(r) {
  if (!r || typeof r !== 'object') return { sandbox: false, startYear: null, goal: 'none', target: 0, years: 0 };
  const goal = GOALS[r.goal] ? r.goal : 'none';
  return { sandbox: !!r.sandbox, startYear: [1800, 1900, 2000].includes(+r.startYear) ? +r.startYear : null, goal, target: goal === 'pop' ? Math.round(num(r.target, 1000, 1e7, 50000)) : 0, years: goal === 'money' ? Math.round(num(r.years, 1, 100, 10)) : 0, startedYear: r.startedYear != null ? Math.round(num(r.startedYear, 1800, 2400)) : null, over: r.over && typeof r.over === 'object' ? { winner: String(r.over.winner || '').slice(0, 24), why: String(r.over.why || '').slice(0, 120), board: Array.isArray(r.over.board) ? r.over.board.slice(0, 16).map((p) => ({ name: String(p.name || '').slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#888888', pop: Math.round(num(p.pop, 0, 1e9)), money: Math.round(num(p.money, -1e12, 1e12)), score: Math.round(num(p.score, -1e12, 1e12)) })) : [] } : null };
}
// host: has somebody won? → { winner, why, board } or null
export function judge(rules, players, year) {
  const R = cleanRules(rules); if (R.over || R.goal === 'none') return null;
  const board = standings(players).map(({ name, color, pop = 0, money = 0, score }) => ({ name, color, pop, money, score }));
  if (R.goal === 'pop') { const w = [...board].sort((a, b) => b.pop - a.pop).find((p) => p.pop >= R.target); return w ? { winner: w.name, why: `first to ${R.target.toLocaleString('en-US')} people`, board } : null; }
  if (R.goal === 'money' && R.startedYear != null && year >= R.startedYear + R.years) { const w = [...board].sort((a, b) => b.money - a.money)[0]; return w ? { winner: w.name, why: `the best treasury after ${R.years} years`, board } : null; }
  return null;
}

// ---------------------------------------------------------------- tiles over the wire
const PRESETS = ['river', 'hills', 'coast', 'islands'];
const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const edgeSet = (e) => { if (!e || typeof e !== 'object') return null; const o = {}; for (const s of ['west', 'east', 'north', 'south']) if (Array.isArray(e[s]) && e[s].length <= 512) o[s] = e[s].map((v) => num(v, -100, 1000)); return o; };
export function tileState(t) {
  if (!t) return null;
  const o = {}; for (const k of ['x', 'z', 'seed', 'preset', 'kind', 'gov', 'name', 'owner', 'color', 'pop', 'edges', 'em', 'tv', 'simDay']) if (t[k] !== undefined) o[k] = t[k];
  if (t.summary) o.summary = t.summary;
  return o;
}
// a tile as sent by a peer, checked
export function cleanTile(t) {
  if (!t || typeof t !== 'object') return null;
  const o = { x: num(t.x, 0, 15), z: num(t.z, 0, 15), seed: num(t.seed, 0, 1e9), preset: PRESETS.includes(t.preset) ? t.preset : 'river', kind: ['wild', 'ai', 'city'].includes(t.kind) ? t.kind : 'wild' };
  if (['ai', 'player', 'remote'].includes(t.gov)) o.gov = t.gov;
  if (typeof t.name === 'string') o.name = t.name.slice(0, 24);
  if (typeof t.owner === 'string') o.owner = t.owner.slice(0, 24);
  if (/^#[0-9a-f]{6}$/i.test(t.color || '')) o.color = t.color;
  if (t.pop != null) o.pop = num(t.pop, 0, 1e8);
  if (t.edges) o.edges = edgeSet(t.edges);
  if (t.em !== undefined) o.em = t.em === null ? null : edgeSet(t.em);
  if (t.tv != null) o.tv = num(t.tv, 0, 99);
  if (t.simDay != null) o.simDay = num(t.simDay, 0, 1e7);
  if (t.summary) o.summary = cleanSummary(t.summary);
  return o;
}
export function regionSnapshot(region, year) {
  const tiles = {}; for (const [k, t] of Object.entries(region.tiles)) tiles[k] = tileState(t);
  return { id: region.id, seed: region.seed, size: region.size, tileSize: region.tileSize || 512, day: region.day || 0, year, tiles, deals: region.deals || [], dealId: region.dealId || 0, host: region.mp?.host || null };
}
// merge a tile the host sent, as seen by this player (our own city stays ours to describe)
export function mergeTile(region, key, raw, meName) {
  const t = region.tiles[key], c = cleanTile(raw); if (!t || !c) return false;
  if (key !== region.active) Object.assign(t, c);
  else if (c.owner) t.owner = c.owner;
  if (t.owner && t.owner === meName) { t.owned = true; if (t.kind === 'city') t.gov = 'player'; }
  else if (t.owner) { t.owned = false; t.gov = 'remote'; }
  return true;
}
// What an AI governor's city is worth: its land, its people and jobs, and its treasury.
// In multiplayer that is the only price it sells for.
export function cityValue(t) {
  const s = t?.summary || {}, pop = s.pop ?? t?.pop ?? 0, jobs = s.jobs ?? pop * 0.45;
  return Math.round((60000 + pop * 150 + jobs * 90 + Math.max(0, s.money || 0)) / 1000) * 1000;
}
// host: sell an AI city to a player who pays at least its value
export function buyCity(region, player, key, price, isHost) {
  const t = region.tiles[key];
  if (!t || t.kind !== 'city' || t.gov !== 'ai' || t.owner) return { ok: false, err: 'That city is not run by an AI governor.' };
  const value = cityValue(t); if (!(price >= value)) return { ok: false, price: value, err: `Its governor wants its full value: ₵${value.toLocaleString('en-US')}.` };
  Object.assign(t, { owner: player.name, color: player.color, gov: isHost ? 'player' : 'remote', owned: !!isHost });
  let code = null; try { code = isHost ? null : localStorage.getItem(cityKey(region, key)); } catch { code = null; }
  return { ok: true, price: value, name: t.name, code };
}
// host: a contract between players ends when either party says so
export function cancelDeal(region, player, id) {
  const d = (region.deals || []).find((x) => x.id === id); if (!d) return null;
  const party = [d.seller, d.buyer].some((k) => region.tiles[k]?.owner === player.name);
  if (!party) return null;
  removeDeal(region, id); return { deals: region.deals, kind: d.kind };
}
// host: a tile for a joining player (the one they ask for if it's theirs, their old one, or the nearest free land)
export function assignTile(region, player, want = {}) {
  if (isKey(want.tile) && region.tiles[want.tile]?.owner === player.name) return want.tile;
  let key = Object.keys(region.tiles).find((k) => region.tiles[k].owner === player.name && region.tiles[k].kind !== 'ai') || null;
  if (!key) {
    const a = region.tiles[region.active], free = Object.entries(region.tiles).filter(([, t]) => t.kind === 'wild' && !t.owned && !t.owner);
    free.sort(([, p], [, q]) => (Math.abs(p.x - a.x) + Math.abs(p.z - a.z)) - (Math.abs(q.x - a.x) + Math.abs(q.z - a.z)) || p.x - q.x || p.z - q.z);
    key = free[0]?.[0] || null;
  }
  if (key) Object.assign(region.tiles[key], { owner: player.name, color: player.color, owned: false, ...(region.tiles[key].kind === 'city' ? { gov: 'remote' } : {}) });
  return key;
}
// host: claiming land next to your own
export function claim(region, player, key) {
  const t = region.tiles[key]; if (!t || t.kind !== 'wild' || t.owner || (t.owned && player.name !== region.mp?.host)) return false;
  if (!neighbours(region, key).some((q) => q.t.owner === player.name)) return false;
  Object.assign(t, { owner: player.name, color: player.color }); if (player.name === region.mp?.host) t.owned = true;
  return true;
}
// guest: store the region the host sent, from this player's side, ready to play
export function adoptRegion(welcome, { code = null } = {}) {
  const r = welcome.region, me = welcome.you;
  if (!r || typeof r.id !== 'string' || !r.tiles || !isKey(me?.tile) || !r.tiles[me.tile]) throw new Error('The host sent no land for you.');
  const prev = loadRegion(), keep = prev && prev.id === r.id ? prev : null;
  const region = { id: r.id.slice(0, 40), seed: num(r.seed, 0, 1e9), size: num(r.size, 1, 9, 5), tileSize: [512, 768, 1024].includes(r.tileSize) ? r.tileSize : 512, day: num(r.day, 0, 1e7), active: me.tile, tiles: {}, deals: Array.isArray(r.deals) ? r.deals.slice(0, 200) : [], dealId: num(r.dealId, 0, 1e6), mp: { host: String(r.host || '').slice(0, 24), player: me.name, myTile: me.tile, color: me.color, code: normCode(code), token: typeof welcome.token === 'string' ? welcome.token.slice(0, 40) : null, rules: cleanRules(welcome.rules) } };
  if (keep?.econ) region.econ = keep.econ;   // our own view of the regional economy survives a rejoin
  for (const [k, t] of Object.entries(r.tiles)) { if (!isKey(k)) continue; const c = cleanTile(t); if (c) region.tiles[k] = c; }
  for (const k of Object.keys(region.tiles)) mergeTile(region, k, region.tiles[k], me.name);
  const mine = region.tiles[me.tile]; Object.assign(mine, { owner: me.name, color: me.color, owned: true });
  if (keep?.tiles?.[me.tile]?.kind === 'city') Object.assign(mine, { kind: 'city', gov: 'player', name: keep.tiles[me.tile].name, summary: keep.tiles[me.tile].summary });
  saveRegion(region);
  for (const [k, v] of Object.entries(welcome.views || {})) if (k !== me.tile && cleanView(v)) storeView(region, k, v);
  return { region, tile: me.tile, year: num(r.year, 1800, 2400, 2000) };
}
// guest: connect (with the host's access code through the relay, or by pasted codes) and wait for the host's welcome
export async function joinGame({ name, color, code, onCode, answer, onStatus = () => {} }) {
  const s = new Session({ role: 'guest', name, color });
  if (code) {
    const { pc, ch } = await dialHost({ relay: makeRelay(relayText()), code, ice: iceServers(), onStatus });
    s.attach(new Link(ch, pc));
  } else {   // no relay: a join code goes to the host, their answer code comes back
    onStatus('Making a join code…');
    const { pc, ch, code: join } = await makeJoinCode(iceServers());
    onCode(join); onStatus('Send the join code to the host, then paste their answer code.');
    await acceptAnswer(pc, await answer()); onStatus('Connecting…'); await opened(ch, pc);
    s.attach(new Link(ch, pc));
  }
  onStatus('Connected. Asking the host for land…');
  const prev = loadRegion();
  const welcome = await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('No answer from the host.')), 30000);
    s.hooks.onWelcome = (w) => { clearTimeout(t); ok(w); }; s.hooks.onBye = (why) => { clearTimeout(t); fail(new Error(why || 'The host closed the connection.')); };
    s.hello({ rid: prev?.id, tile: prev?.mp?.myTile, token: prev?.mp?.token || null });
  });
  return { session: s, welcome };
}
// guest: dial the host again and wait for its welcome, on an existing session (reconnect / rejoin)
export async function redial(s, region, { onStatus = () => {} } = {}) {
  const code = region.mp?.code; if (!code) throw new Error('This game was joined with pasted codes; join again from the start screen.');
  const { pc, ch } = await dialHost({ relay: makeRelay(relayText()), code, ice: iceServers(), onStatus, answerMs: 12000 });
  const welcome = new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('No answer from the host.')), 20000), prev = s.hooks.onWelcome;
    s.hooks.onWelcome = (w) => { clearTimeout(t); s.hooks.onWelcome = prev; ok(w); };
  });
  s.attach(new Link(ch, pc));
  s.hello({ rid: region.id, tile: region.active, token: s.token || region.mp.token || null });   // the city being played (the host checks it is yours)
  return welcome;
}

// ---------------------------------------------------------------- in the game
// ctx: { region, econ, sim, world, rend, ui, tilehost, redrawRegion, syncRegion }
export class Multiplayer {
  constructor(ctx) { this.ctx = ctx; this.s = null; this.chat = []; this.offers = []; this.gate = null; this.gateState = null; this.unread = 0; }
  get connected() { return !!this.s?.connected; }
  get active() { return !!this.s; }
  get role() { return this.s?.role || null; }
  get me() { return this.s?.me || null; }
  get players() { if (!this.s) return []; Object.assign(this.s.me, { pop: Math.round(this.ctx.sim.stats.pop || 0), money: Math.round(this.ctx.sim.money) }); return standings(this.s.players); }   // our own row is live
  changed() { this.ctx.ui.mpChanged?.(); }
  // ---- host
  host(name, color, rules = null, { listed = false } = {}) {
    if (this.s) return this.s;
    this.listed = listed && hasLobby(relayText());
    const { region } = this.ctx; saveName(name);
    const s = this.s = new Session({ role: 'host', name, color: COLORS.includes(color) ? color : COLORS[0], hooks: this.hooks() });
    s.me.tile = region.active;
    for (const t of Object.values(region.tiles)) if (t.owned || t === region.tiles[region.active]) Object.assign(t, { owner: s.me.name, color: s.me.color });
    // the access code stays with the region, so friends can rejoin with the same code later
    const keep = region.mp?.host === s.me.name ? region.mp : null;   // hosting the same region again keeps its code and race
    region.mp = { host: s.me.name, player: s.me.name, myTile: region.active, code: normCode(region.mp?.code) || newAccessCode(), rules: rules ? cleanRules({ ...rules, startedYear: this.ctx.sim.year }) : cleanRules(keep?.rules) }; saveRegion(region);
    s.tokens = new Map(Object.entries(keep?.tokens || {}).filter(([, v]) => typeof v === 'string').slice(0, 64));   // returning players are recognised after a restart
    region.mp.tokens = Object.fromEntries(s.tokens); saveRegion(region);
    this.openGate(); this.changed();
    if (this.listed) { this.list(); this.listT = setInterval(() => this.list(), 20000); }
    return s;
  }
  // host: keep the game in the relay's lobby while it is open
  list(close = false) {
    const { region } = this.ctx, R = this.rules;
    lobbyPost(relayText(), { code: this.code, close, name: region.tiles[region.active]?.name ? `${region.tiles[region.active].name}'s region` : 'A region', host: this.me?.name, players: this.s?.players.length || 1, goal: R.goal === 'pop' ? `first to ${R.target.toLocaleString('en-US')} people` : R.goal === 'money' ? `best treasury in ${R.years} years` : 'free play' });
  }
  get code() { return this.ctx.region.mp?.code || null; }
  get rules() { return cleanRules(this.ctx.region.mp?.rules); }
  // host: announce a winner once the race is decided (the game carries on afterwards)
  judge() {
    const { region, sim } = this.ctx; if (this.role !== 'host' || !region.mp) return null;
    Object.assign(this.s.me, { pop: Math.round(sim.stats.pop || 0), money: Math.round(sim.money) });
    const r = judge(region.mp.rules, this.s.players, sim.year); if (!r) return null;
    region.mp.rules = { ...cleanRules(region.mp.rules), over: r }; saveRegion(region);
    this.s.sendRules(region.mp.rules); this.s.say(`${r.winner} wins: ${r.why}.`, null);
    this.gameOver(r); return r;
  }
  gameOver(r) { this.ctx.ui.showScoreboard?.(r, this.me?.name); this.changed(); }
  // guest: the link died without a goodbye; dial the host again for a couple of minutes
  async reconnect() {
    const { region, ui } = this.ctx, s = this.s; if (!s || this.reconnecting) return;
    if (!region.mp?.code) { s.hooks.onBye?.('Lost the connection to the host.'); return; }
    this.reconnecting = true; this.changed(); ui.toast('Lost the connection to the host. Reconnecting…', 'warn');
    for (const wait of [1, 3, 6, 10, 15, 20, 30, 30]) {
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      if (this.s !== s) return;
      try { await redial(s, region); this.reconnecting = false; ui.toast('Reconnected to the host.', 'good'); this.changed(); return; }
      catch (e) { if (/different version|removed/i.test(e.message)) break; }
    }
    this.reconnecting = false; if (this.s === s) s.hooks.onBye?.('Could not reach the host again.');
  }
  // guest after a page reload: back into the game you were in, on your own tile
  async rejoin(onStatus) {
    const { region } = this.ctx, m = region.mp; if (this.s || !m?.code || m.host === m.player) return;
    if (m.myTile && m.myTile !== region.active && region.tiles[region.active]?.owner !== m.player) throw new Error('Switch to your own city in this region first (world map).');
    const s = new Session({ role: 'guest', name: m.player, color: COLORS.includes(m.color) ? m.color : COLORS[1] });
    s.token = m.token || null;
    const w = await redial(s, region, { onStatus });
    this.attachGuest(s); this.applyWelcome(w, true); return s;
  }
  // guest: the host's welcome again (after reconnecting): refresh tiles, views, players and rules
  applyWelcome(w, fresh = false) {
    const c = this.ctx, region = c.region;
    for (const [k, t] of Object.entries(w.region?.tiles || {})) if (isKey(k) && region.tiles[k]) mergeTile(region, k, t, w.you?.name);
    for (const [k, v] of Object.entries(w.views || {})) if (k !== region.active && cleanView(v)) storeView(region, k, v);
    if (Array.isArray(w.region?.deals)) region.deals = w.region.deals.slice(0, 200);
    region.mp = { ...region.mp, token: w.token || region.mp?.token || null, rules: cleanRules(w.rules), myTile: w.you?.tile || region.mp?.myTile };
    saveRegion(region); c.syncRegion(); c.redrawRegion(); c.ui.renderWorldMap?.();
    if (fresh) this.chat = (w.chat || []).slice();
    if (region.mp.rules.over) this.gameOver(region.mp.rules.over);
    this.changed();
  }
  // listen on the relay under the access code; a code still held by a closed tab frees up within a minute
  async openGate(tries = 6) {
    this.gate?.close(); this.gateState = 'opening'; this.gateErr = null; this.changed();
    const gate = this.gate = new HostGate({ relay: makeRelay(relayText()), code: this.code, ice: iceServers(),
      onLink: (link) => { this.s?.addPeer(link); this.changed(); },
      onFail: (e) => this.ctx.ui.toast(`A player could not connect. ${e.message}`, 'warn') });
    gate.relay.onclose = () => { if (this.gate === gate && this.s) { this.gateState = 'closed'; this.changed(); setTimeout(() => { if (this.gate === gate && this.s) this.openGate(); }, 3000); } };
    try { await gate.open(); if (this.gate === gate) { this.gateState = 'open'; this.changed(); } }
    catch (e) {
      if (this.gate !== gate) return;
      if (e.taken && tries > 0) { setTimeout(() => { if (this.gate === gate && this.s) this.openGate(tries - 1); }, 10000); this.gateState = 'waiting'; }
      else { this.gateState = 'error'; this.gateErr = e.message; }
      this.changed();
    }
  }
  closeGate() { this.gate?.close(); this.gate = null; this.gateState = null; }
  // without a relay: answer a join code a player pasted to you
  async answer(code) {
    const r = await answerJoinCode(code, iceServers());
    r.channel.then((ch) => opened(ch, r.pc, 120000)).then((ch) => { this.s.addPeer(new Link(ch, r.pc)); this.changed(); }).catch((e) => this.ctx.ui.toast(`A player could not connect. ${e.message}`, 'warn'));
    return r.code;
  }
  // ---- guest (the session was opened on the start screen)
  attachGuest(session) {
    this.s = session; Object.assign(session.hooks, this.hooks(), { onDrop: () => this.reconnect(), onWelcome: (w) => this.applyWelcome(w) });
    this.chat = session.chat.slice(); this.ctx.tilehost.disabled = true; this.changed();
  }
  hooks() {
    const c = this.ctx, region = c.region;
    return {
      regionSnapshot: () => regionSnapshot(region, c.sim.year),
      views: () => Object.fromEntries(Object.keys(region.tiles).map((k) => [k, loadView(region, k)]).filter(([, v]) => v)),
      assignTile: (p, want) => { const k = assignTile(region, p, want); saveRegion(region); c.ui.renderWorldMap?.(); return k; },
      cancelDeal: (p, id) => { const r = cancelDeal(region, p, id); if (r) { saveRegion(region); c.syncRegion(); this.changed(); } return r; },
      buyCity: (p, k, price) => {
        const host = p.id === this.me?.id; if (host && price > c.sim.money) return { ok: false, err: 'Not enough money.' };
        const r = buyCity(region, p, k, price, host);
        if (r.ok) { try { const st = c.econ.tile(k); if (st) c.econ.govern(st, region.tiles[k]); } catch { /* the economy catches up next month */ } saveRegion(region); c.ui.renderWorldMap?.(); c.redrawRegion(); }
        return r;
      },
      onBought: (r) => {
        if (!r.ok) { c.ui.toast(r.err || 'The purchase failed.', 'warn'); return; }
        c.sim.money -= r.price;
        if (r.code) try { localStorage.setItem(cityKey(region, r.key), r.code); } catch { /* storage full */ }
        const t = region.tiles[r.key]; if (t) Object.assign(t, { owner: this.me.name, color: this.me.color, owned: true, gov: 'player' });
        saveRegion(region); c.ui.renderWorldMap?.();
        c.ui.toast(`You bought ${t?.name || 'the city'} for ₵${Math.round(r.price).toLocaleString('en-US')}.${this.role === 'guest' ? ' Play it by switching to it from the world map (this leaves the session; rejoin to bring it back).' : ''}`, 'good');
      },
      claim: (p, k) => { const ok = claim(region, p, k); if (ok) { saveRegion(region); c.ui.renderWorldMap?.(); } return ok; },
      tileState: (k) => tileState(region.tiles[k]),
      applyCity: (k, summary, view, blocks) => {   // host: a player's month
        const t = region.tiles[k]; if (!t) return;
        Object.assign(t, { kind: 'city', gov: 'remote', simDay: region.day }); if (summary) { t.summary = summary; if (summary.name) t.name = summary.name; }
        if (view) storeView(region, k, view);
        if (blocks && summary) try { c.econ.updateTile(k, blocks, summary); } catch { /* their economy joins next month */ }
        saveRegion(region); c.redrawRegion(); c.ui.renderWorldMap?.();
      },
      applyTile: (k, tile, view) => {   // guest: the host's news about a tile
        if (!mergeTile(region, k, tile, this.me?.name)) return;
        if (view && k !== region.active) storeView(region, k, view);
        saveRegion(region); c.syncRegion(); c.redrawRegion(); c.ui.renderWorldMap?.();
      },
      addDeal: (d) => { addDeal(region, d); saveRegion(region); c.syncRegion(); this.changed(); return region.deals; },
      setDeals: (deals) => {
        region.deals = deals.filter((d) => d && isKey(d.seller) && isKey(d.buyer)).map((d) => ({ id: num(d.id, 0, 1e9), seller: d.seller, buyer: d.buyer, kind: String(d.kind).slice(0, 16), amount: num(d.amount, 0, 1e6), price: num(d.price, 0, 1e6), players: Array.isArray(d.players) ? d.players.slice(0, 2).map((x) => String(x).slice(0, 24)) : [] }));
        saveRegion(region); c.syncRegion(); this.changed();
      },
      pay: (x) => { c.sim.money += x; c.ui.toast(x > 0 ? `Received ₵${Math.round(x).toLocaleString('en-US')}.` : `Paid ₵${Math.round(-x).toLocaleString('en-US')}.`, x > 0 ? 'good' : 'info'); },
      onChat: (line) => { this.chat.push(line); if (this.chat.length > 200) this.chat.shift(); if (!c.ui.mpOpen?.()) { this.unread++; if (line.from) c.ui.toast(`${line.from}: ${line.text}`, 'info'); } this.changed(); },
      onPlayers: () => this.changed(),
      onOffer: (o, from) => { this.offers.push({ ...o, fromName: from?.name || 'A player' }); c.ui.toast(`${from?.name || 'A player'} sent you an offer (Multiplayer panel).`, 'info'); this.changed(); },
      onDecision: (o, ok) => { c.ui.toast(`Your offer was ${ok ? 'accepted' : 'declined'}.`, ok ? 'good' : 'info'); this.changed(); },
      rules: () => cleanRules(region.mp?.rules),
      tokensChanged: (t) => { if (region.mp) { region.mp.tokens = t; saveRegion(region); } },
      onRules: (r) => { const was = !!this.rules.over; region.mp = { ...region.mp, rules: cleanRules(r) }; saveRegion(region); if (!was && region.mp.rules.over) this.gameOver(region.mp.rules.over); this.changed(); },
      onBye: (why) => { c.ui.toast(`${why} You keep playing your city on your own.`, 'warn'); this.s = null; this.reconnecting = false; if (c.tilehost) c.tilehost.disabled = false; this.changed(); },
    };
  }
  // ---- both
  monthly() {   // our city's month, to everyone
    if (!this.s) return;
    const { region, world, sim, rend } = this.ctx, k = region.active, t = region.tiles[k];
    t.summary = { ...summarize(world, sim, rend), name: t.name }; t.owner = this.me.name;
    this.s.sendCity(k, t.summary, viewSnapshot(world), this.role === 'guest' ? cityBlocks(world, sim) : null);
    this.judge();
  }
  tileChanged(k) { if (this.role === 'host') this.s.sendTile(k, loadView(this.ctx.region, k)); }
  say(text) { this.s?.sendChat(text); }
  propose(to, what) {
    if (what.money && what.money > this.ctx.sim.money) { this.ctx.ui.toast('Not enough money for that payment.', 'warn'); return; }
    this.s?.propose(to, what); this.ctx.ui.toast('Offer sent.', 'info');
  }
  decide(id, accept) { this.offers = this.offers.filter((x) => x.id !== id); this.s?.answer(id, accept); this.changed(); }
  claim(key) { this.s?.claim(key); }
  kick(id) { if (this.role === 'host') { this.s.kick(id); this.changed(); } }
  endContract(id) { this.s?.endContract(id); }
  // buy an AI governor's city at its value (the host checks the price against its own numbers)
  buyCity(key) {
    const t = this.ctx.region.tiles[key], value = cityValue(t);
    if (value > this.ctx.sim.money) { this.ctx.ui.toast(`${t?.name || 'That city'} costs ₵${value.toLocaleString('en-US')}; you have ₵${Math.round(this.ctx.sim.money).toLocaleString('en-US')}.`, 'warn'); return; }
    if (!confirm(`Buy ${t?.name || 'this city'} from its AI governor for ₵${value.toLocaleString('en-US')}?`)) return;
    this.s?.buyCity(key, value);
  }
  leave() { if (this.listed) { clearInterval(this.listT); this.list(true); this.listed = false; } this.closeGate(); this.s?.close(); this.s = null; if (this.ctx.tilehost) this.ctx.tilehost.disabled = false; this.changed(); }
}
