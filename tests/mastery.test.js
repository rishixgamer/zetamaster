import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOMATICITY_MS, betaQuantile, masteryModel, masteryPosterior, masteryProxy, MASTERY_NOTE } from '../packages/analytics/src/skill-model.js';

/* Closed forms the numeric machinery must reproduce (bisection + continued fractions vs math):
 *
 *   Beta(1, 1)  is uniform:  quantile(q) = q
 *   Beta(2, 1)  has CDF x²:  quantile(q) = √q
 *   Beta(1, 2)  has CDF 1−(1−x)²:  quantile(q) = 1 − √(1−q)
 *   Beta(.5,.5) is the arcsine:  F(x) = 2/π·asin(√x) → quantile(q) = sin²(πq/2)
 */
const sin2 = x => Math.sin(x) ** 2;

test('betaQuantile: exact closed forms pinned to hand-computed values', () => {
  assert.equal(betaQuantile(0.3, 1, 1), 0.3);
  assert.ok(Math.abs(betaQuantile(0.025, 2, 1) - Math.sqrt(0.025)) < 5e-4, `got ${betaQuantile(0.025, 2, 1)} vs ${Math.sqrt(0.025)}`);
  assert.ok(Math.abs(betaQuantile(0.975, 2, 1) - Math.sqrt(0.975)) < 5e-4);
  assert.ok(Math.abs(betaQuantile(0.025, 1, 2) - (1 - Math.sqrt(0.975))) < 5e-4);
  assert.ok(Math.abs(betaQuantile(0.975, 1, 2) - (1 - Math.sqrt(0.025))) < 5e-4, `got ${betaQuantile(0.975, 1, 2)}`);
  // Archived prior shape (zero observations): the Jeffreys Beta(0.5, 0.5) arc-sine quantiles.
  assert.ok(Math.abs(betaQuantile(0.025, 0.5, 0.5) - sin2(Math.PI * 0.0125)) < 1e-3, `got ${betaQuantile(0.025, 0.5, 0.5)} vs ${sin2(Math.PI * 0.0125)}`);
  assert.ok(Math.abs(betaQuantile(0.5, 0.5, 0.5) - 0.5) < 1e-6);
  assert.ok(Math.abs(betaQuantile(0.975, 0.5, 0.5) - sin2(Math.PI * 0.4875)) < 1e-3);
  for (const bad of [[0, 1, 1], [1.5, 1, 1], [0.5, 0, 1], [0.5, -1, 1]]) {
    assert.throws(() => betaQuantile(...bad), RangeError);
  }
});

test('masteryPosterior: Jeffreys posterior mean is (0.5+passes)/(n+1); intervals bracket it and are honest on empty', () => {
  const empty = masteryPosterior(0, 0);
  assert.equal(empty.samples, 0);
  assert.equal(empty.estimate, 0.5, 'zero observations fall back to the prior mean, never a fabricated skill number');
  assert.ok(empty.ci.low < 0.02 && empty.ci.high > 0.98, `prior interval should be near-total, got ${empty.ci.low}–${empty.ci.high}`);
  assert.equal(empty.calibrated, false);
  assert.equal(empty.model, 'jeffreys-beta-posterior');
  // 3 of 4: mean = 3.5/5 = 0.7 exactly.
  const mixed = masteryPosterior(3, 4);
  assert.equal(mixed.estimate, 0.7);
  assert.ok(mixed.ci.low > 0.2 && mixed.ci.low < 0.7 && mixed.ci.high > 0.7 && mixed.ci.high < 1, `got ${mixed.ci.low}–${mixed.ci.high}`);
  // Monotonic in passes: more passes lift both the estimate and the interval.
  const zeroOfTen = masteryPosterior(0, 10), allOfTen = masteryPosterior(10, 10);
  assert.equal(zeroOfTen.estimate, Math.round((0.5 / 11) * 10000) / 10000);
  assert.equal(allOfTen.estimate, 1 - zeroOfTen.estimate, 'mirror symmetry of the Jeffreys posterior');
  assert.ok(zeroOfTen.ci.high < 0.45, `0/10 must stay clearly below coin-flip, got high ${zeroOfTen.ci.high}`);
  assert.equal(masteryPosterior(5, 10).estimate, 0.5);
  assert.equal(zeroOfTen.note, MASTERY_NOTE);
  for (const bad of [[-1, 10], [11, 10], [1.5, 10], [3, 2]]) assert.throws(() => masteryPosterior(...bad), RangeError);
  assert.throws(() => masteryPosterior(3, 4, { confidence: 0.96 }), RangeError);
  const ninety = masteryPosterior(3, 4, { confidence: 0.9 });
  assert.ok(ninety.ci.high <= mixed.ci.high && ninety.ci.low >= mixed.ci.low, 'narrower confidence → narrower interval');
});

test('masteryModel: same tag contract and automatization line as masteryProxy', () => {
  const events = [
    { tags: ['cell-a'], correct: true, responseMs: 1000 },
    { tags: ['cell-a'], correct: true, responseMs: 2000 },     // at the line counts as fast
    { tags: ['cell-a'], correct: true, responseMs: AUTOMATICITY_MS + 1 }, // over the line does not
    { tags: ['cell-a'], correct: false, responseMs: 300 },     // wrong answers are never mastered
    { tags: ['cell-b'], correct: true, responseMs: 500 },
    { correct: true, responseMs: 100 }, // untagged events are out of scope
  ];
  const model = masteryModel(events, 'cell-a', { thresholdMs: AUTOMATICITY_MS });
  assert.equal(model.tag, 'cell-a');
  assert.equal(model.samples, 4);
  assert.equal(model.passes, 2, `passes = correct AND ≤ ${AUTOMATICITY_MS}`);
  assert.equal(model.estimate, 0.5, '2 of 4 with Jeffreys → 2.5/5');
  // The legacy proxy sees exactly the same tag population (shared constant, no drift).
  assert.equal(masteryProxy(events, 'cell-a').samples, model.samples);
  assert.equal(masteryModel(events, 'cell-b').samples, 1);
  assert.equal(masteryModel(events, 'no-such').estimate, 0.5, 'unknown tags stay at the prior');
});
