// Engine render-layer sample: proves engine/src/render works without the city. Uses only engine imports (plus
// three itself for geometry): Engine loop + F3 profiler, Atmosphere (sky, sun, clouds, 2-cascade shadows, fog,
// time of day), PostFX (GTAO, bloom, height fog, grading), 2,000 instanced cones through InstancedPool +
// LODGroup with wind / dither MaterialPatches and baked impostors, ChunkCuller over 400 far blocks, a
// ParticleSystem fountain + smoke, and a DecalTrail laid by a marker driving round a ring road.
// A self-test of the utilities runs at startup (HUD + console).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Engine, OrbitRig, Atmosphere, PostFX, TIME_PRESETS,
  InstancedPool, LODGroup, ChunkCuller, DecalTrail, ParticleSystem, ParticleEmitter,
  bakeImpostors, ImpostorBatch, createTimeUniforms, updateTimeUniforms, windSway, ditherFade, applyPatches, makeDepthMaterial,
  makeGrassTexture, makePavingTexture,
} from '@vibe/engine';

const params = new URLSearchParams(location.search);
const NOFX = params.has('nofx') && params.get('nofx') !== '0';
const N_CONES = Math.max(1, +(params.get('cones') || 2000));
const FADE = { start: 90, end: 120 };          // near cones dither out / impostors dither in over this range
const hud = document.getElementById('hud');

// ------------------------------------------------------------------ self-test (pure utility logic)
const tests = [];
const check = (name, ok) => tests.push([name, !!ok]);
function selfTest() {
  // InstancedPool: growth, setters, swap-remove
  const pool = new InstancedPool(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), { capacity: 4, colors: true });
  for (let i = 0; i < 10; i++) pool.add();
  check('pool grows past capacity', pool.count === 10 && pool.capacity >= 10);
  pool.setTRS(3, 5, 1, 2, Math.PI / 2, 2);
  const v = pool.getPosition(3, new THREE.Vector3()), m = pool.getMatrix(3, new THREE.Matrix4());
  const ref = new THREE.Matrix4().compose(new THREE.Vector3(5, 1, 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(2, 2, 2));
  check('pool setTRS matches Matrix4.compose', v.x === 5 && m.elements.every((e, i) => Math.abs(e - ref.elements[i]) < 1e-6));
  pool.setPosition(9, 7, 0, 0);
  check('pool removeAt swaps last in', pool.removeAt(0) === 9 && pool.count === 9 && pool.getPosition(0, v).x === 7);
  pool.updateBounds();
  check('pool bounds cover instances', pool.mesh.boundingSphere.containsPoint(new THREE.Vector3(5, 1, 2)));
  pool.dispose();
  // LODGroup: hysteresis + throttling
  const lod = new LODGroup({ positions: new Float32Array([9, 0, 0, 11, 0, 0, 100, 0, 0]), nearRadius: 10, hysteresis: 2, moveThreshold: 1, minInterval: 0.5, jumpDistance: 50, trackFar: true });
  lod.partition(0, 0, 0);
  check('lod near set', lod.nearCount === 1 && lod.near[0] === 0 && lod.farCount === 2);
  lod.partition(-1.5, 0, 0);
  check('lod hysteresis keeps boundary instance', lod.nearCount === 1 && lod.near[0] === 0);
  check('lod throttles small moves', lod.update(new THREE.Vector3(-1.2, 0, 0), 0.01) === false);
  check('lod throttles by interval', lod.update(new THREE.Vector3(5, 0, 0), 0.01) === false);
  check('lod re-partitions after a jump', lod.update(new THREE.Vector3(95, 0, 0), 0.01) === true && lod.near[0] === 2);
  // ChunkCuller: distance + frustum, shadow casters only distance-culled
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 5000); cam.position.set(0, 0, 0); cam.lookAt(0, 0, -1); cam.updateMatrixWorld();
  const culler = new ChunkCuller({ maxDistance: 200, budget: 2 });
  const mk = (x, z, caster) => { const o = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)); o.position.set(x, 0, z); o.castShadow = caster; culler.add(o); return o; };
  const ahead = mk(0, -50, false), behind = mk(0, 50, false), behindCaster = mk(0, 50, true), far = mk(0, -400, false);
  culler.update(cam);
  check('culler: frustum + distance', ahead.visible && !behind.visible && behindCaster.visible && !far.visible && culler.stats.visible === 2);
  check('culler: budgeted re-evaluation', (culler.update(cam), culler.stats.tested === 2));
  // Particles: lifetimes, capacity
  const ps = new ParticleSystem({ max: 8 });
  for (let i = 0; i < 10; i++) ps.spawn(0, 0, 0, 0, 1, 0, 0.5, 1, 1, 1, 1, 1, 1);
  ps.update(0.3); const alive = ps.count; ps.update(0.3);
  check('particles capped + expire', alive === 8 && ps.count === 0);
  ps.dispose();
  // DecalTrail: ring cap
  const dt = new DecalTrail({ maxQuads: 8, trails: 1 });
  const side = new THREE.Vector3(1, 0, 0), p = new THREE.Vector3();
  for (let i = 0; i <= 20; i++) dt.feed(0, p.set(0, 0, i * 0.5), side, 0.2, 1);
  check('decals ring buffer caps segments', dt.count === 8 && dt.head === 20);
  dt.dispose();
  const ok = tests.filter((t) => t[1]).length;
  console.info(`[engine-render] self-test ${ok}/${tests.length} passed`, tests.filter((t) => !t[1]).map((t) => t[0]));
  return `${ok}/${tests.length}${ok === tests.length ? ' pass' : ' FAIL: ' + tests.filter((t) => !t[1]).map((t) => t[0]).join(', ')}`;
}
const testSummary = selfTest();

// ------------------------------------------------------------------ engine, atmosphere, post
const engine = new Engine({ container: document.getElementById('app'), renderer: { antialias: NOFX }, far: 3000, profile: params.get('profile') ? +params.get('profile') : false });
const { scene, camera, renderer } = engine;
const t = params.get('t');
const atmo = new Atmosphere({
  scene, renderer, camera,
  timeOfDay: t == null ? 'golden' : Number.isFinite(+t) ? +t : t,
  shadows: { cascades: 2, near: 40, far: [180, 320, 520] },
  maxCasterHeight: 40,
});
let postfx = null;
if (!NOFX) {
  postfx = new PostFX(renderer, scene, camera, { atmosphere: atmo, width: engine.size.width, height: engine.size.height, pixelRatio: engine.pixelRatio });
  engine.onResize = (w, h, pr) => postfx.setSize(w, h, pr);
}
let fxOn = !!postfx;
engine.renderFn = (s, c, dt) => {
  if (postfx && fxOn) postfx.render(dt);
  else { renderer.render(s, c); atmo.renderFlare(renderer, c); }
};

// ------------------------------------------------------------------ ground, road ring, boxes
const grass = makeGrassTexture(renderer); grass.repeat.set(600, 600);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }));
ground.receiveShadow = true; ground.name = 'ground';
scene.add(ground);
const RING_R = 42;
const paving = makePavingTexture(renderer); paving.repeat.set(66, 5); // light concrete so the decal trail reads
const ring = new THREE.Mesh(new THREE.RingGeometry(RING_R - 5, RING_R + 5, 160, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: paving, roughness: 0.9 }));
ring.position.y = 0.02; ring.receiveShadow = true; ring.name = 'road';
scene.add(ring);
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; })(); // seeded
const boxMat = new THREE.MeshStandardMaterial({ color: 0xb8b2a8, roughness: 0.7 });
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2 + 0.2, r = 58 + rnd() * 16, h = 3 + rnd() * 14, w = 3 + rnd() * 5;
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), boxMat);
  b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); b.rotation.y = rnd() * 3;
  b.castShadow = b.receiveShadow = true;
  scene.add(b);
}
// emissive marker boxes (bloom at night) + far blocks for the culler
const glowMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb060, emissiveIntensity: 6 });
for (let i = 0; i < 6; i++) { const g = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), glowMat); g.position.set(Math.cos(i) * 12, 0.3, Math.sin(i) * 12); scene.add(g); }
const culler = new ChunkCuller({ maxDistance: 900, budget: 64 });
const blockGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const blockMat = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.8 });
for (let gx = -10; gx < 10; gx++) for (let gz = -10; gz < 10; gz++) {
  const x = gx * 110 + 55, z = gz * 110 + 55;
  if (Math.hypot(x, z) < 160) continue;
  const blk = new THREE.Mesh(blockGeo, blockMat);
  blk.scale.set(14 + rnd() * 20, 8 + rnd() * 30, 14 + rnd() * 20); blk.position.set(x, 0, z);
  blk.receiveShadow = true; blk.name = 'block';
  scene.add(blk); culler.add(blk);
}

// ------------------------------------------------------------------ 2,000 cones: near InstancedPool + far impostors
const coneGeo = (() => {
  const top = new THREE.ConeGeometry(1.7, 5, 10, 1).translate(0, 3.7, 0);
  const trunk = new THREE.CylinderGeometry(0.22, 0.28, 1.4, 6).translate(0, 0.7, 0);
  const paint = (g, c) => { const col = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < col.length; i += 3) { col[i] = c[0]; col[i + 1] = c[1]; col[i + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; };
  const g = mergeGeometries([paint(top.toNonIndexed(), [0.16, 0.34, 0.12]), paint(trunk.toNonIndexed(), [0.3, 0.2, 0.12])]);
  g.computeBoundingSphere();
  return g;
})();
const U = createTimeUniforms();
const coneMat = applyPatches(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), [
  windSway(U, { strength: 0.22, weight: 'height', height: 6.2 }),
  ditherFade(U, { start: FADE.start, end: FADE.end, mode: 'out' }),
]);
const near = new InstancedPool(coneGeo, coneMat, { capacity: 64, castShadow: true, name: 'cones-near' }); // grows on demand
near.mesh.customDepthMaterial = makeDepthMaterial(coneMat);
scene.add(near.mesh);

const POS = new Float32Array(N_CONES * 3), MAT = new Float32Array(N_CONES * 16), YAW = new Float32Array(N_CONES), SCL = new Float32Array(N_CONES);
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N_CONES; i++) {
    let x, z;
    do { const a = rnd() * Math.PI * 2, r = 30 + Math.sqrt(rnd()) * 600; x = Math.cos(a) * r; z = Math.sin(a) * r; } while (Math.abs(Math.hypot(x, z) - RING_R) < 8);
    YAW[i] = rnd() * Math.PI * 2; SCL[i] = 0.7 + rnd() * 0.8;
    POS[i * 3] = x; POS[i * 3 + 1] = 0; POS[i * 3 + 2] = z;
    m.compose(p.set(x, 0, z), q.setFromAxisAngle(up, YAW[i]), s.setScalar(SCL[i])).toArray(MAT, i * 16);
  }
}
const lod = new LODGroup({ positions: POS, nearRadius: FADE.end + 30, moveThreshold: 20 });
const baked = bakeImpostors([{ geometry: coneGeo }], { label: 'engine-render', name: 'cone', cellPx: 160, texSize: 1024 });
let far = null;
if (baked) {
  far = new ImpostorBatch(baked, { capacity: N_CONES, viewPos: U.uViewPos, fade: FADE, name: 'cones-far' });
  for (let i = 0; i < N_CONES; i++) far.setInstance(i, POS[i * 3], 0, POS[i * 3 + 2], YAW[i], SCL[i], SCL[i], 0);
  scene.add(far.mesh);
} else coneMat.userData.patchUniforms.uFade.value.set(500, 600, 0, 0); // no impostors: keep near cones longer

// ------------------------------------------------------------------ particles + decals
const sparks = new ParticleSystem({ max: 1500, blending: 'additive', gravity: 9.8, drag: 0.4, floor: 0.05, streak: 0.035, light: 6, fadeIn: 0 });
const smoke = new ParticleSystem({ max: 600, blending: 'normal', drag: 0.6, fadeIn: 0.4 });
scene.add(sparks.mesh, smoke.mesh);
const fountain = new ParticleEmitter(sparks, { rate: 260, position: new THREE.Vector3(0, 0.8, 0), velocity: new THREE.Vector3(0, 9, 0), spread: 3.2, life: [0.8, 1.6], size: [0.16, 0.05], color: [1, 0.62, 0.25], colorEnd: [1, 0.2, 0.05] });
const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 12).translate(0, 2, 0), boxMat); chimney.position.set(9, 0, -6); chimney.castShadow = true; scene.add(chimney);
const plume = new ParticleEmitter(smoke, { rate: 14, position: new THREE.Vector3(9, 4.2, -6), velocity: new THREE.Vector3(1.1, 2.2, 0.4), spread: 0.5, jitter: 0.25, life: [3, 6], size: [0.8, 4.5], alpha: 0.28, color: [0.32, 0.33, 0.35], colorEnd: [0.6, 0.61, 0.63], gravity: -0.1 });
const skids = new DecalTrail({ maxQuads: 900, trails: 2, color: 0x030303, opacity: 0.9 });
scene.add(skids.mesh);
const marker = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 4.2), new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.35, metalness: 0.4 }));
marker.castShadow = true; scene.add(marker);

// ------------------------------------------------------------------ camera + per-frame systems
const rig = new OrbitRig(camera, renderer.domElement, { target: new THREE.Vector3(0, 2, 0), distance: 70, elevation: 0.32, azimuth: 0.9, maxDistance: 1500, minElevation: 0.03 });
let flyOut = false;
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), side = new THREE.Vector3();
let simT = 0;
engine.addSystem({
  update(dt) {
    simT += dt;
    rig.update(dt);
    camera.updateMatrixWorld();
    updateTimeUniforms(U, dt, camera.position);
    atmo.update(camera.position, dt);
    if (lod.update(camera.position, dt)) lod.copyNear(MAT, near);
    near.update(camera.position);
    culler.update(camera);
    // marker laps the ring; wheels lay decals while "sliding" (intensity pulses)
    const a = simT * 0.45, x = Math.cos(a) * RING_R, z = Math.sin(a) * RING_R;
    marker.position.set(x, 0.55, z); marker.rotation.y = -a;
    side.set(Math.cos(a), 0, Math.sin(a)); // radial = across the travel direction
    const slide = Math.max(0, Math.sin(simT * 1.3)) ** 0.5;
    skids.feed(0, tmpA.set(x, 0.03, z).addScaledVector(side, -0.85), side, 0.16, slide);
    skids.feed(1, tmpB.set(x, 0.03, z).addScaledVector(side, 0.85), side, 0.16, slide);
    fountain.update(dt); plume.update(dt);
    smoke.light = 1 - 0.85 * atmo.darkness; // unlit smoke: dim it at night
    sparks.update(dt); smoke.update(dt);
  },
}, 'demo');

const PRESETS = Object.keys(TIME_PRESETS);
window.addEventListener('keydown', (e) => {
  const k = +e.key;
  if (k >= 1 && k <= PRESETS.length) atmo.setTimeOfDay(PRESETS[k - 1]);
  else if (e.code === 'KeyP' && postfx) { fxOn = !fxOn; postfx.setEnabled(fxOn); }
  else if (e.code === 'KeyF') { flyOut = !flyOut; rig.distance = flyOut ? 420 : 70; rig.elevation = flyOut ? 0.6 : 0.32; }
});

let hudT = 0;
engine.addSystem({
  lateUpdate(dt) {
    hudT += dt; if (hudT < 0.25) return; hudT = 0;
    const f = engine.profiler.frame;
    hud.textContent = `${f.fps.toFixed(0)} fps  ${f.avg.toFixed(1)} ms  calls ${f.calls}  tris ${(f.triangles / 1e6).toFixed(2)}M  pr ${engine.pixelRatio}\n`
      + `time ${atmo.hours.toFixed(2)} h  darkness ${atmo.darkness.toFixed(2)}  post ${fxOn ? 'on' : 'off'}\n`
      + `cones ${N_CONES}: near ${near.count} (cap ${near.capacity}, ${lod.partitions} partitions)  impostors ${far ? far.count : 'off'}\n`
      + `blocks visible ${culler.stats.visible}/${culler.stats.total}  particles ${sparks.count + smoke.count}  decals ${skids.count}\n`
      + `self-test ${testSummary}`;
  },
}, 'hud');

window.__render = { engine, atmo, postfx, near, far, lod, culler, sparks, smoke, skids, rig, tests };
engine.start();
