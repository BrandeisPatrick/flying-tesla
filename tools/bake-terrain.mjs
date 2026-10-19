#!/usr/bin/env node
// Roadster's terrain bake: real San Francisco elevation (USGS 3DEP via AWS Terrarium tiles) for the city.json area,
// via the engine baker (engine/tools/bake-terrain.mjs) -> public/map/terrain.json.
//   node tools/bake-terrain.mjs            (uses cached tiles in tools/.terrain-cache when present)
//   node tools/bake-terrain.mjs --refresh  (re-download)        --dry-run (print the plan)   --help
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeTerrain, SPEC } from '../engine/tools/bake-terrain.mjs';
import { usage } from '../engine/tools/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
export const SF_TERRAIN = {
  city: path.join(ROOT, 'public/map/city.json'), // centre / outer square + land and pier rings
  fine: [-2600, -2900, 3500, 2500], fineCell: 10, fineZoom: 15, // filler ring (city half 1100 + 1000 m ring) + Yerba Buena Island
  outerCell: 40, outerZoom: 13, bayMin: -2,
  out: path.join(ROOT, 'public/map/terrain.json'),
  cache: path.join(HERE, '.terrain-cache'),
  checks: [ // landmark height check printed after the bake
    ['Ferry Building', 37.7955, -122.3937], ['Financial District (Montgomery & California)', 37.7929, -122.4030],
    ['Embarcadero Center', 37.7946, -122.3990], ['Salesforce Tower', 37.7897, -122.3972],
    ['Rincon Hill (Harrison & 1st)', 37.7863, -122.3924], ['Nob Hill (Grace Cathedral)', 37.7919, -122.4134],
    ['California & Powell', 37.7921, -122.4089], ['Telegraph Hill (Coit Tower)', 37.8024, -122.4058],
    ['Russian Hill (Lombard top)', 37.8021, -122.4187], ['Yerba Buena Island peak', 37.8090, -122.3660],
    ['Twin Peaks', 37.7544, -122.4477], ['Bay (off Pier 14)', 37.7950, -122.3850],
  ],
};
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) process.stdout.write(usage('tools/bake-terrain.mjs (SF wrapper; passes --refresh / --dry-run through)', 'engine/tools/bake-terrain.mjs with the San Francisco arguments', SPEC));
else bakeTerrain({ ...SF_TERRAIN, refresh: argv.includes('--refresh'), dryRun: argv.includes('--dry-run') }).catch((e) => { console.error(e); process.exit(1); });
