#!/usr/bin/env node
// Roadster's KTX2 texture compression: every set in public/textures/manifest.json via the engine compressor
// (engine/tools/compress-textures.mjs) -> public/textures/<id>/*.ktx2 (+ manifest ktx2 fields) and the Basis
// transcoder -> public/basis/. Flags pass straight through (--sets, --quality, --uastc, --etc1s, --force, --dry-run,
// --basis-only, --help, ...). `npm run textures:compress`; `npm run textures:basis` refreshes only the transcoder.
//   node tools/compress-textures.mjs              (skips maps whose .ktx2 is up to date)
//   node tools/compress-textures.mjs --force      (re-encode everything)
// Roadster uses the engine defaults (ETC1S albedo / rough / AO, UASTC normals). If a set ever shows ETC1S artefacts
// in game, promote just that map, e.g. --uastc asphalt_02/diff (in isolated 2x crops ETC1S adds faint chroma speckle
// to the asphalt aggregate; in game, A/B screenshots of the road differ by 1.6/255 on average, so it stays ETC1S).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compressTextures, SPEC } from '../engine/tools/compress-textures.mjs';
import { parseArgs, usage } from '../engine/tools/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
export const SF_KTX2 = {
  dir: path.join(ROOT, 'public', 'textures'),
  basis: path.join(ROOT, 'public', 'basis'),
};
let parsed;
try { parsed = parseArgs(process.argv.slice(2), SPEC); } catch (e) { console.error(`tools/compress-textures.mjs: ${e.message}`); process.exit(2); }
if (parsed.help) process.stdout.write(usage('tools/compress-textures.mjs (game wrapper; flags pass through)', 'engine/tools/compress-textures.mjs with the Roadster texture folder', SPEC));
else {
  // defaults from the wrapper, then any flag given on the command line (parseArgs fills unspecified flags with SPEC defaults)
  const given = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')[0].replace(/-([a-z])/g, (_, c) => c.toUpperCase())));
  const opts = { ...parsed.opts, ...SF_KTX2 };
  for (const k of given) if (k in parsed.opts) opts[k] = parsed.opts[k];
  compressTextures(opts).catch((e) => { console.error(e); process.exit(1); });
}
