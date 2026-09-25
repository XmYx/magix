// Deterministic heightfields and a daily, bounded flood propagation model.
import { N, SERVICES, RAMP_LEN, BRIDGE_DECK } from './config.js';
import { fbm, clamp, hash2 } from './util.js';
import { frontAt } from './weather.js';
export const MAP_PRESETS = { river: 'River plain', hills: 'Rolling hills', coast: 'Coastal hills', islands: 'Island chain' };
export function generateHeights(w) {
  for (let z=0;z<N;z++) for(let x=0;x<N;x++) {
    const i=z*N+x, coast=Math.min(1,Math.max(0,w.wdist[i])/35);
    const h=w.mapPreset==='river'?0:Math.max(0,fbm(x*.009,z*.009,w.seed+83)-.32)*(w.mapPreset==='hills'?65:35);
    const entry=clamp((Math.hypot(Math.max(0,x-150),z-252)-22)/45,0,1);
    w.elevation[i]=w.water[i]?0:h*coast*entry;
  }
  w.natural = w.elevation.slice();   // untouched ground: saves store grading as the difference from this
}
// ---------------------------------------------------------------- grading
// Roads and lots reshape the ground a little: a road gets a smoothed, grade-limited
// profile that meets its junctions at one shared height, the band under it is
// levelled and the shoulders blend back into the hillside; lots get a flat pad.
// Elevation is regenerated from the seed on load, so grading is replayed in the
// same order (roads by id, then buildings) and never needs saving.
const MAX_GRADE = 0.09, SHOULDER = 5;
const smooth01 = (t) => t * t * (3 - 2 * t);
export function nodeHeight(w, n) { if (n.y != null) return n.y; const c = w.cellAt(n.x, n.z); return (n.y = c >= 0 && w.water[c] ? Math.max(w.heightAt(n.x, n.z), BRIDGE_DECK) : w.heightAt(n.x, n.z)); }   // a joint mid-river sits on the bridge deck
function touch(w, x0, z0, x1, z1) {
  const g = w.dirty.grade;
  w.dirty.grade = g ? [Math.min(g[0], x0), Math.min(g[1], z0), Math.max(g[2], x1), Math.max(g[3], z1)] : [x0, z0, x1, z1];
}
export function gradeEdge(w, e) {
  const n = e.n, pts = e.pts, h = new Array(n + 1);
  const na = w.net.nodes.get(e.a), nb = w.net.nodes.get(e.b);
  for (let k = 0; k <= n; k++) h[k] = w.heightAt(pts[2 * k], pts[2 * k + 1]);
  const ground = h.slice();
  h[0] = na ? nodeHeight(w, na) : h[0]; h[n] = nb ? nodeHeight(w, nb) : h[n];
  for (let pass = 0; pass < 3; pass++) for (let k = 1; k < n; k++) h[k] = (h[k - 1] + 2 * h[k] + h[k + 1]) / 4;
  // a level plateau at each junction: every road leaves a node at the node's own height
  const J = Math.min(e.hw + 3, e.len / 4);
  let i0 = 0, i1 = n;
  for (let k = 1; k < n; k++) { if (e.cum[k] <= J) { h[k] = h[0]; i0 = k; } if (e.cum[k] >= e.len - J) { h[k] = h[n]; if (i1 === n) i1 = k; } }
  // when the two ends are further apart than the limit allows, spread the climb evenly instead
  const run = Math.max(1, e.cum[i1] - e.cum[i0]), g = Math.max(MAX_GRADE, (1.02 * Math.abs(h[n] - h[0])) / run);
  for (let k = i0 + 1; k < i1; k++) { const d = e.cum[k] - e.cum[k - 1]; h[k] = clamp(h[k], h[k - 1] - g * d, h[k - 1] + g * d); }
  for (let k = i1 - 1; k > i0; k--) { const d = e.cum[k + 1] - e.cum[k]; h[k] = clamp(h[k], h[k + 1] - g * d, h[k + 1] + g * d); }
  // Bridges: over water a ground road rises to a deck above the waves, climbing from the banks
  // no steeper than the grade limit.
  const wet = new Uint8Array(n + 1);
  if (!e.layer) for (let k = 0; k <= n; k++) { const c = w.cellAt(pts[2 * k], pts[2 * k + 1]); wet[k] = c >= 0 && w.water[c] ? 1 : 0; }
  if (wet.some((v) => v)) {
    for (let k = 1; k < n; k++) if (wet[k]) h[k] = Math.max(h[k], BRIDGE_DECK);
    for (let k = 1; k < n; k++) { const d = e.cum[k] - e.cum[k - 1]; h[k] = Math.max(h[k], h[k - 1] - g * d * 1.5); }
    for (let k = n - 1; k > 0; k--) { const d = e.cum[k + 1] - e.cum[k]; h[k] = Math.max(h[k], h[k + 1] - g * d * 1.5); }
  }
  e.heights = h; e.gradedN = n;
  // Where the grade-limited profile runs far below the ground it bores a tunnel; far above,
  // it crosses on a viaduct. Neither moves earth. 1 = viaduct, -1 = tunnel, 0 = graded.
  const struct = new Int8Array(n + 1);
  if (!e.layer) for (let k = 1; k < n; k++) { const d = ground[k] - h[k]; struct[k] = wet[k] || (d < -1.5 && (wet[k - 1] || wet[k + 1])) ? 2 : d > 6 ? -1 : d < -6 ? 1 : 0; }   // 2 = bridge
  for (let k = 1; k < n; k++) if (!struct[k] && struct[k - 1] && struct[k - 1] === struct[k + 1]) struct[k] = struct[k - 1];   // no one-sample gaps
  e.struct = struct.some((v) => v) ? struct : null;
  if (w.replaying) return;           // loading a save: the graded ground is restored, only the profile is needed
  // level the band under the road and blend the shoulders; decks and bores leave the land below alone
  const band = e.hw + 1, reach = band + SHOULDER, best = new Map();
  for (let k = 0; k < n; k++) {
    if (e.layer && (e.noRampA || e.cum[k] > RAMP_LEN) && (e.noRampB || e.cum[k + 1] < e.len - RAMP_LEN)) continue;
    if (e.struct && (e.struct[k] || e.struct[k + 1])) continue;   // tunnels keep the hill, viaducts leave the valley
    const ax = pts[2 * k], az = pts[2 * k + 1], bx = pts[2 * k + 2], bz = pts[2 * k + 3], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach)), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + reach));
    const z0 = Math.max(0, Math.floor(Math.min(az, bz) - reach)), z1 = Math.min(N - 1, Math.ceil(Math.max(az, bz) + reach));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, pz = z + 0.5, t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
      const d = Math.hypot(px - ax - dx * t, pz - az - dz * t); if (d > reach) continue;
      const i = z * N + x, prev = best.get(i);
      if (!prev || d < prev[0]) best.set(i, [d, h[k] + (h[k + 1] - h[k]) * t]);
    }
  }
  let bx0 = N, bz0 = N, bx1 = 0, bz1 = 0;
  for (const [i, [d, target]] of best) {
    if (w.water[i] || (d > band && (w.bld[i] || w.road[i]))) continue;   // shoulders never dig into water, lots or other roads
    const nat = w.elevation[i], f = d <= band ? 0 : smooth01((d - band) / SHOULDER);
    const v = Math.max(0, target + (nat - target) * f);
    if (Math.abs(v - nat) < 1e-3) continue;
    w.elevation[i] = v; const x = i % N, z = (i / N) | 0;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
  }
  if (bx1 >= bx0) touch(w, bx0, bz0, bx1 + 1, bz1 + 1);
}
// Every edge whose polyline changed (new, split or rebuilt) gets graded again.
export function roadProfile(w) {
  const edges = [...w.net.edges.values()].sort((a, b) => a.id - b.id);
  w.net.levels();
  for (const e of edges) if (e.gradedN !== e.n || !e.heights || e.heights.length !== e.n + 1) gradeEdge(w, e);
  if (w.dirty.grade) w.dirty.trees = true;
}
// A flat pad for a building: between the lot's own average and the road at its door,
// blended over a few cells so it sits on a small terrace rather than a cliff.
export function flattenLot(w, b) {
  if (b.platformId || !b.cells.length) return;
  let sum = 0, cnt = 0;
  for (const c of b.cells) if (!w.water[c]) { sum += w.elevation[c]; cnt++; }
  if (!cnt) return;
  let pad = sum / cnt;
  const e = b.edge >= 0 && w.net.edges.get(b.edge);
  if (e && e.heights) {
    let k = 0; while (k < e.n - 1 && e.cum[k + 1] < b.s) k++;
    const t = clamp((b.s - e.cum[k]) / (e.cum[k + 1] - e.cum[k] || 1), 0, 1), roadY = e.heights[k] + (e.heights[k + 1] - e.heights[k]) * t;
    pad = Math.abs(pad - roadY) < 2.5 ? roadY : pad * 0.5 + roadY * 0.5;
  }
  if (w.replaying) { b.pad = w.elevation[b.cells[0]]; return; }   // restored ground is already flat
  const RING = 3, dist = new Map();
  let q = []; for (const c of b.cells) { dist.set(c, 0); q.push(c); }
  for (let r = 1; r <= RING; r++) {
    const nq = [];
    for (const c of q) { const x = c % N; for (const n of [x ? c - 1 : -1, x < N - 1 ? c + 1 : -1, c - N, c + N]) if (n >= 0 && n < N * N && !dist.has(n)) { dist.set(n, r); nq.push(n); } }
    q = nq;
  }
  let bx0 = N, bz0 = N, bx1 = 0, bz1 = 0;
  for (const [c, r] of dist) {
    if (w.water[c] || (r > 0 && (w.road[c] || (w.bld[c] && w.bld[c] !== b.id)))) continue;
    const v = r === 0 ? pad : pad + (w.elevation[c] - pad) * (r / (RING + 1));
    if (Math.abs(v - w.elevation[c]) < (r === 0 ? 1e-7 : 1e-3)) continue;
    w.elevation[c] = Math.max(0, v); const x = c % N, z = (c / N) | 0;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
  }
  b.pad = pad;
  if (bx1 >= bx0) { touch(w, bx0, bz0, bx1 + 1, bz1 + 1); w.dirty.trees = true; }
}
// cells within 6 units of a drain (cached per line version)
function drainMask(w) {
  const drains = (w.ulines || []).filter((l) => l.kind === 'sewer'); if (!drains.length) return null;
  if (w._drainMask?.v === w.ulineVersion) return w._drainMask.m;
  const m = new Uint8Array(N * N);
  for (const l of drains) {
    const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    for (let s = 0; s <= len; s += 2) { const cx = l.a[0] + (l.b[0] - l.a[0]) * s / (len || 1), cz = l.a[1] + (l.b[1] - l.a[1]) * s / (len || 1);
      for (let z = Math.max(0, Math.floor(cz - 6)); z <= Math.min(N - 1, cz + 6); z++) for (let x = Math.max(0, Math.floor(cx - 6)); x <= Math.min(N - 1, cx + 6); x++) if (Math.hypot(x - cx, z - cz) <= 6) m[z * N + x] = 1; }
  }
  w._drainMask = { v: w.ulineVersion, m }; return m;
}
export function pond(w, sim) {
  const P = w.pond ||= new Float32Array(N * N), E = w.elevation, W = w.water, type = sim.weather.type;
  const rain = type === 'storm' ? 0.012 : type === 'rain' ? 0.003 : 0;   // puddles, not lakes
  const D = drainMask(w);
  for (let i = 0; i < P.length; i++) {
    if (W[i]) { P[i] = 0; continue; }
    P[i] *= D && D[i] ? 0.3 : w.road[i] || w.bld[i] ? 0.8 : 0.7;                 // soaks into open ground faster; drains take it away
    if (rain) P[i] += rain * frontAt(sim.weather, i % N, (i / N) | 0, sim.day + 0.5);
  }
  for (let pass = 0; pass < 6; pass++) for (let i = 0; i < P.length; i++) {
    const p = P[i]; if (p < 0.01) continue;
    const x = i % N; let low = -1, ls = E[i] + p;
    for (const j of [x ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i - N, i + N]) { if (j < 0 || j >= P.length) continue; const s = W[j] ? -1 : E[j] + P[j]; if (s < ls) { ls = s; low = j; } }
    if (low < 0) continue;
    const move = Math.min(p, (E[i] + p - ls) / 2);
    P[i] -= move; if (!W[low]) P[low] += move;                                  // water reaching a river or the sea is gone
  }
}

export function hazardTick(sim, advance = true) {
  const w=sim.w, h=w.hazards, weather=sim.weather.type;
  if(advance) h.snow=clamp(h.snow+(weather==='snow'?.045:weather==='heat'?-.07:weather==='rain'?-.025:-.012),0,1.5);
  // surges are rare and shallow: only the worst storm days push the water up, and it recedes fast
  if(advance) h.surge=clamp(h.surge+(weather==='storm'&&hash2(sim.day,w.seed,991)<.3?.05:-.2),0,.9);
  const flood=w.flood; flood.fill(0);
  // Multi-source propagation follows connected water; levees can block it, but overtopping remains possible.
  const q=new Int32Array(N*N), visited=new Uint8Array(N*N); let head=0,tail=0;
  if(h.surge>.01) {
    for(let i=0;i<N*N;i++) if(w.water[i]) { flood[i]=h.surge;visited[i]=1;q[tail++]=i; }
    while(head<tail) {
      const i=q[head++],x=i%N;
      for(const j of [x?i-1:-1,x<N-1?i+1:-1,i-N,i+N]) {
        if(j<0||j>=N*N||visited[j])continue;
        const level=flood[i]+(w.water[i]?0:w.elevation[i])-.06;   // surges lose height as they spread inland
        if(level<=w.elevation[j]+(w.road[j]||w.bld[j]?0:w.levees[j])*3)continue;
        visited[j]=1;flood[j]=level-w.elevation[j];q[tail++]=j;
      }
    }
  }
  // Rainwater ponding: rain falls on land (heaviest under the front), runs downhill for a few
  // passes and collects in hollows; it drains away over the following days.
  if (advance) pond(w, sim);
  if (w.pond) for (let i = 0; i < flood.length; i++) if (w.pond[i] > 0.25) flood[i] = Math.max(flood[i], w.pond[i] - 0.25);
  const active=[...w.buildings.values()].filter(b=>b.svc&&!b.abandoned&&b.edge>=0&&b.power&&b.water&&(b.flood||0)<1);
  for(const b of active.filter(b=>b.svc==='stormdrain')) {
    const r=SERVICES.stormdrain.radius, budget=sim.budgetFor('stormdrain');
    for(let z=Math.max(0,Math.floor(b.cz-r));z<Math.min(N,b.cz+r);z++)for(let x=Math.max(0,Math.floor(b.cx-r));x<Math.min(N,b.cx+r);x++) {
      const i=z*N+x;if(!w.water[i])flood[i]=Math.max(0,flood[i]-1.8*budget*Math.max(0,1-Math.hypot(x-b.cx,z-b.cz)/r));
    }
  }
  const graph=w.net.graph();
  const plows=active.filter(b=>b.svc==='snowdepot');
  for(const e of w.net.edges.values()) {
    const p=w.net.sampleAt(e,e.len/2),i=w.cellAt(p.x,p.z);
    const clear=plows.some(b=>b.comp===graph.comp[graph.idx.get(e.a)]&&Math.hypot(b.cx-p.x,b.cz-p.z)<SERVICES.snowdepot.radius*sim.budgetFor('snowdepot'));
    e.snow=clear?Math.max(0,h.snow-.9):h.snow;
    e.flood=e.layer?0:Math.max(...Array.from({length:e.n+1},(_,k)=>flood[w.cellAt(e.pts[2*k],e.pts[2*k+1])]||0));
    e.hazardSpeed=Math.max(.08,1-e.snow*.45-e.flood*.4);
  }
  for(const b of w.buildings.values()) {
    b.flood=b.platformId?0:flood[w.cellAt(b.cx,b.cz)]||0;
    if(advance&&b.flood>.6) { b.occ=Math.max(0,(b.occ||0)*.99);b.happy=Math.max(0,(b.happy||0)-.04); }
  }
  h.flooded=[...w.buildings.values()].filter(b=>b.flood>.6).length;
  if(advance&&weather==='storm'&&hash2(sim.day,w.seed,987)<.12) {
    const all=[...w.buildings.values()].filter(b=>!b.platformId);
    const under=all.filter(b=>frontAt(sim.weather,b.cx,b.cz,sim.day+.5)>.6), pool=under.length?under:all;   // strikes come from the storm cells
    const b=pool[Math.floor(hash2(sim.day,w.seed,988)*pool.length)];
    if(b) { h.lightning={x:b.cx,z:b.cz,day:sim.day}; if(!sim.sandbox?.noFires&&!b.svc)sim.igniteBuilding(b);sim.msg('Lightning struck the city. Check fire coverage.','warn'); }
  }
  sim.flowVersion=(sim.flowVersion||0)+1;
}
