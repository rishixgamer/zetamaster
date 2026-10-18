import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRunningChain,
  evaluateRunningStep,
  evaluateRunningChain,
} from '../packages/quant/src/running.js';

test('generateRunningChain produces valid integer intermediate results', () => {
  const chain1 = generateRunningChain({ length: 6, seed: 'chain-test' });
  const chain2 = generateRunningChain({ length: 6, seed: 'chain-test' });

  assert.deepEqual(chain1, chain2);
  assert.equal(chain1.steps.length, 6);
  assert.equal(chain1.mode, 'quant');

  // Verify sequential integrity
  let current = chain1.initialValue;
  for (const step of chain1.steps) {
    assert.equal(step.prevValue, current);
    assert.ok(Number.isSafeInteger(step.intermediateAnswer));
    assert.ok(step.intermediateAnswer >= 1);
    current = step.intermediateAnswer;
  }
  assert.equal(chain1.finalAnswer, current);
});

test('evaluateRunningStep accurately checks step calculation', () => {
  const step = {
    prevValue: 20,
    symbol: '+',
    operand: 15,
    intermediateAnswer: 35,
  };

  assert.ok(evaluateRunningStep('35', step).correct);
  assert.ok(evaluateRunningStep(35, step).correct);
  assert.ok(!evaluateRunningStep('30', step).correct);
  assert.ok(!evaluateRunningStep('bad', step).correct);
});

test('evaluateRunningChain checks final answer', () => {
  const chain = {
    finalAnswer: 42,
    fullExpression: 'Start with 10: + 20 × 2 − 18',
  };

  assert.ok(evaluateRunningChain('42', chain).correct);
  assert.ok(evaluateRunningChain(42, chain).correct);
  assert.ok(!evaluateRunningChain('40', chain).correct);
  assert.ok(!evaluateRunningChain('xyz', chain).correct);
});
