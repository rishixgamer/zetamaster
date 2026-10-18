/**
 * Estimation Training (F52).
 * Range-based tolerance with verified numerical bounds and step-by-step justification.
 */
import { createRng, intBetween, sample } from '../../core/src/rng.js';

export const ESTIMATION_TYPES = Object.freeze([
  'large-product',
  'large-division',
  'square-root',
  'power',
  'fermi',
]);

/**
 * Creates a deterministic estimation drill generator.
 */
export function createEstimationGenerator(seed = 'estimation') {
  const rng = createRng(seed);
  let sequence = 0;

  return (subType = null, tolerance = 0.08) => {
    const type = subType || sample(rng, ESTIMATION_TYPES);
    const id = `quant-est-${++sequence}`;

    switch (type) {
      case 'large-product': {
        const a = intBetween(rng, 150, 950);
        const b = intBetween(rng, 120, 850);
        const trueValue = a * b;
        const lowerBound = Math.round(trueValue * (1 - tolerance));
        const upperBound = Math.round(trueValue * (1 + tolerance));

        // Rounding heuristic for explanation
        const roundA = Math.round(a / 10) * 10;
        const roundB = Math.round(b / 10) * 10;
        const heuristic = roundA * roundB;

        return {
          id,
          op: 'estimation',
          subType: 'large-product',
          expression: `Estimate: ${a} × ${b} (tolerance ±${Math.round(tolerance * 100)}%)`,
          trueValue,
          tolerance,
          lowerBound,
          upperBound,
          explanation: `True value: ${trueValue.toLocaleString()}. Acceptable range: [${lowerBound.toLocaleString()} – ${upperBound.toLocaleString()}]. Approximation method: round to 2 sig figs: ${roundA} × ${roundB} = ${heuristic.toLocaleString()}.`,
          mode: 'quant',
        };
      }
      case 'large-division': {
        const divisor = intBetween(rng, 15, 85);
        const quotient = intBetween(rng, 120, 750);
        const dividend = divisor * quotient + intBetween(rng, 0, divisor - 1);
        const trueValue = Math.round((dividend / divisor) * 10) / 10;
        const lowerBound = Math.round(trueValue * (1 - tolerance) * 10) / 10;
        const upperBound = Math.round(trueValue * (1 + tolerance) * 10) / 10;

        return {
          id,
          op: 'estimation',
          subType: 'large-division',
          expression: `Estimate: ${dividend.toLocaleString()} ÷ ${divisor} (tolerance ±${Math.round(tolerance * 100)}%)`,
          trueValue,
          tolerance,
          lowerBound,
          upperBound,
          explanation: `True value: ${trueValue.toLocaleString()}. Acceptable range: [${lowerBound} – ${upperBound}]. Approximation: ${Math.round(dividend / 100) * 100} ÷ ${Math.round(divisor / 10) * 10} ≈ ${Math.round((dividend / divisor))}.`,
          mode: 'quant',
        };
      }
      case 'square-root': {
        const base = intBetween(rng, 120, 850);
        const squared = base * base + intBetween(rng, -base, base);
        const trueValue = Math.round(Math.sqrt(squared) * 100) / 100;
        const lowerBound = Math.round(trueValue * (1 - tolerance) * 10) / 10;
        const upperBound = Math.round(trueValue * (1 + tolerance) * 10) / 10;

        return {
          id,
          op: 'estimation',
          subType: 'square-root',
          expression: `Estimate: √${squared.toLocaleString()} (tolerance ±${Math.round(tolerance * 100)}%)`,
          trueValue,
          tolerance,
          lowerBound,
          upperBound,
          explanation: `True value: ${trueValue}. Acceptable range: [${lowerBound} – ${upperBound}]. Nearest clean square: ${Math.round(base / 10) * 10}² = ${(Math.round(base / 10) * 10) ** 2}.`,
          mode: 'quant',
        };
      }
      case 'power': {
        const base = intBetween(rng, 11, 25);
        const exp = intBetween(rng, 3, 4);
        const trueValue = base ** exp;
        const lowerBound = Math.round(trueValue * (1 - tolerance));
        const upperBound = Math.round(trueValue * (1 + tolerance));

        return {
          id,
          op: 'estimation',
          subType: 'power',
          expression: `Estimate: ${base}^${exp} (tolerance ±${Math.round(tolerance * 100)}%)`,
          trueValue,
          tolerance,
          lowerBound,
          upperBound,
          explanation: `True value: ${trueValue.toLocaleString()}. Acceptable range: [${lowerBound.toLocaleString()} – ${upperBound.toLocaleString()}].`,
          mode: 'quant',
        };
      }
      case 'fermi':
      default: {
        const days = intBetween(rng, 5, 30);
        const trueValue = days * 24 * 3600; // seconds
        const lowerBound = Math.round(trueValue * (1 - tolerance));
        const upperBound = Math.round(trueValue * (1 + tolerance));

        return {
          id,
          op: 'estimation',
          subType: 'fermi',
          expression: `Estimate: Number of seconds in ${days} days (tolerance ±${Math.round(tolerance * 100)}%)`,
          trueValue,
          tolerance,
          lowerBound,
          upperBound,
          explanation: `True value: ${trueValue.toLocaleString()} seconds. Acceptable range: [${lowerBound.toLocaleString()} – ${upperBound.toLocaleString()}]. Method: 1 day ≈ 86,400 s ≈ 8.6 × 10⁴ s. ${days} × 86,400 = ${trueValue.toLocaleString()}.`,
          mode: 'quant',
        };
      }
    }
  };
}

/**
 * Evaluates an estimation guess against verified bounds.
 */
export function evaluateEstimate(userGuess, question) {
  const guess = typeof userGuess === 'number' ? userGuess : Number(String(userGuess).replace(/,/g, '').trim());
  if (!Number.isFinite(guess)) {
    return {
      correct: false,
      errorPercent: null,
      explanation: 'Please enter a valid numeric estimate.',
    };
  }

  const { trueValue, lowerBound, upperBound, tolerance, explanation } = question;
  const absDiff = Math.abs(guess - trueValue);
  const relativeError = absDiff / Math.abs(trueValue);
  const errorPercent = Number((relativeError * 100).toFixed(2));
  const withinBounds = guess >= lowerBound && guess <= upperBound;

  return {
    correct: withinBounds,
    guess,
    trueValue,
    lowerBound,
    upperBound,
    errorPercent,
    tolerancePercent: Math.round(tolerance * 100),
    explanation: withinBounds
      ? `Accurate estimate! Your guess ${guess.toLocaleString()} is within ${errorPercent}% of true value (${trueValue.toLocaleString()}). ${explanation}`
      : `Outside tolerance. Your guess ${guess.toLocaleString()} has ${errorPercent}% error (target ±${Math.round(tolerance * 100)}%). ${explanation}`,
  };
}
