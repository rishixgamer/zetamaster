import { createRng, intBetween } from '../../core/src/rng.js';
import { planForLesson, GLYPH } from './guides.js';
import { LESSONS } from './lessons.js';

/**
 * Strategy-selection training (F27, M3 close-out): compare two mental algorithms on *matched*
 * unseen examples. A duel is a pair of Academy technique cards whose operands overlap, so the
 * SAME problem can be rehearsed with either technique; a seeded fixture draws such shared-domain
 * problems, each side of the duel walks its own guided plan over them, and the UI tallies
 * first-try solutions per side.
 *
 * Honesty notes baked into the data (mirrored by the UI):
 * - both sides solve the identical drawn problems, one after the other — the second pass benefits
 *   from rehearsal, so the tally is a teaching aid, not an experiment; the fixture's arm order is
 *   seeded-offset (`order`) purely so the comparison does not always rehearse the same arm last;
 * - the `recommend` heuristic is a hand-written pedagogical default (stated per duel in plain
 *   arithmetic), pinned by tests for determinism — it is not a validated decision model;
 * - nothing here is timed, scored, or persisted; no claim is made that dueling strategies lifts
 *   benchmark scores.
 *
 * Duels exist only where two curated techniques genuinely overlap in domain ('add' and 'div').
 * Other operations return null with a stated reason — the module never fakes a duel out of
 * disjoint cards.
 */

export const DUEL_NOTE =
  'Both sides solve the identical drawn problems, one after the other — the second pass benefits from rehearsal, so the tally is a teaching aid, not an experiment. Untimed and unscored; nothing is saved.';

/** Draw a divisor/quotient pair whose quotient keeps its unit digit (the shared inverse-overshoot
 * / factoring domain); the same convention as the division technique draws in guides.js. */
const drawSharedDivision = rng => {
  const d = intBetween(rng, 2, 12);
  let t = intBetween(rng, 2, 98);
  if (t % 10 === 0) t += 1;
  return { a: d * t, b: d };
};

const primeChainLength = d => {
  const prime = [2, 3, 5, 7, 11].find(p => d % p === 0);
  let k = 0, rest = d;
  while (rest % prime === 0) { rest /= prime; k++; }
  return k + (rest > 1 ? 1 : 0);
};

export const STRATEGY_DUELS = {
  add: {
    id: 'add-round-vs-left',
    label: 'Round-and-compensate vs left-to-right addition',
    techniques: ['addition-round', 'addition-left'],
    shared: (a, b) => a >= 11 && a <= 99 && b >= 11 && b <= 99 && a % 10 !== 0 && b % 10 !== 0,
    sharedNote: 'two-digit pairs where both operands keep a unit digit',
    draw: rng => {
      const pair = () => { let x = intBetween(rng, 11, 98); if (x % 10 === 0) x += 1; return x; };
      return { a: pair(), b: pair() };
    },
    /**
     * Hand-written pedagogical default: round-and-compensate is worth its payback only when the
     * overshoot is small (pay a back at most 3 on top of the rounded sum), otherwise left-to-right
     * avoids the payback subtraction entirely. Verified for determinism, not validated as a model.
     */
    recommend: (a, b) => (10 - (b % 10)) <= 3
      ? { id: 'addition-round', why: `rounding ${b} up overshoots by only ${10 - (b % 10)} — a small payback on top of a round sum` }
      : { id: 'addition-left', why: `rounding ${b} up overshoots by ${10 - (b % 10)} — payback that big usually costs more than split tens and units` },
  },
  div: {
    id: 'div-inverse-vs-factor',
    label: 'Reverse multiplication vs factor-the-divisor division',
    techniques: ['divide-inverse', 'divide-factor'],
    shared: (a, b) => b >= 2 && b <= 12 && Number.isSafeInteger(a / b) && a / b >= 2 && a / b <= 99 && (a / b) % 10 !== 0,
    sharedNote: 'benchmark-division dividends whose quotient keeps a unit digit',
    draw: drawSharedDivision,
    /**
     * Factoring shines when the divisor peels into 2–3 successive divisions (d = 6, 8, 9, 12); a
     * prime divisor degenerates to one direct division, so the overshoot method is recommended
     * instead. Chain length is plain prime arithmetic, deterministic by construction.
     */
    recommend: (a, b) => {
      const length = primeChainLength(b);
      return length >= 2 && length <= 3
        ? { id: 'divide-factor', why: `${b} peels into ${length} successive divisions — factor it and divide repeatedly` }
        : { id: 'divide-inverse', why: length === 1
          ? `${b} is prime — factoring degenerates to one direct division, so overshoot to the next ten and pay back instead`
          : `${b} needs ${length} chained divisions — too long a chain, overshoot to the next ten and pay back instead` };
    },
  },
};

/** The operations with a real duel, in deterministic order. */
export function duelOps() {
  return Object.keys(STRATEGY_DUELS);
}

/** The duel for one operation, or null when no curated technique pair overlaps for it. */
export function duelFor(op) {
  const duel = STRATEGY_DUELS[op];
  if (!duel) return null;
  const lessons = duel.techniques.map(id => ({ id, lesson: LESSONS.find(l => l.id === id) }));
  if (lessons.some(x => !x.lesson)) return null;
  return { ...duel, lessons };
}

export const WHY_NO_DUEL = Object.freeze({
  sub: 'The curated subtraction cards do not overlap: the complement card only covers fixed-100 targets, which the round-subtraction domain excludes.',
  mul: 'The curated multiplication cards cover disjoint factors (×9, ×5, ×11, splits, ×25) — no pair rehearses the same problems.',
});

/**
 * Seeded fixture: `pairs` problems from the shared domain. Same seed → same fixture; the seed is
 * shown with the problems for reproducibility, as in the transfer rehearsal. Arm order alternates
 * by seed so neither technique is always rehearsed last. Out-of-space ids return null.
 */
export function drawDuels(op, seed, { pairs = 3 } = {}) {
  const duel = STRATEGY_DUELS[op];
  if (!duel || !Number.isSafeInteger(pairs) || pairs < 1 || pairs > 10) return null;
  const rng = createRng(seed);
  // Arm order from the first RNG output keeps the seed the single determinism source.
  const order = rng() < 0.5 ? duel.techniques : [...duel.techniques].reverse();
  const problems = [];
  for (let i = 0; i < pairs; i++) {
    const { a, b } = duel.draw(rng);
    const z = duel.shared(a, b) ? { a, b } : null;
    if (!z) return null; // the sampler must only draw shared-domain problems; never paper over
    problems.push({ a: z.a, b: z.b, text: `${z.a} ${GLYPH[op]} ${z.b}` });
  }
  return { op, seed, order, problems };
}

/** Plan for one fixture problem under one of the duel's techniques; null when impossible. */
export function duelPlan(op, drawn, techniqueId) {
  const duel = STRATEGY_DUELS[op];
  if (!duel || !duel.techniques.includes(techniqueId) || !drawn) return null;
  return planForLesson(techniqueId, drawn.a, drawn.b);
}

/** Deterministic per-problem recommendation `{ id, why }`, or null for unknown problems. */
export function duelRecommendation(op, drawn) {
  const duel = STRATEGY_DUELS[op];
  if (!duel || !drawn || !duel.shared(drawn.a, drawn.b)) return null;
  return duel.recommend(drawn.a, drawn.b);
}

/**
 * Tally helper for the UI: `attempts` are per-problem first-try results
 * `{ correct: boolean }` arrays, one arm each, aligned to the fixture's problems. Pure; returns
 * per-arm counts plus the per-problem head-to-head (`per`: both right / only A / only B per
 * problem, in fixture order), which is what "matched examples" can honestly support. No
 * significance test — n is tiny by design.
 */
export function duelTally(attemptsA, attemptsB) {
  const per = [];
  for (let i = 0; i < Math.min(attemptsA.length, attemptsB.length); i++) {
    per.push({
      pair: i,
      correctA: attemptsA[i]?.correct === true,
      correctB: attemptsB[i]?.correct === true,
    });
  }
  const both = per.filter(p => p.correctA && p.correctB).length;
  const onlyA = per.filter(p => p.correctA && !p.correctB).length;
  const onlyB = per.filter(p => !p.correctA && p.correctB).length;
  const neither = per.filter(p => !p.correctA && !p.correctB).length;
  return {
    compared: per.length,
    both, onlyA, onlyB, neither,
    correctA: per.filter(p => p.correctA).length,
    correctB: per.filter(p => p.correctB).length,
    per,
    note: 'Matched-problem tally only: no significance test at this sample size, and neither pass is timed.',
  };
}
