// Organicity — visible-traffic worker: runs AgentSim (agents.js) off the main
// thread and posts packed vehicle poses back each step.
import { AgentSim } from './agents.js';

const sim = new AgentSim();
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'step') { const r = sim.step(m.dt); self.postMessage(r, [r.buf.buffer]); return; }
  sim.handle(m);
};
