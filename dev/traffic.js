// Dev viewer for traffic: full World (engine/src/world/Traffic.js presenter + TrafficSim core, in a Web Worker unless
// ?noworker=1) + OrbitControls + stats. Served by Vite at /dev/traffic.html
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World } from '../src/world/World.js';

const qs = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 8000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

const hud = document.getElementById('hud');
const t = qs.get('t');
const opts = { timeOfDay: t ? (isNaN(+t) ? t : +t) : 'golden' };
if (qs.get('n')) opts.traffic = +qs.get('n');
const world = new World(scene, renderer, opts);
await world.load((f, label) => { hud.textContent = `loading ${(f * 100) | 0}%  ${label}`; });
const traffic = world.traffic;
if (traffic) traffic.setCamera(camera);
window.__world = world;
window.__traffic = traffic;
window.__three = { scene, camera, renderer, controls, THREE };

const sp = world.getSpawn();
const cam = qs.get('cam');
if (cam) {
  const v = cam.split(',').map(Number);
  camera.position.set(v[0], v[1], v[2]); controls.target.set(v[3] || 0, v[4] || 0, v[5] || 0);
} else {
  const back = new THREE.Vector3(Math.sin(sp.headingRad), 0, Math.cos(sp.headingRad));
  camera.position.copy(sp.position).addScaledVector(back, 50).add(new THREE.Vector3(0, 30, 0));
  controls.target.copy(sp.position);
}

// main-thread cost of the traffic update: traffic.perf.mainMs (EMA kept by the presenter); worker step: perf.workerMs

// lane overlay
let overlay = null;
function buildOverlay() {
  if (overlay) { scene.remove(overlay); overlay.geometry.dispose(); overlay = null; return; }
  const pos = [], col = [], c = controls.target, R = 220;
  const sigCol = (L) => {
    if (L.ctrl === 1) { const li = traffic._light(L.sig, L.grp); return li === 0 ? [1, 0, 0] : li === 1 ? [1, 0.8, 0] : [0, 1, 0]; }
    if (L.ctrl === 2) return [1, 0, 1];
    return null;
  };
  for (const L of traffic.lanes) {
    if ((L.x[0] - c.x) ** 2 + (L.z[0] - c.z) ** 2 > R * R) continue;
    const y = traffic.sim.laneHeight(L.id, 0) + 0.35; // the baked ground height the AI drives on
    const cc = L.conn ? [1, 0.55, 0.1] : [0.2, 0.6, 1];
    for (let i = 0; i < L.x.length - 1; i++) {
      pos.push(L.x[i], y, L.z[i], L.x[i + 1], y, L.z[i + 1]);
      // fade: brighter towards the end so direction is visible
      const f0 = 0.35 + 0.65 * (L.cum[i] / (L.len || 1)), f1 = 0.35 + 0.65 * (L.cum[i + 1] / (L.len || 1));
      col.push(cc[0] * f0, cc[1] * f0, cc[2] * f0, cc[0] * f1, cc[1] * f1, cc[2] * f1);
    }
    const sc = !L.conn && sigCol(L);
    if (sc) {
      const n = L.x.length - 1, x = L.x[n], z = L.z[n];
      pos.push(x, y, z, x, y + 3, z); col.push(...sc, ...sc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  overlay = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
  overlay.renderOrder = 10;
  scene.add(overlay);
}

// dummy player (P) to test braking for the player
let dummy = null;
function togglePlayer() {
  if (dummy) { scene.remove(dummy); dummy = null; traffic.setPlayer(null); return; }
  dummy = new THREE.Mesh(new THREE.BoxGeometry(2, 1.3, 4.5), new THREE.MeshStandardMaterial({ color: 0xe82127 }));
  dummy.position.set(controls.target.x, world.getGroundHeight(controls.target.x, controls.target.z, -1e4) + 0.65, controls.target.z);
  scene.add(dummy);
  traffic.setPlayer(() => dummy.position);
}

let follow = -1, flash = '';
const pose = {};
if (qs.get('ov')) setTimeout(buildOverlay, 300);
const presets = ['dawn', 'morning', 'noon', 'afternoon', 'golden', 'sunset', 'dusk', 'night'];
addEventListener('keydown', (e) => {
  const i = Number(e.key) - 1;
  if (i >= 0 && i < presets.length) world.setTimeOfDay(presets[i]);
  if (!traffic) return;
  if (e.key === 'f') { // follow the nearest drawn vehicle, then cycle (poses: where the presenter draws them)
    const ids = traffic.vehicles.map((v) => v.id).filter((i) => traffic.pose(i, pose).active);
    let best = -1, bd = Infinity;
    for (const i of ids) { if (i === follow) continue; traffic.pose(i, pose); const d = (pose.x - controls.target.x) ** 2 + (pose.z - controls.target.z) ** 2; if (d < bd) { bd = d; best = i; } }
    if (follow >= 0) best = ids[(ids.indexOf(follow) + 1) % ids.length];
    if (best >= 0) follow = best;
  }
  if (e.key === 'h') { // baked lane heights vs the live ground query (the sim never queries the terrain)
    const r = traffic.sim.bakeError((x, z, y) => world.getGroundHeight(x, z, y), 0.5);
    console.log('[traffic] baked heights vs getGroundHeight', r);
    flash = `height bake: p99 ${(r.p99 * 100).toFixed(1)} cm, p99.9 ${(r.p999 * 100).toFixed(1)} cm, max ${r.max.toFixed(2)} m, >10 cm ${r.over10cm}/${r.samples}`;
  }
  if (e.key === 'Escape') follow = -1;
  if (e.key === 'l') buildOverlay();
  if (e.key === 'p') togglePlayer();
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const clock = new THREE.Clock();
let fpsT = 0, frames = 0, fps = 0;
const tmp = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (follow >= 0 && traffic) {
    traffic.pose(follow, pose);
    tmp.set(pose.x, pose.y + 1, pose.z);
    const d = tmp.clone().sub(controls.target);
    controls.target.add(d); camera.position.add(d);
  }
  controls.update();
  world.update(dt, camera.position);
  renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 0.5) {
    fps = frames / fpsT; frames = 0; fpsT = 0;
    const r = renderer.info.render;
    let qUs = 0, nveh = 0;
    if (traffic) {
      const N = 200, out = [];
      const t0 = performance.now();
      for (let k = 0; k < N; k++) { out.length = 0; traffic.queryColliders(controls.target.x + (k % 7), controls.target.z, 60, out); }
      qUs = ((performance.now() - t0) / N) * 1000;
      nveh = out.length;
    }
    const all = world.queryColliders(controls.target.x, controls.target.z, 60);
    const s = traffic ? traffic.summary() : {};
    const fv = follow >= 0 && traffic ? traffic.vehicles[follow] : null;
    if (fv) traffic.pose(follow, pose);
    const P = traffic ? traffic.perf : {};
    hud.textContent = `fps ${fps.toFixed(0)}  calls ${r.calls}  tris ${(r.triangles / 1e6).toFixed(2)}M\n` +
      `vehicles ${traffic ? traffic.count : 0}  moving ${s.moving}  stopped ${s.stopped}  in-junction ${s.onConn}  avg ${(s.avgSpeed * 3.6 || 0).toFixed(0)} km/h  ` +
      `signal entries ${s.sigEntries ?? '-'} (on red ${s.redEntries ?? '-'})  held by player ${s.forPlayer ?? '-'}\n` +
      (traffic ? `sim: ${traffic.mode === 'worker' ? 'Web Worker' : 'main thread'}   main-thread traffic ${P.mainMs.toFixed(3)} ms/frame` +
        (traffic.mode === 'worker' ? `   worker step ${P.workerMs.toFixed(2)} ms   msg ${P.postBytes} B out / ${P.snapBytes} B poses back   late snapshots ${P.late}` : '') + '\n' : '') +
      `vehicle query(r=60) ${qUs.toFixed(1)} us -> ${nveh} boxes  (world.queryColliders: ${all.length}, vehicles ${all.filter((b) => b.kind === 'vehicle').length})\n` +
      (traffic ? `lanes ${traffic.stats.lanes}  connectors ${traffic.stats.connectors}  signals ${traffic.stats.signals}  stop-lanes ${traffic.stats.stopLanes}  build ${traffic.stats.buildMs}ms (height bake ${traffic.stats.heightMs}ms, ${traffic.stats.heightSamples} samples)\n` : '') +
      (fv ? `follow #${fv.id} ${(traffic.typeNames || [])[fv.type]}  y ${pose.y.toFixed(2)}  yaw ${pose.yaw.toFixed(2)}  brake ${pose.brake.toFixed(2)}\n` : '') +
      (flash ? flash + '\n' : '') +
      `time ${world.timeOfDay.toFixed(2)}h  target ${controls.target.x.toFixed(0)},${controls.target.z.toFixed(0)}`;
  }
});
