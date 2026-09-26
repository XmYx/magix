// Storage is conserved: incinerators burn incoming refuse first, then empty connected sites.
import { SERVICES, ZONES } from './config.js';
export const wasteCapacity = b => b.svc === 'landfillzone' ? b.cells.length * 300 : SERVICES[b.svc]?.storage || 0;
export function wasteTick(sim, all, dt) {
  const sites = all.filter(b => wasteCapacity(b)), plants = all.filter(b => SERVICES[b.svc]?.burn);
  const active = b => !b.abandoned && b.comp >= 0 && b.edge >= 0 && !(b.constructionUntil > sim.day) && !(b.flood > 1);
  const burners = plants.filter(b => active(b) && b.power && b.water).map(b => ({b,left:SERVICES[b.svc].burn * sim.budgetFor(b.svc) * dt}));
  const dumps = sites.filter(b => active(b) && !b.emptying).map(b => ({b,left:Math.min(wasteCapacity(b)-(b.garb||0), SERVICES[b.svc].garbage * sim.budgetFor(b.svc) * dt)}));
  const collectionCapacity=[...burners,...dumps].reduce((n,q)=>n+q.left,0);
  let produced=0, burned=0, transferred=0;
  for (const b of all) {
    if (b.svc) continue;
    const prod=((b.abandoned?0:b.occ||0)*0.25+(b.workers||0)*(ZONES[b.zone]?.kind==='I'?0.35:0.15))*dt;
    produced+=prod; b.garb=(b.garb||0)+prod;
    if (sim.at(sim.cov.landfill,b.cx,b.cz)>0.02) for (const q of [...burners,...dumps]) {
      if (q.b.comp!==b.comp) continue;
      const take=Math.min(b.garb,Math.max(0,q.left)); b.garb-=take; q.left-=take;
      if (SERVICES[q.b.svc].burn) burned+=take; else q.b.garb=(q.b.garb||0)+take;
    }
    b.garbOk=b.garb<40+((b.hh||0)+(b.jobs||0))*3;
  }
  for (const q of burners) for (const b of sites) {
    if (!active(b) || b.comp!==q.b.comp) continue;
    const take=Math.min(b.garb||0,q.left); b.garb-=take; q.left-=take; burned+=take; transferred+=take;
  }
  let stored=0, capacity=0;
  for (const b of sites) {
    stored+=b.garb||0; capacity+=wasteCapacity(b);
    const stage=Math.ceil((b.garb||0)/wasteCapacity(b)*20);
    if (b.wasteStage!==stage) { b.wasteStage=stage; sim.w.touchBuilding(b); }
  }
  sim.stats.garbage=[dt?collectionCapacity/dt:0,dt?produced/dt:0,capacity?stored/capacity:0];
  sim.stats.waste={stored,capacity,burned,transferred};
}
