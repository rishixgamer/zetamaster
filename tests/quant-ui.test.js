import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

test('Quant Academy UI integration and navigation markers', () => {
  const indexHtml = readFileSync(resolve(root, 'apps/web/index.html'), 'utf8');

  // Navigation tab present
  assert.ok(indexHtml.includes('data-view="quant"'), 'index.html must have data-view="quant" nav button');
  assert.ok(indexHtml.includes('Quant Academy'), 'index.html nav must be labeled Quant Academy');

  // Section view and container
  assert.ok(indexHtml.includes('id="view-quant"'), 'index.html must have section#view-quant');
  assert.ok(indexHtml.includes('id="quant-root"'), 'index.html must have #quant-root container');

  // Verify main.js wires quant view
  const mainJs = readFileSync(resolve(root, 'apps/web/src/main.js'), 'utf8');
  assert.ok(mainJs.includes('renderQuantUI'), 'main.js must import renderQuantUI');
  assert.ok(mainJs.includes('renderQuant()'), 'main.js must call renderQuant() in refresh');

  // Verify service worker precaches quant modules
  const swJs = readFileSync(resolve(root, 'apps/web/sw.js'), 'utf8');
  assert.ok(swJs.includes('/apps/web/src/quant-ui.js'), 'sw.js must precache quant-ui.js');
  assert.ok(swJs.includes('/packages/quant/src/rational.js'), 'sw.js must precache rational.js');
  assert.ok(swJs.includes('/packages/quant/src/fractions.js'), 'sw.js must precache fractions.js');
  assert.ok(swJs.includes('/packages/quant/src/probability.js'), 'sw.js must precache probability.js');
  assert.ok(swJs.includes('/packages/quant/src/finance.js'), 'sw.js must precache finance.js');
  assert.ok(swJs.includes('/packages/quant/src/estimation.js'), 'sw.js must precache estimation.js');
  assert.ok(swJs.includes('/packages/quant/src/running.js'), 'sw.js must precache running.js');
  assert.ok(swJs.includes('/packages/quant/src/historical.js'), 'sw.js must precache historical.js');
  assert.ok(swJs.includes('/packages/quant/src/market-making.js'), 'sw.js must precache market-making.js');
  assert.ok(swJs.includes('/packages/quant/src/scoring.js'), 'sw.js must precache scoring.js');
});
