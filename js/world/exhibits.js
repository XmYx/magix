// exhibits.js — turns works.json into glowing monoliths standing on the bodies.
import * as THREE from 'three';
import { ZONES } from './field.js';

const V3 = THREE.Vector3;
const Y = new V3(0, 1, 0);

function itemsFor(data) {
  const repoUrl = e => e.url || `https://github.com/XmYx/${e.repo}`;
  return {
    hub: [
      { title: 'Welcome', blurb: 'Walk off any edge — gravity follows the surface. Jump between worlds; follow the gold arrow (or press H) to come home.', welcome: true },
      ...data.pages.map(p => ({ title: p.label, blurb: p.blurb, href: p.href })),
      { title: 'GitHub', blurb: 'Every repository, forks and all.', href: data.links.github },
    ],
    code: data.featured.map(f => ({
      title: f.title, blurb: f.blurb, href: repoUrl(f), big: true,
      meta: [f.stars ? `★ ${f.stars}` : '', f.language].filter(Boolean).join(' · '),
    })),
    film: data.film.credits.map(c => ({
      title: c.title, blurb: `${c.role} · ${c.kind}`, meta: [c.years, c.note].filter(Boolean).join(' · '), href: data.film.imdb,
    })),
    lab: data.lab.map(l => ({ title: l.label, blurb: l.blurb || 'A small experiment that runs in the browser.', href: l.href })),
    wild: data.archive.slice(0, 12).map(a => ({
      title: a.repo, blurb: a.blurb || a.description || 'From the archive.', href: repoUrl(a),
      meta: [a.language, a.pushed?.slice(0, 4)].filter(Boolean).join(' · '),
    })),
  };
}

function makeLabel(text, glow) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 160;
  const x = c.getContext('2d');
  let size = 84;
  do { x.font = `600 ${size}px Fraunces, Georgia, serif`; size -= 4; } while (x.measureText(text).width > 960 && size > 36);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = `#${glow.getHexString()}`;
  x.shadowBlur = 28;
  x.fillStyle = '#ffffff';
  x.fillText(text, 512, 84);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(4.2, 0.66, 1);
  return s;
}

function makeMonolith(item, zone, slabMat) {
  const glow = new THREE.Color(ZONES[zone].glow);
  const g = new THREE.Group();
  const h = item.big ? 3.0 : item.welcome ? 2.6 : 2.2;
  const slabGeo = new THREE.BoxGeometry(1.3, h, 0.22);
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.y = h / 2;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo),
    new THREE.LineBasicMaterial({ color: glow.clone().multiplyScalar(2.2) }));
  edges.position.copy(slab.position);
  const gem = new THREE.Mesh(item.welcome ? new THREE.IcosahedronGeometry(0.45) : new THREE.OctahedronGeometry(0.32),
    new THREE.MeshBasicMaterial({ color: glow.clone().multiplyScalar(item.welcome ? 1.4 : 1.9) }));
  gem.position.y = h + 0.7;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.08, 48),
    new THREE.MeshBasicMaterial({ color: glow.clone().multiplyScalar(1.6), transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  const label = makeLabel(item.title, glow);
  label.position.y = h + 1.45;
  g.add(slab, edges, gem, ring, label);
  return { group: g, gem, ring, height: h };
}

/** Place every item on a surface point of its zone's bodies, with clearance. */
export function buildExhibits(world, data, rand) {
  const { field, bodies, hub, spawn } = world;
  const group = new THREE.Group();
  const list = [];
  const items = itemsFor(data);
  const slabMat = new THREE.MeshBasicMaterial({ color: 0x0b0716 });
  const p = new V3(), n = new V3(), dir = new V3(), probe = new V3();

  const clear = (pt, nrm) => {
    if (field.hard(probe.copy(pt).addScaledVector(nrm, 1.4)) < 1.1) return false;
    if (field.hard(probe.copy(pt).addScaledVector(nrm, 3.2)) < 1.1) return false;
    if (pt.distanceTo(spawn.pos) < 3) return false;
    return !list.some(e => e.base.distanceTo(pt) < 3.6);
  };
  const add = (item, zone, body, pt, nrm, spin = rand() * Math.PI * 2) => {
    const m = makeMonolith(item, zone, slabMat);
    m.group.position.copy(pt);
    m.group.quaternion.setFromUnitVectors(Y, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(Y, spin));
    group.add(m.group);
    list.push({ ...m, item, zone, body, base: pt.clone(), normal: nrm.clone(), center: pt.clone().addScaledVector(nrm, 1.2) });
  };

  /* hub: hand-placed on the top face around the spawn; the welcome slab faces it */
  const hubDirs = [[0, 1, -0.45], [-0.55, 1, -0.05], [0.55, 1, -0.05], [-0.5, 1, 0.55], [0.5, 1, 0.55], [0, 1, 0.9]];
  items.hub.forEach((item, i) => {
    hub.surfacePoint(dir.set(...hubDirs[i % hubDirs.length]).normalize(), p);
    hub.normal(p, n);
    add(item, 'hub', hub, p.clone(), n.clone(), item.welcome ? 0 : rand() * Math.PI * 2);
  });

  /* zones: round-robin over the zone's bodies */
  for (const zone of ['code', 'film', 'lab', 'wild']) {
    const zb = bodies.filter(b => b.zone === zone);
    if (!zb.length) continue;
    items[zone].forEach((item, i) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        const b = zb[(i + Math.floor(attempt / 20)) % zb.length];
        const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        b.surfacePoint(dir.set(s * Math.cos(th), u, s * Math.sin(th)), p);
        if (Math.abs(field.hard(p)) > 0.02) continue; // point is buried inside another body
        b.normal(p, n);
        if (!clear(p, n)) continue;
        add(item, zone, b, p.clone(), n.clone());
        return;
      }
    });
  }

  return {
    group,
    list,
    update(t, playerPos) {
      let best = null, bestD = 3.8;
      for (const e of list) {
        e.gem.rotation.y = t * 0.9;
        e.gem.position.y = e.height + 0.7 + Math.sin(t * 1.6 + e.base.x) * 0.12;
        const d = e.center.distanceTo(playerPos);
        if (d < bestD) { bestD = d; best = e; }
      }
      for (const e of list) e.ring.material.opacity = e === best ? 1 : 0.55;
      return best;
    },
  };
}
