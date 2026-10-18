import test from 'node:test';
import assert from 'node:assert/strict';
import { createFractionGenerator, evaluateFractionAnswer, FRACTION_OPS } from '../packages/quant/src/fractions.js';
import { Rational } from '../packages/quant/src/rational.js';

test('createFractionGenerator produces valid deterministic questions across all operations', () => {
  const gen1 = createFractionGenerator('frac-seed');
  const gen2 = createFractionGenerator('frac-seed');

  for (let i = 0; i < 20; i++) {
    const q1 = gen1();
    const q2 = gen2();
    assert.deepEqual(q1, q2);
    assert.equal(q1.mode, 'quant');
    assert.equal(q1.op, 'fraction');
    assert.ok(q1.expression.length > 5);
    assert.ok(q1.answer);
    assert.ok(q1.explanation);
  }
});

test('sub-operation coverage for fractions generator', () => {
  const gen = createFractionGenerator('ops-seed');
  for (const op of FRACTION_OPS) {
    const q = gen(op);
    assert.equal(q.subOp, op);
    assert.ok(q.expression);
    assert.ok(q.answer);
  }
});

test('evaluateFractionAnswer accurately judges answers', () => {
  const qAdd = {
    answer: '5/6',
    rationalAnswer: new Rational(5, 6),
    acceptedAnswers: ['5/6', '0.8333'],
    explanation: 'Find common denominator',
  };

  assert.ok(evaluateFractionAnswer('5/6', qAdd).correct);
  assert.ok(evaluateFractionAnswer('10/12', qAdd).correct); // unreduced
  assert.ok(evaluateFractionAnswer('0.8333', qAdd).correct);
  assert.ok(!evaluateFractionAnswer('1/2', qAdd).correct);
  assert.ok(!evaluateFractionAnswer('', qAdd).correct);
  assert.ok(!evaluateFractionAnswer('invalid', qAdd).correct);
});
