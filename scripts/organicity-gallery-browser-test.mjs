// Run against the repository server on 8777; uses an isolated real gallery server.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createGallery } from './organicity-gallery.mjs';
import { World } from '../organicity/js/world.js';
import { Sim } from '../organicity/js/sim.js';
import { makeSave } from '../organicity/js/save.js';
import { encodeSave } from '../organicity/js/share.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(tmpdir() + '/gallery-browser-'), gallery = createGallery({dir,token:'test'});
await new Promise(ok => gallery.server.listen(0,'127.0.0.1',ok));
const base = `http://127.0.0.1:${gallery.server.address().port}`;
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const world = new World(42); world.newGame();
  const code = await encodeSave(makeSave(world,new Sim(world,{sandbox:{}})));
  const shot='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const post = async (p,body,admin=false) => (await fetch(base+p,{method:'POST',headers:{'content-type':'application/json',...(admin?{authorization:'Bearer test'}:{})},body:JSON.stringify(body)})).json();
  for (const [title,size,year] of [['Alpine',768,1905],['Harbour',1024,2005]]) {
    const {id}=await post('/api/gallery',{title,author:'Ada',code,shot,consent:true,stats:{size,year}});
    await post(`/api/admin/${id}/approve`,{},true);
  }
  const context=await browser.newContext(), page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async route=>{
    await route.fulfill({body:await readFile(new URL('../desktop/node_modules/three/'+route.request().url().split('three@0.170.0/')[1],import.meta.url)),contentType:'text/javascript'});
  });
  await page.addInitScript(url=>localStorage.setItem('organicity-gallery-url',url),base);
  const game=process.env.CITY_URL || 'http://localhost:8777/organicity/';
  await page.goto(game); await page.locator('#introGallery').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-gal-open]').length===2);
  await page.locator('[name=q]').fill('alpine'); await page.locator('[name=size]').selectOption('768'); await page.locator('[name=era]').selectOption('1900');
  await page.locator('#galleryFilters button').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-gal-open]').length===1);
  assert.match(await page.locator('#galleryList').innerText(),/Alpine/);
  await page.locator('[data-gal-like]').click(); await page.waitForFunction(()=>document.querySelector('[data-gal-like]').textContent==='♥ 1');
  await page.locator('[data-gal-like]').click(); await page.waitForFunction(()=>document.querySelector('[data-gal-like]').textContent==='♥ 0');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedLink=text;}},configurable:true});});
  await page.locator('[data-gal-link]').click();
  const link=await page.evaluate(()=>window.copiedLink); assert(link.includes('#gallery='));
  await page.goto(link); await page.waitForFunction(()=>document.getElementById('introGallery').textContent.includes('127.0.0.1')); assert.match(await page.locator('#introGallery').innerText(),/127.0.0.1/);
  assert.equal(await page.evaluate(()=>!!window.city),false);
  await page.locator('#introGallery').click(); await page.waitForFunction(()=>window.city?.world.seed===42);
  assert.deepEqual(errors,[]); console.log(JSON.stringify({filters:true,likes:true,linkedCity:42,errors}));
} finally { await browser.close(); await new Promise(ok=>gallery.server.close(ok)); await rm(dir,{recursive:true,force:true}); }
