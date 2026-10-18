import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { createGenerator } from '../packages/core/src/generator.js';
import { createRng } from '../packages/core/src/rng.js';

/**
 * Independent reference model of the original client generator, written from the
 * audit in docs/PARITY_AUDIT.md (client module fetched 2026-10-17). It shares only
 * the uniform-float source with production code so draw order and mapping are tested.
 */
function referenceGenerator(seed) {
  const r = createRng(seed);
  const pick = n => Math.floor(r() * n);
  const between = (min, max) => min + pick(max - min + 1);
  const families = ['add', 'sub', 'mul', 'div'];
  return () => {
    const op = families[pick(families.length)];
    if (op === 'add' || op === 'sub') {
      const first = between(2, 100), second = between(2, 100);
      return op === 'add' ? { op, left: first, right: second, answer: first + second } : { op, left: first + second, right: first, answer: second };
    }
    const first = between(2, 12), second = between(2, 100);
    return op === 'mul' ? { op, left: first, right: second, answer: first * second } : { op, left: first * second, right: first, answer: second };
  };
}

// Upper-tail chi-square critical values at p = 0.001 for the degrees of freedom used below.
const CHI2_CRIT_001 = { 3: 16.27, 10: 29.59, 98: 148.0 };
function chiSquare(counts, expected) { return counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0); }

test('benchmark generator matches audited reference draw-for-draw', () => {
  for (const seed of ['parity-a', 'parity-b', 12345]) {
    const ours = createGenerator(BENCHMARK_RULES, seed);
    const ref = referenceGenerator(seed);
    for (let i = 0; i < 20000; i++) {
      const q = ours(), expected = ref();
      assert.deepEqual({ op: q.op, left: q.left, right: q.right, answer: q.answer }, expected, `seed ${seed} draw ${i}`);
    }
  }
});

test('operation and operand distributions are uniform (chi-square, p=0.001)', () => {
  const next = createGenerator(BENCHMARK_RULES, 'distribution');
  const n = 200000;
  const ops = { add: 0, sub: 0, mul: 0, div: 0 };
  const addLeft = new Array(99).fill(0), mulLeft = new Array(11).fill(0);
  let addDraws = 0, mulDraws = 0;
  for (let i = 0; i < n; i++) {
    const q = next(); ops[q.op]++;
    if (q.op === 'add' || q.op === 'sub') { addLeft[q.sourceLeft - 2]++; addDraws++; }
    else { mulLeft[q.sourceLeft - 2]++; mulDraws++; }
  }
  assert.ok(chiSquare(Object.values(ops), n / 4) < CHI2_CRIT_001[3]);
  assert.ok(chiSquare(addLeft, addDraws / 99) < CHI2_CRIT_001[98]);
  assert.ok(chiSquare(mulLeft, mulDraws / 11) < CHI2_CRIT_001[10]);
});

test('inclusive bounds are reachable and orientation matches original', () => {
  const next = createGenerator(BENCHMARK_RULES, 'bounds');
  const seen = new Set();
  for (let i = 0; i < 100000; i++) {
    const q = next();
    if (q.op === 'mul') assert.ok(q.left >= 2 && q.left <= 12, 'table factor always shown on the left');
    if (q.op === 'div') { assert.ok(q.right >= 2 && q.right <= 12, 'divisor is the table factor'); assert.equal(q.left % q.right, 0); }
    if (q.op === 'sub') assert.ok(q.answer >= 2 && q.answer <= 100 && q.right >= 2 && q.right <= 100);
    seen.add(`${q.op === 'add' || q.op === 'sub' ? 'A' : 'M'}L${q.sourceLeft}`).add(`${q.op === 'add' || q.op === 'sub' ? 'A' : 'M'}R${q.sourceRight}`);
  }
  for (const key of ['AL2', 'AL100', 'AR2', 'AR100', 'ML2', 'ML12', 'MR2', 'MR100']) assert.ok(seen.has(key), key);
  assert.ok(!seen.has('ML13') && !seen.has('AL1') && !seen.has('AR101'));
});

test('display glyphs match the original problem text', () => {
  const symbols = new Set();
  const next = createGenerator(BENCHMARK_RULES, 'glyphs');
  for (let i = 0; i < 200; i++) { const q = next(); symbols.add(`${q.op}:${q.symbol}`); }
  const bySymbol = Object.fromEntries([...symbols].map(s => s.split(':')));
  assert.deepEqual(bySymbol, { add: '+', sub: '–', mul: '×', div: '÷' });
});
