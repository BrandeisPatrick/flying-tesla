// Dev bench: fakes a car driving a figure-eight that periodically takes off,
// so the HUD, chase camera and audio synth can be eyeballed without world/car modules.
import * as THREE from 'three';
import { HUD } from '../src/ui/HUD.js';
import { ChaseCamera } from '../src/camera/ChaseCamera.js';
import { CarAudio } from '../src/audio/Audio.js';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb4d8);
scene.fog = new THREE.Fog(0x8fb4d8, 200, 1400);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x404030, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(200, 400, 100);
scene.add(sun);

// ground + grid "roads"
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x3c4a3a }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(2000, 20, 0x222222, 0x555555);
grid.position.y = 0.02;
scene.add(grid);
// a few "buildings" for parallax
const bGeo = new THREE.BoxGeometry(1, 1, 1);
const bMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad });
for (let i = 0; i < 160; i++) {
  const b = new THREE.Mesh(bGeo, bMat);
  const h = 10 + Math.random() * 60;
  b.scale.set(20 + Math.random() * 30, h, 20 + Math.random() * 30);
  const gx = Math.round((Math.random() - 0.5) * 18) * 100 + 50;
  const gz = Math.round((Math.random() - 0.5) * 18) * 100 + 50;
  b.position.set(gx, h / 2, gz);
  scene.add(b);
}

// fake car: body + cabin + red nose marker (forward = -Z)
const car = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.2), new THREE.MeshStandardMaterial({ color: 0xb01218, metalness: 0.6, roughness: 0.35 }));
body.position.y = 0.55;
const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.8), new THREE.MeshStandardMaterial({ color: 0x111418, metalness: 0.2, roughness: 0.1 }));
cabin.position.set(0, 1.05, 0.3);
const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff }));
nose.position.set(0, 0.6, -2.12);
car.add(body, cabin, nose);
scene.add(car);

// minimap data: 100 m grid + ring road + diagonal
const roads = [];
for (let x = -1000; x <= 1000; x += 100) roads.push([[x, -1000], [x, 1000]]);
for (let z = -1000; z <= 1000; z += 100) roads.push([[-1000, z], [1000, z]]);
const ring = [];
for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; ring.push([Math.cos(a) * 600, Math.sin(a) * 600]); }
roads.push(ring, [[-1000, -1000], [1000, 1000]]);
// figure-eight path the car follows (drawn on map too)
const path = [];
const pathPoint = (t, out) => out.set(Math.sin(t) * 400, 0, Math.sin(t) * Math.cos(t) * 300);
const tmpP = new THREE.Vector3();
for (let i = 0; i <= 200; i++) { pathPoint((i / 200) * Math.PI * 2, tmpP); path.push([tmpP.x, tmpP.z]); }
roads.push(path);

const hud = new HUD(document.body);
hud.setMinimapData({ roads, bounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 } });

const audio = new CarAudio();
const chase = new ChaseCamera(camera, renderer.domElement, { minY: 0.6 });

// fake state
const state = {
  speedKmh: 0, altitude: 0, mode: 'ground', thrust: 0, gForce: 0,
  velocity: new THREE.Vector3(), grounded: true, rpmLike: 0, thrusterLevel: 1,
  damage: 0, boostLevel: 1, steer: 0, wheelSlip: 0,
};
chase.setTarget(car, () => state);

let s = 0;          // path parameter
let simT = 0;
let paused = false;
const prevPos = new THREE.Vector3();
const nextPos = new THREE.Vector3();
const tangent = new THREE.Vector3();
const prevVel = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const qBase = new THREE.Quaternion();
const qExtra = new THREE.Quaternion();
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();

function fakeCar(dt) {
  simT += dt;
  // speed: sinusoid 0..330 km/h on a 24 s cycle
  const speedKmh = Math.max(0, 165 - 165 * Math.cos(simT * (2 * Math.PI / 24)));
  const accelPhase = Math.sin(simT * (2 * Math.PI / 24)); // >0 accelerating, <0 braking
  const v = speedKmh / 3.6;
  // advance along path by arc length
  pathPoint(s, prevPos);
  pathPoint(s + 0.001, nextPos);
  const dsdl = 0.001 / Math.max(1e-4, nextPos.distanceTo(prevPos));
  s += v * dt * dsdl;
  pathPoint(s, nextPos);
  pathPoint(s + 0.002, tangent);
  tangent.sub(nextPos).normalize();

  // flight cycle: airborne for part of every 30 s
  const fc = (simT % 30) / 30;
  const altitude = fc > 0.35 && fc < 0.85 ? Math.sin(((fc - 0.35) / 0.5) * Math.PI) * 120 : 0;
  const flying = altitude > 0.3;
  const yPrev = car.position.y;
  car.position.set(nextPos.x, altitude, nextPos.z);

  // orientation: face tangent (forward -Z), plus pitch/roll
  m4.lookAt(ORIGIN, tangent, UP);          // Matrix4.lookAt: local -Z points at target = forward
  qBase.setFromRotationMatrix(m4);
  const roll = flying ? Math.sin(simT * 0.7) * 0.6 : Math.sin(simT * 0.9) * 0.03;
  const vy = dt > 0 ? (altitude - yPrev) / dt : 0;
  const pitch = flying ? Math.atan2(vy, Math.max(5, v)) * 0.8 : 0;
  eul.set(pitch, 0, -roll, 'YXZ');
  qExtra.setFromEuler(eul);
  car.quaternion.copy(qBase).multiply(qExtra);

  // velocity (with a fake drift angle when slipping)
  state.velocity.copy(tangent).multiplyScalar(v);
  state.velocity.y = vy;
  const slip = !flying ? Math.max(0, Math.sin(simT * 0.5) - 0.6) * 2.5 : 0;
  if (slip > 0) state.velocity.applyAxisAngle(UP, slip * 0.25);

  const acc = prevVel.distanceTo(state.velocity) / Math.max(dt, 1e-3);
  prevVel.copy(state.velocity);

  state.speedKmh = speedKmh;
  state.altitude = altitude;
  state.mode = flying ? 'flight' : 'ground';
  state.grounded = !flying;
  state.thrust = flying ? Math.min(1, 0.4 + Math.max(0, vy) / 20 + 0.2 * Math.sin(simT * 2)) : 0;
  state.rpmLike = accelPhase > 0 ? Math.min(1, 0.3 + accelPhase) : 0;
  state.gForce = Math.min(5, acc / 9.81);
  state.thrusterLevel = flying ? Math.max(0, 1 - (fc - 0.35) / 0.5 * 0.95) : Math.min(1, state.thrusterLevel + dt * 0.1);
  state.boostLevel = 0.5 + 0.5 * Math.sin(simT * 0.3);
  state.wheelSlip = Math.min(1, slip);
  state.steer = Math.sin(simT);
}

// input
addEventListener('pointerdown', () => audio.start());
addEventListener('keydown', (e) => {
  audio.start();
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyC': document.getElementById('cammode').textContent = chase.cycleMode(); break;
    case 'KeyB': chase.setLookBack(true); break;
    case 'KeyH': hud.toggleHelp(); break;
    case 'KeyF': hud.flash(state.mode === 'flight' ? 'FLIGHT MODE' : 'GROUND MODE'); break;
    case 'KeyM': hud.flash(audio.toggleMute() ? 'MUTED' : 'SOUND ON'); break;
    case 'KeyX': state.damage = Math.min(1, state.damage + 0.12); break;
    case 'KeyR': chase.snap(); state.damage = 0; hud.flash('RESET'); break;
    case 'Space': paused = !paused; e.preventDefault(); break;
  }
});
addEventListener('keyup', (e) => { if (e.code === 'KeyB') chase.setLookBack(false); });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();
let lastMode = state.mode;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) fakeCar(dt);
  if (state.mode !== lastMode) { hud.flash(state.mode === 'flight' ? 'FLIGHT MODE' : 'TOUCHDOWN'); lastMode = state.mode; }
  chase.update(dt);
  hud.update(dt, state, car);
  audio.update(dt, state);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
fakeCar(0.016);
chase.snap();
requestAnimationFrame(frame);
window.__game = { hud, chase, audio, state, car, camera };
