// Publish the built game (dist/, built with `npm run build:pages`, base /flying-tesla/) to GitHub Pages: the
// contents of dist/ become a single orphan commit force-pushed to the `gh-pages` branch of this repository
// (the site keeps no history, so the 110 MB of textures do not pile up). Pages must be set to serve the
// gh-pages branch (Settings > Pages, or `gh api` below runs once). Run: npm run deploy
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (!existsSync(dist + 'index.html')) { console.error('dist/index.html missing: run `npm run build:pages` first'); process.exit(1); }
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: dist, ...opts });
const remote = execSync('git remote get-url origin', { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) }).trim();
const repo = (remote.match(/github\.com[:/]([^/]+\/[^/.]+)/) || [])[1];
if (!repo) { console.error(`origin is not a GitHub repository: ${remote}`); process.exit(1); }

writeFileSync(dist + '.nojekyll', '');            // serve every file as-is (no Jekyll pass)
rmSync(dist + '.git', { recursive: true, force: true });
sh('git init -q -b gh-pages');
sh('git add -A');
sh(`git -c user.name=deploy -c user.email=deploy@local commit -q -m "Deploy ${new Date().toISOString().slice(0, 16)}"`);
sh(`git push -f ${remote} gh-pages:gh-pages`);
rmSync(dist + '.git', { recursive: true, force: true });
// point Pages at the branch (idempotent; needs the gh CLI)
try {
  execSync(`gh api -X POST repos/${repo}/pages -f build_type=legacy -f "source[branch]=gh-pages" -f "source[path]=/"`, { stdio: 'ignore' });
} catch { /* already configured */ }
console.log(`Deployed to https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/`);
