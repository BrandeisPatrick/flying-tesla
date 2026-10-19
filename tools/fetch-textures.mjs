#!/usr/bin/env node
// Roadster's texture download: the curated CC0 Poly Haven sets listed in tools/textures.sf.json, via the engine
// fetcher (engine/tools/fetch-textures.mjs) -> public/textures (+ manifest.json, CREDITS.md).
//   node tools/fetch-textures.mjs            (skips files already present with the right size)
//   node tools/fetch-textures.mjs --refresh  (re-download everything)        --dry-run (list only)   --help
//   node tools/fetch-textures.mjs --ktx2     (then compress to .ktx2 + copy the Basis transcoder: tools/compress-textures.mjs)
// The game runs without these files (procedural canvas fallback), so this is optional but recommended.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTextures, SPEC } from '../engine/tools/fetch-textures.mjs';
import { usage } from '../engine/tools/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
export const SF_TEXTURES = { sets: path.join(HERE, 'textures.sf.json'), out: path.join(ROOT, 'public', 'textures'), res: '1k' };
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) process.stdout.write(usage('tools/fetch-textures.mjs (game wrapper; passes --refresh / --dry-run / --ktx2 through)', 'engine/tools/fetch-textures.mjs with --sets tools/textures.sf.json', SPEC));
else fetchTextures({ ...SF_TEXTURES, refresh: argv.includes('--refresh'), dryRun: argv.includes('--dry-run'), ktx2: argv.includes('--ktx2'), ktx2Options: { basis: path.join(ROOT, 'public', 'basis') } }).catch((e) => { console.error(e); process.exit(1); });
