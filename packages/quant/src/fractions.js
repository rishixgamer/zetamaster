/**
 * Fractions and Decimals Drill Generator & Evaluator (F49).
 * Separate quant generator scaffold; expand exact rational representations.
 */
import { createRng, intBetween, sample } from '../../core/src/rng.js';
import { Rational, isRationalEquivalent, parseRational } from './rational.js';

export const FRACTION_OPS = Object.freeze([
  'add',
  'sub',
  'mul',
  'div',
  'reduce',
  'to-decimal',
  'to-fraction',
  'decimal-mul',
]);

/**
 * Creates a deterministic generator for fraction and decimal exercises.
 */
export function createFractionGenerator(seed = 'fractions') {
  const rng = createRng(seed);
  let sequence = 0;

  return (subOp = null) => {
    const op = subOp || sample(rng, FRACTION_OPS);
    const id = `quant-frac-${++sequence}`;

    switch (op) {
      case 'add': {
        const d1 = intBetween(rng, 2, 12);
        const d2 = intBetween(rng, 2, 12);
        const n1 = intBetween(rng, 1, d1 - 1);
        const n2 = intBetween(rng, 1, d2 - 1);
        const r1 = new Rational(n1, d1);
        const r2 = new Rational(n2, d2);
        const answer = r1.add(r2);
        return {
          id,
          op: 'fraction',
          subOp: 'add',
          expression: `${r1.toString()} + ${r2.toString()} = ?`,
          answer: answer.toString(),
          rationalAnswer: answer,
          acceptedAnswers: [answer.toString(), answer.toDecimalString(4), answer.toMixedString()],
          explanation: `Find common denominator: ${r1.toString()} + ${r2.toString()} = ${answer.toString()}${answer.num > answer.den ? ` (${answer.toMixedString()})` : ''}`,
          mode: 'quant',
        };
      }
      case 'sub': {
        const d1 = intBetween(rng, 2, 12);
        const d2 = intBetween(rng, 2, 12);
        let n1 = intBetween(rng, 1, d1);
        let n2 = intBetween(rng, 1, d2);
        let r1 = new Rational(n1, d1);
        let r2 = new Rational(n2, d2);
        if (r1.compare(r2) < 0) {
          const t = r1;
          r1 = r2;
          r2 = t;
        }
        const answer = r1.sub(r2);
        return {
          id,
          op: 'fraction',
          subOp: 'sub',
          expression: `${r1.toString()} − ${r2.toString()} = ?`,
          answer: answer.toString(),
          rationalAnswer: answer,
          acceptedAnswers: [answer.toString(), answer.toDecimalString(4)],
          explanation: `Subtract with common denominator: ${r1.toString()} − ${r2.toString()} = ${answer.toString()}`,
          mode: 'quant',
        };
      }
      case 'mul': {
        const d1 = intBetween(rng, 2, 10);
        const d2 = intBetween(rng, 2, 10);
        const n1 = intBetween(rng, 1, d1 * 2);
        const n2 = intBetween(rng, 1, d2 * 2);
        const r1 = new Rational(n1, d1);
        const r2 = new Rational(n2, d2);
        const answer = r1.mul(r2);
        return {
          id,
          op: 'fraction',
          subOp: 'mul',
          expression: `${r1.toString()} × ${r2.toString()} = ?`,
          answer: answer.toString(),
          rationalAnswer: answer,
          acceptedAnswers: [answer.toString(), answer.toDecimalString(4), answer.toMixedString()],
          explanation: `Multiply numerators and denominators and simplify: (${r1.num} × ${r2.num}) / (${r1.den} × ${r2.den}) = ${answer.toString()}`,
          mode: 'quant',
        };
      }
      case 'div': {
        const d1 = intBetween(rng, 2, 10);
        const d2 = intBetween(rng, 2, 10);
        const n1 = intBetween(rng, 1, 9);
        const n2 = intBetween(rng, 1, 9);
        const r1 = new Rational(n1, d1);
        const r2 = new Rational(n2, d2);
        const answer = r1.div(r2);
        return {
          id,
          op: 'fraction',
          subOp: 'div',
          expression: `${r1.toString()} ÷ ${r2.toString()} = ?`,
          answer: answer.toString(),
          rationalAnswer: answer,
          acceptedAnswers: [answer.toString(), answer.toDecimalString(4), answer.toMixedString()],
          explanation: `Multiply by reciprocal: ${r1.toString()} × ${r2.inv().toString()} = ${answer.toString()}`,
          mode: 'quant',
        };
      }
      case 'reduce': {
        const factor = intBetween(rng, 2, 8);
        const d = intBetween(rng, 2, 12);
        const n = intBetween(rng, 1, d - 1);
        const r = new Rational(n, d);
        const rawNum = r.num * factor;
        const rawDen = r.den * factor;
        return {
          id,
          op: 'fraction',
          subOp: 'reduce',
          expression: `Reduce ${rawNum}/${rawDen} to lowest terms = ?`,
          answer: r.toString(),
          rationalAnswer: r,
          acceptedAnswers: [r.toString()],
          explanation: `Divide numerator and denominator by gcd(${rawNum}, ${rawDen}) = ${factor}: ${r.toString()}`,
          mode: 'quant',
        };
      }
      case 'to-decimal': {
        // Familiar fractions: halves, quarters, eighths, tenths, fifths, sixteenths
        const commonDens = [2, 4, 5, 8, 10, 16, 20, 25];
        const den = sample(rng, commonDens);
        const num = intBetween(rng, 1, den - 1);
        const r = new Rational(num, den);
        const dec = r.toNumber();
        return {
          id,
          op: 'fraction',
          subOp: 'to-decimal',
          expression: `Express ${r.toString()} as a decimal = ?`,
          answer: `${dec}`,
          rationalAnswer: r,
          acceptedAnswers: [`${dec}`, `0${dec}`],
          explanation: `${r.toString()} = ${num} ÷ ${den} = ${dec}`,
          mode: 'quant',
        };
      }
      case 'to-fraction': {
        const commonDens = [2, 4, 5, 8, 10, 16, 20, 25];
        const den = sample(rng, commonDens);
        const num = intBetween(rng, 1, den - 1);
        const r = new Rational(num, den);
        const dec = r.toNumber();
        return {
          id,
          op: 'fraction',
          subOp: 'to-fraction',
          expression: `Express ${dec} as a reduced fraction = ?`,
          answer: r.toString(),
          rationalAnswer: r,
          acceptedAnswers: [r.toString()],
          explanation: `${dec} = ${r.num}/${r.den}`,
          mode: 'quant',
        };
      }
      case 'decimal-mul':
      default: {
        const a = intBetween(rng, 2, 15);
        const b = intBetween(rng, 2, 25);
        const decA = (a / 10).toFixed(1);
        const decB = (b / 100).toFixed(2);
        const ans = (Number(decA) * Number(decB)).toFixed(3);
        const cleanAns = Number(ans).toString();
        return {
          id,
          op: 'fraction',
          subOp: 'decimal-mul',
          expression: `${decA} × ${decB} = ?`,
          answer: cleanAns,
          rationalAnswer: Rational.from(Number(cleanAns)),
          acceptedAnswers: [cleanAns, ans],
          explanation: `${decA} × ${decB} = ${a} × ${b} / 1000 = ${(a * b) / 1000} = ${cleanAns}`,
          mode: 'quant',
        };
      }
    }
  };
}

/**
 * Validates a user's answer to a fraction question.
 */
export function evaluateFractionAnswer(userInput, question) {
  if (typeof userInput !== 'string' && typeof userInput !== 'number') {
    return { correct: false, explanation: 'Invalid answer input' };
  }
  const str = String(userInput).trim();
  if (!str) return { correct: false, explanation: 'No answer entered' };

  if (question.acceptedAnswers && question.acceptedAnswers.includes(str)) {
    return { correct: true, explanation: question.explanation };
  }

  if (question.rationalAnswer) {
    const isEq = isRationalEquivalent(str, question.rationalAnswer);
    return {
      correct: isEq,
      explanation: isEq ? question.explanation : `Expected ${question.answer}. ${question.explanation}`,
    };
  }

  const cleanExpected = String(question.answer).trim();
  const correct = str === cleanExpected || Number(str) === Number(cleanExpected);
  return {
    correct,
    explanation: correct ? question.explanation : `Expected ${question.answer}. ${question.explanation}`,
  };
}
