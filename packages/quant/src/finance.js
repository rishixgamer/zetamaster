/**
 * Percentages and Financial Arithmetic (F51).
 * Percentages, basis points, markups, margins, interest, and Rule of 72 with explicit feedback.
 */
import { createRng, intBetween, sample } from '../../core/src/rng.js';

export const FINANCE_TYPES = Object.freeze([
  'pct-of',
  'pct-increase',
  'pct-decrease',
  'basis-points-to-pct',
  'pct-to-basis-points',
  'markup-vs-margin',
  'simple-interest',
  'rule-of-72',
]);

/**
 * Creates a deterministic generator for finance and percentage exercises.
 */
export function createFinanceGenerator(seed = 'finance') {
  const rng = createRng(seed);
  let sequence = 0;

  return (subType = null) => {
    const type = subType || sample(rng, FINANCE_TYPES);
    const id = `quant-fin-${++sequence}`;

    switch (type) {
      case 'pct-of': {
        const pct = sample(rng, [5, 10, 15, 20, 25, 30, 35, 40, 50, 75]);
        const base = intBetween(rng, 2, 20) * 20;
        const ans = (pct / 100) * base;
        return {
          id,
          op: 'finance',
          subType: 'pct-of',
          expression: `What is ${pct}% of ${base}?`,
          answer: `${ans}`,
          acceptedAnswers: [`${ans}`],
          explanation: `${pct}% × ${base} = (${pct} / 100) × ${base} = ${ans}`,
          mode: 'quant',
        };
      }
      case 'pct-increase': {
        const base = intBetween(rng, 2, 10) * 25; // 50, 75, 100...
        const pct = sample(rng, [10, 20, 25, 30, 40, 50]);
        const finalVal = base * (1 + pct / 100);
        return {
          id,
          op: 'finance',
          subType: 'pct-increase',
          expression: `Price increases from $${base} to $${finalVal}. What is the percentage increase?`,
          answer: `${pct}`,
          acceptedAnswers: [`${pct}`, `${pct}%`],
          explanation: `Change = ${finalVal} − ${base} = ${finalVal - base}. Pct increase = (${finalVal - base} / ${base}) × 100% = ${pct}%.`,
          mode: 'quant',
        };
      }
      case 'pct-decrease': {
        const base = intBetween(rng, 2, 10) * 25;
        const pct = sample(rng, [10, 20, 25, 30, 40, 50]);
        const finalVal = base * (1 - pct / 100);
        return {
          id,
          op: 'finance',
          subType: 'pct-decrease',
          expression: `Value falls from $${base} to $${finalVal}. What is the percentage decrease?`,
          answer: `${pct}`,
          acceptedAnswers: [`${pct}`, `${pct}%`],
          explanation: `Change = ${base} − ${finalVal} = ${base - finalVal}. Pct decrease = (${base - finalVal} / ${base}) × 100% = ${pct}%.`,
          mode: 'quant',
        };
      }
      case 'basis-points-to-pct': {
        const bps = intBetween(rng, 5, 80) * 5; // 25 to 400 bps
        const pct = bps / 100;
        return {
          id,
          op: 'finance',
          subType: 'basis-points-to-pct',
          expression: `Convert ${bps} basis points (bps) to percentage:`,
          answer: `${pct}`,
          acceptedAnswers: [`${pct}`, `${pct}%`],
          explanation: `1 basis point = 0.01%. ${bps} bps = ${bps} / 100 = ${pct}%.`,
          mode: 'quant',
        };
      }
      case 'pct-to-basis-points': {
        const pct = sample(rng, [0.25, 0.5, 0.75, 1.25, 1.5, 2.0, 2.75, 3.5]);
        const bps = Math.round(pct * 100);
        return {
          id,
          op: 'finance',
          subType: 'pct-to-basis-points',
          expression: `Convert ${pct}% to basis points (bps):`,
          answer: `${bps}`,
          acceptedAnswers: [`${bps}`, `${bps} bps`],
          explanation: `1% = 100 bps. ${pct}% × 100 = ${bps} bps.`,
          mode: 'quant',
        };
      }
      case 'markup-vs-margin': {
        // e.g. Cost 80, Sell 100 -> Profit 20. Markup = 20/80 = 25%. Margin = 20/100 = 20%.
        const cost = sample(rng, [40, 50, 60, 80, 100]);
        const markupPct = sample(rng, [20, 25, 50, 100]);
        const profit = (cost * markupPct) / 100;
        const price = cost + profit;
        const marginPct = (profit / price) * 100;
        const askMarkup = rng() > 0.5;

        if (askMarkup) {
          return {
            id,
            op: 'finance',
            subType: 'markup-vs-margin',
            expression: `Cost is $${cost} and selling price is $${price}. What is the markup percentage?`,
            answer: `${markupPct}`,
            acceptedAnswers: [`${markupPct}`, `${markupPct}%`],
            explanation: `Markup = (Price − Cost) / Cost = ($${price} − $${cost}) / $${cost} = $${profit} / $${cost} = ${markupPct}%.`,
            mode: 'quant',
          };
        }
        return {
          id,
          op: 'finance',
          subType: 'markup-vs-margin',
          expression: `Cost is $${cost} and selling price is $${price}. What is the profit margin percentage?`,
          answer: `${marginPct}`,
          acceptedAnswers: [`${marginPct}`, `${marginPct}%`],
          explanation: `Profit Margin = (Price − Cost) / Price = ($${price} − $${cost}) / $${price} = $${profit} / $${price} = ${marginPct}%.`,
          mode: 'quant',
        };
      }
      case 'simple-interest': {
        const principal = intBetween(rng, 2, 20) * 100; // $200 - $2000
        const rate = sample(rng, [3, 4, 5, 6, 8, 10]);
        const years = intBetween(rng, 2, 5);
        const interest = (principal * rate * years) / 100;
        return {
          id,
          op: 'finance',
          subType: 'simple-interest',
          expression: `$${principal} invested at ${rate}% simple annual interest for ${years} years. Total interest earned ($)?`,
          answer: `${interest}`,
          acceptedAnswers: [`${interest}`, `$${interest}`],
          explanation: `Interest = P × r × t = $${principal} × ${rate / 100} × ${years} = $${interest}.`,
          mode: 'quant',
        };
      }
      case 'rule-of-72':
      default: {
        const rate = sample(rng, [4, 6, 8, 9, 12]);
        const years = 72 / rate;
        return {
          id,
          op: 'finance',
          subType: 'rule-of-72',
          expression: `According to the Rule of 72, at a ${rate}% annual compounding rate, roughly how many years to double?`,
          answer: `${years}`,
          acceptedAnswers: [`${years}`, `${years} years`],
          explanation: `Rule of 72: Years to double ≈ 72 / rate = 72 / ${rate} = ${years} years.`,
          mode: 'quant',
        };
      }
    }
  };
}

/**
 * Validates a user's answer to a finance question.
 */
export function evaluateFinanceAnswer(userInput, question) {
  if (typeof userInput !== 'string' && typeof userInput !== 'number') {
    return { correct: false, explanation: 'Invalid answer input' };
  }
  const clean = String(userInput).trim().replace(/[%\$]/g, '').trim();
  if (!clean) return { correct: false, explanation: 'No answer entered' };

  if (question.acceptedAnswers && question.acceptedAnswers.some(a => a.replace(/[%\$]/g, '').trim() === clean)) {
    return { correct: true, explanation: question.explanation };
  }

  const cleanExpected = String(question.answer).replace(/[%\$]/g, '').trim();
  const correct = clean === cleanExpected || Math.abs(Number(clean) - Number(cleanExpected)) < 1e-4;
  return {
    correct,
    explanation: correct ? question.explanation : `Expected ${question.answer}. ${question.explanation}`,
  };
}
