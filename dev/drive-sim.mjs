// Headless street drive: the Roadster (engine VehicleController) is driven by a pure-pursuit pilot along real downtown
// SF streets of the baked map, with the terrain + road surface, building / pier / furniture colliders and the bridge
// decks attached exactly as the game builds them (no renderer). Reports the physics quality per street: per-step
// pitch / roll snaps, vertical hops not explained by the velocity, airborne episodes and flight-mode entries,
// floating wheels, wheels below the drawn surface, impacts, controller tracking error.
//   node dev/drive-sim.mjs [--streets=a,b,c] [--kmh=50] [--trace=street] [--json]
import fs from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { RoadNetwork, Props, Terrain, BuildingBuilder } from '@vibe/engine/world';
import { polygonToBoxes, VehicleController, ROADSTER_SPEC, PhysicsWorld } from '@vibe/engine/physics';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
globalThis.performance ??= { now: () => Date.now() };
const DT = 1 / 120, DEG = 180 / Math.PI;

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
for (const b of world.net.piers) world.colliders.add(b[0], b[1], b[2], b[3], b[4], b[5], 5);
world.deckHash = world.net.deckHash;
{ // building colliders from the footprints (as _buildBuildingsStreamed registers them)
  const probe = new BuildingBuilder(world.bounds, { ...world._buildingOpts(), grid: false });
  let n = 0;
  for (const bd of data.buildings) {
    if (!bd || bd._lm) continue;
    let fp = null;
    try { fp = probe.footprint(bd); } catch { fp = null; }
    if (!fp) continue;
    const y0 = fp.base + (fp.mh > 0 ? fp.mh : -1);
    for (const bx of polygonToBoxes(fp.outer, fp.holes)) { world.colliders.add(bx[0], y0, bx[2], fp.base + fp.h, bx[1], bx[3], 1); n++; }
  }
  world._buildingBoxes = n;
}
world.props = new Props({ net: world.net, raster: world.raster, colliders: world.colliders, data, isLand: (x, z) => world.isLand(x, z), groundAt: (x, z) => world._groundAt(x, z), seed: 4242, streets: O.props.streets, signStyle: O.props.signStyle, treeRules: O.vegetation.rules });
world.props.build();
const physics = PhysicsWorld.fromWorld(world, { deckStep: 0.35 });
if (!args.json) console.log(`world: ${world.colliders.boxes.length} collider boxes (${world._buildingBoxes} building), ${world.net.list.length} roads, terrain ${world.terrain.ready ? 'ready' : 'FLAT'}`);

// ---------------------------------------------------------------- street paths (chain the named road pieces)
function streetPath(name) {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  let list = world.net.list.filter((R) => R.name && re.test(R.name) && !R.filler && R.st.drivable && !R.st.minor && R.pts.length >= 2);
  if (!list.length) return null;
  // one street name can cover a busway / tram median with the same name: keep the car class with the most length
  const carish = list.filter((R) => !/^(busway|pedestrian|footway|cycleway|track|path)$/.test(R.st.cls));
  if (carish.length) list = carish;
  const lenByCls = {};
  for (const R of list) lenByCls[R.st.cls] = (lenByCls[R.st.cls] || 0) + R.pp.L;
  const topCls = Object.entries(lenByCls).sort((a, b) => b[1] - a[1])[0][0];
  list = list.filter((R) => R.st.cls === topCls);
  const byLen = list.slice().sort((a, b) => b.pp.L - a.pp.L);
  // drive in the right-most through lane of EACH piece (widths change along a street): inside the parking lane,
  // half a lane from the kerb-side lane edge; one-way streets with a single lane stay on the centre line
  const offsetOf = (st) => {
    const laneW = st.laneW || 3.3, parkW = st.parkW || 0;
    if (st.oneway && st.lanes <= 1) return 0;
    return Math.max(st.oneway ? 0 : laneW * 0.5, Math.min(st.hw - parkW - laneW * 0.5, st.hw - 1.3));
  };
  const st = byLen[0].st, laneOff = offsetOf(st);
  // chain the RAW centre lines (ends meet exactly), remembering each vertex's piece offset, then offset the chain
  const raw = list.map((R, k) => ({ pts: R.pts.map((p) => [p[0], p[1], offsetOf(R.st)]), k }));
  raw.sort((a, b) => len(b.pts) - len(a.pts));
  let chain = raw.shift().pts;
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 2.5;
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < raw.length; i++) {
      const q = raw[i].pts, h = chain[0], t = chain[chain.length - 1];
      if (near(t, q[0])) chain = chain.concat(q.slice(1));
      else if (near(t, q[q.length - 1])) chain = chain.concat(q.slice(0, -1).reverse());
      else if (near(h, q[q.length - 1])) chain = q.slice(0, -1).concat(chain);
      else if (near(h, q[0])) chain = q.slice(1).reverse().concat(chain);
      else continue;
      raw.splice(i, 1); grew = true; break;
    }
  }
  chain = chain.map((p, i) => {
    const a = chain[Math.max(0, i - 1)], b = chain[Math.min(chain.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, off = p[2];
    return [p[0] + (-dz / l) * off, p[1] + (dx / l) * off];
  });
  // cumulative distance
  const s = [0];
  for (let i = 1; i < chain.length; i++) s.push(s[i - 1] + Math.hypot(chain[i][0] - chain[i - 1][0], chain[i][1] - chain[i - 1][1]));
  return { name, pts: chain, s, L: s[s.length - 1], hw: st.hw, laneOff, oneway: st.oneway };
}
function len(P) { let l = 0; for (let i = 1; i < P.length; i++) l += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return l; }
function pointAt(path, d) {
  const { pts, s } = path;
  if (d <= 0) return pts[0];
  if (d >= path.L) return pts[pts.length - 1];
  let i = 1; while (s[i] < d) i++;
  const t = (d - s[i - 1]) / Math.max(1e-9, s[i] - s[i - 1]);
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
}
function progressOf(path, x, z, from) {
  // closest point on the path near the previous progress (search a window of segments)
  const { pts, s } = path;
  let best = Infinity, bs = from;
  let i0 = 1; while (i0 < s.length - 1 && s[i0] < from - 40) i0++;
  for (let i = i0; i < pts.length && s[i - 1] < from + 80; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], dx = pts[i][0] - ax, dz = pts[i][1] - az, L2 = dx * dx + dz * dz;
    const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const qx = ax + dx * t, qz = az + dz * t, d2 = (qx - x) ** 2 + (qz - z) ** 2;
    if (d2 < best) { best = d2; bs = s[i - 1] + Math.sqrt(L2) * t; }
  }
  return { s: bs, dist: Math.sqrt(best) };
}

// ---------------------------------------------------------------- drive one street
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
function attitude(q) {
  _f.set(0, 0, -1).applyQuaternion(q); _r.set(1, 0, 0).applyQuaternion(q); _u.set(0, 1, 0).applyQuaternion(q);
  return { pitch: Math.asin(Math.max(-1, Math.min(1, _f.y))), roll: Math.atan2(-_r.y, _u.y), heading: Math.atan2(-_f.x, -_f.z) };
}
function drive(path, kmh, opts = {}) {
  const vmax = kmh / 3.6;
  const car = new VehicleController(ROADSTER_SPEC);
  const p0 = path.pts[0], p1 = pointAt(path, 6);
  const heading = Math.atan2(-(p1[0] - p0[0]), -(p1[1] - p0[1]));
  car.reset(new THREE.Vector3(p0[0], 0, p0[1]), heading, physics);
  const ctl = { throttle: 0, brake: 0, steer: 0, thrust: 0, pitch: 0, roll: 0, yaw: 0, boost: false, handbrake: false };
  const M = {
    street: path.name, lengthM: path.L, steps: 0, time: 0, dist: 0, maxKmh: 0, meanKmh: 0,
    pitchStep: { max: 0, over02: 0, over05: 0, over1: 0 }, rollStep: { max: 0, over02: 0, over05: 0, over1: 0 },
    hops: { max: 0, over2cm: 0, over5cm: 0 }, air: { episodes: 0, time: 0, maxDur: 0, flightEntries: 0, flightTime: 0 },
    wheels: { floatMax: 0, floatSteps: 0, sinkMin: 0, sinkSteps: 0 }, impacts: { n: 0, maxMs: 0, kinds: {} },
    bodyContact: 0, upsideDown: 0, damage: 0, track: { maxOff: 0, meanOff: 0 }, maxPitchDeg: 0, maxRollDeg: 0, grade: { maxUp: 0, maxDown: 0 }, nan: false, finished: false,
    events: [],
  };
  const ev = (kind, t, p, extra) => { if (M.events.length < 14) M.events.push(`${kind} t=${t.toFixed(1)} @(${p.x.toFixed(0)},${p.y.toFixed(2)},${p.z.toFixed(0)}) ${extra}`); };
  const trace = opts.trace ? [] : null;
  let prog = 0, prevAtt = attitude(car.quaternion), prevY = car.position.y, prevVy = 0, airStart = -1, offSum = 0, kmhSum = 0;
  let wasGrounded = true, prevMode = 'ground', flightStart = -1;
  const maxT = path.L / Math.max(3, vmax * 0.35) + 20;
  for (let t = 0; t < maxT; t += DT) {
    const p = car.position;
    const { s, dist } = progressOf(path, p.x, p.z, prog);
    prog = Math.max(prog, s);
    if (prog > path.L - 8) { M.finished = true; break; }
    // pure pursuit
    const look = Math.max(7, Math.min(28, 0.7 * car.speed + 4));
    const T = pointAt(path, prog + look);
    const att = attitude(car.quaternion);
    const h = att.heading;
    const fx = -Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
    const dx = T[0] - p.x, dz = T[1] - p.z;
    const fwd = dx * fx + dz * fz, right = dx * rx + dz * rz;
    const alpha = Math.atan2(right, Math.max(fwd, 0.5));
    // curvature ahead limits the speed (lateral accel budget 0.6 g)
    const T2 = pointAt(path, prog + look * 2.2), d2x = T2[0] - p.x, d2z = T2[1] - p.z;
    const alpha2 = Math.atan2(d2x * rx + d2z * rz, Math.max(d2x * fx + d2z * fz, 0.5));
    const bend = Math.max(Math.abs(alpha), Math.abs(alpha2) * 0.7);
    const vT = Math.min(vmax, Math.max(5, vmax * (1 - bend / 0.55)));
    const e = vT - car.forwardSpeed;
    ctl.steer = Math.max(-1, Math.min(1, alpha * 2.2));
    ctl.throttle = e > 0 ? Math.min(1, e * 0.35) : 0;
    ctl.brake = e < -1.5 ? Math.min(1, -e * 0.25) : 0;
    car.step(DT, ctl, physics);
    M.steps++; M.time = t + DT;
    if (![p.x, p.y, p.z, car.velocity.x, car.velocity.y, car.velocity.z].every(Number.isFinite)) { M.nan = true; break; }
    const att2 = attitude(car.quaternion);
    const dp = Math.abs(att2.pitch - prevAtt.pitch) * DEG, dr = Math.abs(att2.roll - prevAtt.roll) * DEG;
    M.pitchStep.max = Math.max(M.pitchStep.max, dp); if (dp > 0.2) M.pitchStep.over02++; if (dp > 0.5) M.pitchStep.over05++; if (dp > 1) M.pitchStep.over1++;
    M.rollStep.max = Math.max(M.rollStep.max, dr); if (dr > 0.2) M.rollStep.over02++; if (dr > 0.5) M.rollStep.over05++; if (dr > 1) M.rollStep.over1++;
    M.maxPitchDeg = Math.max(M.maxPitchDeg, Math.abs(att2.pitch) * DEG); M.maxRollDeg = Math.max(M.maxRollDeg, Math.abs(att2.roll) * DEG);
    // vertical hop: position change beyond what the pre-step vertical velocity explains
    const hop = Math.abs((p.y - prevY) - prevVy * DT);
    if (car.grounded && wasGrounded) { M.hops.max = Math.max(M.hops.max, hop); if (hop > 0.02) M.hops.over2cm++; if (hop > 0.05) M.hops.over5cm++; if (hop > 0.2) ev('HOP', t, p, `dy=${(p.y - prevY).toFixed(2)} kmh=${(car.speed * 3.6).toFixed(0)} gaps=${Array.from(car.wheelGaps).map((g) => g.toFixed(2)).join('/')}`); }
    if (dp > 2 || dr > 2) ev('SNAP', t, p, `dpitch=${dp.toFixed(1)} droll=${dr.toFixed(1)} kmh=${(car.speed * 3.6).toFixed(0)} gaps=${Array.from(car.wheelGaps).map((g) => g.toFixed(2)).join('/')} grounded=${car.grounded}`);
    // grade of the road (for context)
    if (car.grounded) { const g = Math.atan2(car.velocity.y, Math.hypot(car.velocity.x, car.velocity.z)) * DEG; if (car.speed > 3) { M.grade.maxUp = Math.max(M.grade.maxUp, g); M.grade.maxDown = Math.min(M.grade.maxDown, g); } }
    // airborne / flight
    if (!car.grounded && wasGrounded) { airStart = t; M.air.episodes++; }
    if (car.grounded && !wasGrounded && airStart >= 0) { const d = t - airStart; M.air.time += d; M.air.maxDur = Math.max(M.air.maxDur, d); if (d > 0.25) ev('AIR', t, p, `dur=${d.toFixed(2)} landing=${car.landingImpact.toFixed(1)}m/s kmh=${(car.speed * 3.6).toFixed(0)}`); airStart = -1; }
    if (car.mode === 'flight' && prevMode !== 'flight') { M.air.flightEntries++; flightStart = t; }
    if (car.mode !== 'flight' && prevMode === 'flight' && flightStart >= 0) { M.air.flightTime += t - flightStart; flightStart = -1; }
    // wheels: floating (gap while grounded) and sinking below the drawn surface
    if (car.grounded) {
      let fl = 0, sink = 0;
      for (let i = 0; i < 4; i++) {
        fl = Math.max(fl, car.wheelGaps[i]);
        const w = car._wheelW[i];
        const gh = world.getGroundHeight(w.x, w.z, w.y + 0.35);
        sink = Math.min(sink, w.y - gh);
      }
      M.wheels.floatMax = Math.max(M.wheels.floatMax, fl); if (fl > 0.08) M.wheels.floatSteps++;
      M.wheels.sinkMin = Math.min(M.wheels.sinkMin, sink); if (sink < -0.03) M.wheels.sinkSteps++;
    }
    if (car.impact > 0) {
      M.impacts.n++; M.impacts.maxMs = Math.max(M.impacts.maxMs, car.impact);
      const cs = physics.queryColliders(p.x, p.z, 3.5, []);
      const kinds = [...new Set(cs.map((b) => String(b.kind)))].sort().join('/') || 'ground';
      M.impacts.kinds[kinds] = (M.impacts.kinds[kinds] || 0) + 1;
      if (M.impacts.n <= 3 || (car.impact > 3 && M.impacts.n % 400 === 0)) {
        const b = cs.find((q) => q.kind !== 1) || cs[0];
        ev('HIT', t, p, `${car.impact.toFixed(1)}m/s kmh=${(car.speed * 3.6).toFixed(0)} off=${dist.toFixed(1)} kind=${kinds}${b ? ` box=[${b.minX.toFixed(1)}..${b.maxX.toFixed(1)} x ${b.minY.toFixed(1)}..${b.maxY.toFixed(1)} x ${b.minZ.toFixed(1)}..${b.maxZ.toFixed(1)}]` : ''}`);
      }
    }
    if (car.bodyContact) M.bodyContact++;
    if (car.upsideDown) M.upsideDown++;
    M.maxKmh = Math.max(M.maxKmh, car.speed * 3.6); kmhSum += car.speed * 3.6;
    M.track.maxOff = Math.max(M.track.maxOff, dist); offSum += dist;
    if (trace) trace.push([t.toFixed(3), p.x.toFixed(2), p.y.toFixed(3), p.z.toFixed(2), (car.speed * 3.6).toFixed(1), (att2.pitch * DEG).toFixed(2), (att2.roll * DEG).toFixed(2), car.grounded ? 1 : 0, car.mode, hop.toFixed(4), car.wheelGaps[0].toFixed(3), car.wheelGaps[1].toFixed(3), car.wheelGaps[2].toFixed(3), car.wheelGaps[3].toFixed(3), car.impact.toFixed(2), ctl.steer.toFixed(2), ctl.throttle.toFixed(2), ctl.brake.toFixed(2), car.gForce.toFixed(2)].join(','));
    prevAtt = att2; prevY = p.y; prevVy = car.velocity.y; wasGrounded = car.grounded; prevMode = car.mode;
  }
  if (airStart >= 0) { const d = M.time - airStart; M.air.time += d; M.air.maxDur = Math.max(M.air.maxDur, d); }
  if (flightStart >= 0) M.air.flightTime += M.time - flightStart;
  M.dist = prog; M.meanKmh = kmhSum / Math.max(1, M.steps); M.track.meanOff = offSum / Math.max(1, M.steps); M.damage = car.damage;
  if (trace) fs.writeFileSync(opts.trace, 't,x,y,z,kmh,pitch,roll,grounded,mode,hop,g0,g1,g2,g3,impact,steer,throttle,brake,gForce\n' + trace.join('\n'));
  return M;
}

// ---------------------------------------------------------------- run
const DEFAULT = ['California Street', 'Sacramento Street', 'Clay Street', 'Washington Street', 'Pine Street', 'Bush Street', 'Kearny Street', 'Grant Avenue', 'Stockton Street', 'Powell Street', 'Broadway', 'Columbus Avenue', 'Montgomery Street', 'Market Street', 'Mission Street', 'Howard Street', 'Folsom Street', 'Harrison Street', '1st Street', '2nd Street', 'Beale Street', 'Main Street', 'The Embarcadero'];
const streets = args.streets ? String(args.streets).split(',').map((s) => s.trim()) : DEFAULT;
const kmh = +(args.kmh || 50);
const out = [];
for (const name of streets) {
  const path = streetPath(name);
  if (!path) { if (!args.json) console.log(`${name}: not found`); continue; }
  const fast = /Embarcadero/.test(name) ? Math.max(kmh, 80) : kmh;
  const tracePath = args.trace && new RegExp(String(args.trace), 'i').test(name) ? new URL(`../../../../private/tmp/claude-501/-Users-patrickli-Documents-vibe/7000ff4d-511c-46a2-b066-6c1015a109c5/scratchpad/trace-${name.replace(/\W+/g, '_')}.csv`, import.meta.url).pathname : null;
  const M = drive(path, fast, { trace: tracePath });
  out.push(M);
}
if (args.json) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
console.log('street'.padEnd(20), 'len'.padStart(5), 'done', 'kmh'.padStart(4), 'grade+/-'.padStart(9), 'pitch/step max >.2 >.5 >1'.padStart(26), 'roll/step max >.2 >.5 >1'.padStart(25), 'hop max >2 >5cm'.padStart(16), 'air n/s/flt'.padStart(13), 'float/sink'.padStart(12), 'impacts'.padStart(10), 'off'.padStart(5));
for (const M of out) {
  console.log(M.street.padEnd(20), f(M.lengthM, 0).padStart(5), (M.finished ? 'yes' : M.nan ? 'NaN' : 'no ').padStart(4), f(M.meanKmh, 0).padStart(4), `${f(M.grade.maxUp, 1)}/${f(M.grade.maxDown, 1)}`.padStart(9),
    `${f(M.pitchStep.max)} ${M.pitchStep.over02} ${M.pitchStep.over05} ${M.pitchStep.over1}`.padStart(26), `${f(M.rollStep.max)} ${M.rollStep.over02} ${M.rollStep.over05} ${M.rollStep.over1}`.padStart(25),
    `${f(M.hops.max, 3)} ${M.hops.over2cm} ${M.hops.over5cm}`.padStart(16), `${M.air.episodes}/${f(M.air.time, 1)}/${M.air.flightEntries}`.padStart(13), `${f(M.wheels.floatMax)}/${f(M.wheels.sinkMin)}`.padStart(12),
    `${M.impacts.n}@${f(M.impacts.maxMs, 1)}`.padStart(10), f(M.track.meanOff, 1).padStart(5), Object.keys(M.impacts.kinds).length ? JSON.stringify(M.impacts.kinds) : '');
  if (args.events) for (const e of M.events) console.log('    ' + e);
}
const tot = (k) => out.reduce((a, M) => a + k(M), 0);
console.log(`\ntotal: ${f(tot((M) => M.dist) / 1000, 1)} km, ${f(tot((M) => M.time), 0)} s | pitch snaps >0.5deg/step: ${tot((M) => M.pitchStep.over05)}, roll snaps: ${tot((M) => M.rollStep.over05)} | hops >2cm: ${tot((M) => M.hops.over2cm)} | air episodes: ${tot((M) => M.air.episodes)} (flight entries ${tot((M) => M.air.flightEntries)}) | impacts: ${tot((M) => M.impacts.n)} | floating-wheel steps: ${tot((M) => M.wheels.floatSteps)} | sunk-wheel steps: ${tot((M) => M.wheels.sinkSteps)}`);
