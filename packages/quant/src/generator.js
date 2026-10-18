import { createRng, intBetween, sample } from '../../core/src/rng.js';
import { createFractionGenerator } from './fractions.js';
import { createProbabilityGenerator } from './probability.js';
import { createFinanceGenerator } from './finance.js';
import { createEstimationGenerator } from './estimation.js';
import { generateRunningChain } from './running.js';
import { createHistorical80in8Generator } from './historical.js';
import { createMarketScenario } from './market-making.js';

export {
  createFractionGenerator,
  createProbabilityGenerator,
  createFinanceGenerator,
  createEstimationGenerator,
  generateRunningChain,
  createHistorical80in8Generator,
  createMarketScenario,
};

/**
 * Quant generator scaffold (F49–F55, Milestone M6).
 * Separate distribution; NEVER contaminate Zetamac benchmark data.
 * Backward compatible with existing tests while supporting specialized category generators.
 */
export function createQuantGenerator(seed = 'quant', category = null) {
  if (category === 'fraction') return createFractionGenerator(seed);
  if (category === 'probability') return createProbabilityGenerator(seed);
  if (category === 'finance') return createFinanceGenerator(seed);
  if (category === 'estimation') return createEstimationGenerator(seed);
  if (category === 'historical') return createHistorical80in8Generator(seed);

  const rng = createRng(seed);
  let sequence = 0;
  return () => {
    const op = sample(rng, ['percentage', 'fraction', 'expected-value', 'basis-points']);
    const a = intBetween(rng, 1, 20);
    const b = intBetween(rng, 1, 20);
    const variants = {
      percentage: () => ({ expression: `${a * 5}% of ${b * 20}`, answer: a * b }),
      fraction: () => ({ expression: `${a * b}/${b} = ?`, answer: a }),
      'expected-value': () => ({ expression: `50% chance of +${a * 2}, otherwise −${b * 2}. EV?`, answer: a - b }),
      'basis-points': () => ({ expression: `${a * 10} basis points as a percentage?`, answer: a / 10 }),
    };
    return { id: `quant-${++sequence}`, op, ...variants[op](), mode: 'quant' };
  };
}
