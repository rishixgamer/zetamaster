import test from 'node:test';
import assert from 'node:assert/strict';
import { wilsonInterval, exactPermutationTest, eachCombination } from '../packages/analytics/src/stats.js';

test('wilsonInterval: pin to published values and reject garbage', () => {
  // 0 of 10 at 95%: high bound is the classic z²/(n+z²) half-interval.
  const zero = wilsonInterval(0, 10);
  assert.equal(zero.low, 0);
  assert.ok(Math.abs(zero.high - 0.2775) < 5e-3, `high should be ≈0.2775, got ${zero.high}`);
  // 5 of 10: symmetric-ish around 0.5001, half-width ≈0.263 → [0.237, 0.764].
  const half = wilsonInterval(5, 10);
  assert.ok(Math.abs(half.low - 0.2367) < 5e-3 && Math.abs(half.high - 0.7635) < 5e-3, `got ${half.low} / ${half.high}`);
  // All successes at 90%: interval must stay inside [0, 1].
  const all = wilsonInterval(10, 10, 0.9);
  assert.ok(all.high <= 1 && all.low > 0.65, `got ${all.low} / ${all.high}`);
  assert.equal(all.confidence, 0.9);
  // An independent recomputation of the published formula must agree exactly (module rounds to 4dp).
  const k = 3, n = 12, z = 1.959964;
  const p = k / n, z2 = z * z, z2n = z2 / n;
  const center = (p + z2n / 2) / (1 + z2n);
  const halfW = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2n);
  const round4 = value => Math.round(value * 10000) / 10000;
  const manual = wilsonInterval(k, n);
  assert.equal(manual.low, round4(Math.max(0, center - halfW)));
  assert.equal(manual.high, round4(Math.min(1, center + halfW)));
  for (const bad of [[-1, 10], [11, 10], [1.5, 10], [0, 0], ['2', 10]]) {
    assert.throws(() => wilsonInterval(...bad), RangeError);
  }
  assert.throws(() => wilsonInterval(1, 10, 0.96), RangeError, 'only the three named confidences exist');
});

test('eachCombination: enumerates exactly C(n, k) index sets, lexicographically', () => {
  const seen = [];
  const combine = (n, k) => eachCombination(n, k, c => seen.push(c.join('')));
  combine(4, 2);
  assert.deepEqual(seen, ['01', '02', '03', '12', '13', '23']);
  seen.length = 0;
  combine(5, 0);
  assert.deepEqual(seen, ['']);
  seen.length = 0;
  combine(3, 3);
  assert.deepEqual(seen, ['012']);
  assert.throws(() => eachCombination(2, 3, () => {}), RangeError);
});

test('exactPermutationTest: identical arms → p = 1 (exact enumeration, no asymptotics)', () => {
  const result = exactPermutationTest([1, 1], [1, 1]);
  assert.equal(result.feasible, true);
  assert.equal(result.statistic, 'median-difference');
  assert.equal(result.observed, 0);
  assert.equal(result.p, 1, 'every regrouping reaches the same |difference|');
  assert.equal(result.reassignments, 6, 'C(4, 2) = 6 full regroupings of 2+2');
});

test('exactPermutationTest: hand-verified median case A=[5,5,5,5] B=[1,1,1,1] → p = 34/70', () => {
  // Pooled: four 5s, four 1s. A k-of-4 split's median is 5 (k≥3), 3 (k=2), 1 (k≤1).
  // |medianA − medianB| = 4 happens for k ∈ {0,1,3,4} → 2·(C4,0·C4,4 + C4,1·C4,3) = 2·(1+16)=34.
  const result = exactPermutationTest([5, 5, 5, 5], [1, 1, 1, 1]);
  assert.equal(result.feasible, true);
  assert.equal(Math.abs(result.p - 34 / 70) < 5e-5, true, `p should be 34/70 ≈ 0.4857, got ${result.p}`);
  assert.equal(result.reassignments, 70);
  assert.equal(Math.round(result.observed * 10000) / 10000, 4);
});

test('exactPermutationTest: hand-verified mean case → p = 2/70 (identity + mirror)', () => {
  const result = exactPermutationTest([5, 5, 5, 5], [1, 1, 1, 1], { statistic: 'mean' });
  // A split holding k fives has meanA = k+1 and meanB = 4−k, so mean-diff = 2k−4. The observed 4
  // is reached only at k=4 (identity) and mirrored at k=0 (all the 1s vs all the 5s): 2 reassignments.
  assert.equal(Math.abs(result.observed - 4) < 1e-9, true, `observed should be 4, got ${result.observed}`);
  assert.equal(Math.abs(result.p - 2 / 70) < 5e-5, true, `p should be 2/70 ≈ 0.0286, got ${result.p}`);
  assert.equal(result.reassignments, 70);
  assert.equal(result.feasible, true);
});

test('exactPermutationTest: refuses >20 pooled values and oversized reassignment counts — never approximates', () => {
  const big = Array.from({ length: 11 }, (_, i) => i + 1);
  const refused = exactPermutationTest(big, big);
  assert.equal(refused.feasible, false);
  assert.equal(refused.p, null);
  assert.ok(/exceed the 20-value guard/.test(refused.note), refused.note);
  const capped = exactPermutationTest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [11, 12, 13, 14, 15], { maxReassignments: 10 });
  assert.equal(capped.feasible, false);
  assert.equal(capped.reassignments, 3003, 'C(15,10) = 3003');
  assert.ok(/refused, never approximated/.test(capped.note), capped.note);
  assert.throws(() => exactPermutationTest([], [1]), RangeError);
  // Non-finite entries are filtered before the guard, so [1, NaN] behaves like [1].
  const filtered = exactPermutationTest([1, NaN], [1]);
  assert.equal(filtered.feasible, true);
  assert.equal(filtered.reassignments, 2);
  assert.throws(() => exactPermutationTest([1, 2], [3, 4], { statistic: 'nope' }), RangeError);
});
