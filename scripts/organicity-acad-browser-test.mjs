// Run with the repository served on 8777. PLAYWRIGHT_MODULE can name a bundled runtime.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async route=>{try{await route.fulfill({body:await readFile(new URL('../desktop/node_modules/three/'+route.request().url().split('three@0.170.0/')[1],import.meta.url)),contentType:'text/javascript'});}catch{await route.continue();}});
 await page.goto(process.env.CITY_URL || 'http://localhost:8777/organicity/');await page.locator('#optSandbox').check();await page.locator('#introGo').click();await page.waitForFunction(()=>!!window.city);
 await page.evaluate(()=>{city.sim.paused=true;city.tools.setTool('util');});
 await page.locator('[data-uline="water"]').click();await page.locator('[data-line-tier="1"]').click();await page.locator('[data-line-mode="curve"]').click();
 const curve=await page.evaluate(()=>{const {tools:t,world:w}=city; const original=t.ground;const click=(x,z)=>{t.ground=()=>({x,z});t.act(true);}; click(120,130);click(160,180);click(200,130);t.ground=original;return w.ulines.at(-1);});
 assert(curve?.tier===1 && curve.points.length>2);
 await page.evaluate(()=>city.tools.setTool('road'));await page.locator('[data-bridge-style="arch"]').click();assert.equal(await page.evaluate(()=>city.tools.s.bridgeStyle),'arch');
 const state=await page.evaluate(async()=>{
  const {world:w,sim:s,rend:r,ui}=city;
  w.buildRoad(w.net.snap(150,262,3),null,w.net.snap(270,262,3),'avenue');
  const place=(key,x)=>{for(let z=230;z<325;z+=3)for(let dx=0;dx<135;dx+=3){const p=w.planService(key,140+dx,z);if(p.ok)return w.placeService(key,p);}throw Error('No placement '+key);};
  for(const [k,x] of [['transformer',150],['treatment',170],['sewageplant',195],['advancedsewage',210],['parking',230]])place(k,x);
  place('school',150);place('college',170);place('depot',200);
  w.fillZone(170,248,1);for(let i=0;i<w.zone.length;i+=3)if(w.zone[i]===1 && w.free(i)&&w.accEdge[i]>=0)w.placeGrowable(i%512+0.5,Math.floor(i/512)+0.5,1);
  for(const b of w.buildings.values())if(!b.svc){s.capacity(b);if(b.hh)b.occ=Math.min(b.hh,5);}
  for(const _ of s.utilitiesJob()){};
  s.coreJob.covKey=null;s.requestCore(s.day,true,'acad');
  r.cam.x=190;r.cam.z=260;r.cam.dist=230;r.setOverlay('pipes');r.frame(0);
  ui.togglePanel('president');
  return {ulines:w.ulines.length,services:[...w.buildings.values()].filter(b=>b.svc).length};
 });
 await page.waitForFunction(()=>city.sim.residentTrips?.length>0);
 const visuals=await page.evaluate(()=>{
  const {rend:r,sim:s,ui}=city;const c=s.residentTrips.find(c=>c.destination!=null);if(!c)throw Error('No resident destination assigned');
  r.tod=((c.depart+c.minutes/120-6+24)%24)/24;r.frame(0);ui.followResident(city.world.buildings.get(c.home),c.k);r.frame(0);
  let invalid=0;r.scene.traverse(o=>{const p=o.geometry?.attributes?.position?.array;if(p)for(const n of p)if(!Number.isFinite(n)){invalid++;break;}});
  return {residents:s.residentTrips.length,walkers:r.people.count,following:r.follow.work,invalid,utilityMeshes:r.ulGroup.children.length};
 });
 assert.equal(visuals.invalid,0);assert(visuals.following && visuals.utilityMeshes);
 const aerial=await page.evaluate(async()=>{
  const {world:w,sim:s,rend:r,tools:t}=city;const {N}=await import('/organicity/js/config.js');const {maxCameraDistance}=await import('/organicity/js/aviation.js');
  w.buildRoad(w.net.snap(60,90,3),null,w.net.snap(250,90,3),'avenue');
  let airport=null;for(let x=90;x<240 && !airport;x+=3)for(let z=104;z<130 && !airport;z+=3){const p=w.planService('airfield',x,z);if(p.ok)airport=w.placeService('airfield',p);}
  if(!airport)throw Error('Airfield placement');airport.power=airport.water=true;airport.constructionUntil=0;
  r.flightClock=36;r.updateAviation(0);
  const bounds=r.cameraRegionBounds;r.cam.x=bounds.minX+N/2;r.cam.z=bounds.minZ+N/2;t.wheel({preventDefault(){},clientX:500,clientY:300,deltaY:100000});r.updateCamera();r.updateRegionalClouds(0);
  const before=w.net.edges.size,ground=t.ground;t.ground=()=>({x:-100,z:50});t.setTool('road');t.act(true);t.ground=ground;
  r.frame(0);return {x:r.cam.x,z:r.cam.z,zoom:r.cam.dist,max:maxCameraDistance(),planes:r.airplanes.count,clouds:r.regionalClouds.count,visible:r.regionalClouds.visible,unchanged:w.net.edges.size===before};
 });
 assert(aerial.zoom===aerial.max && aerial.planes>0 && aerial.clouds>0 && aerial.visible && aerial.unchanged);assert(aerial.x<0 || aerial.z<0);
 await page.screenshot({path:'/tmp/organicity-acad.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({state,visuals,aerial,errors}));
} finally {await browser.close();}
