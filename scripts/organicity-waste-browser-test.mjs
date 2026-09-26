import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async route=>route.fulfill({body:await readFile(new URL('../desktop/node_modules/three/'+route.request().url().split('three@0.170.0/')[1],import.meta.url)),contentType:'text/javascript'}));
  await page.goto(process.env.CITY_URL||'http://localhost:8777/organicity/');await page.locator('#optSandbox').check();await page.locator('#introGo').click();await page.waitForFunction(()=>!!window.city);
  const result=await page.evaluate(async()=>{
    const {world:w,sim:s,rend:r,tools:t,ui}=city;
    const {N}=await import('/organicity/js/config.js');const {genBuilding}=await import('/organicity/js/procgen.js');
    const {wasteTick,wasteCapacity}=await import('/organicity/js/waste.js');
    s.paused=true;
    w.buildRoad({x:80,z:260},null,{x:250,z:260},'avenue');
    let point=null;for(let z=235;z<290&&!point;z++)for(let x=90;x<240;x++){const i=z*N+x;if(!w.water[i]&&!w.road[i]&&!w.bld[i]&&w.accEdge[i]>=0){point={x:x+.5,z:z+.5};break;}}
    if(!point)throw Error('No landfill location');
    const original=t.ground;t.ground=()=>point;t.set({tool:'util',svc:'landfillzone',uline:null,brush:3});t.act(true);
    const dump=[...w.buildings.values()].find(b=>b.svc==='landfillzone');if(!dump)throw Error('No painted dump');
    dump.comp=0;dump.emptying=true;dump.garb=wasteCapacity(dump)*.6;
    const shape=()=>JSON.stringify(genBuilding(dump,w));const full=shape();
    const plant={svc:'incinerator',comp:0,edge:dump.edge,power:true,water:true};
    for(let k=0;k<100&&dump.garb>0;k++)wasteTick(s,[dump,plant],1);
    const emptied=shape();if(full===emptied||dump.garb!==0)throw Error('Waste visual did not empty');
    dump.garb=10;t.s.tool='bulldoze';t.hover={b:dump};t.act(true);if(!w.buildings.has(dump.id))throw Error('Filled dump demolished');
    dump.garb=0;t.hover={b:dump};t.act(true);if(w.buildings.has(dump.id))throw Error('Empty dump demolition failed');
    t.set({tool:'zone',zone:1,brush:4,fill:false});t.refresh();const brush=r.zoneGhost.count;
    t.set({fill:true});t.refresh();const fill=r.zoneGhost.count;if(!brush||!fill)throw Error('Missing zone previews');
    t.ground=original;
    s.setWeather('rain');r.updateWeather(0);const before=Array.from(r.precipitation.geometry.attributes.position.array);
    r.cam.x+=90;r.cam.z+=70;r.cam.dist*=1.5;r.updateWeather(0);const after=Array.from(r.precipitation.geometry.attributes.position.array);
    if(before.some((v,i)=>v!==after[i]))throw Error('Rain moved with camera');
    const {TYPE_IDS}=await import('/organicity/js/agents.js');r.carLightsEnabled=true;r.drawnPoses={n:1,buf:new Float32Array([120,2,260,0,TYPE_IDS.indexOf('car'),0,0,999])};r.lastDrawn=new Map([[999,[120,2,260,0]]]);r.drawCarLights();
    const lit=r.vehicleLights.meshes,lights=lit.every(m=>m.count>=1)&&lit[0].material.color.getHex()===0xffdf72&&lit[1].material.color.getHex()===0xff2211;
    r.drawnPoses={n:25,buf:new Float32Array(25*8)};r.lastDrawn=new Map();for(let i=0;i<25;i++){r.drawnPoses.buf.set([120+i,2,260,0,i%TYPE_IDS.length,0,0,i],i*8);r.lastDrawn.set(i,[120+i,2,260,0]);}r.drawCarLights();if(r.vehicleLights.meshes.some(m=>m.count<25))throw Error('Vehicle light count capped');
    r.carLightsEnabled=false;r.drawCarLights();if(!lights||lit[0].visible)throw Error('Vehicle lights toggle');
    const {waterPorts}=await import('/organicity/js/waterports.js');
    const pump=w.createBuilding({svc:'pump',cells:[270*N+200],cx:200,cz:270,fx:0,fz:-1});
    for(const _ of s.utilitiesJob()){};if(pump.pipeConnected)throw Error('Unconnected pump works');
    const port=waterPorts(pump)[0];t.s.uline='water';const snap=t.ulineSnap({x:port.x+.5,z:port.z+.5});if(snap.x!==port.x||snap.z!==port.z)throw Error('Port snap failed');
    const pipe=w.addULine('water',port.x,port.z,200,260);for(const _ of s.utilitiesJob()){};if(!pump.pipeConnected)throw Error('Connected pump does not work');
    r.setOverlay('pipes');r.updateULines();if(!r.waterPortGroup.children.length)throw Error('Missing terminal markers');
    w.removeULine(pipe.id);for(const _ of s.utilitiesJob()){};if(pump.pipeConnected)throw Error('Pump works after removal');
    r.frame(0);ui.togglePanel('settings');
    return {brush,fill,weatherAnchored:true,wasteEmptied:true,carLights:lights};
  });
  await page.locator('[data-set="carLights"]').check();assert(await page.evaluate(()=>city.rend.carLightsEnabled));await page.locator('[data-set="carLights"]').uncheck();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({...result,errors}));
}finally{await browser.close();}
