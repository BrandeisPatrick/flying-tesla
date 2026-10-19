# engine/

Reusable browser game engine (Three.js/WebGL2) being extracted from the flying-car game.
Design and migration plan: [../ENGINE.md](../ENGINE.md). Layers: core, render, physics, world, input, camera, audio, ui.
Packaged as `@vibe/engine` (npm workspace of this repo; MIT). Games import it as a normal package:

```js
import { Engine, PhysicsWorld, VehicleController, Atmosphere, PostFX } from '@vibe/engine';
import { MapWorld } from '@vibe/engine/world';      // subpath per layer: core, physics, render, input, camera, audio, ui, world
```

## Install
- In this repo: `npm install` at the root links the workspace (`node_modules/@vibe/engine -> engine`).
- Elsewhere: `npm pack` in `engine/` produces the tarball (`npm run pack:check` lists its ~100 files, ~440 kB);
  publish with `npm publish --access public` once a registry scope is set up. Peer dependency: `three >= 0.170`.
- Tests: `npm test` (headless vehicle physics + traffic sims, Node ≥ 20).

- `src/world/` — data-driven city worlds: `MapWorld` (map + terrain + options + plugins) and its systems: `Terrain`,
  `MapData`, `RoadNetwork`, `Buildings` + `FacadeTextures`, `Props` + `Furniture` + `Vehicles`, `Traffic`,
  `Vegetation` (+ `Veg*`), `Water`, `Shore`, `Boats`, plus `MeshChunker`, `ShadowPasses`, `NearestLights`. API, plugin
  hooks and the city.json / terrain.json / farland.json contracts: ENGINE.md, "World layer".
- `tools/` — parameterised data bakers (`bake-map`, `bake-terrain`, `bake-farland`, `fetch-textures`; `--help`,
  `--dry-run`), see [tools/README.md](tools/README.md).
