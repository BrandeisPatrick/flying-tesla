# Roadster — browser flying-car game

Three.js (v0.180, npm, ES modules via Vite). Plain JS, no TypeScript, no framework.
Goal: a driving game in a **realistic real-world city** where the car is an electric
hypercar (Tesla Roadster-style, SpaceX cold-gas-thruster package) that can lift off and fly.

Run: `npm run dev` → http://localhost:5180

## Coordinate system & units
- Three.js default: **Y up**. Ground plane is roughly y = 0 (world may have small terrain variation).
- 1 unit = 1 metre. Speeds internally in m/s; HUD converts to km/h.
- Heading: car forward is **-Z** in its local frame (Three.js convention, `Object3D.lookAt` compatible).
- World origin (0,0,0) is the spawn area: a drivable road.

## Module contracts (each module is a folder under `src/`; one owner each)

### `src/world/World.js`  (owner: world agent)
```js
export class World {
  constructor(scene, renderer) {}
  /** Build everything (map data, meshes, lights, sky, env). onProgress(0..1, label). */
  async load(onProgress) {}
  /** Per-frame: animate time-of-day, traffic lights, etc. cameraPos is THREE.Vector3. */
  update(dt, cameraPos) {}
  /** Height of the drivable ground surface at (x,z). Flat city ≈ 0, but always call this. */
  getGroundHeight(x, z) {}
  /**
   * Static colliders near a point. Returns array of axis-aligned boxes in world space:
   * { minX, minY, maxX, maxY, minZ, maxZ }  (buildings, bridge piers, big props).
   * Must be cheap (spatial hash / grid). radius in metres.
   */
  queryColliders(x, z, radius) {}
  /** Spawn pose for the car. */
  getSpawn() { return { position: THREE.Vector3, headingRad: number }; }
  /** For the minimap: array of road polylines [[x,z],[x,z],...] in world units, plus bounds. */
  getMinimapData() { return { roads: [[ [x,z], ... ]], bounds: {minX,maxX,minZ,maxZ} }; }
  /** Sun direction (unit THREE.Vector3) for other modules wanting consistent lighting. */
  get sunDirection() {}
}
```

### `src/car/Car.js` + `src/car/Input.js`  (owner: car agent)
```js
export class Input { constructor(domElement) {} /* keyboard+gamepad */  update() {}
  // normalized state read by Car:
  // throttle 0..1, brake 0..1, steer -1..1, thrust 0..1 (lift), pitch -1..1, roll -1..1, yaw -1..1,
  // boost bool, handbrake bool, toggleCamera (edge), reset (edge), toggleHelp (edge)
}
export class Car {
  constructor(scene) {}
  async load() {}                       // build the mesh (procedural geometry, PBR materials)
  reset(position, headingRad) {}
  update(dt, input, world) {}           // physics + visuals; uses world.getGroundHeight / queryColliders
  get object3d() {}                     // root THREE.Group (position/quaternion are the car pose)
  get state() {}                        // { speedKmh, altitude, mode: 'ground'|'flight', thrust 0..1,
                                        //   gForce, velocity: THREE.Vector3, grounded: bool,
                                        //   rpmLike 0..1, thrusterLevel 0..1, damage 0..1 }
}
```
Physics intent: arcade-realistic. Ground: RWD, tyre slip/drift, weight transfer, suspension on
4 wheels (visual), top speed ~400 km/h, 0-100 in ~1.1 s. Flight: holding thrust lifts the car
(cold-gas thrusters at the four corners + rear), with real-ish gravity (9.81), air drag, pitch/roll/yaw
authority via thruster differential, auto-level when no input. Collisions with world AABBs push the car
out and bleed speed; hitting hard adds damage. Never let the car fall through ground.

### `src/camera/ChaseCamera.js`  (owner: hud agent)
```js
export class ChaseCamera {
  constructor(camera, domElement) {}
  setTarget(carObject3d, carStateGetter) {}
  cycleMode() {}            // chase → hood/cockpit → cinematic orbit
  update(dt) {}             // smooth follow, speed-dependent FOV & distance, look-back on key
}
```

### `src/ui/HUD.js`  (owner: hud agent)
```js
export class HUD {
  constructor(container) {}             // creates DOM overlay (no canvas-only text)
  setMinimapData(data) {}               // from world.getMinimapData()
  update(dt, carState, carObject3d) {}  // speedometer, altitude, thrust gauge, mode, minimap, G-meter
  showHelp(bool) {} toggleHelp() {}
  flash(msg) {}                         // transient center message e.g. "FLIGHT MODE"
}
```

### `src/audio/Audio.js`  (owner: hud agent)
```js
export class CarAudio { constructor() {} start() {} update(dt, carState) {} } // WebAudio synth: EV whine, wind, thrusters
```

### `src/main.js` (owner: integrator)
Creates renderer (ACES tone mapping, sRGB, shadows), scene, camera; instantiates World, Car,
Input, ChaseCamera, HUD, CarAudio; loop with fixed-step physics (120 Hz, max 4 substeps) and
variable-rate render. Handles resize, pointer-lock-free input, loading screen.

## Controls (default)
W/S or ↑/↓ throttle/brake · A/D or ←/→ steer (ground) / roll (flight) · Space: thrust (lift)
· Shift: boost · Q/E: yaw (flight) · I/K (or ↑/↓ while airborne): pitch · C: camera · R: reset · H: help
Gamepad: left stick steer/pitch, RT throttle, LT brake, A thrust, B boost, Y camera.

## Visual quality bar ("as realistic as possible")
- Real city geometry from OpenStreetMap (buildings with heights/levels, roads w/ lane counts, water,
  parks, railways). Baked offline into `public/map/city.json` by `tools/bake-map.mjs` (Overpass API),
  with a deterministic procedural fallback if the file is missing.
- PBR materials everywhere, procedural canvas textures (facade windows that glow at night, asphalt
  with lane markings, concrete sidewalks, grass). Window lights vary per building.
- Physically-based sky (THREE.Sky), sun as directional light with cascaded-ish shadow (large map +
  tight follow shadow camera), PMREM environment from the sky, exponential fog matching horizon.
- Street lights, trees (instanced), traffic lights, road signs, parked cars (instanced simple shapes),
  bridges/elevated roads where OSM says so. Everything via InstancedMesh / merged geometry: target 60 fps
  on an M-series Mac with ~5 km² of city.

## Conventions
- ES modules, `import * as THREE from 'three'`; addons via `three/addons/...`.
- No globals except `window.__game` for debugging.
- Dispose nothing fancy; this is a single-scene game.
- Each module must be importable and testable in isolation (no cross-imports between world/car/ui).

---
**2026-10-18 update.** The module layout above describes the original game. The systems have since been
extracted into the browser game engine in `engine/` (see `ENGINE.md`): the game is now `src/main.js` (wiring),
`src/world/World.js` (San Francisco `MapWorld` configuration) plus the `bridge.js` / `landmarks.js` plugins,
`src/car/` (hero car visuals over the engine `VehicleController`), and thin skins for HUD, camera, input and
audio. A second game, `samples/canyon-run/`, runs on the same engine.
