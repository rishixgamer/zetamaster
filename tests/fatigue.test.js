import test from 'node:test';
import assert from 'node:assert/strict';
import { shownAt, relativeEvents, paceProfile, tailProfile } from '../packages/analytics/src/fatigue.js';
import { makeQuestion, createGenerator } from '../packages/core/src/generator.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { createRng } from '../packages/core/src/rng.js';

/** Play a real benchmark where each solve takes timeFor(question, shownAtMs) ms. */
function play(seed, timeFor, day = 1) {
  let t = 0;
  const s = new ArithmeticSession({ rules: BENCHMARK_RULES, generator: createGenerator(BENCHMARK_RULES, seed), mode: 'benchmark', seed, clock: () => t, wallClock: () => new Date(Date.UTC(2026, 0, day)).toISOString() });
  s.start();
  while (true) {
    const dt = timeFor(s.current, t);
    if (t + dt >= 120000) break;
    t += dt; const a = String(s.current.answer); s.recordInput(a);
  }
  t = 120000; return s.finish();
}
const BASE = { add: 1000, sub: 1300, mul: 1800, div: 2200 };

test('shownAt supports engine-1 records', () => {
  assert.equal(shownAt({ shownAtMs: 500 }), 500);
  assert.equal(shownAt({ completedAtMs: 4000, responseMs: 1500 }), 2500);
  assert.equal(shownAt({}), null);
});

test('only standard benchmarks are analyzed', () => {
  const real = play('a', q => BASE[q.op]);
  const practice = { ...play('b', q => BASE[q.op] * 5), benchmark: false, mode: 'drill' };
  const r = relativeEvents([real, practice]);
  assert.equal(r.runs, 1);
  assert.equal(r.events.length, real.events.length);
  assert.equal(r.opMedian.mul, 1800);
});

test('no fatigue is detected when pace is constant, whatever the operation mix', () => {
  // Operation mix differs by run segment only through chance; times depend on operation alone.
  const runs = Array.from({ length: 8 }, (_, i) => play('flat' + i, q => BASE[q.op], i + 1));
  const p = paceProfile(runs);
  for (const s of p.segments) assert.ok(Math.abs(s.ratio - 1) < 1e-9, `segment ${s.index}`);
  assert.equal(p.halfShift.ratio, 1);
});

test('operation adjustment: harder ops late in the run are not mistaken for fatigue', () => {
  // Generator that serves additions early and divisions late; each op at its usual speed.
  const mk = (i) => { let t = 0, n = 0; const s = new ArithmeticSession({ rules: BENCHMARK_RULES, generator: () => makeQuestion(t < 60000 ? 'add' : 'div', 7, 20 + (n++ % 30)), mode: 'benchmark', seed: 'x' + i, clock: () => t, wallClock: () => new Date(Date.UTC(2026, 1, i + 1)).toISOString() });
    s.start(); while (t + BASE[s.current.op] < 120000) { t += BASE[s.current.op]; s.recordInput(String(s.current.answer)); } t = 120000; return s.finish(); };
  const runs = Array.from({ length: 5 }, (_, i) => mk(i));
  const p = paceProfile(runs);
  assert.ok(p.segments[3].rawMedianMs > p.segments[0].rawMedianMs, 'raw times do rise');
  assert.equal(p.segments[3].ratio, 1, 'relative times do not');
  assert.equal(p.halfShift.ratio, 1);
});

test('genuine slowdown is detected with an interval above 1', () => {
  const rng = createRng('slow');
  const runs = Array.from({ length: 10 }, (_, i) => play('fat' + i, (q, t) => Math.round(BASE[q.op] * (1 + 0.5 * t / 120000) * (0.85 + 0.3 * rng())), i + 1));
  const p = paceProfile(runs);
  assert.ok(p.segments[3].ratio > p.segments[0].ratio * 1.2);
  assert.ok(p.halfShift.ratio > 1.15 && p.halfShift.ratio < 1.45, String(p.halfShift.ratio));
  assert.ok(p.halfShift.ci.low > 1, 'interval excludes no-change');
});

test('pace profile degrades gracefully', () => {
  const empty = paceProfile([]);
  assert.equal(empty.observations, 0); assert.equal(empty.halfShift.ratio, null);
  assert.ok(empty.segments.every(s => s.n === 0 && s.ratio === null && s.ci === null));
  const two = paceProfile([play('a', q => BASE[q.op]), play('b', q => BASE[q.op], 2)]);
  assert.equal(two.halfShift.ratio, null, 'needs at least 3 runs');
  assert.equal(tailProfile([]).worst.length, 0);
});

test('slow tail: stalls are flagged and their cost estimated', () => {
  const runs = Array.from({ length: 6 }, (_, i) => play('tail' + i, q => (q.op === 'mul' && q.sourceLeft === 7 && q.sourceRight > 80 ? 9000 : BASE[q.op]), i + 1));
  const t = tailProfile(runs);
  assert.ok(t.cutoffRatio >= 2);
  const stalls = runs.flatMap(r => r.events).filter(e => e.op === 'mul' && e.sourceLeft === 7 && e.sourceRight > 80);
  assert.ok(stalls.length > 0);
  assert.equal(Math.round(t.slowShare * t.observations), stalls.length, 'exactly the stalls are slow');
  assert.ok(t.worst.every(w => w.label.startsWith('7 × ') && w.excessMs === 9000 - 1800));
  assert.ok(t.questionsPerRun >= 0);
  assert.equal(t.byOp.find(o => o.op === 'mul').slow, stalls.length);
  const clean = tailProfile(Array.from({ length: 3 }, (_, i) => play('c' + i, q => BASE[q.op], i + 1)));
  assert.equal(clean.slowShare, 0); assert.equal(clean.excessPerRun, 0); assert.equal(clean.worst.length, 0);
});

test('worst list run numbers are chronological', () => {
  const late = play('late', q => (q.op === 'div' ? 15000 : BASE[q.op]), 9);
  const early = play('early', q => BASE[q.op], 1);
  const mid = play('mid', q => BASE[q.op], 5);
  const t = tailProfile([late, early, mid]);
  assert.ok(t.worst.length > 0);
  assert.ok(t.worst.every(w => w.run === 3));
});
