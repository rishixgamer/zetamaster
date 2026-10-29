import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const scan = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async (entry) => {
  const p = join(dir, entry.name);
  return entry.isDirectory() ? scan(p) : entry.name.endsWith('.js') || entry.name.endsWith('.mjs') ? [p] : [];
}))).flat();
const files = ['sw.js', ...await scan('packages'), ...await scan('apps'), ...await scan('scripts')];
for (const f of files) {
  const result = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`Syntax validated: ${files.length} JavaScript modules.`);
