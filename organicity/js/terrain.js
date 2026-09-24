// Deterministic heightfields and a daily, bounded flood propagation model.
import { N, SERVICES } from './config.js';
import { fbm, clamp, hash2 } from './util.js';
export const MAP_PRESETS = { river: 'River plain', hills: 'Rolling hills', coast: 'Coastal hills', islands: 'Island chain' };
export function generateHeights(w) {
  for (let z=0;z<N;z++) for(let x=0;x<N;x++) {
    const i=z*N+x, coast=Math.min(1,Math.max(0,w.wdist[i])/35);
    const h=w.mapPreset==='river'?0:Math.max(0,fbm(x*.009,z*.009,w.seed+83)-.32)*(w.mapPreset==='hills'?65:35);
    const entry=clamp((Math.hypot(Math.max(0,x-150),z-252)-22)/45,0,1);
    w.elevation[i]=w.water[i]?0:h*coast*entry;
  }
}
export function roadProfile(w) {
  for(const e of w.net.edges.values()) e.heights=Array.from({length:e.n+1},(_,k)=>w.heightAt(e.pts[k*2],e.pts[k*2+1]));
}
export function hazardTick(sim, advance = true) {
  const w=sim.w, h=w.hazards, weather=sim.weather.type;
  if(advance) h.snow=clamp(h.snow+(weather==='snow'?.045:weather==='heat'?-.07:weather==='rain'?-.025:-.012),0,1.5);
  if(advance) h.surge=clamp(h.surge+(weather==='storm'?.18:weather==='rain'?.035:-.12),0,2.4);
  const flood=w.flood; flood.fill(0);
  // Multi-source propagation follows connected water; levees can block it, but overtopping remains possible.
  const q=new Int32Array(N*N), visited=new Uint8Array(N*N); let head=0,tail=0;
  if(h.surge>.01) {
    for(let i=0;i<N*N;i++) if(w.water[i]) { flood[i]=h.surge;visited[i]=1;q[tail++]=i; }
    while(head<tail) {
      const i=q[head++],x=i%N;
      for(const j of [x?i-1:-1,x<N-1?i+1:-1,i-N,i+N]) {
        if(j<0||j>=N*N||visited[j])continue;
        const level=flood[i]+(w.water[i]?0:w.elevation[i])-.06;
        if(level<=w.elevation[j]+(w.road[j]||w.bld[j]?0:w.levees[j])*3)continue;
        visited[j]=1;flood[j]=level-w.elevation[j];q[tail++]=j;
      }
    }
  }
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
    if(advance&&b.flood>.4) { b.occ=Math.max(0,(b.occ||0)*.97);b.happy=Math.max(0,(b.happy||0)-.08); }
  }
  h.flooded=[...w.buildings.values()].filter(b=>b.flood>.4).length;
  if(advance&&weather==='storm'&&hash2(sim.day,w.seed,987)<.12) {
    const all=[...w.buildings.values()].filter(b=>!b.platformId);
    const b=all[Math.floor(hash2(sim.day,w.seed,988)*all.length)];
    if(b) { h.lightning={x:b.cx,z:b.cz,day:sim.day}; if(!sim.sandbox?.noFires&&!b.svc)sim.igniteBuilding(b);sim.msg('Lightning struck the city. Check fire coverage.','warn'); }
  }
  sim.flowVersion=(sim.flowVersion||0)+1;
}
