// Engine demo: widget kit, input map state (keyboard / gamepad / pointer / touch), camera rigs around a
// drivable cube, and the audio synth voices. Engine imports only (+ three for the scene).
import * as THREE from 'three';
import {
  // input
  InputMap, TouchControls, PAD_BUTTONS, PAD_AXES, inputRamp,
  // camera
  ChaseRig, OrbitRig, FreeFlyRig,
  // audio
  AudioBus, NoiseVoice, OscStack, Envelope, playTone, playNoiseBurst, noiseBuffer, PositionalAudio, CityAmbience, VehicleAudio,
  // ui
  UILayer, Panel, Gauge, Bar, Readout, AttitudeIndicator, GMeter, Badge, Segments, Minimap, Flash, HelpOverlay, LoadingScreen, setTheme, theme, UIDom,
} from '@vibe/engine';

const $ = (id) => document.getElementById(id);
const button = (parent, label, onClick, cls = '') => { const b = UIDom.el('button', cls, $(parent), label); b.onclick = () => onClick(b); return b; };

// ------------------------------------------------------------------ scene
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a9cc);
scene.fog = new THREE.Fog(0x87a9cc, 120, 700);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
camera.position.set(10, 6, 12);
scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x3a4030, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(80, 140, 40);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x3d4a3b }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(1000, 50, 0x1f2a22, 0x55604f);
grid.position.y = 0.02;
scene.add(grid);

// obstacles (also fed to the chase rig's occlusion and the minimap markers)
const boxes = [];
const boxMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.8 });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4b2e });
const crownMat = new THREE.MeshStandardMaterial({ color: 0x3f6e35 });
let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 60; i++) {
  const tree = i % 3 === 0;
  const x = Math.round((rnd() - 0.5) * 16) * 30 + 15, z = Math.round((rnd() - 0.5) * 16) * 30 + 15;
  if (Math.hypot(x, z) < 25) continue;
  if (tree) {
    const h = 4.5;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, h, 8), trunkMat); t.position.set(x, h / 2, z); scene.add(t);
    const c = new THREE.Mesh(new THREE.SphereGeometry(5.5, 12, 8), crownMat); c.scale.y = 0.9; c.position.set(x, h + 4, z); scene.add(c);
    boxes.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, minY: 0, maxY: h, kind: 2 });
  } else {
    const w = 8 + rnd() * 14, d = 8 + rnd() * 14, h = 6 + rnd() * 30;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), boxMat); b.position.set(x, h / 2, z); scene.add(b);
    boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: h, kind: 1 });
  }
}
const queryColliders = (x, z, r) => boxes.filter((b) => b.maxX > x - r && b.minX < x + r && b.maxZ > z - r && b.minZ < z + r);

// the "vehicle": a cube with a nose marker (forward = -Z)
const cube = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 3.6), new THREE.MeshStandardMaterial({ color: 0xb01218, metalness: 0.4, roughness: 0.4 }));
body.position.y = 0.6;
const nose = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff }));
nose.position.set(0, 0.9, -1.85);
cube.add(body, nose);
scene.add(cube);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ input map
const input = new InputMap({ pointerTarget: renderer.domElement, actions: {
  throttle: { type: 'axis', range: [0, 1], smoothing: inputRamp(0.12, 0.06), bindings: ['KeyW', { key: 'ArrowUp', when: '!flight' }, { padButton: PAD_BUTTONS.RT }, { virtual: 'gas' }] },
  brake: { type: 'axis', range: [0, 1], smoothing: inputRamp(0.12, 0.06), bindings: ['KeyS', { key: 'ArrowDown', when: '!flight' }, { padButton: PAD_BUTTONS.LT }, { virtual: 'brake' }] },
  steer: { type: 'axis', smoothing: inputRamp(0.15, 0.07), bindings: [{ key: 'KeyD', value: 1 }, { key: 'ArrowRight', value: 1 }, { key: 'KeyA', value: -1 }, { key: 'ArrowLeft', value: -1 }, { padAxis: PAD_AXES.LX }, { virtual: 'stick.x' }] },
  pitch: { type: 'axis', smoothing: inputRamp(0.2, 0.1), bindings: [{ key: 'ArrowDown', value: 1, when: 'flight' }, { key: 'ArrowUp', value: -1, when: 'flight' }, { padAxis: PAD_AXES.LY, when: 'flight' }, { virtual: 'stick.y', when: 'flight' }] },
  lift: { type: 'axis', range: [0, 1], smoothing: inputRamp(0.1), bindings: ['Space', { padButton: PAD_BUTTONS.A }, { virtual: 'lift' }] },
  boost: { type: 'button', bindings: ['ShiftLeft', 'ShiftRight', { padButton: PAD_BUTTONS.B }, { virtual: 'boost' }] },
  camera: { type: 'button', bindings: ['KeyC', { padButton: PAD_BUTTONS.Y }, { virtual: 'cam' }] },
  honk: { type: 'button', bindings: ['KeyG', { padButton: PAD_BUTTONS.X }, { virtual: 'honk' }] },
  help: { type: 'button', bindings: ['KeyH', { padButton: PAD_BUTTONS.BACK }] },
  pointerX: { type: 'axis', bindings: [{ mouse: 'x', value: 0.05 }] },
  pointerBtn: { type: 'button', bindings: [{ mouse: 0 }] },
} });
const touch = new TouchControls({ input, show: 'auto', layout: [
  { type: 'stick', id: 'stick', side: 'left', x: 110, y: 120, radius: 60 },
  { type: 'button', id: 'gas', label: 'GAS', side: 'right', x: 70, y: 120, size: 70 },
  { type: 'button', id: 'brake', label: 'BRK', side: 'right', x: 155, y: 95, size: 56 },
  { type: 'button', id: 'lift', label: 'LIFT', side: 'right', x: 70, y: 210, size: 60 },
  { type: 'button', id: 'boost', label: 'BST', side: 'right', x: 150, y: 180, size: 50 },
  { type: 'button', id: 'cam', label: 'CAM', side: 'right', x: 36, y: 40, size: 44, top: true, fontSize: 10 },
  { type: 'button', id: 'honk', label: 'HONK', side: 'right', x: 36, y: 92, size: 44, top: true, fontSize: 9 },
] });
button('inputbtns', 'Touch controls', (b) => { touch.setVisible(!touch.visible); b.classList.toggle('on', touch.visible); }, touch.visible ? 'on' : '');
const flightBtn = button('inputbtns', "Context 'flight'", (b) => { input.setContext('flight', !input.hasContext('flight')); b.classList.toggle('on', input.hasContext('flight')); });
button('inputbtns', 'Rebind honk…', async (b) => {
  b.textContent = 'Press a key / pad button…';
  const bind = await input.captureBinding({ timeout: 6000 });
  if (bind) input.rebind('honk', [bind, { virtual: 'honk' }]);
  b.textContent = bind ? `honk = ${JSON.stringify(bind)}` : 'Rebind honk…';
});
const actsEl = $('acts'), rows = {};
for (const name of input.actions.keys()) {
  const tr = UIDom.el('tr', '', actsEl);
  UIDom.el('td', '', tr, name);
  const m = UIDom.el('div', 'meter', UIDom.el('td', '', tr));
  rows[name] = { meter: m, fill: UIDom.el('i', '', m), num: UIDom.el('td', '', tr, '0.00'), edge: 0 };
}

// ------------------------------------------------------------------ camera rigs
const chase = new ChaseRig(camera, renderer.domElement, { minY: 0.5, queryColliders, getGroundHeight: () => 0 });
const orbit = new OrbitRig(camera, renderer.domElement, { target: cube, distance: 16, elevation: 0.32, autoRotate: 0.25 });
const free = new FreeFlyRig(camera, renderer.domElement, { speed: 18 });
const rigs = { orbit, chase, free };
const vstate = { velocity: new THREE.Vector3(), speedKmh: 0, mode: 'ground', thrust: 0, gForce: 0, grounded: true, wheelSlip: 0, rpmLike: 0, damage: 0, boostLevel: 1, thrusterLevel: 1, altitude: 0 };
chase.setTarget(cube, () => vstate);
let rig = null;
const rigBtns = {};
const HINTS = { orbit: 'drag rotate · right/shift-drag pan · wheel zoom · auto-rotates', chase: 'C cycles chase / hood / cockpit / cinematic · obstacles occlude', free: 'WASD + E/Q fly · drag look · Shift fast · wheel speed (driving paused)' };
function useRig(name) {
  for (const [k, r] of Object.entries(rigs)) { if (k === name) r.activate(); else r.deactivate(); rigBtns[k].classList.toggle('on', k === name); }
  rig = rigs[name];
  input.enabled = name !== 'free';
  $('righint').textContent = HINTS[name];
}
for (const k of Object.keys(rigs)) rigBtns[k] = button('rigs', k === 'free' ? 'Free fly' : k[0].toUpperCase() + k.slice(1), () => useRig(k));
button('rigs', 'Snap', () => rig.snap());
useRig('orbit');

// ------------------------------------------------------------------ audio
const bus = new AudioBus({ volume: 0.7 });
const space = new PositionalAudio(bus, { listener: camera });
const ambience = new CityAmbience(bus);
const vehicle = new VehicleAudio({ bus, ambience: false });
const voices = {};
bus.onStart((ctx) => {
  const ui = bus.bus('ui');
  voices.white = new NoiseVoice(ctx, { type: 'white', seconds: 2, filters: [{ type: 'lowpass', frequency: 6000 }], out: ui });
  voices.pink = new NoiseVoice(ctx, { type: 'pink', seconds: 3, out: ui });
  voices.brown = new NoiseVoice(ctx, { type: 'brown', seconds: 3, out: ui });
  voices.chord = new OscStack(ctx, { voices: [{ type: 'sawtooth', gain: 0.4 }, { type: 'sawtooth', ratio: 1.26, detune: 7, gain: 0.3 }, { type: 'sawtooth', ratio: 1.5, detune: -6, gain: 0.3 }],
    frequency: 196, drive: 1.6, filter: { type: 'lowpass', frequency: 1400, Q: 1.2 }, out: ui });
  voices.burst = noiseBuffer(ctx, 'white', 1);
});
space.add(cube, { bus: 'effects', refDistance: 6 }); // emitter is realised when the bus starts
let humOn = false, vehicleOn = false;
const toggles = {};
const toggleVoice = (name, level) => (b) => {
  if (!bus.started) return;
  const on = b.classList.toggle('on');
  const v = voices[name];
  if (v.setGain) v.setGain(on ? level : 0); else v.set('gain', on ? level : 0);
};
const startBtn = button('audiobtns', 'Start audio', async (b) => { const ok = await bus.start(); b.classList.toggle('on', ok); b.textContent = ok ? 'Audio running' : 'Audio blocked'; });
button('audiobtns', 'Mute', (b) => b.classList.toggle('on', bus.toggleMute()));
for (const [n, lvl] of [['white', 0.08], ['pink', 0.25], ['brown', 0.3], ['chord', 0.12]]) toggles[n] = button('audiobtns', n === 'chord' ? 'Osc stack' : `${n} noise`, toggleVoice(n, lvl));
button('audiobtns', 'Perc hit', () => {
  const ctx = bus.ctx; if (!ctx) return;
  playTone(ctx, bus.bus('effects'), { type: 'sine', pitch: [[0, 140], [0.25, 38]], peak: 0.8, attack: 0.006, decay: 0.32 });
  playNoiseBurst(ctx, bus.bus('effects'), voices.burst, { peak: 0.4, decay: 0.15, filter: { type: 'lowpass', frequency: 900 } });
});
button('audiobtns', 'UI blip', () => bus.ctx && playTone(bus.ctx, bus.bus('ui'), { type: 'triangle', pitch: [[0, 1320], [0.06, 1760]], peak: 0.15, decay: 0.08 }));
button('audiobtns', 'Envelope (ADSR)', () => {
  const ctx = bus.ctx; if (!ctx) return;
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 330;
  const g = ctx.createGain(); g.gain.value = 0;
  o.connect(g).connect(bus.bus('ui')); o.start();
  Envelope.adsr(g.gain, ctx.currentTime, { peak: 0.12, attack: 0.02, decay: 0.15, sustain: 0.5, hold: 0.4, release: 0.5 });
  o.stop(ctx.currentTime + 1.2);
});
button('audiobtns', 'Gull', () => ambience.gull(1));
toggles.amb = button('audiobtns', 'Ambience', (b) => ambience.setEnabled(b.classList.toggle('on')), 'on');
button('audiobtns', 'Positional hum (cube)', (b) => { humOn = b.classList.toggle('on'); });
button('audiobtns', 'Vehicle synth (cube)', (b) => { vehicleOn = b.classList.toggle('on'); });
$('vol').oninput = (e) => bus.setVolume(+e.target.value);
const env = () => ambience.setEnvironment({ nearWater: +$('water').value, darkness: +$('dark').value });
$('water').oninput = env; $('dark').oninput = env;
let hum = null;
bus.onStart((ctx) => {
  hum = new OscStack(ctx, { voices: [{ type: 'sawtooth', gain: 0.5 }, { type: 'square', ratio: 2.01, gain: 0.15 }], frequency: 92, filter: { type: 'lowpass', frequency: 700 }, gain: 0 });
});

// ------------------------------------------------------------------ widgets
const layer = new UILayer({ parent: document.body, className: 'demo-layer' });
const br = new Panel({ parent: layer, corner: 'br', style: { width: '260px', padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' } });
const gauge = new Gauge({ parent: br, footer: 'POWER' });
const gear = new Segments({ parent: gauge.center, items: ['P', 'R', 'N', 'D'] });
const speedRO = new Readout({ parent: gauge.center, contents: true, size: 'xl', unitLabel: 'km/h', sub: '0 mph' });
const boostBar = new Bar({ parent: br, label: 'Boost', text: '100%', fill: 'linear-gradient(90deg,#ff6a3d,var(--ui-accent))', className: 'demo-boost' });
boostBar.el.style.cssText = 'width:100%;margin-top:6px';
const bl = new Panel({ parent: layer, corner: 'bl', style: { width: '300px', padding: '14px 16px 16px' } });
const bw = UIDom.el('div', '', bl.el); bw.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px';
const badge = new Badge({ parent: bw, text: 'GROUND' });
UIDom.el('span', 'ui-label', bw, 'Widget kit');
const fbody = UIDom.el('div', '', bl.el); fbody.style.cssText = 'display:flex;gap:14px;align-items:stretch';
const adi = new AttitudeIndicator({ parent: fbody, size: 112 });
const fdata = UIDom.el('div', '', fbody); fdata.style.cssText = 'flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0';
const altRO = new Readout({ parent: fdata, contents: true, label: 'Altitude', unit: 'm', size: 'lg' });
const vsiRow = UIDom.el('div', '', fdata); vsiRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:4px';
const vsi = new Bar({ parent: vsiRow, vertical: true, bipolar: true, length: 42, thickness: 6 });
const vsRO = new Readout({ parent: vsiRow, label: 'V/S', value: '+0.0 m/s', size: 'sm' });
const liftBar = new Bar({ parent: bl, label: 'Lift', text: '0%', thickness: 6, fill: 'linear-gradient(90deg,#7fd3ff,#d9f2ff)' });
liftBar.el.style.marginTop = '12px';
const tl = new Panel({ parent: layer, corner: 'tl', style: { width: '236px', padding: '8px', borderRadius: '22px' } });
const minimap = new Minimap({ parent: tl, size: 220 });
layer.onScale((s) => minimap.setScale(s));
const roads = [];
for (let x = -480; x <= 480; x += 60) roads.push([[x, -480], [x, 480]]);
for (let z = -480; z <= 480; z += 60) roads.push([[-480, z], [480, z]]);
minimap.setData({ roads });
for (const b of boxes) minimap.addMarker({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, color: b.kind === 2 ? 'rgba(90,170,90,.9)' : 'rgba(200,210,225,.55)', radius: b.kind === 2 ? 2.5 : 3.5, clamp: false });
const tr = new Panel({ parent: layer, corner: 'tr', style: { width: '190px', padding: '12px 14px 14px' } });
const gmeter = new GMeter({ parent: tr });
const dmgBar = new Bar({ parent: tr, label: 'Integrity', text: '100%', fill: theme.ok });
dmgBar.el.style.marginTop = '12px';
const flash = new Flash({ parent: layer });
const help = new HelpOverlay({ parent: layer, title: 'ENGINE <b>·</b> DEMO', subtitle: 'InputMap actions bound to keys, pad and touch',
  rows: [['W / S · ↑ / ↓', 'Throttle / brake'], ['A / D · ← / →', 'Steer'], ['Space', 'Lift (flight context: ↑/↓ pitch)'], ['Shift', 'Boost'], ['C', 'Next camera mode'], ['G', 'Honk'], ['H', 'Toggle help']],
  footnote: 'Gamepad: left stick steer · RT/LT throttle/brake · A lift · B boost · Y camera · X honk', hint: 'PRESS <kbd>H</kbd> TO HIDE' });
button('uibtns', 'Flash', () => flash.show(['HELLO', 'FLIGHT MODE', 'CHECKPOINT', 'NEW RECORD'][Math.floor(Math.random() * 4)]));
button('uibtns', 'Help overlay', (b) => b.classList.toggle('on', help.toggle()));
button('uibtns', 'Badge pulse', () => badge.pulse());
button('uibtns', 'Damage -15%', () => { vstate.damage = Math.min(1, vstate.damage + 0.15); });
button('uibtns', 'Repair', () => { vstate.damage = 0; });
button('uibtns', 'Loading screen', async () => {
  const ls = new LoadingScreen({ title: 'ENGINE', label: 'Loading assets…' });
  const steps = ['Loading assets…', 'Building world…', 'Compiling shaders…', 'Ready'];
  for (let i = 0; i <= 20; i++) { ls.setProgress(i / 20, steps[Math.min(3, Math.floor(i / 6))]); await new Promise((r) => setTimeout(r, 90)); }
  await ls.hide();
});
button('uibtns', 'Hide HUD', (b) => layer.setVisible(!b.classList.toggle('on')));
$('accent').oninput = (e) => setTheme({ accent: e.target.value });

// ------------------------------------------------------------------ simulation
let heading = 0, speed = 0, vy = 0, boostE = 1, last = performance.now(), prevMode = 'ground';
const fwd = new THREE.Vector3(), prevVel = new THREE.Vector3(), acc = new THREE.Vector3(), accL = new THREE.Vector3(), qInv = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
let bank = 0, pitchA = 0;
function step(dt) {
  const thr = input.value('throttle'), brk = input.value('brake'), steer = input.value('steer'), lift = input.value('lift');
  const boosting = input.down('boost') && boostE > 0.02 && thr > 0.1;
  boostE = Math.max(0, Math.min(1, boostE + (boosting ? -0.25 : 0.08) * dt));
  const top = boosting ? 60 : 38;
  speed += (thr * (boosting ? 26 : 16) - brk * 30 * Math.sign(speed || 1) - speed * 0.35) * dt;
  if (brk > 0.2 && Math.abs(speed) < 1 && thr < 0.05) speed -= brk * 8 * dt; // reverse
  speed = Math.max(-12, Math.min(top, speed));
  const air = cube.position.y > 0.05;
  heading -= steer * dt * (air ? 1.1 : 1.6) * Math.min(1, Math.abs(speed) / 6) * Math.sign(speed || 1);
  vy += (lift * 16 - 9.81) * dt;
  if (air) pitchA += (input.value('pitch') * -0.4 - pitchA) * Math.min(1, dt * 4);
  cube.position.y = Math.max(0, cube.position.y + vy * dt);
  if (cube.position.y === 0 && vy < 0) { if (vy < -8) vstate.damage = Math.min(1, vstate.damage + 0.05); vy = 0; }
  if (!air) pitchA += (0 - pitchA) * Math.min(1, dt * 6);
  fwd.set(-Math.sin(heading), 0, -Math.cos(heading));
  cube.position.addScaledVector(fwd, speed * dt);
  // obstacle collisions: push out, bleed speed, take damage
  for (const b of queryColliders(cube.position.x, cube.position.z, 3)) {
    const p = cube.position, r = 1.4;
    if (p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r && p.y < b.maxY) {
      const dx = Math.min(p.x - (b.minX - r), (b.maxX + r) - p.x), dz = Math.min(p.z - (b.minZ - r), (b.maxZ + r) - p.z);
      if (dx < dz) p.x = p.x - (b.minX - r) < (b.maxX + r) - p.x ? b.minX - r : b.maxX + r; else p.z = p.z - (b.minZ - r) < (b.maxZ + r) - p.z ? b.minZ - r : b.maxZ + r;
      if (Math.abs(speed) > 4) { vstate.damage = Math.min(1, vstate.damage + Math.abs(speed) * 0.004); flash.show('IMPACT'); }
      speed *= 0.3;
    }
  }
  bank += (steer * Math.min(1, Math.abs(speed) / 20) * (air ? 0.6 : 0.08) - bank) * Math.min(1, dt * 5);
  euler.set(pitchA, heading, -bank, 'YXZ');
  cube.quaternion.setFromEuler(euler);
  const flight = cube.position.y > 0.3;
  input.setContext('flight', flight || flightBtn.classList.contains('on'));
  vstate.velocity.copy(fwd).multiplyScalar(speed); vstate.velocity.y = vy;
  vstate.speedKmh = Math.abs(speed) * 3.6; vstate.mode = flight ? 'flight' : 'ground'; vstate.grounded = !flight;
  vstate.thrust = lift; vstate.rpmLike = Math.min(1, thr + (boosting ? 0.2 : 0)); vstate.wheelSlip = Math.min(1, Math.abs(steer) * Math.abs(speed) / 40);
  vstate.boostLevel = boostE; vstate.altitude = cube.position.y;
  acc.copy(vstate.velocity).sub(prevVel).divideScalar(Math.max(dt, 1e-3)); prevVel.copy(vstate.velocity);
  vstate.gForce = acc.length() / 9.81;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  input.update(dt);
  if (input.enabled) step(dt);
  if (input.justPressed('camera')) { if (rig !== chase) useRig('chase'); else flash.show(`Camera: ${chase.cycleMode()}`); }
  if (input.justPressed('help')) help.toggle();
  if (input.justPressed('honk') && bus.ctx) { playTone(bus.ctx, bus.bus('effects'), { type: 'square', pitch: [[0, 415], [0.3, 405]], peak: 0.12, attack: 0.01, decay: 0.35, filter: { type: 'lowpass', frequency: 1800 } }); flash.show('HONK'); }
  if (vstate.mode !== prevMode) { badge.set(vstate.mode === 'flight' ? 'FLIGHT' : 'GROUND', vstate.mode === 'flight', { animate: true }); prevMode = vstate.mode; }
  rig.update(dt);
  // audio
  if (bus.running) {
    space.update();
    const e = space.emitters[0];
    if (hum && e && !hum._wired) { hum.connect(e.input); hum._wired = true; }
    if (hum) { hum.setGain(humOn ? 0.18 : 0, 0.1); hum.setFrequency(92 + vstate.speedKmh * 0.9); }
    vehicle.update(dt, vehicleOn ? vstate : { ...vstate, speedKmh: 0, rpmLike: 0, thrust: 0, wheelSlip: 0, damage: vstate.damage });
    ambience.update(dt, { speedN: vstate.speedKmh / 216, altitude: vstate.altitude });
  }
  // widgets
  const kmh = vstate.speedKmh, text = layer.tickText(dt);
  gauge.setValue(vstate.rpmLike);
  gauge.setColor(vstate.rpmLike > 0.9 ? theme.accent : '#ffffff');
  boostBar.setValue(boostE); liftBar.setValue(vstate.thrust); dmgBar.setValue(1 - vstate.damage);
  vsi.setValue(Math.max(-1, Math.min(1, vy / 10)));
  fwd.set(0, 0, -1).applyQuaternion(cube.quaternion);
  adi.set(Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 57.3, bank * 57.3);
  qInv.copy(cube.quaternion).invert(); accL.copy(acc).applyQuaternion(qInv);
  gmeter.update(dt, accL.x / 9.81, -accL.z / 9.81);
  const hdg = ((heading * -57.2958) % 360 + 360) % 360;
  minimap.update(dt, { x: cube.position.x, z: cube.position.z, headingDeg: hdg, viewM: 300 + kmh * 1.2, playerColor: vstate.mode === 'flight' ? '#fff' : theme.accent });
  if (text) {
    speedRO.set(String(Math.round(kmh))); speedRO.setSub(`${Math.round(kmh * 0.621371)} mph`);
    gear.select(kmh < 0.5 && vstate.rpmLike < 0.02 ? 'P' : speed < -0.5 ? 'R' : 'D');
    gauge.setFooter(`POWER ${Math.round(vstate.rpmLike * 100)}%`);
    boostBar.setText(`${Math.round(boostE * 100)}%`); liftBar.setText(`${Math.round(vstate.thrust * 100)}%`);
    dmgBar.setText(`${Math.round((1 - vstate.damage) * 100)}%`);
    dmgBar.setColor(vstate.damage > 0.66 ? theme.accent : vstate.damage > 0.33 ? '#ffb057' : '#4cd27a');
    altRO.set(vstate.altitude.toFixed(1)); vsRO.set(`${vy >= 0 ? '+' : '−'}${Math.abs(vy).toFixed(1)} m/s`);
    gmeter.setValueText(gmeter.magnitude.toFixed(1));
    minimap.setFoot(`View ${Math.round(minimap.viewMeters / 10) * 10} m`, `HDG ${String(Math.round(hdg) % 360).padStart(3, '0')}°`);
    // input panel
    for (const [name, a] of input.actions) {
      const r = rows[name], v = a.value;
      if (a.justPressed) r.edge = 0.3;
      r.fill.style.left = v >= 0 ? '50%' : `${50 + v * 50}%`; r.fill.style.width = `${Math.abs(v) * 50}%`;
      r.meter.classList.toggle('down', a.down); r.meter.classList.toggle('edge', r.edge > 0);
      r.num.textContent = v.toFixed(2);
    }
    const gp = input.gamepad;
    $('raw').textContent = `keys: ${[...input.pressedKeys].join(' ') || '-'}\npad: ${gp.connected ? gp.id.slice(0, 40) : 'none (press a button)'}\n` +
      `pointer Δ: ${input.mouseDelta.x.toFixed(0)}, ${input.mouseDelta.y.toFixed(0)}  contexts: ${[...input.contexts].join(',') || '-'}\n` +
      `virtual: ${[...input.virtual].filter(([, v]) => v).map(([k, v]) => `${k}=${(+v).toFixed(2)}`).join(' ') || '-'}\n` +
      `camera: ${rig === chase ? `chase/${chase.mode}` : rig === orbit ? 'orbit' : 'free fly'}  audio: ${bus.running ? 'running' : 'off'}`;
  }
  for (const r of Object.values(rows)) if (r.edge > 0) r.edge -= dt;
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
flash.show('Engine demo');
window.__demo = { input, touch, chase, orbit, free, bus, ambience, vehicle, space, layer, minimap, gauge, help };
void startBtn;
