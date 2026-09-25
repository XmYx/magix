import { N } from './config.js';
// Seeded weather uses its own random stream: simulation workload cannot change it.
import { mulberry32 } from './util.js';
export const WEATHER = {
  clear: { label: 'Clear', speed: 1, power: 1, water: 1, fire: 1, wear: 1, sky: 0xa9d3ec, light: 2.3 },
  rain: { label: 'Rain', speed: 0.8, power: 1.05, water: 0.95, fire: 0.4, wear: 1.15, sky: 0x899faa, light: 1.1 },
  snow: { label: 'Snow', speed: 0.6, power: 1.25, water: 1, fire: 0.6, wear: 1.7, sky: 0xb4c4d1, light: 1.4 },
  fog: { label: 'Fog', speed: 0.85, power: 1.05, water: 1, fire: 0.8, wear: 1, sky: 0xb6c4c7, light: 1.2 },
  heat: { label: 'Heatwave', speed: 1, power: 1.3, water: 1.35, fire: 1.8, wear: 1.1, sky: 0xe6ccb0, light: 2.6 },
  storm: { label: 'Storm', speed: 0.65, power: 1.15, water: 1, fire: 0.3, wear: 1.5, sky: 0x687987, light: 0.7 },
};
export function weatherAt(seed, day, override = null) {
  const season = ['Winter', 'Spring', 'Summer', 'Autumn'][Math.floor(((Math.floor(day / 30) * 30 + 30) % 360) / 90)];
  const rng = mulberry32((seed ^ (Math.floor(day / 30) * 2654435761)) >>> 0);
  const table = season === 'Winter' ? ['clear','snow','snow','fog','rain'] : season === 'Summer' ? ['clear','clear','heat','rain','storm'] : ['clear','rain','rain','fog','storm'];
  const type = override && WEATHER[override] ? override : table[Math.floor(rng() * table.length)];
  const wind = (type === 'storm' ? 0.95 : 0.35) + rng() * (type === 'storm' ? 0.25 : 0.6);
  const direction = rng() * Math.PI * 2;
  // fronts move with the wind: a rain band (or storm cells) sweeping across the tile
  const front = { speed: 160 + rng() * 220, width: 60 + rng() * 80, phase: rng() * 1000, cells: [0, 1, 2].map(() => [rng() - 0.5, 40 + rng() * 30]) };
  return { type, season, wind, direction, front, ...WEATHER[type] };
}

// How hard the weather hits (x, z) at time t (days): rain and snow come in a moving
// band with light drizzle either side; storms add fierce cells inside the band.
// Fog and heat cover the whole tile; clear skies nothing.
export function frontAt(w, x, z, t) {
  if (!w || !w.front) return 1;
  if (w.type === 'clear') return 0;
  if (w.type !== 'rain' && w.type !== 'snow' && w.type !== 'storm') return 1;
  const F = w.front, dx = Math.sin(w.direction), dz = Math.cos(w.direction), N2 = N / 2;
  const p = (x - N2) * dx + (z - N2) * dz, q = (x - N2) * dz - (z - N2) * dx, L = 900 + 2 * F.width;
  const pos = ((t * F.speed + F.phase) % L) - L / 2, band = Math.exp(-(((p - pos) / F.width) ** 2));
  if (w.type !== 'storm') return 0.15 + 0.85 * band;
  let cell = 0;
  F.cells.forEach(([off, r], k) => { const cp = pos + (k - 1) * 110, cq = off * 320; cell = Math.max(cell, Math.exp(-(((p - cp) ** 2 + (q - cq) ** 2) / (r * r)))); });
  return Math.min(1, 0.1 + 0.55 * band + 0.9 * cell);
}
