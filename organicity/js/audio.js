// Organicity — procedural soundscape (Web Audio, no sound files). A city hum that
// follows density and zoom, traffic that follows road flows near the camera, rain,
// sirens while emergency vehicles run, birds in quiet older towns and a synth pad
// in the cyberpunk era, and positional sound: industry, trains and crowds heard from where
// they are, panned and fading with distance around the camera. Starts on the first click or
// key press (browser policy).
import { ROADS, SERVICES } from './config.js';
import { clamp } from './util.js';

const KEY = 'organicity-audio';

export class CityAudio {
  constructor(sim, rend) {
    this.sim = sim; this.r = rend; this.ctx = null; this.t = 0; this.traffic = 0;
    this.volume = 0.6; this.muted = false;
    try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); if (Number.isFinite(s.volume)) this.volume = s.volume; this.muted = !!s.muted; } catch { /* storage unavailable */ }
    const go = () => { this.start(); removeEventListener('pointerdown', go); removeEventListener('keydown', go); };
    addEventListener('pointerdown', go); addEventListener('keydown', go);
    document.addEventListener('visibilitychange', () => { if (this.ctx) document.hidden ? this.ctx.suspend() : this.ctx.resume(); });
  }
  store() { try { localStorage.setItem(KEY, JSON.stringify({ volume: this.volume, muted: this.muted })); } catch { /* ignore */ } }
  setVolume(v) { this.volume = clamp(v, 0, 1); this.store(); this.applyMaster(); }
  toggleMute() { this.muted = !this.muted; this.store(); this.applyMaster(); return this.muted; }
  applyMaster() { if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.5, this.ctx.currentTime, 0.2); }

  start() {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination); this.applyMaster();
    // two seconds of white noise, and a brown-noise variant for the low hum
    const len = ctx.sampleRate * 2, white = ctx.createBuffer(1, len, ctx.sampleRate), brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = white.getChannelData(0), bd = brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const r = Math.random() * 2 - 1; wd[i] = r; last = (last + 0.02 * r) / 1.02; bd[i] = last * 3.5; }
    const loop = (buf, filter, freq, q = 0.7) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return g;
    };
    this.hum = loop(brown, 'lowpass', 320);
    this.road = loop(white, 'bandpass', 650, 0.6);
    this.rain = loop(white, 'highpass', 2400);
    // cyberpunk pad: detuned saws through a low-pass
    this.pad = ctx.createGain(); this.pad.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(this.pad); this.pad.connect(this.master);
    for (const f of [55, 55.4, 82.4]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.12; o.connect(g); g.connect(lp); o.start(); }
    // siren: a triangle wave swept up and down
    this.siren = ctx.createGain(); this.siren.gain.value = 0; this.siren.connect(this.master);
    const so = ctx.createOscillator(); so.type = 'triangle'; so.frequency.value = 700;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.5; const depth = ctx.createGain(); depth.gain.value = 220;
    lfo.connect(depth); depth.connect(so.frequency); so.connect(this.siren); so.start(); lfo.start();
    // positional voices: a small pool per kind, each a looped noise through a filter, a pulse and a panner
    this.voices = [];
    const voice = (kind, buf, type, freq, q, pulse, depthV) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const amp = ctx.createGain(); amp.gain.value = 1 - depthV;   // rhythm: machinery clanks, rails clatter, crowds swell
      const lf = ctx.createOscillator(); lf.frequency.value = pulse * (0.9 + Math.random() * 0.2); const ld = ctx.createGain(); ld.gain.value = depthV; lf.connect(ld); ld.connect(amp.gain); lf.start();
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createPanner(); Object.assign(pan, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 25, maxDistance: 900, rolloffFactor: 1.3 });
      src.connect(f); f.connect(amp); amp.connect(g); g.connect(pan); pan.connect(this.master); src.start();
      this.voices.push({ kind, g, pan, busy: false });
    };
    for (let k = 0; k < 3; k++) voice('industry', brown, 'lowpass', 260, 1.2, 1.6, 0.45);
    for (let k = 0; k < 2; k++) voice('train', white, 'bandpass', 420, 0.8, 5.5, 0.5);
    for (let k = 0; k < 2; k++) voice('crowd', white, 'bandpass', 950, 1.1, 0.35, 0.4);
  }

  // where each kind of sound comes from right now, nearest first
  emitters() {
    const c = this.r.cam, w = this.sim.w, out = { industry: [], train: [], crowd: [] }, R = 160 + c.dist;
    for (const b of w.buildings.values()) {
      if (Math.abs(b.cx - c.x) > R || Math.abs(b.cz - c.z) > R || b.abandoned) continue;
      const S = SERVICES[b.svc];
      if ((S?.chain && S.chain !== 'market' && (b.indEff || 0) > 0.1) || b.svc === 'coal' || (!b.svc && b.zone === 4 && b.level >= 2 && b.workers > 5)) out.industry.push({ x: b.cx, y: 3, z: b.cz, v: S?.chain ? 1 : b.svc === 'coal' ? 0.9 : 0.45 });
      if (b.svc === 'stadium' || b.svc === 'plaza' || (this.sim.event && this.sim.event.venue === b.id)) out.crowd.push({ x: b.cx, y: 2, z: b.cz, v: this.sim.event?.venue === b.id ? 1 : 0.35 });
    }
    for (const t of this.r.trains || []) out.train.push({ x: t.mesh.position.x, y: t.mesh.position.y, z: t.mesh.position.z, v: 1 });
    // a crowd wherever many pedestrians are gathered
    const walk = (this.r.walkers || []).filter((a) => a.stay > 0);
    if (walk.length > 8) { let x = 0, z = 0; for (const a of walk) { x += a.ax; z += a.az; } out.crowd.push({ x: x / walk.length, y: 1, z: z / walk.length, v: Math.min(1, walk.length / 40) }); }
    for (const k in out) out[k].sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
    return out;
  }
  placeVoices() {
    const ctx = this.ctx, now = ctx.currentTime, L = ctx.listener, cam = this.r.camera, s = this.sim, night = this.r.night || 0;
    // the listener is the camera: its position and where it looks
    const p = cam.position, d = cam.getWorldDirection?.(cam.position.clone()) || { x: 0, y: -1, z: -1 };
    if (L.positionX) { L.positionX.setTargetAtTime(p.x, now, 0.1); L.positionY.setTargetAtTime(p.y, now, 0.1); L.positionZ.setTargetAtTime(p.z, now, 0.1); L.forwardX.setTargetAtTime(d.x, now, 0.1); L.forwardY.setTargetAtTime(d.y, now, 0.1); L.forwardZ.setTargetAtTime(d.z, now, 0.1); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(d.x, d.y, d.z, 0, 1, 0); }
    const em = this.emitters(), idx = { industry: 0, train: 0, crowd: 0 }, active = s.paused ? 0.3 : 1;
    const level = { industry: 0.5 * (1 - 0.5 * night), train: 0.55, crowd: 0.35 * (1 - 0.6 * night) };
    for (const v of this.voices) {
      const e = em[v.kind][idx[v.kind]++];
      if (!e) { v.g.gain.setTargetAtTime(0, now, 0.8); continue; }
      const P = v.pan; if (P.positionX) { P.positionX.setTargetAtTime(e.x, now, 0.3); P.positionY.setTargetAtTime(e.y, now, 0.3); P.positionZ.setTargetAtTime(e.z, now, 0.3); } else P.setPosition(e.x, e.y, e.z);
      v.g.gain.setTargetAtTime(level[v.kind] * e.v * active, now, 0.6);
    }
  }

  chirp() {
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    const f = 2400 + Math.random() * 1800; o.type = 'sine';
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.6), t + 0.12);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.2);
  }

  // measured every half second: congestion-weighted traffic within earshot of the camera target
  sampleTraffic() {
    const c = this.r.cam, R = 90 + c.dist * 0.4; let v = 0;
    for (const e of this.sim.w.net.edges.values()) {
      const mx = (e.bb[0] + e.bb[2]) / 2, mz = (e.bb[1] + e.bb[3]) / 2, d = Math.hypot(mx - c.x, mz - c.z);
      if (d < R) v += Math.min(1.5, (e.flow || 0) / ROADS[e.type].capacity) * Math.min(1, e.len / 40) * (1 - d / R);
    }
    this.traffic = clamp(v / 6, 0, 1);
  }

  update(dt) {
    if (!this.ctx || this.muted) return;
    this.t += dt;
    const s = this.sim, c = this.r.cam, now = this.ctx.currentTime, set = (g, v) => g.gain.setTargetAtTime(v, now, 0.6);
    if (this.t > 0.5) { this.t = 0; this.sampleTraffic(); if (this.voices?.length) this.placeVoices(); }
    const near = clamp(1 - (c.dist - 40) / 700, 0.15, 1), dens = clamp(s.at(s.f.dens, c.x, c.z) / 250, 0, 1), night = this.r.night || 0;
    const active = s.paused ? 0.35 : 1, wet = { rain: 0.5, storm: 0.9, snow: 0.08 }[s.weather.type] || 0;
    set(this.hum, (0.08 + 0.35 * dens) * near * (1 - 0.4 * night) * active);
    set(this.road, 0.22 * this.traffic * near * active);
    set(this.rain, wet * 0.35);
    set(this.pad, s.tech.style === 'cyberpunk' ? 0.05 * (0.5 + night) : 0);
    const em = (this.r.poseCounts?.fire || 0) + (this.r.poseCounts?.police || 0);
    set(this.siren, em && !s.paused ? 0.03 * near : 0);
    if (!s.paused && !wet && night < 0.5 && dens < 0.4 && s.tech.style !== 'cyberpunk' && Math.random() < dt * 0.6 * near) this.chirp();
  }
}
