// Roadster's world: the engine MapWorld (engine/src/world/MapWorld.js) composed for downtown San Francisco.
// Generic systems (terrain, roads, buildings, props, vegetation, traffic, water / shore / boats, far relief, sky)
// live in the engine; this file only supplies the SF data URLs, the SF tuning (district style map, street /
// lamp / species rules, Muni livery, Bay Bridge deck hold, ferry / ship / sailboat routes, far Bay Area relief) and
// the two SF plugins: the Bay Bridge superstructure (bridge.js) and the hand-modelled landmarks (landmarks.js).
// Contract (unchanged): new World(scene, renderer, opts) -> load(onProgress), update(dt, cameraPos),
// getGroundHeight, queryColliders, getSpawn, getMinimapData, isLand, setTimeOfDay, sunDirection, stats.
// opts: timeOfDay ('golden'), mapUrl / terrainUrl / farlandUrl, filler, forceProcedural, terrain, pbrSize,
// traffic (count | false | { count, seed, worker }), streaming (false | { radius, keep, budgetMs, ... }), baseGrid /
// detailGrid / buildingLod, chunkBuildings / chunkStructures / chunkGround / chunkBridge, plus any MapWorld option.
import { MapWorld, assetBase } from '@vibe/engine/world';
import { clamp } from '@vibe/engine/world';
import { bayBridgePlugin } from './bridge.js';
import { landmarksPlugin } from './landmarks.js';

export const WATER_LEVEL = -0.6;

const BAY_BRIDGE = /bay bridge|eisenhower|i-80|interstate 80/i;
const MARKET = /\bMarket\b/i, EMBARCADERO = /Embarcadero/i;

/**
 * Streaming pin: tall buildings beside the Bay Bridge deck. bridge.js (afterProps) collapses the OSM tower blocks under
 * the bridge towers in the merged building geometry, so the tiles holding them are built at load and never rebuilt.
 */
const besideBayBridge = (() => {
  let src = null, segs = null;
  const d2 = (px, pz, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / L2, 0, 1) : 0;
    return (a[0] + dx * t - px) ** 2 + (a[1] + dz * t - pz) ** 2;
  };
  return (b, data) => {
    if (!(b.h > 90) || b.lod || !Array.isArray(b.p) || b.p.length < 3) return false;
    if (src !== data) {
      src = data; segs = [];
      for (const r of data.roads || []) if (r && r.b && Array.isArray(r.p) && BAY_BRIDGE.test(r.n || '')) for (let i = 0; i + 1 < r.p.length; i++) segs.push([r.p[i], r.p[i + 1]]);
    }
    let cx = 0, cz = 0; for (const q of b.p) { cx += q[0]; cz += q[1]; } cx /= b.p.length; cz /= b.p.length;
    return segs.some(([a, c]) => d2(cx, cz, a, c) < 60 * 60);
  };
})();

/** San Francisco options for MapWorld (bake frame = metres around 37.792 N, 122.3965 W; x east, z south). */
export const SF_WORLD = {
  waterLevel: WATER_LEVEL,
  spawn: { road: /^Beale Street$/ }, // the wide street nearest the district centre
  procedural: { waterfrontName: 'The Embarcadero', center: { lat: 37.792, lon: -122.3965 } },
  // the Bay Bridge's suspended spans: upper deck 58 m, lower (eastbound) deck 9 m below, from 146 m inland of the
  // Embarcadero seawall (the SF anchorage, as bridge.js lays out the spans) to the Yerba Buena shore
  roads: { deckHolds: [{ name: BAY_BRIDGE, top: 58, lowerGap: 9, anchorage: 146, minWet: 800, minLen: 1200, farShore: 1500, maxOffset: 45 }] },
  buildings: {
    style: {
      /** Era heuristic: probability that a building in this part of downtown is pre-war masonry (bake frame metres). */
      oldProb(xb, zb) {
        let p = 0.3 + clamp(-xb / 1400, -0.25, 0.55) + clamp(-zb / 2600, -0.15, 0.3);
        if (xb > -180 && zb > 40) p *= 0.35;       // Transbay / Rincon Hill: mostly new
        if (xb < -420 && zb < -250) p += 0.2;      // Jackson Square / Chinatown / North Beach
        return clamp(p, 0.08, 0.92);
      },
      victorianProb: (xb, zb) => (xb < -350 && zb < -150 ? 0.55 : 0.3), // painted ladies toward Nob Hill / North Beach
      namedRe: /building|hotel|bank|exchange|hall|church|theat|temple|club|lodge|house|cathedral|mission|mint|customs|chronicle/i,
    },
  },
  props: {
    streets: {
      lampStyle: (name) => (MARKET.test(name) ? 'pathOfGold' : EMBARCADERO.test(name) ? 'doubleGlobe' : null),
      featureLamps: [{ road: MARKET, style: 'pathOfGold', step: 28 }], // Market's split carriageways defeat the generic pass
      boulevard: MARKET,      // Market Street: car-free kerbs, busy sidewalks
      promenade: EMBARCADERO, // The Embarcadero promenade
      utilityPoles: (name) => !/Market|Embarcadero/i.test(name),
    },
    signStyle: {
      manholeText: 'S.F. SEWER',
      posters: [
        ['#f2b134', '#c2410c', 'FOG CITY', 'FILM FESTIVAL', 'circle'], ['#0e7490', '#082f49', 'RIDE THE', 'CABLE CARS', 'hills'],
        ['#fde68a', '#16a34a', 'GOLDEN GATE', 'PARK CONCERTS', 'sun'], ['#e0e7ff', '#4338ca', 'BAY BREW', 'COFFEE CO.', 'cup'],
        ['#fecdd3', '#be123c', 'SUMMER', 'SALE  -40%', 'circle'], ['#111827', '#f59e0b', 'SF SYMPHONY', 'TONIGHT', 'sun'],
      ],
    },
  },
  // Canary Island date palms: The Embarcadero (all), Market Street (70 %, else London planes)
  vegetation: {
    rules: [
      { road: /embarcadero/i, species: 'palm', share: 1, radius: 30 },
      { road: /^market street$/i, species: 'palm', share: 0.7, other: 'planeA', radius: 22 },
    ],
  },
  streaming: { pin: besideBayBridge }, // engine DEFAULT_STREAMING otherwise (radius 900 m + tall-tile reach, 500 m at load)
  traffic: {
    seed: 7,
    busLivery: { // Muni: grey lower body, red window-line stripe
      lower: { c: [0.36, 0.37, 0.39], rough: 0.32, metal: 0.55, cc: 1 },
      stripe: { c: [0.5, 0.03, 0.035], rough: 0.32, metal: 0.05, cc: 1 },
    },
  },
  shore: {
    ferryDock: { x: 246, z: -390, dir: [0.8, -0.25] }, // Ferry Building (37.7955 N, 122.3937 W), east face of the pier
    islandFill: (L) => L.bb.minX > 0 && (L.bb.maxX - L.bb.minX) > 800, // Treasure Island: flat fill north of Yerba Buena
    boats: {
      // ferries: Ferry Building -> NE along the city front -> west of Treasure Island -> back (north of the bridge)
      ferryRoute: [[0, 0], [260, -220], [650, -700], [900, -1450], [760, -2050], [330, -2100], [120, -1500], [80, -700]],
      ferries: 2,
      // container ship: long ellipse between the city front and Alcatraz (world frame)
      shipRoute: [[1150, -2700], [-1200, -2620], [-4300, -2700], [-4500, -3050], [-4300, -3280], [-1200, -3300], [1150, -3250], [1350, -2980]],
      sailZones: [[300, -1900, 900], [-800, -2400, 700], [1000, -2400, 500], [-1800, -3000, 700], [800, -1300, 380], [2000, -900, 500], [-300, -3200, 800], [3800, -2200, 700]],
      sailCount: 9,
      avoidRoads: /bay bridge|eisenhower|interstate 80|i-80/i, // keep hulls off the Bay Bridge west span line
    },
    farland: {
      natural: (bx, bz) => bz < -5600 && bx < 1800,   // Marin headlands
      urbanMax: (bx) => (bx > 4000 ? 120 : 95),       // East Bay flats reach higher up the hills
      // downtown Oakland / Emeryville, Alameda, Berkeley, west SF: [bx, bz, r, hMin, hMax, density]
      clusters: [[10950, -1450, 1300, 25, 135, 1.0], [9400, -5300, 800, 15, 65, 0.8], [11300, 2300, 1500, 6, 14, 0.7], [-6000, 1500, 2500, 7, 13, 0.75]],
      cranes: { region: [5600, 8800, -3300, -300], max: 16, spacing: 260 }, // Port of Oakland, Outer / Middle Harbor
      blockAngle: (bx) => (bx > 0 ? 0.47 : 0.02),
    },
  },
};

export class World extends MapWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [opts] see header (legacy flat options + any MapWorld option)
   */
  constructor(scene, renderer, opts = {}) {
    const base = assetBase(), t = opts.traffic;
    const data = {
      mapUrl: opts.mapUrl || `${base}map/city.json`, terrainUrl: opts.terrainUrl || `${base}map/terrain.json`,
      farlandUrl: opts.farlandUrl ?? `${base}map/farland.json`, ...(opts.data || {}),
    };
    super({
      ...SF_WORLD,
      ...opts,
      scene, renderer, data,
      traffic: t === false ? false : { ...SF_WORLD.traffic, ...(t && typeof t === 'object' ? t : Number.isFinite(t) ? { count: t } : {}) },
      streaming: opts.streaming === false ? false : { ...SF_WORLD.streaming, ...(opts.streaming && typeof opts.streaming === 'object' ? opts.streaming : {}) },
      plugins: opts.plugins || [bayBridgePlugin({ chunk: opts.chunkBridge ?? 400 }), landmarksPlugin()],
    });
  }
}
