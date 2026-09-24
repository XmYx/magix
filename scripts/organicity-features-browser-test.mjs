// Start a local HTTP server at the repository root before running.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.CITY_URL || 'http://localhost:8777/organicity/');await page.locator('#optSeed').fill('4242');await page.locator('#optMap').selectOption('hills');await page.locator('#optSandbox').check();await page.locator('#introGo').click();await page.waitForFunction(()=>!!window.city);
const state=await page.evaluate(async()=>{
 const {world:w,sim:s,rend:r,tools:t,ui}=city;s.paused=true;
 w.buildRoad(w.net.snap(150,262,3),null,w.net.snap(275,262,3),'avenue');
 const find=(key,x)=>{for(let z=275;z<315;z+=3)for(let dx=0;dx<30;dx+=3){const p=w.planService(key,x+dx,z);if(p.ok)return w.placeService(key,p);}throw Error('No placement '+key);};
 const {routeLines}=await import('/organicity/js/assign.js');
 for(const mode of ['tram','rail','metro']) {
  const svc={tram:'tramstop',rail:'railstation',metro:'metrostation'}[mode];const a=find(svc,170),b=find(svc,235);a.power=b.power=true;
  t.s.transitMode=mode;t.lineStops=[a.id,b.id];t.finishLine();
 }
 find('stormdrain',195);find('snowdepot',210);
 const infos=routeLines(w.net,w.lines.map(l=>({...l,stops:l.stops.map(id=>{const b=w.buildings.get(id);return{edge:b.edge,s:b.s,x:b.cx,z:b.cz}})})));
 s.lineInfo=new Map(infos.map(i=>[i.id,i]));s.lineInfoVersion++;r.setOverlay('transit');
 w.beginTx('Levee');w.paintLevee(200,320,10,1);w.commitTx();
 w.hazards.snow=.5;r.cam.x=220;r.cam.z=270;r.cam.dist=190;r.updateCamera();
 ui.showLines();return{lines:w.lines.map(l=>l.mode),routes:infos.map(i=>i.ok),presets:w.mapPreset};
});
await page.waitForTimeout(1000);await page.screenshot({path:'/tmp/organicity-hi-features.png'});
const rendering=await page.evaluate(()=>{const r=city.rend;return{trains:r.trains?.length,levees:r.leveeMesh?.count,geometry:[...city.world.buildings.values()].map(b=>[b.svc,b.top]),errors:[]}});
console.log(JSON.stringify({state,rendering,errors}));
if(errors.length||rendering.trains!==2||!rendering.levees)throw Error('Feature rendering failed');
await browser.close();
