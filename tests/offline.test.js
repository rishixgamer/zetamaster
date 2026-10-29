import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
function importGraph(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const m of readFileSync(entry, 'utf8').matchAll(/(?:import|export)\s+(?:[^;]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = resolve(dirname(entry), m[1]);
    assert.ok(existsSync(target), `missing ${m[1]} from ${entry}`);
    importGraph(target, seen);
  }
  return seen;
}

test('service worker precaches every module the browser app imports', () => {
  const sw = readFileSync(resolve(root, 'sw.js'), 'utf8');
  const cached = new Set(JSON.parse(/const FILES=(\[[^\]]+\])/.exec(sw)[1].replaceAll("'", '"')));
  for (const file of importGraph(resolve(root, 'apps/web/src/main.js'))) {
    assert.ok(cached.has(relative(root, file)), `sw.js FILES is missing ${relative(root, file)}`);
  }
});
