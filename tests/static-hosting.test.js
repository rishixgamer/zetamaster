import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const read = file => readFileSync(resolve(root, file), 'utf8');
const swFiles = () => JSON.parse(/const FILES=(\[[^\]]+\])/.exec(read('sw.js'))[1].replaceAll("'", '"'));
const isRelative = url => !/^([a-z][a-z0-9+.-]*:|\/)/i.test(url);

test('index.html loads everything by a URL relative to the page', () => {
  const urls = [...read('index.html').matchAll(/\b(?:href|src)="([^"#]+)"/g)].map(m => m[1]);
  assert.ok(urls.length >= 4, 'index.html should link the icon, manifest, stylesheet and script');
  for (const url of urls) {
    assert.ok(isRelative(url), `index.html uses a non-relative URL: ${url}`);
    assert.ok(existsSync(resolve(root, url)), `index.html points at a missing file: ${url}`);
  }
});

test('manifest start_url, scope and icons are relative to the manifest and land on the app', () => {
  const manifestPath = 'apps/web/manifest.webmanifest';
  const manifest = JSON.parse(read(manifestPath));
  const from = resolve(root, dirname(manifestPath));
  for (const url of [manifest.start_url, manifest.scope, ...manifest.icons.map(icon => icon.src)]) {
    assert.ok(isRelative(url), `manifest uses a non-relative URL: ${url}`);
  }
  assert.equal(resolve(from, manifest.start_url), root, 'start_url should be the folder that holds index.html');
  assert.equal(resolve(from, manifest.scope), root, 'scope should be the folder that holds index.html');
  for (const icon of manifest.icons) assert.ok(existsSync(resolve(from, icon.src)), `missing icon ${icon.src}`);
});

test('the service worker sits at the root and every precached entry is relative and exists', () => {
  assert.ok(existsSync(resolve(root, 'sw.js')) && existsSync(resolve(root, 'index.html')), 'sw.js must sit next to index.html');
  const files = swFiles();
  assert.ok(files.includes('./') && files.includes('index.html') && files.includes('sw.js'));
  for (const file of files) {
    assert.ok(isRelative(file), `sw.js FILES has a non-relative entry: ${file}`);
    assert.ok(existsSync(resolve(root, file)), `sw.js FILES lists a missing file: ${file}`);
  }
});

test('the page registers the worker beside itself with no absolute path or scope', () => {
  const main = read('apps/web/src/main.js');
  assert.match(main, /serviceWorker\.register\('sw\.js'\)/);
  assert.ok(!/register\('\//.test(main), 'registration must not use a root-absolute path');
});
