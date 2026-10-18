import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignStrategyTrial,
  createBalancedExperiment,
  analyzeExperimentOutcomes,
  MIN_TRIALS_PER_ARM,
} from '../packages/training/src/experiment.js';

// Arithmetic strategy experiments (F42, M4):
// Seeded A/B assignment exists; add balanced items and outcome testing.

test('assignStrategyTrial retains backward-compatible deterministic parity assignment', () => {
  assert.equal(assignStrategyTrial('user-1', 0), assignStrategyTrial('user-1', 2));
  assert.notEqual(assignStrategyTrial('user-1', 0), assignStrategyTrial('user-1', 1));
});

test('createBalancedExperiment generates matched, counterbalanced items across arms', () => {
  const exp = createBalancedExperiment({
    name: 'round-vs-left-add',
    strategyA: 'addition-round',
    strategyB: 'addition-left',
    op: 'add',
    seed: 'ab-seed-123',
    itemCount: 12,
  });

  assert.equal(exp.itemCount, 12);
  assert.equal(exp.armACount, 6);
  assert.equal(exp.armBCount, 6);

  // Each item has valid problem structure and correct answer
  for (const item of exp.items) {
    assert.ok(item.arm === 'A' || item.arm === 'B');
    assert.equal(item.strategy, item.arm === 'A' ? 'addition-round' : 'addition-left');
    assert.equal(item.problem.expectedAnswer, item.problem.a + item.problem.b);
  }

  // Same seed reproduces exact experiment
  const again = createBalancedExperiment({
    name: 'round-vs-left-add',
    strategyA: 'addition-round',
    strategyB: 'addition-left',
    op: 'add',
    seed: 'ab-seed-123',
    itemCount: 12,
  });
  assert.deepEqual(exp, again);
});

test('createBalancedExperiment supports subtraction, multiplication, and division', () => {
  for (const op of ['sub', 'mul', 'div']) {
    const exp = createBalancedExperiment({ op, seed: `exp-${op}`, itemCount: 8 });
    assert.equal(exp.itemCount, 8);
    assert.equal(exp.armACount, 4);
    assert.equal(exp.armBCount, 4);

    for (const item of exp.items) {
      if (op === 'sub') {
        assert.equal(item.problem.expectedAnswer, item.problem.a - item.problem.b);
      } else if (op === 'mul') {
        assert.equal(item.problem.expectedAnswer, item.problem.a * item.problem.b);
      } else if (op === 'div') {
        assert.equal(item.problem.expectedAnswer, item.problem.a / item.problem.b);
      }
    }
  }
});

test('analyzeExperimentOutcomes requires minimum sample size per arm', () => {
  // Only 2 trials in Arm A, 3 in Arm B (Arm A below gate)
  const thinTrials = [
    { arm: 'A', correct: true, responseMs: 1200 },
    { arm: 'A', correct: true, responseMs: 1300 },
    { arm: 'B', correct: true, responseMs: 1500 },
    { arm: 'B', correct: true, responseMs: 1600 },
    { arm: 'B', correct: true, responseMs: 1400 },
  ];

  const res = analyzeExperimentOutcomes(thinTrials);
  assert.equal(res.status, 'insufficient-data');
  assert.equal(res.minTrialsPerArm, MIN_TRIALS_PER_ARM);
  assert.match(res.reason, /valid trials per arm required/);
});

test('analyzeExperimentOutcomes calculates latency difference, accuracy, and effect summary', () => {
  // Arm A faster (median 1200ms), Arm B slower (median 1600ms)
  const trials = [
    { arm: 'A', correct: true, responseMs: 1100 },
    { arm: 'A', correct: true, responseMs: 1200 },
    { arm: 'A', correct: true, responseMs: 1300 },
    { arm: 'A', correct: true, responseMs: 1250 },
    { arm: 'B', correct: true, responseMs: 1500 },
    { arm: 'B', correct: true, responseMs: 1600 },
    { arm: 'B', correct: true, responseMs: 1700 },
    { arm: 'B', correct: false, responseMs: 1900 },
  ];

  const outcome = analyzeExperimentOutcomes(trials);
  assert.equal(outcome.status, 'analyzed');
  assert.equal(outcome.sampleSizes.armA, 4);
  assert.equal(outcome.sampleSizes.armB, 4);
  assert.equal(outcome.accuracy.armA, 1.0);
  assert.equal(outcome.accuracy.armB, 0.75);
  assert.equal(outcome.fasterArm, 'A');
  assert.equal(outcome.moreAccurateArm, 'A');
  assert.ok(outcome.medianResponseMs.latencyDiffMs > 0);
  assert.ok(outcome.limitation.includes('Experimental outcome'));
});
