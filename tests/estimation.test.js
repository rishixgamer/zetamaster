import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEstimationGenerator,
  evaluateEstimate,
  ESTIMATION_TYPES,
} from '../packages/quant/src/estimation.js';

test('createEstimationGenerator produces bounded problems', () => {
  const e1 = createEstimationGenerator('est-seed');
  const e2 = createEstimationGenerator('est-seed');

  for (let i = 0; i < 20; i++) {
    const q1 = e1();
    const q2 = e2();
    assert.deepEqual(q1, q2);
    assert.equal(q1.mode, 'quant');
    assert.equal(q1.op, 'estimation');
    assert.ok(q1.lowerBound < q1.upperBound);
    assert.ok(q1.trueValue >= q1.lowerBound * 0.99);
    assert.ok(q1.trueValue <= q1.upperBound * 1.01);
  }
});

test('all estimation types generate valid problems', () => {
  const e = createEstimationGenerator('all-types');
  for (const t of ESTIMATION_TYPES) {
    const q = e(t);
    assert.equal(q.subType, t);
    assert.ok(q.expression);
    assert.ok(q.trueValue > 0);
  }
});

test('evaluateEstimate tests range boundaries and error calculation', () => {
  const q = {
    trueValue: 1000,
    lowerBound: 900,
    upperBound: 1100,
    tolerance: 0.1,
    explanation: 'Test justification',
  };

  // Exactly on true value
  const rExact = evaluateEstimate(1000, q);
  assert.ok(rExact.correct);
  assert.equal(rExact.errorPercent, 0);

  // Within bounds
  const rGood = evaluateEstimate('950', q);
  assert.ok(rGood.correct);
  assert.equal(rGood.errorPercent, 5);

  // Lower edge
  assert.ok(evaluateEstimate(900, q).correct);
  // Upper edge
  assert.ok(evaluateEstimate(1100, q).correct);

  // Outside bounds
  const rLow = evaluateEstimate(850, q);
  assert.ok(!rLow.correct);
  assert.equal(rLow.errorPercent, 15);

  const rHigh = evaluateEstimate(1200, q);
  assert.ok(!rHigh.correct);
  assert.equal(rHigh.errorPercent, 20);

  // Invalid input
  const rBad = evaluateEstimate('not a number', q);
  assert.ok(!rBad.correct);
});
