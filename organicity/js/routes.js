// Directed, congestion-weighted routes between positions along road edges.
// Segments keep partial-edge arc lengths so curves and one-way access stay exact.
export function fastestRoute(net, origin, destinations) {
  const start = net.edges.get(origin.edge);
  if (!start) return null;
  const search = net.dijkstra(net.sourcesAt(start, origin.s), 'time', Infinity, true);
  let best = null;
  const offer = (cost, destination, node, end, direct = false) => {
    if (Number.isFinite(cost) && (!best || cost < best.seconds)) best = { seconds: cost, destination: destination.id, node, end, direct };
  };
  for (const d of destinations) {
    if (d.node != null) {
      const k = search.g.idx.get(d.node);
      if (k !== undefined) offer(search.dist[k], d, d.node, null);
      continue;
    }
    const e = net.edges.get(d.edge); if (!e) continue;
    const delta = d.s - origin.s;
    if (e.id === start.id && (!e.oneway || delta === 0 || Math.sign(delta) === e.oneway))
      offer(Math.abs(delta) * e.cost / e.len, d, null, { edge: e.id, from: origin.s, to: d.s }, true);
    for (const [node, arc, allowed] of [[e.a, 0, e.oneway >= 0], [e.b, e.len, e.oneway <= 0]]) {
      if (!allowed) continue;
      const k = search.g.idx.get(node);
      offer(search.dist[k] + Math.abs(d.s - arc) * e.cost / e.len, d, node, { edge: e.id, from: arc, to: d.s });
    }
  }
  if (!best) return null;
  const segments = [];
  if (!best.direct) {
    let node = best.node;
    for (let guard = 0; guard <= search.g.n; guard++) {
      const k = search.g.idx.get(node), id = search.prev[k];
      if (id < 0) break;
      const e = net.edges.get(id), forward = node === e.b;
      segments.push({ edge: id, from: forward ? 0 : e.len, to: forward ? e.len : 0 });
      node = forward ? e.a : e.b;
    }
    segments.reverse();
    segments.unshift({ edge: start.id, from: origin.s, to: node === start.a ? 0 : start.len });
  }
  if (best.end) segments.push(best.end);
  return { seconds: best.seconds, destination: best.destination, segments: segments.filter(s => Math.abs(s.to - s.from) > 1e-5) };
}

export function commuteRoutes(net, buildings, originId) {
  const origin = buildings.find(b => b.id === originId);
  if (!origin || origin.ab || origin.construction) return { job: null, highway: null };
  const jobs = buildings.filter(b => b.id !== originId && !b.svc && !b.ab && !b.construction && b.workers > 0.5);
  const outside = [...net.nodes.values()].filter(n => n.outside).map(n => ({ id: n.id, node: n.id }));
  return { job: fastestRoute(net, origin, jobs), highway: fastestRoute(net, origin, outside) };
}
