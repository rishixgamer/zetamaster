import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFinanceGenerator,
  evaluateFinanceAnswer,
  FINANCE_TYPES,
} from '../packages/quant/src/finance.js';

test('createFinanceGenerator produces deterministic problems', () => {
  const f1 = createFinanceGenerator('fin-seed');
  const f2 = createFinanceGenerator('fin-seed');

  for (let i = 0; i < 20; i++) {
    const q1 = f1();
    const q2 = f2();
    assert.deepEqual(q1, q2);
    assert.equal(q1.mode, 'quant');
    assert.equal(q1.op, 'finance');
    assert.ok(q1.expression);
    assert.ok(q1.answer);
  }
});

test('all finance types generate valid questions', () => {
  const f = createFinanceGenerator('types-test');
  for (const t of FINANCE_TYPES) {
    const q = f(t);
    assert.equal(q.subType, t);
    assert.ok(q.expression);
    assert.ok(q.answer);
  }
});

test('evaluateFinanceAnswer validates user inputs', () => {
  const qPct = {
    answer: '25',
    acceptedAnswers: ['25', '25%'],
    explanation: 'Markup calculation',
  };

  assert.ok(evaluateFinanceAnswer('25', qPct).correct);
  assert.ok(evaluateFinanceAnswer('25%', qPct).correct);
  assert.ok(evaluateFinanceAnswer(' 25 % ', qPct).correct);
  assert.ok(!evaluateFinanceAnswer('20', qPct).correct);

  const qMoney = {
    answer: '180',
    acceptedAnswers: ['180', '$180'],
    explanation: 'Interest earned',
  };
  assert.ok(evaluateFinanceAnswer('180', qMoney).correct);
  assert.ok(evaluateFinanceAnswer('$180', qMoney).correct);
  assert.ok(!evaluateFinanceAnswer('200', qMoney).correct);
});
