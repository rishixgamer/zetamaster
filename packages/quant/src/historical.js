/**
 * Historical 80-in-8 Training (F54).
 * Separate format and scoring based on documented historical question style.
 * Strictly labeled as HISTORICAL; never alters Zetamac standard benchmark metrics.
 */
import { createRng, intBetween, sample } from '../../core/src/rng.js';

export const HISTORICAL_80_IN_8_RULES = Object.freeze({
  id: 'historical-80-in-8',
  label: 'HISTORICAL · 80-in-8 Quant Test',
  description: 'Optiver-style historical quant assessment: 80 questions in 8 minutes with negative marking.',
  durationSeconds: 480, // 8 minutes
  targetQuestions: 80,
  penaltyPerWrong: 1, // -1 point per incorrect attempt
  rewardPerCorrect: 1, // +1 point per correct answer
  mode: 'quant',
  namespace: 'quant-practice',
  benchmarkEquivalent: false,
});

/**
 * Creates a deterministic question generator matching historical 80-in-8 quant tests:
 * includes mixed operations with negative numbers, fractions, decimals, and two-digit multiplication.
 */
export function createHistorical80in8Generator(seed = 'historical-80-in-8') {
  const rng = createRng(seed);
  let sequence = 0;

  return () => {
    sequence++;
    const id = `hist80-${sequence}`;
    const opType = sample(rng, ['add-neg', 'sub-neg', 'mul-twodigit', 'div-neg', 'fraction-sum', 'pct-fast']);

    switch (opType) {
      case 'add-neg': {
        const a = intBetween(rng, -99, 99);
        const b = intBetween(rng, -99, 99);
        const ans = a + b;
        return {
          id,
          sequence,
          op: 'hist-add',
          expression: `${a} + (${b}) = ?`,
          answer: `${ans}`,
          numericAnswer: ans,
          mode: 'quant',
        };
      }
      case 'sub-neg': {
        const a = intBetween(rng, -99, 99);
        const b = intBetween(rng, -99, 99);
        const ans = a - b;
        return {
          id,
          sequence,
          op: 'hist-sub',
          expression: `${a} − (${b}) = ?`,
          answer: `${ans}`,
          numericAnswer: ans,
          mode: 'quant',
        };
      }
      case 'mul-twodigit': {
        const a = intBetween(rng, 12, 35);
        const b = intBetween(rng, 3, 19);
        const ans = a * b;
        return {
          id,
          sequence,
          op: 'hist-mul',
          expression: `${a} × ${b} = ?`,
          answer: `${ans}`,
          numericAnswer: ans,
          mode: 'quant',
        };
      }
      case 'div-neg': {
        const b = intBetween(rng, 3, 16);
        const q = intBetween(rng, -25, 25);
        const a = b * q;
        return {
          id,
          sequence,
          op: 'hist-div',
          expression: `${a} ÷ ${b} = ?`,
          answer: `${q}`,
          numericAnswer: q,
          mode: 'quant',
        };
      }
      case 'fraction-sum': {
        const d = sample(rng, [4, 5, 8, 10]);
        const n1 = intBetween(rng, 1, d - 1);
        const n2 = intBetween(rng, 1, d - 1);
        const sum = n1 + n2;
        // As decimal
        const dec = Number((sum / d).toFixed(3));
        return {
          id,
          sequence,
          op: 'hist-fraction',
          expression: `${n1}/${d} + ${n2}/${d} = ? (decimal)`,
          answer: `${dec}`,
          numericAnswer: dec,
          mode: 'quant',
        };
      }
      case 'pct-fast':
      default: {
        const pct = sample(rng, [5, 10, 15, 20, 25, 50]);
        const base = intBetween(rng, 2, 25) * 20;
        const ans = (pct / 100) * base;
        return {
          id,
          sequence,
          op: 'hist-pct',
          expression: `${pct}% of ${base} = ?`,
          answer: `${ans}`,
          numericAnswer: ans,
          mode: 'quant',
        };
      }
    }
  };
}

/**
 * Evaluates the results of an 80-in-8 session under historical rules.
 */
export function evaluateHistorical80in8Session({ events = [], elapsedMs = 480000 } = {}) {
  let correctCount = 0;
  let wrongCount = 0;

  for (const e of events) {
    if (e.correct === true) {
      correctCount++;
    } else if (e.correct === false || (Array.isArray(e.wrongAttempts) && e.wrongAttempts.length > 0)) {
      wrongCount++;
    }
  }

  const attempted = correctCount + wrongCount;
  const unanswered = Math.max(0, 80 - attempted);
  const netScore = correctCount * HISTORICAL_80_IN_8_RULES.rewardPerCorrect - wrongCount * HISTORICAL_80_IN_8_RULES.penaltyPerWrong;
  const accuracy = attempted > 0 ? Number(((correctCount / attempted) * 100).toFixed(1)) : 0;
  const elapsedMinutes = Math.max(0.1, elapsedMs / 60000);
  const pacePerMin = Number((attempted / elapsedMinutes).toFixed(1));

  return {
    rulesId: HISTORICAL_80_IN_8_RULES.id,
    label: HISTORICAL_80_IN_8_RULES.label,
    isHistorical: true,
    benchmarkEquivalent: false,
    correctCount,
    wrongCount,
    attempted,
    unanswered,
    netScore,
    accuracy,
    pacePerMin,
    elapsedMs,
    targetReached: netScore >= 55, // Typical historical pass cutoff ~55-60 net
    summary: `Historical 80-in-8: ${netScore} net score (${correctCount} correct, ${wrongCount} incorrect, ${accuracy}% accuracy).`,
  };
}
