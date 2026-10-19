#!/usr/bin/env node
// Roadster's distant relief bake: the Bay Area around the 9 km San Francisco map square (Oakland / Berkeley hills,
// Marin headlands, San Bruno Mountain), via the engine baker (engine/tools/bake-farland.mjs) -> public/map/farland.json.
//   node tools/bake-farland.mjs            (re-uses tiles cached in tools/.terrain-cache)
//   node tools/bake-farland.mjs --refresh  (re-download)        --dry-run (print the plan)   --help
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeFarland, SPEC } from '../engine/tools/bake-farland.mjs';
import { usage } from '../engine/tools/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
export const SF_FARLAND = {
  city: path.join(ROOT, 'public/map/city.json'), // centre
  half: 24000, cell: 250, zoom: 11, sea: -5,      // 250 m cells over +-24 km
  out: path.join(ROOT, 'public/map/farland.json'),
  cache: path.join(HERE, '.terrain-cache'),
};
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) process.stdout.write(usage('tools/bake-farland.mjs (SF wrapper; passes --refresh / --dry-run through)', 'engine/tools/bake-farland.mjs with the San Francisco arguments', SPEC));
else bakeFarland({ ...SF_FARLAND, refresh: argv.includes('--refresh'), dryRun: argv.includes('--dry-run') }).catch((e) => { console.error(e); process.exit(1); });
