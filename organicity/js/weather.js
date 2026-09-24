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
  const season = ['Winter', 'Spring', 'Summer', 'Autumn'][Math.floor(((day + 30) % 360) / 90)];
  const rng = mulberry32((seed ^ (Math.floor(day / 5) * 2654435761)) >>> 0);
  const table = season === 'Winter' ? ['clear','snow','snow','fog','rain'] : season === 'Summer' ? ['clear','clear','heat','rain','storm'] : ['clear','rain','rain','fog','storm'];
  const type = override && WEATHER[override] ? override : table[Math.floor(rng() * table.length)];
  const wind = (type === 'storm' ? 0.95 : 0.35) + rng() * (type === 'storm' ? 0.25 : 0.6);
  return { type, season, wind, direction: rng() * Math.PI * 2, ...WEATHER[type] };
}
