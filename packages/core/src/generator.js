import { intBetween, createRng } from './rng.js';
import { validateRules } from './rulesets.js';
import { classifyQuestion } from './classify.js';

export function makeQuestion(op, a, b, sequence = 0) {
  if (![a, b].every(Number.isSafeInteger) || a < 1 || b < 1) throw new RangeError('Operands must be positive integers');
  const result = {
    add: () => ({ left: a, right: b, answer: a + b, symbol: '+' }),
    sub: () => ({ left: a + b, right: a, answer: b, symbol: '\u2013' }),
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

const sameFact = (p, q) => p.op === q.op && p.sourceLeft === q.sourceLeft && p.sourceRight === q.sourceRight;

/**
 * Stimulus-variety decorator (F31, cognitive automaticity training). An i.i.d. seeded draw can,
 * by chance, set the exact same fact twice in a row — and a repeated problem invites rote short-term
 * recall instead of real retrieval. This wrapper redraws whenever the next draw repeats the previous
 * fact (same operation and both source operands), bounded by `maxRedraws` so a degenerate range
 * (e.g. [5,5] × [5,5]) can never loop forever: at the cap the draw is emitted as-is, and honesty
 * beats a hang. Deterministic for a given seed because the wrapped generator is; the decorator
 * changes nothing else — ranges, question objects and sequencing stay the base generator's.
 */
export function varyStimulus(base, { maxRedraws = 16 } = {}) {
  if (!Number.isSafeInteger(maxRedraws) || maxRedraws < 0) throw new RangeError('maxRedraws must be a non-negative integer');
  let previous = null;
  return () => {
    let question = base();
    if (previous && sameFact(previous, question)) {
      for (let tries = 0; tries < maxRedraws && sameFact(previous, question); tries++) question = base();
    }
    previous = { op: question.op, sourceLeft: question.sourceLeft, sourceRight: question.sourceRight };
    return question;
  };
}
