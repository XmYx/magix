// Transit supply and operations. Capacity is trips per assignment pass.
export const TRANSIT = {
  bus: { name: 'Bus', stop: 'busstop', speed: 7, capacity: 500, walk: 45, upkeep: 150, perStop: 45, fare: 6, trackCost: 0 },
  tram: { name: 'Tram', stop: 'tramstop', speed: 10, capacity: 1000, walk: 55, upkeep: 400, perStop: 70, fare: 6, trackCost: 35 },
  rail: { name: 'Rail', stop: 'railstation', speed: 24, capacity: 2400, walk: 85, upkeep: 900, perStop: 140, fare: 9, trackCost: 75 },
  metro: { name: 'Metro', stop: 'metrostation', speed: 18, capacity: 3200, walk: 65, upkeep: 1200, perStop: 180, fare: 7, trackCost: 150 },
};
export const transitMode = l => TRANSIT[l.mode] || TRANSIT.bus;
export function trackLength(stops) {
  return stops.reduce((n, a, i) => { const b = stops[(i + 1) % stops.length]; return n + Math.hypot(a.x - b.x, a.z - b.z); }, 0);
}
