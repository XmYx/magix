// aurora.js — soft drifting colour fields + twinkling stars behind Browse mode.
// Drawn at reduced resolution (it's all blur anyway); pauses when hidden.

export function startAurora(canvas, { reduced = false } = {}) {
  const ctx = canvas.getContext('2d');
  const SCALE = 0.5;
  let w = 0, h = 0, raf = 0, running = false, held = false, colours = [];
  const stars = Array.from({ length: 140 }, () => ({
    x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.3, p: Math.random() * Math.PI * 2,
  }));
  const blobs = [
    { k: '--aurora-a', ax: .25, ay: .3, rx: .18, ry: .12, s: .00007, r: .55 },
    { k: '--aurora-b', ax: .75, ay: .35, rx: .15, ry: .18, s: .00005, r: .5 },
    { k: '--aurora-c', ax: .55, ay: .8, rx: .22, ry: .1, s: .00006, r: .45 },
  ];

  const readColours = () => {
    const cs = getComputedStyle(document.documentElement);
    colours = blobs.map(b => cs.getPropertyValue(b.k).trim());
    colours.star = cs.getPropertyValue('--star').trim();
  };
  const resize = () => {
    w = canvas.width = Math.max(1, Math.round(innerWidth * SCALE));
    h = canvas.height = Math.max(1, Math.round(innerHeight * SCALE));
  };

  const draw = t => {
    ctx.clearRect(0, 0, w, h);
    blobs.forEach((b, i) => {
      const x = (b.ax + Math.sin(t * b.s + i) * b.rx) * w;
      const y = (b.ay + Math.cos(t * b.s * 1.3 + i * 2) * b.ry) * h;
      const r = b.r * Math.max(w, h);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${colours[i]}, .32)`);
      g.addColorStop(1, `rgba(${colours[i]}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    for (const s of stars) {
      const a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.0012 + s.p));
      ctx.fillStyle = `rgba(${colours.star}, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r * SCALE * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const loop = t => { draw(t); raf = requestAnimationFrame(loop); };
  const start = () => {
    if (running || held || document.hidden) return;
    running = true;
    if (reduced) draw(0); else raf = requestAnimationFrame(loop);
  };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  readColours();
  resize();
  addEventListener('resize', () => { resize(); if (reduced) draw(0); });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();

  return {
    pause() { held = true; stop(); },
    resume() { held = false; start(); },
    refresh() { readColours(); if (reduced) draw(0); },
  };
}
