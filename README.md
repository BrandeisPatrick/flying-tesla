# Roadster — flying-car driving game (browser)

Drive an electric hypercar with a cold-gas thruster package through a real slice of
downtown San Francisco (Financial District, Embarcadero, Rincon Hill, Nob Hill, Bay Bridge),
built from OpenStreetMap data on real USGS terrain, with AI traffic that obeys the signals.
Hold Space to lift off and fly between the towers or along the Bay Bridge cables.

```bash
git clone --recurse-submodules https://github.com/BrandeisPatrick/flying-tesla.git
cd flying-tesla
npm install        # links the engine submodule as the workspace package @vibe/engine
npm run dev        # http://localhost:5180
```

The engine lives in its own repository, [inbrowser-game-engine](https://github.com/BrandeisPatrick/inbrowser-game-engine),
embedded here as the `engine/` submodule (an existing clone gets it with `git submodule update --init`). To pick up
a newer engine commit: `git submodule update --remote engine`, then commit the new pointer.

## Controls
| Key | Action |
|---|---|
| W / S, ↑ / ↓ | Throttle / brake (brake from standstill reverses) |
| A / D, ← / → | Steer on the ground, roll in flight |
| Space | Thrust (lift off / climb). Release to hover-descend gently |
| Shift | Boost (rear thrusters + extra power, 4 s, recharges) |
| Q / E | Yaw in flight |
| I / K, ↑ / ↓ (airborne) | Pitch |
| X | Handbrake |
| C | Camera: chase → hood → cockpit → cinematic |
| B | Look back |
| R | Reset to spawn |
| H | Help overlay · M mute · F3 profiler |

URL switches: `?nofx=1` (no post-processing), `?camshake=0` (no camera shake), `?noworker=1`, `?nostream=1`, `?ktx2=0`, `?profile=1`.

Gamepad: left stick steer/pitch, RT throttle, LT brake, A thrust, B boost, Y camera, X reset.

## Layout
- `src/main.js` — renderer, fixed-step (120 Hz) game loop, wiring.
- `src/world/` — the San Francisco world, composed from the engine's `MapWorld` (`engine/src/world/`: terrain,
  roads with shader lane markings, buildings with PBR facades / real window openings / storefronts / rooftop plant,
  props, vegetation, traffic AI, water / shore / boats, far relief, sky): `World.js` (SF data URLs + SF options: district
  style map, lamp / palm / street rules, Muni livery, Bay Bridge deck hold, ferry / ship / sailboat routes), plugins
  `bridge.js` (Bay Bridge west span) and `landmarks.js` (hand-modelled Transamerica, Salesforce Tower, Ferry Building,
  Embarcadero Center, Coit Tower, ...); `util.js` re-exports the engine helpers.
- `public/textures/` — CC0 PBR texture sets from Poly Haven (see `CREDITS.md`); re-download with
  `node tools/fetch-textures.mjs` (optional: the game falls back to procedural textures without them). Each JPG has a
  GPU-compressed `.ktx2` twin (Basis Universal) made by `npm run textures:compress` (`tools/compress-textures.mjs`;
  `public/basis/` holds the matching transcoder). The loader prefers the `.ktx2` and falls back to the JPG; `?ktx2=0`
  in the URL forces the JPGs (A/B comparisons). Details and measurements: engine/ENGINE.md, "Textures".
- `src/car/` — procedural car mesh and effects on the engine's `VehicleController` (sprung body, tyre model, thruster flight; `Physics.js` is a re-export shim), `Input.js`.
- `src/camera/`, `src/ui/`, `src/audio/` — chase camera, HUD overlay, Web Audio synth.
- `tools/bake-map.mjs` — re-bake `public/map/city.json` from Overpass (`npm run bake:map`, `--refresh` to ignore cache).
- `tools/bake-terrain.mjs` — re-bake `public/map/terrain.json` from AWS Terrarium tiles (`npm run bake:terrain`).
- `tools/bake-farland.mjs`, `tools/fetch-textures.mjs` (+ `tools/textures.sf.json`, `--ktx2` to compress afterwards),
  `tools/compress-textures.mjs` (KTX2 twins + transcoder copy) — far relief / texture sets. All of them
  are thin SF wrappers over the parameterised engine bakers in `engine/tools/` (`--dry-run` prints the plan, `--help`).
- `engine/test/car-sim.mjs` — headless vehicle physics checks (`npm test` runs them with the traffic check).
- `dev/traffic-sim.mjs` — headless traffic checks on the simulation core (`PLAYER=1 node dev/traffic-sim.mjs 120`).
- `dev/drive-sim.mjs` — headless street drive: a pilot drives the Roadster along 23 real downtown streets with terrain, decks and colliders, and reports pitch/roll snaps, hops, grounded flicker, flight entries and impacts (`node dev/drive-sim.mjs --events`).
- `dev/world.html`, `dev/car.html`, `dev/hud.html`, `dev/traffic.html` — isolated module test pages (world: streaming
  stats; traffic: worker / main-thread timings, H = baked lane heights vs the live ground).
- URL switches for A/B checks: `?noworker=1` (traffic AI on the main thread instead of a Web Worker), `?nostream=1`
  (build every building at load instead of streaming tiles around the camera), `?nofx=1`, `?ktx2=0`.

World options (in `main.js`): `new World(scene, renderer, { timeOfDay: 'night' })` — presets dawn, morning,
noon, afternoon, golden (default), sunset, dusk, night, or hours as a number.

## Assets
- Textures: CC0 photoscanned PBR sets from [Poly Haven](https://polyhaven.com) in `public/textures/`
  (see `public/textures/CREDITS.md`; re-fetch with `node tools/fetch-textures.mjs`), shipped as KTX2 / Basis Universal
  (33.8 MB instead of 51 MB of JPG, transcoded to ASTC / BC7 on the GPU) with the JPGs as fallback. Missing files fall
  back to procedural canvas textures, so the game runs offline. Re-compress after a re-fetch with
  `npm run textures:compress` (needs the devDependencies `ktx2-encoder`, `jpeg-js`, `ktx-parse`).
- Models: everything is procedural and instanced — trees (engine `Vegetation.js`, `VegModels.js`: plane, ficus, oak, palm,
  cypress, pine with billboard impostors beyond ~180 m), buildings (engine `Buildings.js`: PBR walls, recessed windows,
  storefronts, cornices, fire escapes, rooftop plant), landmarks (`landmarks.js`: Transamerica, Salesforce Tower,
  555 California, Ferry Building, Embarcadero Center, Millennium, 181 Fremont, Coit Tower), vehicles
  (engine `Vehicles.js`: 9 types shared by traffic and parked cars), street furniture (engine `Furniture.js`: signals, signs with
  real street names, lamps, hydrants, shelters, utility poles).

## Rendering
- Post-processing (`src/render/PostFX.js`): HDR scene target, GPU eye adaptation, half-res GTAO from the depth
  buffer, quarter-res bloom, one final pass with height/distance fog, ACES, grading, vignette, FXAA at night
  (4x MSAA by day). Disable with `?nofx=1`; `window.__game.postfx.debug = 'ao'|'bloom'|'fog'` shows a buffer.
- Atmosphere (`engine/src/render/Atmosphere.js`): sun disc + lens flare, drifting clouds, blue-hour/night sky with stars and
  moon, two camera-following shadow cascades (near 2048 / far 4096), sun colour from an air-mass model.
- Water (`engine/src/world/Water.js`): camera-following swell grid, 4-layer normals, Fresnel sky reflection, sun
  glitter, baked shore-distance foam; boats (`Boats.js`), shoreline detail (`Shore.js`), far Bay Area relief
  (`public/map/farland.json`, `tools/bake-farland.mjs`).
- Hero car (`src/car/CarMesh.js` + `carBody.js`, `carParts.js`, `carMaterials.js`, `Effects.js`): ~58k tris,
  see-through canopy with interior, clearcoat flake paint, plumes, dust, skid marks, sparks, headlight cones.
- Camera avoids buildings, vehicles, tree crowns and terrain (`src/camera/ChaseCamera.js`).
- The engine is the git submodule `engine/` ([inbrowser-game-engine](https://github.com/BrandeisPatrick/inbrowser-game-engine)); its design notes are `engine/ENGINE.md`.

## Known limitations
- Terrain is real (USGS elevation via AWS Terrarium tiles, `tools/bake-terrain.mjs`), but the Yerba Buena
  tunnel is not modelled: the bridge deck simply runs into the island's hill.
- A parked player holds up the traffic behind it. Water reflects only the sky, not the city.
- Bay Bridge east span past Yerba Buena is a plain deck; `dev/traffic.html` shows the lane graph (key L).
- Street-lamp point lights only near the camera at night.
- Buildings stream in tiles around the camera (engine/ENGINE.md, "Streaming"): from street level a district tile appears
  ~0.9-1.8 km away (farther for tiles with tall towers, from the air or over the water), the near-detail facades
  (real window openings) ~0.45 km before their LOD switch. Driving or flying fast towards the edge of the loaded area
  shows tiles arriving at that distance; a reset to the spawn after a long drive rebuilds the spawn area at once (a
  short hitch). Colliders are always global.
- Traffic is simulated in a Web Worker and drawn from the newest snapshot (one frame old, extrapolated by speed and
  yaw rate); without module Workers (or with `?noworker=1`) it runs on the main thread as before.
