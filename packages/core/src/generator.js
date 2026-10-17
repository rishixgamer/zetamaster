import { intBetween, createRng } from './rng.js';
import { validateRules } from './rulesets.js';
import { classifyQuestion } from './classify.js';

export function makeQuestion(op, a, b, sequence = 0) {
  if (![a, b].every(Number.isSafeInteger) || a < 1 || b < 1) throw new RangeError('Operands must be positive integers');
  const result = {
    add: () => ({ left: a, right: b, answer: a + b, symbol: '+' }),
    sub: () => ({ left: a + b, right: a, answer: b, symbol: '−' }),
    mul: () => ({ left: a, right: b, answer: a * b, symbol: '×' }),
    div: () => ({ left: a * b, right: a, answer: b, symbol: '÷' }),
  }[op];
  if (!result) throw new RangeError('Invalid operation');
  const q = { id: `q-${sequence}`, sequence, op, sourceLeft: a, sourceRight: b, ...result() };
  if (!Number.isSafeInteger(q.answer) || !Number.isSafeInteger(q.left)) throw new RangeError('Arithmetic exceeds safe integer range');
  q.tags = classifyQuestion(q);
  return q;
}
/** Inverse subtraction and division are generated from the underlying add/mul families. */
export function createGenerator(rules, seed = 'default', weights = null) {
  const config = validateRules(rules);
  const rng = createRng(seed);
  let sequence = 0;
  const validOps = config.enabled;
  const eligibleWeights = validOps.map(op => (Number.isFinite(Number(weights?.[op] ?? 1)) ? Math.max(0,Math.min(1000,Number(weights?.[op] ?? 1))) : 0));
  if (!eligibleWeights.some(Boolean)) throw new RangeError('At least one operation weight must be positive');
  return () => {
    const total = eligibleWeights.reduce((a, b) => a + b, 0);
    let point = rng() * total;
    let op = validOps.at(-1);
    for (let i = 0; i < validOps.length; i++) { point -= eligibleWeights[i]; if (point < 0) { op = validOps[i]; break; } }
    const ranges = op === 'add' || op === 'sub' ? config.addition : config.multiplication;
    const a = intBetween(rng, ...ranges.left);
    const b = intBetween(rng, ...ranges.right);
    return makeQuestion(op, a, b, ++sequence);
  };
}
