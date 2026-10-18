import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalSet, intervalSetRationale, SETS_DEFAULTS } from '../packages/training/src/sets.js';
import { sprintRules } from '../packages/training/src/drills.js';
import { benchmarkEquivalent } from '../packages/core/src/rulesets.js';

// Speed-interval sets (F30 close-out). Pure data + evidence-linked rationale; every work stage is
// launched by the UI as an independent 'sprint' practice run, and recovery is a pause BETWEEN
// sessions — nothing here may touch the benchmark ruleset or any timing inside a session.

test('the default set is 3 × 30 s work with 15 s recovery between', () => {
  const spec = intervalSet();
  assert.equal(spec.id, 'interval-set-default');
  assert.equal(spec.label, '3 × 30 s sprints · 15 s recovery');
  assert.equal(spec.workStages, 3);
  assert.equal(spec.restStages, 2);
  assert.equal(spec.totalMinutes, 2, '90 s of sprints + 30 s of rest = exactly 2 minutes');
  assert.deepEqual(spec.stages.map(s => s.kind), ['work', 'rest', 'work', 'rest', 'work'], 'work first, rest between, never resting after the final bout');
  assert.deepEqual(spec.stages.filter(s => s.kind === 'rest').map(s => s.seconds), [15, 15]);
  assert.deepEqual(spec.stages.filter(s => s.kind === 'work').map(s => s.seconds), [30, 30, 30]);
});

test('custom sets scale stages exactly and always end with a work bout', () => {
  for (const sets of [1, 2, 5, 10]) {
    const spec = intervalSet({ sets, workSeconds: 20, restSeconds: 10 });
    assert.equal(spec.stages.length, sets * 2 - 1);
    assert.equal(spec.stages[spec.stages.length - 1].kind, 'work');
    assert.equal(spec.restStages, sets - 1, 'recovery stages only exist between work bouts');
    assert.equal(Math.ceil((sets * 20 + (sets - 1) * 10) / 60), spec.totalMinutes);
  }
  const single = intervalSet({ sets: 1, workSeconds: 10 });
  assert.deepEqual(single.stages, [{ kind: 'work', seconds: 10, index: 1 }]);
  assert.equal(single.restStages, 0);
  assert.equal(single.totalMinutes, 1, 'a single 10 s bout still books one full minute');
  const noRest = intervalSet({ sets: 2, restSeconds: 5, workSeconds: 30 });
  assert.equal(noRest.label, '2 × 30 s sprints · 5 s recovery', 'the minimum recovery avoids a silent zero-rest mistake');
});

test('inputs are validated instead of inventing shares or durations', () => {
  for (const bad of [
    () => intervalSet({ sets: 0 }),
    () => intervalSet({ sets: 11 }),
    () => intervalSet({ sets: 1.5 }),
    () => intervalSet({ workSeconds: 9 }),
    () => intervalSet({ workSeconds: 301 }),
    () => intervalSet({ workSeconds: 30.5 }),
    () => intervalSet({ restSeconds: 4 }),
    () => intervalSet({ restSeconds: 121 }),
    () => intervalSet({ restSeconds: 15.5 }),
  ]) assert.throws(bad, RangeError);
  assert.deepEqual({ ...SETS_DEFAULTS }, { sets: 3, workSeconds: 30, restSeconds: 15 }, 'defaults are pinned');
});

test('work bouts are practice-only sprint rules, at any set length', () => {
  for (const seconds of [10, 30, 120, 300]) {
    const rules = sprintRules(seconds);
    assert.equal(rules.id, 'custom');
    assert.equal(benchmarkEquivalent(rules), false, `no ${seconds} s work bout can be a benchmark`);
    assert.equal(rules.durationSeconds, seconds);
  }
});

test('the rationale quotes the measured split, only when the split exists', () => {
  assert.equal(intervalSetRationale(null), null, 'no analysis object');
  assert.equal(intervalSetRationale({ runs: 2, halfShift: { runs: 2, ratio: 1.4, ci: null } }), null, 'under 3 standard runs nothing is claimed');
  assert.equal(intervalSetRationale({ runs: 5, halfShift: { runs: 2, ratio: null, ci: null } }), null, 'split needs 3 runs with solves in both halves');
  const grounded = intervalSetRationale({ runs: 9, halfShift: { runs: 9, ratio: 1.18, ci: { low: 1.02, high: 1.4 } } });
  assert.equal(grounded.slowHalf, true);
  assert.equal(grounded.grounded, true);
  assert.equal(grounded.text, 'measured on your verified runs: ×1.18 slower in the second half (95% CI ×1.02–×1.40)');
  const thin = intervalSetRationale({ runs: 4, halfShift: { runs: 4, ratio: 1.3, ci: null } });
  assert.match(thin.text, /interval needs ≥6/, 'a missing interval is named, not hidden');
  const none = intervalSetRationale({ runs: 6, halfShift: { runs: 6, ratio: 0.97, ci: null } });
  assert.equal(none.slowHalf, false);
  assert.match(none.text, /do not currently show a second-half slowdown/, 'no slowdown measured → no treatment claim either');
});
