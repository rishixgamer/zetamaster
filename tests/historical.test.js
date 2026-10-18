import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORICAL_80_IN_8_RULES,
  createHistorical80in8Generator,
  evaluateHistorical80in8Session,
} from '../packages/quant/src/historical.js';

test('HISTORICAL_80_IN_8_RULES is strictly non-benchmark', () => {
  assert.equal(HISTORICAL_80_IN_8_RULES.mode, 'quant');
  assert.equal(HISTORICAL_80_IN_8_RULES.durationSeconds, 480);
  assert.equal(HISTORICAL_80_IN_8_RULES.targetQuestions, 80);
  assert.equal(HISTORICAL_80_IN_8_RULES.benchmarkEquivalent, false);
});

test('createHistorical80in8Generator produces deterministic questions', () => {
  const g1 = createHistorical80in8Generator('hist-seed');
  const g2 = createHistorical80in8Generator('hist-seed');

  for (let i = 0; i < 30; i++) {
    const q1 = g1();
    const q2 = g2();
    assert.deepEqual(q1, q2);
    assert.equal(q1.mode, 'quant');
    assert.ok(q1.expression);
    assert.ok(q1.answer);
  }
});

test('evaluateHistorical80in8Session calculates net score with penalty', () => {
  const events = [
    { correct: true, responseMs: 2500 },
    { correct: true, responseMs: 2100 },
    { correct: true, responseMs: 3000 },
    { correct: false, wrongAttempts: [{ value: '42', atMs: 2000 }], responseMs: 2500 },
    { correct: false, wrongAttempts: [{ value: '18', atMs: 1500 }], responseMs: 2000 },
  ];

  const evalResult = evaluateHistorical80in8Session({ events, elapsedMs: 480000 });
  assert.equal(evalResult.correctCount, 3);
  assert.equal(evalResult.wrongCount, 2);
  assert.equal(evalResult.attempted, 5);
  assert.equal(evalResult.unanswered, 75);
  // Net score = 3 - 2 = 1
  assert.equal(evalResult.netScore, 1);
  assert.equal(evalResult.accuracy, 60.0);
  assert.equal(evalResult.benchmarkEquivalent, false);
});
