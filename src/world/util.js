// Game-side helper facade: the deterministic helpers now live in the engine (seeded RNG / lattice noise / easing:
// engine/src/render/noise.js; string hash + polygon math: engine/src/world/geom.js). Re-exported here so game code
// and old scripts that import src/world/util.js keep working.
export {
  mulberry32, hash2, pnoise, pfbm, clamp, lerp, smoothstep,
  hashStr, signedArea, pointInRing, pointInPoly, ringBounds, centroid, sanitizeRing, polylineLength,
} from '@vibe/engine/world';
