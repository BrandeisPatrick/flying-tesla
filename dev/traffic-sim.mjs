// Headless traffic checks: builds the World's road network + props (no renderer, flat ground) with the game's SF
// options and runs the engine traffic simulation core directly (engine/src/world/TrafficSim.js, the same code the
// traffic Web Worker runs; ground heights baked into the lane graph at build time).
// node dev/traffic-sim.mjs [seconds=120] [vehicles=250]   (PLAYER=1: stationary dummy player at the spawn, camera there)
import fs from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { RoadNetwork, Props, TrafficSim, buildSignalInfos } from '@vibe/engine/world';
import { PhysicsWorld } from '@vibe/engine/physics';

const secs = +(process.argv[2] || 120), N = +(process.argv[3] || 250);
globalThis.performance ??= { now: () => Date.now() };
const data = JSON.parse(fs.readFileSync(new URL('../public/map/city.json', import.meta.url)));
const world = new World(new THREE.Scene(), null, { traffic: N });
world.data = data; world.source = 'osm';
world._prepare(data);
world._buildRaster();
world._makeFiller();
const O = world.opts;
world.net = new RoadNetwork({ roads: data.roads, rail: data.rail, raster: world.raster, isWater: (x, z) => !world.isLand(x, z), deckHolds: O.roads.deckHolds });
world.net.build();
world.deckHash = world.net.deckHash;
world.props = new Props({ net: world.net, raster: world.raster, colliders: world.colliders, data, isLand: (x, z) => world.isLand(x, z), seed: 4242, streets: O.props.streets, signStyle: O.props.signStyle, treeRules: O.vegetation.rules });
world.props.build();
const t0 = Date.now();
const tr = new TrafficSim({
  roads: TrafficSim.roadsFrom(world.net), signals: buildSignalInfos({ data, net: world.net, props: world.props }),
  groundAt: (x, z, y) => world.getGroundHeight(x, z, y), spawn: world.getSpawn().position, seed: 7, count: N,
});
tr.build();
console.log('build ms', Date.now() - t0, 'count', tr.count, tr.stats);

// stationary dummy player at the real spawn (like main.js: setPlayer(() => car.object3d))
const PLAYER = !!process.env.PLAYER;
const dummy = new THREE.Object3D();
if (PLAYER) {
  const sp = world.getSpawn();
  dummy.position.set(sp.position.x, world.getGroundHeight(sp.position.x, sp.position.z), sp.position.z);
  dummy.rotation.y = sp.headingRad;
  dummy.updateMatrixWorld();
  tr.setPlayer(() => dummy);
}
const PHL = 2.3, PHW = 0.98;
function obb2(ax, az, afx, afz, ahl, ahw, bx, bz, bfx, bfz, bhl, bhw) {
  const dx = bx - ax, dz = bz - az;
  for (const [ux, uz] of [[afx, afz], [-afz, afx], [bfx, bfz], [-bfz, bfx]]) {
    const ra = ahl * Math.abs(afx * ux + afz * uz) + ahw * Math.abs(-afz * ux + afx * uz);
    const rb = bhl * Math.abs(bfx * ux + bfz * uz) + bhw * Math.abs(-bfz * ux + bfx * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}
const vvLog = [];
let plObb = 0, plAabb = 0, plMinGap = Infinity, vv03 = 0, plAabbFrames = 0;
function obb(a, b) {
  const axes = [[a.fx, a.fz], [-a.fz, a.fx], [b.fx, b.fz], [-b.fz, b.fx]];
  const d = [b.x - a.x, b.z - a.z];
  for (const u of axes) {
    const ra = Math.abs(a.fx * u[0] + a.fz * u[1]) * a.L / 2 + Math.abs(-a.fz * u[0] + a.fx * u[1]) * a.W / 2;
    const rb = Math.abs(b.fx * u[0] + b.fz * u[1]) * b.L / 2 + Math.abs(-b.fz * u[0] + b.fx * u[1]) * b.W / 2;
    if (Math.abs(d[0] * u[0] + d[1] * u[1]) > ra + rb - 0.25) return false;
  }
  return Math.abs(a.y - b.y) < 2;
}
let redEntries = 0, sigEntries = 0, ignored = 0, maxDy = 0, ovFrames = 0, ovTotal = 0, ovPairs = new Map();
const origEnter = tr._enter.bind(tr);
tr._enter = (v, nid) => {
  const L = tr.lanes[v.lane], Nn = tr.lanes[nid];
  if (!L.conn && Nn.conn && L.ctrl === 1) { sigEntries++; if (tr._light(L.sig, L.grp) === 0 && v.sigGo !== L.id) redEntries++; }
  if (!L.conn && Nn.conn && v.waitT >= 12) ignored++;
  origEnter(v, nid);
};
let placed = 0; const origPlace = tr._place.bind(tr); tr._place = (v, p) => { placed++; origPlace(v, p); };
// camera drives slowly around the district
const cam = new THREE.Vector3();
const dt = 1 / 60;
let tUpd = 0, frames = 0;
const speeds = [];
for (let t = 0; t < secs; t += dt) {
  world.time = t;
  world.props.updateSignals(t);
  tr.readSignals(world.props.signals); // the phase the bulbs show (MapWorld/Traffic.js copy it every frame)
  if (PLAYER) cam.set(dummy.position.x, 30, dummy.position.z + 0.01);
  else cam.set(Math.sin(t * 0.01) * 300, 30, Math.cos(t * 0.013) * 300);
  const a = Date.now();
  tr.update(dt, cam);
  tUpd += Date.now() - a; frames++;
  const V = tr.vehicles.filter((v) => v.active);
  let ov = 0;
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    const p = V[i], q = V[j];
    if ((p.x - q.x) ** 2 + (p.z - q.z) ** 2 < 200 && obb(p, q)) {
      ov++;
      const k = p.id + ':' + q.id;
      if (!ovPairs.has(k)) ovPairs.set(k, { t: t.toFixed(1), ty: p.type + '' + q.type, la: p.lane, lb: q.lane, ca: tr.lanes[p.lane].conn ? tr.lanes[p.lane].turn : 'lane', cb: tr.lanes[q.lane].conn ? tr.lanes[q.lane].turn : 'lane', na: tr.lanes[p.lane].node?.id, nb: tr.lanes[q.lane].node?.id, sa: +p.s.toFixed(1), sb: +q.s.toFixed(1), va: +p.v.toFixed(1), vb: +q.v.toFixed(1), x: +p.x.toFixed(0), z: +p.z.toFixed(0), frames: 0 });
      ovPairs.get(k).frames++;
    }
  }
  if (ov) { ovFrames++; ovTotal += ov; }
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    const p = V[i], q = V[j];
    if ((p.x - q.x) ** 2 + (p.z - q.z) ** 2 < 200 && Math.abs(p.y - q.y) < 2 && obb2(p.x, p.z, p.fx, p.fz, p.L / 2 - 0.15, p.W / 2 - 0.15, q.x, q.z, q.fx, q.fz, q.L / 2 - 0.15, q.W / 2 - 0.15)) { vv03++; if (vvLog.length < 12) vvLog.push(`t ${t.toFixed(1)} #${p.id}(${p.type}) lane ${p.lane}${tr.lanes[p.lane].conn ? 'C' : ''} s ${p.s.toFixed(1)} v ${p.v.toFixed(1)} why ${p.why} | #${q.id}(${q.type}) lane ${q.lane}${tr.lanes[q.lane].conn ? 'C' : ''} s ${q.s.toFixed(1)} v ${q.v.toFixed(1)} why ${q.why} @ ${p.x.toFixed(0)},${p.z.toFixed(0)}`); }
  }
  if (PLAYER) {
    const px = dummy.position.x, pz = dummy.position.z, pfx = -Math.sin(dummy.rotation.y), pfz = -Math.cos(dummy.rotation.y);
    for (const v of V) {
      const dx = v.x - px, dz = v.z - pz; if (dx * dx + dz * dz > 400) continue;
      if (obb2(px, pz, pfx, pfz, PHL, PHW, v.x, v.z, v.fx, v.fz, v.L / 2, v.W / 2)) plObb++;
      // clearance estimate: shrink-search
      for (let m = 0; m <= 3; m += 0.1) if (obb2(px, pz, pfx, pfz, PHL + m, PHW + m, v.x, v.z, v.fx, v.fz, v.L / 2, v.W / 2)) { plMinGap = Math.min(plMinGap, m); break; }
    }
    // what the car physics sees: its OBB vs the vehicle AABB slices returned by queryColliders
    let hit = 0;
    for (const b of tr.queryColliders(px, pz, 6, [])) {
      if (obb2(px, pz, pfx, pfz, PHL, PHW, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, 1, 0, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2)) hit++;
    }
    if (hit) { plAabb += hit; plAabbFrames++; }
  }
  if (frames % 30 === 0) {
    for (const v of V) { const g = world.getGroundHeight(v.x, v.z, tr.lanes[v.lane].bridge ? v.y : v.y - 1.5); maxDy = Math.max(maxDy, Math.abs(g - v.y)); }
    speeds.push(tr.summary());
  }
}
const s = tr.summary();
const avg = speeds.reduce((a, b) => a + b.avgSpeed, 0) / speeds.length;
const stoppedAvg = speeds.reduce((a, b) => a + b.stopped, 0) / speeds.length;
const idle = tr.vehicles.filter((v) => v.active).map((v) => v.idleT).sort((a, b) => b - a);
console.log('respawns', placed, 'idle>30s', idle.filter((x) => x > 30).length, 'max idle', idle[0].toFixed(1), 'waitT>12 now', tr.vehicles.filter((v) => v.waitT > 12).length);
console.log('vehicle-vehicle overlaps >0.3m (pair-frames):', vv03); if (process.env.DIAG) vvLog.forEach((l) => console.log('  vv', l));
if (PLAYER) console.log({ playerObbOverlapFrames: plObb, playerVsColliderSliceHits: plAabb, framesWithSliceHit: plAabbFrames, minClearanceToPlayer: plMinGap === Infinity ? 'none within 20 m' : plMinGap.toFixed(2) + ' m', stoppedForPlayer: tr.vehicles.filter((v) => v.why && v.why.startsWith('player')).length });
console.log({ frames, msPerUpdate: +(tUpd / frames).toFixed(3), final: s, avgSpeedKmh: +(avg * 3.6).toFixed(1), stoppedAvg: +stoppedAvg.toFixed(1), sigEntries, redEntries, ignoredConflicts: ignored, maxDy: +maxDy.toFixed(3), ovFrames, ovTotal, ovPairs: ovPairs.size });
const worst = [...ovPairs.values()].sort((a, b) => b.frames - a.frames).slice(0, 12);
console.table(worst);
// collider query timing
const out = [];
const q0 = Date.now();
for (let i = 0; i < 100000; i++) { out.length = 0; tr.queryColliders(cam.x + (i % 50), cam.z, 60, out); }
console.log('queryColliders us', ((Date.now() - q0) / 100000 * 1000).toFixed(2));
// engine PhysicsWorld over the real city (as main.js builds it): same collider answers as the World, and
// vertical raycasts land on the highest surface (ground / deck / box top)
{
  world.traffic = tr; // (this sim builds traffic standalone) so World.queryColliders includes vehicles, as in the game
  const pw = PhysicsWorld.fromWorld(world, { dynamic: [(x, z, r, o) => tr.queryColliders(x, z, r, o)] });
  const b = world.bounds; let rs = 12345; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  let qOk = 0, qN = 0, rOk = 0, rN = 0, bad = [];
  const pwOut = [];
  for (let i = 0; i < 3000; i++) {
    const x = b.minX + rnd() * (b.maxX - b.minX), z = b.minZ + rnd() * (b.maxZ - b.minZ), r = 2 + rnd() * 30;
    const A = world.queryColliders(x, z, r), B = pw.queryColliders(x, z, r, pwOut);
    qN++; if (A.length === B.length && A.every((a, k) => a === B[k])) qOk++;
    if (i % 3) continue;
    const top = 300;
    let want = world.getGroundHeight(x, z, top);
    for (const c of world.queryColliders(x, z, 0)) if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && c.maxY < top && c.maxY > want) want = c.maxY;
    const h = pw.raycast(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0), 1000);
    rN++; if (h && Math.abs(h.point.y - want) < 0.02) rOk++; else if (bad.length < 4) bad.push({ x: +x.toFixed(1), z: +z.toFixed(1), want, got: h && h.point.y });
  }
  const t1 = Date.now(); let hits = 0;
  for (let i = 0; i < 20000; i++) {
    const x = b.minX + rnd() * (b.maxX - b.minX), z = b.minZ + rnd() * (b.maxZ - b.minZ), a = rnd() * 6.283;
    if (pw.raycast(new THREE.Vector3(x, world.getGroundHeight(x, z) + 1.5, z), new THREE.Vector3(Math.sin(a), -0.05, Math.cos(a)), 120)) hits++;
  }
  const usRay = ((Date.now() - t1) / 20000 * 1000).toFixed(1);
  console.log('PhysicsWorld: queryColliders == World', `${qOk}/${qN}`, '| raycast-down on highest surface', `${rOk}/${rN}`, '| 120 m street-level raycast us', usRay, 'hit rate', (hits / 20000).toFixed(2));
  if (bad.length) console.log('  raycast mismatches', bad);
  if (qOk !== qN || rOk !== rN) process.exitCode = 1;
}
if (process.env.DIAG) {
  const L = tr.lanes;
  for (const v of tr.vehicles.filter((v) => v.active && v.idleT > 30).sort((a, b) => b.idleT - a.idleT).slice(0, 25)) {
    const ln = L[v.lane], nx = v.path[0] >= 0 ? L[v.path[0]] : null;
    const blk = nx && nx.conn ? nx.conf.filter((c) => L[c].occ > 0).map((c) => `${c}(occ${L[c].occ} veh${L[c].veh.map((u) => u.id).join('/')} hold${L[c].holders.map((u) => u.id + ':' + u.v.toFixed(1)).join('/')})`).join(' ') : '';
    const lead = ln.veh[v.bi + 1];
    console.log(`#${v.id} idle ${v.idleT.toFixed(0)} lane ${v.lane}${ln.conn ? 'C' + ln.turn + '@' + ln.node.id : ' ctrl' + ln.ctrl} s ${v.s.toFixed(1)}/${ln.len.toFixed(1)} xz ${v.x.toFixed(0)},${v.z.toFixed(0)} wait ${v.waitT.toFixed(0)} res ${v.res} next ${v.path[0]} lead ${lead ? lead.id : '-'} acc ${v.acc.toFixed(1)} why ${v.why} ${v.whyJ || ""} blk ${blk} dst1st ${nx && nx.conn && L[nx.dst].veh[0] ? L[nx.dst].veh[0].id + '@' + L[nx.dst].veh[0].s.toFixed(1) : ''}`);
  }
}
// baked lane heights vs the live ground query (headless: flat terrain + asphalt + bridge decks)
{
  const e = tr.bakeError((x, z, y) => world.getGroundHeight(x, z, y), 0.5);
  console.log('baked lane heights vs getGroundHeight:', JSON.stringify(e));
  if (e.over10cm / e.samples > 0.001) process.exitCode = 1;
}
