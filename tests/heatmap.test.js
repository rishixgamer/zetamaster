import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHeatmap, heatmapLayout, medianCI, slowestCells, MIN_CELL_SAMPLES } from '../packages/analytics/src/heatmap.js';
import { benchmarkProgress } from '../packages/analytics/src/progress.js';
import { makeQuestion, createGenerator } from '../packages/core/src/generator.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { cellDrill } from '../packages/training/src/drills.js';
import { nextGridPosition, heatmapHash, parseHeatmapHash } from '../apps/web/src/grid-nav.js';

const ev = (op, a, b, responseMs, extra = {}) => ({ ...makeQuestion(op, a, b), responseMs, correct: true, corrections: 0, wrongPrefixes: 0, fullWrongAnswers: 0, wrongSubmissions: 0, ...extra });
const session = (events, benchmark = true, mode = benchmark ? 'benchmark' : 'custom') => ({ benchmark, mode, events, startedAt: '2026-10-01T00:00:00Z', score: events.length });

test('layouts cover the full default operand space', () => {
  const mul = heatmapLayout('mul'), add = heatmapLayout('add');
  assert.equal(mul.rows.length, 11); assert.equal(mul.cols.length, 10);
  assert.equal(add.rows.length, 10); assert.equal(add.cols.length, 10);
  assert.deepEqual(add.rows[0].range, [2, 9]); assert.deepEqual(add.rows.at(-1).range, [90, 100]);
  assert.throws(() => heatmapLayout('pow'));
  // Every generated benchmark question lands in exactly one cell.
  const next = createGenerator(BENCHMARK_RULES, 'cover');
  const events = Array.from({ length: 4000 }, () => ({ ...next(), responseMs: 1000, correct: true }));
  for (const op of ['add', 'sub', 'mul', 'div']) {
    const h = buildHeatmap([session(events)], op);
    assert.equal(h.cells.flat().reduce((s, c) => s + c.count, 0), events.filter(e => e.op === op).length, op);
  }
});

test('events bucket by source operands, including inverse operations', () => {
  const h = buildHeatmap([session([ev('mul', 7, 45, 3000), ev('mul', 12, 100, 1000), ev('mul', 2, 2, 1000)])], 'mul');
  assert.equal(h.cells[5][4].count, 1); assert.equal(h.cells[5][4].label, '7 × 40–49');
  assert.equal(h.cells[10][9].count, 1); assert.equal(h.cells[0][0].count, 1);
  // 672 ÷ 7 = 96 → divisor row 7, answer band 90–100
  const d = buildHeatmap([session([ev('div', 7, 96, 2000)])], 'div');
  assert.equal(d.cells[5][9].count, 1);
  // 76 – 47 = 29 → subtracted 47 (row 40–49), answer 29 (col 20–29)
  const s = buildHeatmap([session([ev('sub', 47, 29, 2000)])], 'sub');
  assert.equal(s.cells[4][2].count, 1);
});

test('benchmark scope excludes practice and drills; all scope includes them', () => {
  const xs = [session([ev('mul', 7, 45, 3000)]), session([ev('mul', 7, 45, 9000), ev('mul', 7, 46, 9000)], false, 'drill')];
  assert.equal(buildHeatmap(xs, 'mul').cells[5][4].count, 1);
  assert.equal(buildHeatmap(xs, 'mul', { scope: 'all' }).cells[5][4].count, 3);
  assert.throws(() => buildHeatmap(xs, 'mul', { scope: 'nope' }));
});

test('sparse cells are shrunk toward the operation median and marked insufficient', () => {
  const base = Array.from({ length: 40 }, (_, i) => ev('mul', 3, 10 + (i % 10), 1000));
  const h = buildHeatmap([session([...base, ev('mul', 7, 45, 9000)])], 'mul');
  const sparse = h.cells[5][4];
  assert.equal(sparse.evidence, 'insufficient');
  assert.equal(sparse.medianMs, 9000);
  assert.ok(sparse.ratio > 1 && sparse.ratio < 3, 'one slow sample is pulled strongly toward the median');
  assert.equal(h.cells[1][1].evidence, 'stable');
  assert.deepEqual(slowestCells(h), [], 'insufficient cells are never reported as weaknesses');
  const many = buildHeatmap([session([...base, ...Array.from({ length: 6 }, () => ev('mul', 7, 45, 4000))])], 'mul');
  assert.equal(slowestCells(many)[0].label, '7 × 40–49');
  assert.ok(MIN_CELL_SAMPLES >= 3);
});

test('non-clean entry share comes from the error typology', () => {
  const h = buildHeatmap([session([ev('add', 40, 32, 1000), ev('add', 41, 33, 1500, { wrongPrefixes: 1, corrections: 1 })])], 'add');
  assert.equal(h.cells[4][3].flawedShare, 0.5);
});

test('heatmap degrades gracefully with no data', () => {
  const h = buildHeatmap([], 'add');
  assert.equal(h.observations, 0); assert.equal(h.opMedianMs, null);
  assert.ok(h.cells.flat().every(c => c.count === 0 && c.ratio === null && c.ci === null && c.evidence === 'none'));
});

test('distribution-free median CI', () => {
  assert.equal(medianCI([1, 2, 3, 4, 5]), null, 'n=5 cannot reach 95%');
  assert.deepEqual(medianCI([6, 1, 5, 2, 4, 3]), { low: 1, high: 6, confidence: 0.95, n: 6 });
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  const ci = medianCI(hundred);
  assert.equal(ci.low, 40); assert.equal(ci.high, 61); // order statistics 40 and 61 for n=100
  const big = medianCI(Array.from({ length: 2000 }, (_, i) => i));
  assert.ok(big.low < 1000 && big.high > 999 && big.high - big.low < 100);
  assert.equal(medianCI([]), null);
});

test('cell drill only produces problems from that cell and never counts as benchmark', () => {
  const mulRules = cellDrill('mul', { rowRange: [7, 7], colRange: [40, 49] }, 60);
  const addRules = cellDrill('sub', { rowRange: [90, 100], colRange: [2, 9] }, 60);
  assert.equal(mulRules.id, 'custom'); assert.deepEqual(mulRules.enabled, ['mul']);
  const nm = createGenerator(mulRules, 'drill'), na = createGenerator(addRules, 'drill');
  for (let i = 0; i < 2000; i++) {
    const q = nm(); assert.equal(q.left, 7); assert.ok(q.right >= 40 && q.right <= 49);
    const s = na(); assert.equal(s.op, 'sub'); assert.ok(s.right >= 90 && s.right <= 100 && s.answer >= 2 && s.answer <= 9);
  }
  let t = 0;
  const run = new ArithmeticSession({ rules: mulRules, generator: nm, mode: 'drill', seed: 'x', clock: () => t, drill: { op: 'mul', cell: 'mul:5:4', label: '7 × 40–49' } });
  run.start(); t = 60000;
  const result = run.finish();
  assert.equal(result.benchmark, false); assert.equal(result.drill.cell, 'mul:5:4');
  assert.equal(benchmarkProgress([result]).count, 0);
  assert.equal(buildHeatmap([result], 'mul').observations, 0);
});

test('grid keyboard navigation clamps at edges', () => {
  assert.deepEqual(nextGridPosition({ row: 0, col: 0 }, 'ArrowUp', 11, 10), { row: 0, col: 0 });
  assert.deepEqual(nextGridPosition({ row: 0, col: 0 }, 'ArrowRight', 11, 10), { row: 0, col: 1 });
  assert.deepEqual(nextGridPosition({ row: 10, col: 9 }, 'ArrowDown', 11, 10), { row: 10, col: 9 });
  assert.deepEqual(nextGridPosition({ row: 4, col: 4 }, 'Home', 11, 10), { row: 4, col: 0 });
  assert.deepEqual(nextGridPosition({ row: 4, col: 4 }, 'End', 11, 10, { ctrl: true }), { row: 10, col: 9 });
  assert.deepEqual(nextGridPosition({ row: 4, col: 4 }, 'PageUp', 11, 10), { row: 0, col: 4 });
  assert.equal(nextGridPosition({ row: 0, col: 0 }, 'a', 11, 10), null);
});

test('heatmap deep links round-trip and reject junk', () => {
  const hash = heatmapHash('mul', 'benchmark', { row: 5, col: 4 });
  assert.equal(hash, '#heatmap/mul/benchmark/5/4');
  assert.deepEqual(parseHeatmapHash(hash), { op: 'mul', scope: 'benchmark', cell: { row: 5, col: 4 } });
  assert.deepEqual(parseHeatmapHash('#heatmap/add/all'), { op: 'add', scope: 'all', cell: null });
  for (const bad of ['', '#heatmap/pow/all', '#heatmap/mul/all/1', '#heatmap/mul/all/<x>/1', null]) assert.equal(parseHeatmapHash(bad), null);
});
