/**
 * Probability Arithmetic & Combinatorics (F50).
 * Verified probability and combinatorics drill bank with deterministic checking.
 */
import { createRng, intBetween, sample } from '../../core/src/rng.js';
import { Rational, isRationalEquivalent } from './rational.js';

/** Factorial function with bounds protection. */
export function factorial(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 20) {
    throw new RangeError('Factorial operand must be an integer between 0 and 20');
  }
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/** Permutations P(n, r) = n! / (n - r)! */
export function permutations(n, r) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || n < 0 || r < 0 || r > n) {
    throw new RangeError('Invalid permutations arguments: require 0 <= r <= n');
  }
  let res = 1;
  for (let i = 0; i < r; i++) res *= n - i;
  return res;
}

/** Combinations C(n, r) = n! / (r! * (n - r)!) */
export function combinations(n, r) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || n < 0 || r < 0 || r > n) {
    throw new RangeError('Invalid combinations arguments: require 0 <= r <= n');
  }
  const k = Math.min(r, n - r);
  let num = 1;
  let den = 1;
  for (let i = 1; i <= k; i++) {
    num *= n - i + 1;
    den *= i;
  }
  return Math.round(num / den);
}

export const PROBABILITY_TYPES = Object.freeze([
  'permutations',
  'combinations',
  'coin-flips',
  'dice-sum',
  'card-draw',
  'expected-value',
]);

/**
 * Creates a deterministic probability drill generator.
 */
export function createProbabilityGenerator(seed = 'probability') {
  const rng = createRng(seed);
  let sequence = 0;

  return (subType = null) => {
    const type = subType || sample(rng, PROBABILITY_TYPES);
    const id = `quant-prob-${++sequence}`;

    switch (type) {
      case 'permutations': {
        const n = intBetween(rng, 4, 8);
        const r = intBetween(rng, 2, n);
        const ans = permutations(n, r);
        return {
          id,
          op: 'probability',
          subType: 'permutations',
          expression: `P(${n}, ${r}) [Permutations: ${n} choose ${r} with order] = ?`,
          answer: `${ans}`,
          acceptedAnswers: [`${ans}`],
          explanation: `P(${n}, ${r}) = ${n}! / (${n} − ${r})! = ${ans}`,
          mode: 'quant',
        };
      }
      case 'combinations': {
        const n = intBetween(rng, 4, 10);
        const r = intBetween(rng, 2, n - 1);
        const ans = combinations(n, r);
        return {
          id,
          op: 'probability',
          subType: 'combinations',
          expression: `C(${n}, ${r}) [Combinations: ${n} choose ${r}] = ?`,
          answer: `${ans}`,
          acceptedAnswers: [`${ans}`],
          explanation: `C(${n}, ${r}) = ${n}! / (${r}! × (${n} − ${r})!) = ${ans}`,
          mode: 'quant',
        };
      }
      case 'coin-flips': {
        const flips = intBetween(rng, 3, 5);
        const heads = intBetween(rng, 1, flips - 1);
        const ways = combinations(flips, heads);
        const total = 2 ** flips;
        const rat = new Rational(ways, total);
        const dec = rat.toNumber();
        return {
          id,
          op: 'probability',
          subType: 'coin-flips',
          expression: `Probability of exactly ${heads} heads in ${flips} fair coin flips? (fraction or decimal)`,
          answer: rat.toString(),
          rationalAnswer: rat,
          acceptedAnswers: [rat.toString(), `${ways}/${total}`, `${dec}`, `${dec}`.replace(/^0/, '')],
          explanation: `Ways = C(${flips}, ${heads}) = ${ways}. Total outcomes = 2^${flips} = ${total}. Probability = ${ways}/${total} = ${rat.toString()} (${dec}).`,
          mode: 'quant',
        };
      }
      case 'dice-sum': {
        const targetSum = intBetween(rng, 3, 11);
        // Count ways to roll targetSum with 2 standard 6-sided dice
        let count = 0;
        for (let d1 = 1; d1 <= 6; d1++) {
          for (let d2 = 1; d2 <= 6; d2++) {
            if (d1 + d2 === targetSum) count++;
          }
        }
        const rat = new Rational(count, 36);
        return {
          id,
          op: 'probability',
          subType: 'dice-sum',
          expression: `Probability of rolling a sum of ${targetSum} with two 6-sided dice? (reduced fraction)`,
          answer: rat.toString(),
          rationalAnswer: rat,
          acceptedAnswers: [rat.toString(), `${count}/36`, `${rat.toNumber().toFixed(4)}`],
          explanation: `There are ${count} combinations summing to ${targetSum} out of 36 possible outcomes: ${count}/36 = ${rat.toString()}.`,
          mode: 'quant',
        };
      }
      case 'card-draw': {
        // Probability of drawing 2 cards of same suit, or 2 face cards, etc.
        const suits = ['Hearts', 'Spades', 'Diamonds', 'Clubs'];
        const chosenSuit = sample(rng, suits);
        // Probability of drawing 2 cards of that suit in a row without replacement:
        // 13/52 * 12/51 = 1/4 * 4/17 = 1/17
        const rat = new Rational(1, 17);
        return {
          id,
          op: 'probability',
          subType: 'card-draw',
          expression: `Probability of drawing 2 ${chosenSuit} in a row from a standard 52-card deck without replacement? (reduced fraction)`,
          answer: '1/17',
          rationalAnswer: rat,
          acceptedAnswers: ['1/17', '156/2652', `${(1 / 17).toFixed(4)}`],
          explanation: `(13/52) × (12/51) = (1/4) × (4/17) = 1/17 ≈ 0.0588.`,
          mode: 'quant',
        };
      }
      case 'expected-value':
      default: {
        const win = intBetween(rng, 4, 25);
        const loss = intBetween(rng, 2, 15);
        const winPct = intBetween(rng, 2, 8) * 10; // 20% to 80%
        const lossPct = 100 - winPct;
        const pWin = winPct / 100;
        const pLoss = lossPct / 100;
        const ev = Math.round((win * pWin - loss * pLoss) * 100) / 100;
        const evStr = Number(ev.toFixed(2)).toString();
        return {
          id,
          op: 'probability',
          subType: 'expected-value',
          expression: `Game pays +$${win} with probability ${winPct}%, otherwise −$${loss}. What is the Expected Value (EV) in $?`,
          answer: evStr,
          acceptedAnswers: [evStr, `$${evStr}`, `${ev}`],
          explanation: `EV = (${win} × ${pWin}) − (${loss} × ${pLoss}) = ${win * pWin} − ${loss * pLoss} = $${evStr}.`,
          mode: 'quant',
        };
      }
    }
  };
}

/**
 * Validates a user's answer to a probability question.
 */
export function evaluateProbabilityAnswer(userInput, question) {
  if (typeof userInput !== 'string' && typeof userInput !== 'number') {
    return { correct: false, explanation: 'Invalid answer input' };
  }
  const str = String(userInput).trim().replace(/^\$/, '');
  if (!str) return { correct: false, explanation: 'No answer entered' };

  if (question.acceptedAnswers && question.acceptedAnswers.some(a => a.replace(/^\$/, '') === str)) {
    return { correct: true, explanation: question.explanation };
  }

  if (question.rationalAnswer) {
    const isEq = isRationalEquivalent(str, question.rationalAnswer);
    return {
      correct: isEq,
      explanation: isEq ? question.explanation : `Expected ${question.answer}. ${question.explanation}`,
    };
  }

  const cleanExpected = String(question.answer).trim().replace(/^\$/, '');
  const correct = str === cleanExpected || Math.abs(Number(str) - Number(cleanExpected)) < 1e-4;
  return {
    correct,
    explanation: correct ? question.explanation : `Expected ${question.answer}. ${question.explanation}`,
  };
}
