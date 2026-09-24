// Organicity — simulation worker. Hosts the heavy read-only systems (see core.js)
// off the main thread. GitHub Pages can't send COOP/COEP headers, so there is no
// SharedArrayBuffer: state goes in and results come out as structured clones.
import { Core } from './core.js';

let core = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { core = new Core(m.seed); return; }
  if (!core) return;
  if (m.type === 'run') {
    const t0 = performance.now();
    const g = core.run(m.req);
    while (!g.next().done) { /* the worker can run a whole pass at once */ }
    core.result.ms = performance.now() - t0;
    self.postMessage(core.result);
    return;
  }
  core.handle(m);
};
