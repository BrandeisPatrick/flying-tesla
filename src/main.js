// Roadster entry point: wires the game modules into the engine (engine/src/core/Engine.js owns the renderer,
// the 120 Hz fixed-step loop, resize, adaptive pixel ratio and the F3 profiler overlay).
import * as THREE from 'three';
import { Engine, PhysicsWorld, PostFX } from '@vibe/engine';
import { World } from './world/World.js';
import { Car } from './car/Car.js';
import { Input } from './car/Input.js';
import { ChaseCamera } from './camera/ChaseCamera.js';
import { HUD } from './ui/HUD.js';
import { CarAudio } from './audio/Audio.js';

const loadingEl = document.getElementById('loading');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');

function setProgress(p, label) {
  if (loadingBar) loadingBar.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
  if (label && loadingText) loadingText.textContent = label;
}

const params = new URLSearchParams(window.location.search);
const NOFX = params.has('nofx') && params.get('nofx') !== '0';

async function boot() {
  // With post-processing the scene is drawn into PostFX's own HDR target (4x MSAA by day, FXAA at night;
  // engine/src/render/PostFX.js), so the canvas needs no multisampling; ?nofx=1 renders straight to the canvas with MSAA.
  const engine = new Engine({ container: document.getElementById('app'), fixedHz: 120, maxSubsteps: 4, renderer: { antialias: NOFX }, profile: params.has('profile') });
  const { scene, camera, renderer } = engine;
  camera.position.set(0, 3, 10);

  const world = new World(scene, renderer);
  const car = new Car(scene);
  const input = new Input(renderer.domElement);
  const audio = new CarAudio();
  let postfx = null, chase = null, hud = null, audioStarted = false;
  let state = car.state, prevMode = state.mode;
  const camPos = new THREE.Vector3();

  const makePostFX = () => {
    if (NOFX) return null;
    try {
      const { width, height } = engine.size;
      return new PostFX(renderer, scene, camera, { atmosphere: world.atmo, width, height, pixelRatio: renderer.getPixelRatio() });
    } catch (e) {
      console.warn('[main] post-processing unavailable, rendering directly', e);
      if (world.atmo && world.atmo.setFogMode) world.atmo.setFogMode('scene');
      return null;
    }
  };

  // Systems (each phase runs in registration order; input polls before the fixed steps)
  engine.addSystem({
    earlyUpdate() {
      input.update();
      if (input.toggleCamera) { chase.cycleMode(); hud.flash(`Camera: ${chase.mode}`); }
      if (input.toggleHelp) hud.toggleHelp();
      if (input.reset) {
        const s = world.getSpawn();
        car.reset(s.position, s.headingRad, world);
        if (chase.snap) chase.snap();
        hud.flash('Reset');
      }
      if (chase.setLookBack) chase.setLookBack(!!input.lookBack);
    },
  }, 'input');
  engine.addSystem({
    loadWeight: 0.82,
    async load(progress) {
      await world.load(progress);
      if (world.atmo) world.atmo.camera = camera; // shadow cascades lead the view; lens flare
      postfx = makePostFX();
    },
    lateUpdate: (dt) => world.update(dt, camPos.copy(camera.position)), // after the camera has moved
  }, 'world');
  engine.addSystem({
    loadWeight: 0.18,
    async load(progress) { progress(0, 'Building car…'); await car.load(); },
    fixedUpdate: (dt) => car.update(dt, input, world),
    update(dt, alpha) {
      car.interpolate(alpha); // render pose between fixed steps (no judder at variable frame rates)
      state = car.state;
      if (state.mode !== prevMode) { hud.flash(state.mode === 'flight' ? 'FLIGHT MODE' : 'TOUCHDOWN'); prevMode = state.mode; }
    },
  }, 'car');
  engine.addSystem({ update: (dt) => chase.update(dt) }, 'camera');
  engine.addSystem({ update: (dt) => hud.update(dt, state, car.object3d) }, 'hud');
  let envTimer = 0;
  engine.addSystem({ update: (dt) => {
    if (!audioStarted) return;
    audio.update(dt, state);
    envTimer -= dt;
    if (envTimer <= 0 && audio.setEnvironment) {
      envTimer = 1;
      const p = car.object3d.position;
      let water = false;
      for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) if (!world.isLand(p.x + dx, p.z + dz)) { water = true; break; }
      audio.setEnvironment({ nearWater: water, darkness: world.atmo ? world.atmo.darkness : 0 });
    }
  } }, 'audio');

  setProgress(0.02, 'Loading city…');
  await engine.load(setProgress);

  const spawn = world.getSpawn();
  car.reset(spawn.position, spawn.headingRad, world);
  // engine physics view of the city: shares the world's static collider grid + ground query, plus traffic boxes
  const traffic = world.traffic;
  // deckStep 0.35 (= the Roadster's step height): an elevated deck counts as the car's ground only when its wheels could step onto it
  const physics = engine.physics = PhysicsWorld.fromWorld(world, { dynamic: traffic && traffic.queryColliders ? [(x, z, r, out) => traffic.queryColliders(x, z, r, out)] : [], deckStep: 0.35 });
  if (traffic) {
    if (traffic.setPlayer) traffic.setPlayer(() => car.object3d);
    if (traffic.setCamera) traffic.setCamera(camera);
  }

  chase = new ChaseCamera(camera, renderer.domElement, { minY: 0.6, physics, thinKinds: [2, 3, 'vehicle'] });
  // ?camshake=0 disables the camera shake, ?camshake=1 restores full strength (default 0.6)
  const camShake = new URLSearchParams(location.search).get('camshake');
  if (camShake !== null && Number.isFinite(+camShake)) chase.shakeScale = +camShake;
  chase.setTarget(car.object3d, () => car.state);
  if (chase.snap) chase.snap();

  hud = new HUD(document.body);
  hud.setMinimapData(world.getMinimapData());
  hud.showHelp(true);

  const startAudio = () => {
    if (audioStarted) return;
    audioStarted = true;
    try { audio.start(); } catch (e) { console.warn('audio start failed', e); }
    window.removeEventListener('keydown', startAudio);
    window.removeEventListener('pointerdown', startAudio);
  };
  window.addEventListener('keydown', startAudio);
  window.addEventListener('pointerdown', startAudio);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && audioStarted) hud.flash(audio.toggleMute() ? 'MUTED' : 'SOUND ON');
  });

  engine.renderFn = (sc, cam, dt) => {
    if (postfx) postfx.render(dt);
    else {
      renderer.render(sc, cam);
      if (world.atmo && world.atmo.renderFlare) world.atmo.renderFlare(renderer, cam);
    }
  };
  engine.onResize = (w, h, pr) => { if (postfx) postfx.setSize(w, h, pr); };

  window.__game = { THREE, engine, profiler: engine.profiler, physics, scene, camera, renderer, world, car, input, chase, hud, audio, postfx };

  if (loadingEl) {
    loadingEl.style.transition = 'opacity .5s';
    loadingEl.style.opacity = '0';
    setTimeout(() => loadingEl.remove(), 550);
  }
  hud.flash('Press H for controls');
  engine.start();
}

boot().catch((err) => {
  console.error(err);
  if (loadingText) loadingText.textContent = `Failed to start: ${err.message}`;
});
