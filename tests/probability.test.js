import test from 'node:test';
import assert from 'node:assert/strict';
import {
  factorial,
  permutations,
  combinations,
  createProbabilityGenerator,
  evaluateProbabilityAnswer,
  PROBABILITY_TYPES,
} from '../packages/quant/src/probability.js';

test('combinatorics math functions', () => {
  assert.equal(factorial(0), 1);
  assert.equal(factorial(1), 1);
  assert.equal(factorial(5), 120);
  assert.equal(factorial(7), 5040);
  assert.throws(() => factorial(-1), RangeError);
  assert.throws(() => factorial(25), RangeError);

  assert.equal(permutations(5, 2), 20);
  assert.equal(permutations(6, 3), 120);
  assert.equal(permutations(4, 0), 1);
  assert.throws(() => permutations(3, 5), RangeError);

  assert.equal(combinations(5, 2), 10);
  assert.equal(combinations(7, 3), 35);
  assert.equal(combinations(10, 0), 1);
  assert.equal(combinations(10, 10), 1);
  assert.throws(() => combinations(2, 4), RangeError);
});

test('createProbabilityGenerator produces deterministic questions', () => {
  const g1 = createProbabilityGenerator('prob-seed');
  const g2 = createProbabilityGenerator('prob-seed');

  for (let i = 0; i < 20; i++) {
    const q1 = g1();
    const q2 = g2();
    assert.deepEqual(q1, q2);
    assert.equal(q1.mode, 'quant');
    assert.equal(q1.op, 'probability');
    assert.ok(q1.expression);
    assert.ok(q1.answer);
  }
});

test('all probability subtypes generate valid problems', () => {
  const g = createProbabilityGenerator('all-types');
  for (const t of PROBABILITY_TYPES) {
    const q = g(t);
    assert.equal(q.subType, t);
    assert.ok(q.expression);
    assert.ok(q.answer);
  }
});

test('evaluateProbabilityAnswer validates solutions accurately', () => {
  const qEV = {
    answer: '3.5',
    acceptedAnswers: ['3.5', '$3.5', '3.50', '$3.50'],
    explanation: 'EV calculation',
  };

  assert.ok(evaluateProbabilityAnswer('3.5', qEV).correct);
  assert.ok(evaluateProbabilityAnswer('$3.50', qEV).correct);
  assert.ok(evaluateProbabilityAnswer('3.50', qEV).correct);
  assert.ok(!evaluateProbabilityAnswer('4.0', qEV).correct);
  assert.ok(!evaluateProbabilityAnswer('bad', qEV).correct);
});
