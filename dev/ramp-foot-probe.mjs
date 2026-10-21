// Ramp-foot probe: lists elevated-deck samples that hang 0.4-3.2 m above a ground-level carriageway (a slab a car
// can neither drive under nor climb onto), with the deck name, the street under it and the distance to the piece's
// grounded end. Builds the road network headless the way dev/drive-sim.mjs does (terrain + corridors + decks).
//   node dev/ramp-foot-probe.mjs [--lo=0.4] [--hi=3.2] [--step=2] [--all] [--json]
import fs from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { RoadNetwork, Terrain } from '@vibe/engine/world';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
globalThis.performance ??= { now: () => Date.now() };
const LO = +(args.lo || 0.4), HI = +(args.hi || 3.2), STEP = +(args.step || 2);

// ---------------------------------------------------------------- world (same build order as MapWorld.load)
const data = JSON.parse(fs.readFileSync(new URL('../public/map/city.json', import.meta.url)));
const terrainJson = JSON.parse(fs.readFileSync(new URL('../public/map/terrain.json', import.meta.url)));
const world = new World(new THREE.Scene(), null, { traffic: false });
world.data = data; world.source = 'osm';
world._prepare(data);
world.terrain = new Terrain(); world.terrain.setData(terrainJson); world.terrain.setOffset(world.offset);
world._buildRaster();
world._makeFiller();
world._buildSurface();
const O = world.opts;
world.net = new RoadNetwork({ roads: data.roads, rail: data.rail, raster: world.raster, isWater: (x, z) => !world.isLand(x, z), surface: world.surface, deckHolds: O.roads.deckHolds });
world.net.prepare();
world.surface.applyCorridors(world.net.corridors);
world.surface.finalize();
world.terrain.attachSurface(world.surface);
world.net.build();
world.deckHash = world.net.deckHash;

// ---------------------------------------------------------------- probe
const net = world.net, rows = [];
const decks = net.list.filter((R) => R.bridge && R.pts.length >= 2);
for (const R of decks) {
  const { pts, pp, hs, hg } = R, n = pts.length, name = R.name || `(${R.st.cls})`;
  // grounded ends: deck within 0.3 m of the ground under it
  const feet = [];
  if (Math.abs(hs[0] - hg[0]) < 0.3) feet.push(0);
  if (Math.abs(hs[n - 1] - hg[n - 1]) < 0.3) feet.push(pp.L);
  for (let s = 0; s <= pp.L + 1e-6; s += STEP) {
    const ss = Math.min(s, pp.L), i = Math.min(n - 2, pp.s.findIndex((v, k) => k + 1 < n && pp.s[k + 1] >= ss - 1e-9));
    const t = (ss - pp.s[i]) / Math.max(1e-9, pp.s[i + 1] - pp.s[i]);
    const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    const deck = hs[i] + (hs[i + 1] - hs[i]) * t + 0.05;
    // ground carriageway under the deck centre line (exact ribbon geometry, another street's name)
    let street = null, sh = -Infinity, slat = 0;
    net.segHash.forEachNear(x, z, 0, (sg, tt, lat) => {
      if (Math.abs(lat) > sg.hw || (sg.road.r.n || '') === (R.name || '')) return;
      const h = sg.ha + (sg.hb - sg.ha) * tt;
      if (h > sh) { sh = h; street = sg.road; slat = lat; }
    });
    if (!street) continue;
    const dh = deck - sh;
    if (dh < LO || dh > HI) continue;
    const foot = feet.length ? Math.min(...feet.map((f) => Math.abs(ss - f))) : Infinity;
    rows.push({ deck: name, cls: R.st.cls, street: street.r.n || `(${street.st.cls})`, x: +x.toFixed(0), z: +z.toFixed(0), s: +ss.toFixed(1), L: +pp.L.toFixed(0), above: +dh.toFixed(2), lat: +slat.toFixed(1), foot: Number.isFinite(foot) ? +foot.toFixed(1) : null, feet: feet.length });
  }
}
if (args.json) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
// ramp-foot zones the solver applied (RoadNetwork.footZone): deck pinned to the street for the first metres of a piece
const zoned = net.roads.filter((R) => R.bridge && R.zone && (R.zone[0] > 0 || R.zone[1] > 0));
console.log(`${zoned.length} ramp-foot zones:`);
for (const R of zoned) {
  const L = R.pp0.L, f = (p) => `(${p[0].toFixed(0)},${p[1].toFixed(0)})`;
  const parts = [];
  if (R.zone[0] > 0) parts.push(`${R.zone[0].toFixed(1)} m from ${f(R.pts[0])}`);
  if (R.zone[1] > 0) parts.push(`${R.zone[1].toFixed(1)} m from ${f(R.pts[R.pts.length - 1])}`);
  console.log(`  ${(R.r.n || '(' + R.st.cls + ')').padEnd(28)} L=${L.toFixed(0).padStart(4)}  ${parts.join(', ')}${R.zone[0] + R.zone[1] >= L - 1e-6 ? '  (whole piece on the ground)' : ''}`);
}
console.log(`\n${decks.length} deck pieces, ${rows.length} samples ${LO}-${HI} m above a ground carriageway (${STEP} m step)\n`);
if (args.all) {
  console.log('deck'.padEnd(26), 'street'.padEnd(22), 'x'.padStart(6), 'z'.padStart(6), 's/L'.padStart(10), 'above'.padStart(6), 'lat'.padStart(5), 'toFoot'.padStart(7));
  for (const r of rows) console.log(r.deck.padEnd(26), r.street.padEnd(22), String(r.x).padStart(6), String(r.z).padStart(6), `${r.s}/${r.L}`.padStart(10), r.above.toFixed(2).padStart(6), r.lat.toFixed(1).padStart(5), (r.foot === null ? '-' : r.foot.toFixed(1)).padStart(7));
  console.log('');
}
// grouped by deck piece x street
const groups = new Map();
for (const r of rows) {
  const k = `${r.deck}|${r.street}|${r.L}`;
  let g = groups.get(k);
  if (!g) groups.set(k, (g = { deck: r.deck, street: r.street, n: 0, min: Infinity, max: -Infinity, footMin: Infinity, footMax: -Infinity, x: r.x, z: r.z, feet: r.feet }));
  g.n++; g.min = Math.min(g.min, r.above); g.max = Math.max(g.max, r.above);
  if (r.foot !== null) { g.footMin = Math.min(g.footMin, r.foot); g.footMax = Math.max(g.footMax, r.foot); }
}
console.log('deck'.padEnd(26), 'street'.padEnd(22), 'n'.padStart(3), 'above m'.padStart(11), 'toFoot m'.padStart(12), 'at');
for (const g of [...groups.values()].sort((a, b) => b.n - a.n)) {
  const ft = Number.isFinite(g.footMin) ? `${g.footMin.toFixed(0)}-${g.footMax.toFixed(0)}` : g.feet ? '-' : 'no foot';
  console.log(g.deck.padEnd(26), g.street.padEnd(22), String(g.n).padStart(3), `${g.min.toFixed(2)}-${g.max.toFixed(2)}`.padStart(11), ft.padStart(12), `(${g.x},${g.z})`);
}
