import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateInputBaseline,
  generateCopyTrials,
  evaluateCopyTrial,
  computeHardwareDiagnostics,
} from '../packages/core/src/calibration.js';

// Hardware calibration (F40, M4):
// Baseline computation exists; add independent number-copying interface.

test('estimateInputBaseline preserves original backward-compatible baseline computation', () => {
  const trials = [{ ms: 200 }, { ms: 250 }, { ms: 180 }];
  const baseline = estimateInputBaseline(trials);
  assert.equal(baseline.sampleSize, 3);
  assert.equal(baseline.medianMs, 200);
  assert.ok(baseline.limitation.length > 10);
  assert.equal(estimateInputBaseline([]), null);
});

test('generateCopyTrials produces deterministic number-copying prompt bank', () => {
  const bankA = generateCopyTrials('calib-seed-1', 10);
  const bankB = generateCopyTrials('calib-seed-1', 10);
  assert.deepEqual(bankA, bankB, 'same seed produces identical trial bank');
  assert.equal(bankA.length, 10);

  for (const trial of bankA) {
    assert.ok(trial.id.startsWith('copy-'));
    assert.equal(typeof trial.prompt, 'string');
    assert.equal(trial.prompt, trial.expected);
    assert.ok(/^\d+$/.test(trial.prompt), 'prompt contains digits only');
    assert.equal(trial.digits, trial.prompt.length);
  }

  // Different seed produces varied prompts
  const bankC = generateCopyTrials('calib-seed-2', 10);
  const distinctPrompts = new Set([...bankA.map(t => t.prompt), ...bankC.map(t => t.prompt)]);
  assert.ok(distinctPrompts.size > 10);
});

test('evaluateCopyTrial checks exact match and records latency', () => {
  const trial = { id: 'copy-1', prompt: '48', expected: '48', digits: 2 };

  const correct = evaluateCopyTrial(trial, '48', 215);
  assert.equal(correct.correct, true);
  assert.equal(correct.ms, 215);
  assert.equal(correct.typed, '48');

  // Trimming whitespace is allowed
  const trimmed = evaluateCopyTrial(trial, '  48  ', 220);
  assert.equal(trimmed.correct, true);

  // Mismatched value is marked incorrect
  const wrong = evaluateCopyTrial(trial, '47', 190);
  assert.equal(wrong.correct, false);

  assert.equal(evaluateCopyTrial(null, '48', 200), null);
});

test('computeHardwareDiagnostics aggregates typing speed, distribution, and char rates', () => {
  const trialResults = [
    { ms: 180, correct: true, digits: 2 },
    { ms: 220, correct: true, digits: 2 },
    { ms: 200, correct: true, digits: 2 },
    { ms: 300, correct: true, digits: 3 },
    { ms: 150, correct: false, digits: 2 },
  ];

  const diag = computeHardwareDiagnostics(trialResults);
  assert.ok(diag);
  assert.equal(diag.sampleSize, 5);
  assert.equal(diag.correctCount, 4);
  assert.equal(diag.accuracy, 0.8);
  assert.equal(diag.medianMs, 200);
  assert.ok(Number.isFinite(diag.msPerDigit));
  assert.ok(diag.limitation.includes('Copy-typing'));

  assert.equal(computeHardwareDiagnostics([]), null);
});
