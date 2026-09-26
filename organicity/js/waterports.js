// Visible pipe terminals: a line must reach the terminal and join the site's road grid.
import { SERVICES } from './config.js';
import { lineSegments, lineTier } from './infrastructure.js';
export function waterPorts(b) {
  const s=SERVICES[b.svc];if(!s)return [];
  const kinds=[];if(s.water||s.treatment)kinds.push('water');if(s.sewage||b.svc==='stormdrain')kinds.push('sewer');
  return kinds.map(kind=>({kind,x:b.cx+(b.fx||0)*(s.d/2+0.5),z:b.cz+(b.fz??1)*(s.d/2+0.5)}));
}
export function portLine(w, port, grid, comp) {
  if(comp<0)return null;
  let best=null,capacity=0;
  for(const l of w.ulines||[]) {
    if(l.kind!==port.kind||grid.root(port.kind,'l'+l.id)!==grid.root(port.kind,'c'+comp))continue;
    for(const s of lineSegments(l)) {
      const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],t=Math.max(0,Math.min(1,((port.x-s.a[0])*dx+(port.z-s.a[1])*dz)/(dx*dx+dz*dz||1)));
      if(Math.hypot(port.x-s.a[0]-t*dx,port.z-s.a[1]-t*dz)<=1.25&&lineTier(l).cap>capacity){best=l.id;capacity=lineTier(l).cap;}
    }
  }
  return best;
}
export function waterConnected(w,b,grid) {
  const ports=waterPorts(b);const edge=w.net.edges.get(b.edge),comp=edge?w.net.compOf(edge):-1;
  return ports.every(p=>portLine(w,p,grid,comp)!==null);
}

// Governors and authored scenarios build the same visible connection a player would draw.
export function connectWaterPorts(w,b,sim=null) {
  const edge=w.net.edges.get(b.edge);if(!edge)return;
  for(const p of waterPorts(b)) {
    let q=w.net.sampleAt(edge,Math.min(edge.len,Math.max(0,(b.s||0)+4)));
    if(Math.hypot(q.x-p.x,q.z-p.z)<3){const a=w.net.nodes.get(edge.a),z=w.net.nodes.get(edge.b);q=Math.hypot(a.x-p.x,a.z-p.z)>Math.hypot(z.x-p.x,z.z-p.z)?a:z;}
    const plan=w.planULine(p.kind,p.x,p.z,q.x,q.z);
    if(!plan.ok||sim&&!sim.canAfford(plan.cost))continue;
    w.addULine(p.kind,p.x,p.z,q.x,q.z);if(sim)sim.spend(plan.cost);
  }
}
