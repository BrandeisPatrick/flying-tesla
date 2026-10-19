#!/usr/bin/env node
// Roadster's map bake: downtown San Francisco (Embarcadero / Financial District / Rincon Hill / waterfront) with the
// Bay Bridge approach, via the engine baker (engine/tools/bake-map.mjs) -> public/map/city.json.
//   node tools/bake-map.mjs            (uses cached raw responses in tools/.osm-cache when present)
//   node tools/bake-map.mjs --refresh  (ignore the cache)        --dry-run (print the plan)   --help
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeMap, SPEC } from '../engine/tools/bake-map.mjs';
import { usage } from '../engine/tools/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
export const SF_MAP = {
  lat: 37.7920, lon: -122.3965, // bake frame origin (src/world/landmarks.js uses the same centre)
  size: 2200,                   // city square edge, metres (~4.8 km2)
  outer: 9000,                  // coastline / land square edge, metres (horizon ground)
  bridgeExt: [3200, 2200],      // extra area east / north for the Bay Bridge deck
  out: path.join(ROOT, 'public/map/city.json'),
  cache: path.join(HERE, '.osm-cache'),
};
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) process.stdout.write(usage('tools/bake-map.mjs (SF wrapper; passes --refresh / --dry-run through)', 'engine/tools/bake-map.mjs with the San Francisco arguments', SPEC));
else bakeMap({ ...SF_MAP, refresh: argv.includes('--refresh'), dryRun: argv.includes('--dry-run') }).catch((e) => { console.error(e); process.exit(1); });
