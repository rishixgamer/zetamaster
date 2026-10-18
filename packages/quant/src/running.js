/**
 * Stateful Running Arithmetic (F53).
 * Stateful sequence generator with deterministic intermediate and final answers.
 */
import { createRng, intBetween, sample } from '../../core/src/rng.js';

export const RUNNING_OPS = Object.freeze(['add', 'sub', 'mul', 'div']);
const OP_SYMBOLS = { add: '+', sub: '−', mul: '×', div: '÷' };

/**
 * Generates a stateful running arithmetic sequence.
 * Guarantees all intermediate values are clean integers, >= 1, and reasonably bounded.
 */
export function generateRunningChain({ length = 5, seed = 'running-chain' } = {}) {
  const rng = createRng(seed);
  const stepsCount = Math.max(2, Math.min(10, length));
  let current = intBetween(rng, 10, 40);
  const initialValue = current;
  const steps = [];

  for (let i = 0; i < stepsCount; i++) {
    // Choose operation based on current value to keep numbers friendly for mental calculation
    let op;
    if (current > 150) {
      op = sample(rng, ['sub', 'div']);
    } else if (current < 15) {
      op = sample(rng, ['add', 'mul']);
    } else {
      op = sample(rng, RUNNING_OPS);
    }

    let operand;
    let nextValue;

    if (op === 'add') {
      operand = intBetween(rng, 5, 35);
      nextValue = current + operand;
    } else if (op === 'sub') {
      operand = intBetween(rng, 5, Math.min(35, current - 2));
      nextValue = current - operand;
    } else if (op === 'mul') {
      operand = intBetween(rng, 2, 5);
      nextValue = current * operand;
    } else {
      // Division: must divide evenly
      const divisors = [];
      for (let d = 2; d <= 9; d++) {
        if (current % d === 0) divisors.push(d);
      }
      if (divisors.length > 0) {
        operand = sample(rng, divisors);
        nextValue = current / operand;
      } else {
        // Fallback to addition if no clean divisor
        op = 'add';
        operand = intBetween(rng, 5, 25);
        nextValue = current + operand;
      }
    }

    steps.push({
      stepIndex: i + 1,
      op,
      symbol: OP_SYMBOLS[op],
      operand,
      prevValue: current,
      intermediateAnswer: nextValue,
      expression: `${OP_SYMBOLS[op]} ${operand}`,
    });

    current = nextValue;
  }

  // Construct full left-to-right chain expression
  const fullExpression = `Start with ${initialValue}: ` + steps.map(s => `${s.symbol} ${s.operand}`).join(' ');

  return {
    id: `quant-running-${seed}`,
    initialValue,
    steps,
    finalAnswer: current,
    fullExpression,
    length: stepsCount,
    mode: 'quant',
  };
}

/**
 * Evaluates an individual step in a running arithmetic session.
 */
export function evaluateRunningStep(userAnswer, step) {
  const parsed = Number(String(userAnswer).trim());
  if (!Number.isSafeInteger(parsed)) {
    return { correct: false, explanation: 'Please enter a valid integer.' };
  }
  const isCorrect = parsed === step.intermediateAnswer;
  return {
    correct: isCorrect,
    userAnswer: parsed,
    expected: step.intermediateAnswer,
    explanation: isCorrect
      ? `Correct: ${step.prevValue} ${step.symbol} ${step.operand} = ${step.intermediateAnswer}`
      : `Incorrect: ${step.prevValue} ${step.symbol} ${step.operand} = ${step.intermediateAnswer} (you entered ${parsed})`,
  };
}

/**
 * Evaluates the final answer of a complete running chain.
 */
export function evaluateRunningChain(userAnswer, chain) {
  const parsed = Number(String(userAnswer).trim());
  if (!Number.isSafeInteger(parsed)) {
    return { correct: false, explanation: 'Please enter a valid integer.' };
  }
  const isCorrect = parsed === chain.finalAnswer;
  return {
    correct: isCorrect,
    userAnswer: parsed,
    expected: chain.finalAnswer,
    explanation: isCorrect
      ? `Correct! Final result is ${chain.finalAnswer}.`
      : `Incorrect. Final result is ${chain.finalAnswer} (you entered ${parsed}). Steps: ${chain.fullExpression}`,
  };
}
