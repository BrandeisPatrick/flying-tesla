// Stand-alone test bench for the car module + chase camera: flat ground with a hill, buildings, street
// trees (trunk colliders + crowns), a parked car, sky PMREM reflections. Open http://localhost:5180/dev/car.html
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Car } from '../src/car/Car.js';
import { Input } from '../src/car/Input.js';
import { ChaseCamera } from '../src/camera/ChaseCamera.js';

const app = document.getElementById('app');
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);

// ---- sky + PMREM environment (same idea as the world's atmosphere) -------------------------
const sky = new Sky();
sky.scale.setScalar(2500);
scene.add(sky);
const sunDir = new THREE.Vector3();
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function setSun(elevDeg, azDeg) {
  const u = sky.material.uniforms;
  u.turbidity.value = 4; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevDeg), THREE.MathUtils.degToRad(azDeg));
  u.sunPosition.value.copy(sunDir);
  const envScene = new THREE.Scene();
  const s2 = new Sky(); s2.scale.setScalar(1000); s2.material.uniforms.sunPosition.value.copy(sunDir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = u[k].value;
  envScene.add(s2);
  // a ground disc so reflections have a horizon
  const gd = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: elevDeg > 0 ? 0x3a3f45 : 0x050608 }));
  gd.rotation.x = -Math.PI / 2; gd.position.y = -2; envScene.add(gd);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
}
setSun(28, 210);

const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a4036, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dd, 2.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 300 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
scene.fog = new THREE.FogExp2(0xb8c6d4, 0.0012);

// ---- test world ---------------------------------------------------------------------------------
const hill = (x, z) => 4 * Math.exp(-((x - 40) ** 2 + (z + 140) ** 2) / 900);
const boxes = [
  { minX: -30, maxX: -10, minY: 0, maxY: 18, minZ: -90, maxZ: -60, kind: 1 },   // building
  { minX: 12, maxX: 30, minY: 0, maxY: 6, minZ: -50, maxZ: -30, kind: 1 },      // low roof to land on
  { minX: -1.5, maxX: 1.5, minY: 0, maxY: 8, minZ: -200, maxZ: -197, kind: 5 },  // pier on the runway
  { minX: -60, maxX: -40, minY: 0, maxY: 3, minZ: 10, maxZ: 14, kind: 1 },      // wall
  { minX: 50, maxX: 54, minY: 0, maxY: 40, minZ: 20, maxZ: 24, kind: 1 },       // tower
  { minX: 8, maxX: 14, minY: 0, maxY: 22, minZ: -30, maxZ: 40, kind: 1 },       // long wall along x = 8 (drive along it)
  { minX: -6.2, maxX: -4.4, minY: 0, maxY: 1.45, minZ: 6, maxZ: 10.5, kind: 4 }, // parked car
];
// street trees: trunk collider (kind 2) + a crown; crowns are NOT colliders (like the real world)
const trees = [];
for (let i = 0; i < 8; i++) trees.push({ x: -4.6, z: -8 - i * 9, s: 0.9 + (i % 3) * 0.1 });
for (let i = 0; i < 5; i++) trees.push({ x: 5.2, z: -12 - i * 10, s: 1.0 });
for (const t of trees) {
  const colH = 4.3 * t.s, rc = 0.3 * t.s;
  boxes.push({ minX: t.x - rc, maxX: t.x + rc, minY: -0.25, maxY: colH, minZ: t.z - rc, maxZ: t.z + rc, kind: 2 });
}
const world = {
  getGroundHeight: (x, z) => hill(x, z),
  queryColliders: (x, z, r) => boxes.filter((b) => x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ),
  getSpawn: () => ({ position: new THREE.Vector3(0, 0, 0), headingRad: 0 }),
  get sunDirection() { return sunDir; },
};

{
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3d4247'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#43494f'; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
  g.strokeStyle = '#5a6168'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(150, 150);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const geo = new THREE.PlaneGeometry(1200, 1200, 240, 240);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hill(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
  ground.receiveShadow = true;
  scene.add(ground);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 1000), new THREE.MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.6 }));
  stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.01, -400); scene.add(stripe);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.7 });
  const carMat = new THREE.MeshStandardMaterial({ color: 0x2f5f9a, roughness: 0.4, metalness: 0.4 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6a2c, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  for (const b of boxes) {
    if (b.kind === 2) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ), b.kind === 4 ? carMat : boxMat);
    m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  for (const t of trees) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * t.s, 0.3 * t.s, 4.6 * t.s, 8), trunkMat);
    trunk.position.set(t.x, 2.3 * t.s, t.z); trunk.castShadow = true; scene.add(trunk);
    // crown roughly like the world's London plane (centre ~7.7 m, radius ~4.5 m at scale 1); lumpy card ball
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(4.3 * t.s, 2), leafMat);
    const p2 = crown.geometry.attributes.position;
    for (let i = 0; i < p2.count; i++) { const f = 1 + 0.12 * Math.sin(p2.getX(i) * 3.1) * Math.sin(p2.getZ(i) * 2.7 + p2.getY(i)); p2.setXYZ(i, p2.getX(i) * f, p2.getY(i) * f * 0.95, p2.getZ(i) * f); }
    crown.geometry.computeVertexNormals();
    crown.position.set(t.x, 7.6 * t.s, t.z); crown.castShadow = true;
    scene.add(crown);
    // a few hanging "branches" (thin dark bars) that would show if the camera entered the crown
    for (let k = 0; k < 4; k++) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 4.5 * t.s), trunkMat);
      br.position.set(t.x, 6 + k * 0.6, t.z); br.rotation.y = k * 0.8; br.rotation.x = 0.3; scene.add(br);
    }
  }
}

// ---- car + camera ---------------------------------------------------------------------------------
const car = new Car(scene, { night: 0 });
await car.load();
const spawn = world.getSpawn();
car.update(1 / 120, null, world);
car.reset(spawn.position, spawn.headingRad);
const input = new Input(renderer.domElement);
const chase = new ChaseCamera(camera, renderer.domElement, { minY: 0.6, getGroundHeight: world.getGroundHeight, queryColliders: world.queryColliders });
chase.setTarget(car.object3d, () => car.state);
chase.snap();
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enabled = false;

// preset turntable views (relative to the car): [azimuth deg (0 = front), elevation deg, distance, target height]
const VIEWS = {
  front34: [35, 12, 7.2, 0.55], side: [90, 4, 7.5, 0.5], rear34: [145, 13, 7.2, 0.55], rear: [180, 8, 6.4, 0.5],
  front: [0, 6, 6.4, 0.5], top: [60, 62, 8.5, 0.4], low: [25, 2, 5.2, 0.45], wheel: [80, 4, 1.9, 0.36, 0.9, -1.45],
  cockpitOver: [150, 35, 3.6, 0.8], tailClose: [165, 6, 3.2, 0.45], noseClose: [20, 8, 3.2, 0.45], under: [120, -6, 5, 0.3],
};
let view = null, paused = false;
const fixedCam = { p: new THREE.Vector3(), t: new THREE.Vector3() };
function placeView(name) {
  if (name === 'fixed') { camera.position.copy(fixedCam.p); camera.up.set(0, 1, 0); camera.lookAt(fixedCam.t); camera.fov = 50; camera.updateProjectionMatrix(); return; }
  const v = VIEWS[name]; if (!v) return;
  const o = car.object3d;
  const [az, el, d, ty, tx = 0, tz = 0] = v;
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  const local = new THREE.Vector3(tx + Math.sin(a) * Math.cos(e) * d, Math.sin(e) * d + ty, tz - Math.cos(a) * Math.cos(e) * d);
  camera.position.copy(local.applyQuaternion(o.quaternion).add(o.position));
  camera.up.set(0, 1, 0);
  camera.lookAt(new THREE.Vector3(tx, ty, tz).applyQuaternion(o.quaternion).add(o.position));
  camera.fov = name === 'wheel' ? 45 : 40; camera.updateProjectionMatrix();
}

let night = false;
function setNight(on) {
  night = on;
  car.setNight(on ? 1 : 0);
  setSun(on ? -14 : 28, 210);
  sky.visible = !on;
  scene.background = on ? new THREE.Color(0x05070c) : null;
  scene.fog.color.set(on ? 0x05070c : 0xb8c6d4);
  hemi.intensity = on ? 0.05 : 0.6; sun.intensity = on ? 0.03 : 2.8;
  scene.environmentIntensity = on ? 0.12 : 1;
}
function placeCar(x, z, headingRad = 0) { car.reset(new THREE.Vector3(x, 0, z), headingRad, world); chase.snap(); }

addEventListener('keydown', (e) => {
  if (e.code === 'KeyN') setNight(!night);
  if (e.code === 'KeyV') car.physics.hoverAssist = !car.physics.hoverAssist;
  if (e.code === 'KeyC') { view = null; chase.cycleMode(); }
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'KeyO') {
    orbit.enabled = !orbit.enabled; view = null;
    if (orbit.enabled) { orbit.target.copy(car.object3d.position).add(new THREE.Vector3(0, 0.6, 0)); orbit.update(); }
  }
  const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(e.code);
  if (idx >= 0) { view = Object.keys(VIEWS)[idx]; orbit.enabled = false; }
  if (e.code === 'Escape') view = null;
});
window.__game = { car, input, world, scene, camera, orbit, chase, renderer };
window.__bench = {
  view: (n) => { view = n; orbit.enabled = false; },
  cam: (px, py, pz, tx, ty, tz) => { fixedCam.p.set(px, py, pz); fixedCam.t.set(tx, ty, tz); view = 'fixed'; orbit.enabled = false; }, free: () => { view = null; }, setNight, placeCar, pause: (p = true) => { paused = p; },
  mode: (m) => { view = null; chase.mode = m; chase.snap(); }, views: Object.keys(VIEWS),
  /** Deterministic stepping (works while the tab is throttled): physics + camera, then one render. */
  step(seconds, ctl = {}) {
    const c = { throttle: 0, brake: 0, steer: 0, thrust: 0, pitch: 0, roll: 0, yaw: 0, boost: false, handbrake: false, ...ctl };
    const n = Math.max(1, Math.round(seconds / STEP));
    for (let i = 0; i < n; i++) { car.update(STEP, c, world); if (!view && !orbit.enabled && i % 2 === 1) chase.update(STEP * 2); }
    this.render();
    return car.state;
  },
  render() {
    if (view) placeView(view);
    const o = car.object3d;
    sun.target.position.copy(o.position); sun.position.copy(o.position).addScaledVector(sunDir, 120);
    renderer.render(scene, camera);
  },
};

// ---- loop: fixed 120 Hz physics -----------------------------------------------------
const STEP = 1 / 120;
let acc = 0, last = performance.now();
const tmp = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  input.update(dt);
  if (input.reset) { car.reset(world.getSpawn().position, world.getSpawn().headingRad); chase.snap(); }
  chase.setLookBack(!!input.lookBack);
  acc += dt;
  let n = 0;
  while (!paused && acc >= STEP && n < 4) { car.update(STEP, input, world); acc -= STEP; n++; }
  if (n === 4 || paused) acc = 0;
  if (view) placeView(view);
  else if (orbit.enabled) { orbit.target.lerp(tmp.copy(car.object3d.position).setY(car.object3d.position.y + 0.6), 0.2); orbit.update(); }
  else chase.update(dt);
  const o = car.object3d;
  sun.target.position.copy(o.position);
  sun.position.copy(o.position).addScaledVector(sunDir, 120);
  renderer.render(scene, camera);
  const s = car.state, d = chase.debug;
  hud.textContent =
    `speed     ${s.speedKmh.toFixed(0).padStart(4)} km/h   mode ${s.mode}${s.upsideDown ? ' (upside down)' : ''}\n` +
    `altitude  ${s.altitude.toFixed(1).padStart(6)} m     g ${s.gForce.toFixed(2)}\n` +
    `thrust    ${(s.thrust * 100).toFixed(0).padStart(4)} %   tank ${(s.thrusterLevel * 100).toFixed(0)} %   boost ${(s.boostLevel * 100).toFixed(0)} %\n` +
    `steer     ${s.steer.toFixed(2).padStart(6)}   slip ${s.wheelSlip.toFixed(2)}   rpm ${s.rpmLike.toFixed(2)}\n` +
    `camera    ${view ? 'view ' + view : orbit.enabled ? 'orbit' : chase.mode}   hit ${d.hitT.toFixed(2)}  lim ${Number.isFinite(d.occLimit) ? d.occLimit.toFixed(1) : '-'}  duck ${d.duck.toFixed(2)}  elev ${d.elev.toFixed(2)}  boxes ${d.boxes} crowns ${d.canopies}\n` +
    `damage    ${(s.damage * 100).toFixed(0).padStart(4)} %   hover-assist ${car.physics.hoverAssist ? 'on' : 'off'}   tris ${s.triangles}`;
  requestAnimationFrame(frame);
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
requestAnimationFrame(frame);
