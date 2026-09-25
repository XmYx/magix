// Requires the repository server on port 8777 and Playwright.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium, _electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const desktop = process.env.PHOTO_DESKTOP === '1';
const browser = desktop ? await _electron.launch({ executablePath: new URL('../desktop/node_modules/electron/dist/electron', import.meta.url).pathname, args: ['--no-sandbox', new URL('../desktop/main.cjs', import.meta.url).pathname] }) : await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = desktop ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', async route => {
    const rel = route.request().url().split('three@0.170.0/')[1];
    try { await route.fulfill({ body: await readFile(new URL('../desktop/node_modules/three/' + rel, import.meta.url)), contentType: 'text/javascript' }); }
    catch { await route.continue(); }
  });
  if (!desktop) await page.goto(process.env.CITY_URL || 'http://localhost:8777/organicity/');
  await page.locator('#introGo').click(); await page.waitForFunction(() => !!window.city);
  await page.evaluate(() => { city.sim.paused = true; city.ui.togglePhoto(true); });
  assert(await page.locator('[data-play]').isDisabled());
  await page.locator('[data-point]').click();
  await page.evaluate(() => { city.rend.cam.x += 60; city.rend.cam.yaw += 0.5; });
  await page.locator('[data-point]').click(); await page.locator('[data-duration]').fill('2');
  const original = await page.evaluate(() => ({ ...city.rend.cam }));
  await page.locator('[data-play]').click();
  await page.waitForFunction(() => !city.rend.photoTour.busy);
  assert.deepEqual(await page.evaluate(() => ({ ...city.rend.cam })), { ...original, targetY: original.targetY ?? 0 });
  const download = desktop ? browser.evaluate(({ BrowserWindow, app }) => new Promise(resolve => {
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_e, item) => {
      const path = app.getPath('temp') + '/organicity-photo-desktop-test.webm';
      item.setSavePath(path); item.once('done', (_e, state) => resolve({ path, state }));
    });
  })) : page.waitForEvent('download');
  await page.locator('[data-video]').click();
  const file = await download;
  if (desktop) assert.equal(file.state, 'completed');
  const bytes = await readFile(desktop ? file.path : await file.path());
  assert(bytes.length > 1000); assert.equal(bytes.subarray(0, 4).toString('hex'), '1a45dfa3');
  await page.waitForFunction(() => !city.rend.photoTour.busy);
  const playable = await page.evaluate(async () => {
    // Exercise decoding as well as the container header on a second short recording.
    const tour = city.rend.photoTour;
    const blob = await new Promise(resolve => { tour.save = resolve; tour.start(2, true); });
    const url = URL.createObjectURL(blob), video = document.createElement('video'); video.src = url;
    const result = await new Promise((resolve, reject) => { video.onloadeddata = () => resolve({ width: video.videoWidth, height: video.videoHeight }); video.onerror = reject; });
    URL.revokeObjectURL(url); return result;
  });
  assert(playable.width > 0 && playable.height > 0);
  await page.locator('[data-video]').click();
  await page.evaluate(() => { window.photoStream = city.rend.photoTour.stream; city.ui.togglePhoto(false); });
  await page.waitForFunction(() => !city.rend.photoTour.busy);
  assert(await page.evaluate(() => photoStream.getTracks().every(t => t.readyState === 'ended')));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, videoBytes: bytes.length, playable, errors }));
} finally { await browser.close(); }
