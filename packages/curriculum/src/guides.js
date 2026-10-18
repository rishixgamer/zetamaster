/**
 * Interactive guided lessons (M3 slice 1, F23–F25): a machine-checkable plan for every human-written
 * technique card in `lessons.js` covering addition, subtraction and multiplication. Each plan turns
 * the card's canonical example into per-step intermediate questions whose expected values are
 * computed here by plain arithmetic — never graded or inferred by a language model. The curated
 * step strings in `lessons.js` stay the human explanation; this module must reproduce their
 * arithmetic exactly (pinned by tests/guides.test.js against each card's example text).
 *
 * Geometry of one plan (`planForLesson`):
 * - `steps` — the intermediate questions the technique is made of; the LAST step's answer is the
 *   lesson result itself (composition always completes on the last step);
 * - `final` — the whole problem asked at once, used by the 'independent' mode;
 * - `result` — the lesson's own recorded result (must equal `steps.at(-1).answer`).
 *
 * Three practice modes (`askPlan`), all deterministic, none timed:
 * - `guided`     — the learner computes every step in order;
 * - `partial`    — every step except the last is shown as text; the learner computes the last;
 * - `independent` — only the problem is shown; the learner computes the final answer directly.
 *
 * Transfer (`drawTransfer`) draws *unseen* operand pairs for the same technique from a seeded RNG
 * (`core/rng.js`), inside a hand-chosen domain per technique (e.g. complements keep the 100 target,
 * the double-and-halve card keeps the 25 anchor). Transfer problems are verified by the same plan
 * code plus independent recomputation in tests. Guides hand off to the existing practice surface
 * through `guideDrillTarget` (the F17/F09 cell of the practiced operands) — no new persistence, no
 * score surface, and no claim that lessons lift benchmark scores (that measurement is F21/F22).
 */
import { matchesAnswer } from '../../core/src/session.js';
import { createRng, intBetween } from '../../core/src/rng.js';
import { skillCellFor } from '../../training/src/skills.js';
import { LESSONS } from './lessons.js';

/** Lesson ids covered by this slice: F23 (addition), F24 (subtraction), F25 (multiplication). */
export const GUIDE_LESSON_IDS = [
  'addition-round', 'addition-left',
  'subtraction-round', 'subtraction-complement',
  'multiply-nine', 'multiply-distribute', 'multiply-five', 'multiply-eleven', 'multiply-halve',
];

export const GLYPH = Object.freeze({ add: '+', sub: '−', mul: '×', div: '÷' });

/**
 * Per-technique definitions. `plan(a, b)` returns the step prompts (canonical strings using the
 * curriculum's own glyphs) and — computed here, once, deterministically — their exact answers.
 * `domain.ok` phrases each technique's validity as explicit predicates: out-of-domain input yields
 * `null` from `planForLesson`, never a wrong plan.
 */
const TECHNIQUES = {
  'addition-round': {
    op: 'add',
    domain: { ok: (a, b) => a >= 10 && a <= 99 && b >= 11 && b <= 99 && b % 10 !== 0, note: 'two-digit addend pair, addend not a multiple of 10' },
    draw: rng => {
      let b = intBetween(rng, 11, 98);
      if (b % 10 === 0) b += 1;
      return { a: intBetween(rng, 10, 99), b };
    },
    plan: (a, b) => {
      const up = b + (10 - b % 10);           // round the addend up to the next ten
      const delta = up - b;                   // the overshoot to pay back
      return [
        [`${a} + ${up}`, a + up],
        [`${a + up} − ${delta}`, a + b],
      ];
    },
  },
  'addition-left': {
    op: 'add',
    domain: { ok: (a, b) => a >= 11 && a <= 99 && b >= 11 && b <= 99 && a % 10 !== 0 && b % 10 !== 0, note: 'two-digit pair, both with unit digits (draw keeps tens+units split meaningful)' },
    draw: rng => {
      const pair = () => { let x = intBetween(rng, 11, 98); if (x % 10 === 0) x += 1; return x; };
      return { a: pair(), b: pair() };
    },
    plan: (a, b) => {
      const at = a - a % 10, bt = b - b % 10;            // tens parts
      const au = a % 10, bu = b % 10;                    // unit parts
      return [
        [`${at} + ${bt}`, at + bt],
        [`${au} + ${bu}`, au + bu],
        [`${at + bt} + ${au + bu}`, a + b],
      ];
    },
  },
  'subtraction-round': {
    op: 'sub',
    domain: { ok: (a, b) => b >= 11 && b <= 89 && b % 10 !== 0 && a >= b + 10 && a <= 99, note: 'minuend at least 10 above a non-round subtrahend' },
    draw: rng => {
      let b = intBetween(rng, 11, 88);
      if (b % 10 === 0) b += 1;
      return { a: intBetween(rng, b + 10, 98), b };
    },
    plan: (a, b) => {
      const up = b + (10 - b % 10);           // overshoot the subtrahend to the next ten
      const delta = up - b;                   // pay the overshoot back
      return [
        [`${a} − ${up}`, a - up],
        [`${a - up} + ${delta}`, a - b],
      ];
    },
    /**
     * Source operands for the shared taxonomy: subtraction questions are generated inversely —
     * `makeQuestion('sub', subtrahend, difference)` — so the drill cell's axes are (subtrahend,
     * difference), never the composite display operands (see skills.js/skillCellFor doc).
     */
    cellArgs: (a, b) => [b, a - b],
  },
  'subtraction-complement': {
    op: 'sub',
    domain: { ok: (a, b) => a === 100 && b >= 21 && b <= 79 && b % 10 !== 0, note: 'fixed 100 target; subtrahend keeps a unit digit and stays two-digit' },
    draw: rng => {
      let b = intBetween(rng, 21, 78);
      if (b % 10 === 0) b += 1;
      return { a: 100, b };
    },
    plan: (a, b) => {
      const rest = a - b;                     // distance to cross
      const fill2 = rest % 10;                // last units to reach the target
      const fill1 = rest - fill2;             // the large stride below the target
      return [
        [`${b} + ${fill1}`, b + fill1],
        [`${b + fill1} + ${fill2}`, a],
        [`${fill1} + ${fill2}`, rest],
      ];
    },
    cellArgs: (a, b) => [b, a - b],           // same inverse-subtraction axes as above
  },
  'multiply-nine': {
    op: 'mul',
    domain: { ok: (a, b) => b === 9 && a >= 2 && a <= 99, note: 'any 2–99 factor times exactly 9 (swapped operands are rejected, not mis-planned)' },
    draw: rng => ({ a: intBetween(rng, 2, 99), b: 9 }),
    plan: (a, b) => [
      [`${a} × 10`, a * 10],
      [`${a * 10} − ${a}`, a * 9],
    ],
    cellArgs: (a, b) => [b, a],               // the table factor rides first, like the generator's
  },
  'multiply-distribute': {
    op: 'mul',
    domain: { ok: (a, b) => a >= 2 && a <= 9 && b >= 11 && b <= 99 && b % 10 !== 0, note: 'table factor × a two-digit number with a units part' },
    draw: rng => {
      let b = intBetween(rng, 11, 98);
      if (b % 10 === 0) b += 1;
      return { a: intBetween(rng, 2, 9), b };
    },
    plan: (a, b) => {
      const bt = b - b % 10, bu = b % 10;
      return [
        [`${a} × ${bt}`, a * bt],
        [`${a} × ${bu}`, a * bu],
        [`${a * bt} + ${a * bu}`, a * b],
      ];
    },
    cellArgs: (a, b) => [a, b],               // the table factor is already first here
  },
  'multiply-five': {
    op: 'mul',
    domain: { ok: (a, b) => b === 5 && a >= 2 && a <= 99, note: 'any 2–99 factor times exactly 5 (×10 then halve; a×10 is always even)' },
    draw: rng => ({ a: intBetween(rng, 2, 99), b: 5 }),
    plan: (a, b) => [
      [`${a} × 10`, a * 10],
      [`${a * 10} ÷ 2`, a * 5],
    ],
    cellArgs: (a, b) => [b, a],
  },
  'multiply-eleven': {
    op: 'mul',
    domain: { ok: (a, b) => b === 11 && a >= 2 && a <= 99, note: 'any 2–99 factor times exactly 11' },
    draw: rng => ({ a: intBetween(rng, 2, 99), b: 11 }),
    plan: (a, b) => [
      [`${a} × 10`, a * 10],
      [`${a * 10} + ${a}`, a * 11],
    ],
    cellArgs: (a, b) => [b, a],
  },
  'multiply-halve': {
    op: 'mul',
    domain: { ok: (a, b) => a === 25 && b % 4 === 0 && b >= 8 && b <= 100, note: 'fixed ×25 anchor; the other factor stays a multiple of 4' },
    draw: rng => ({ a: 25, b: 4 * intBetween(rng, 2, 25) }),
    plan: (a, b) => [
      [`${a} × 4`, a * 4],
      [`${b} ÷ 4`, b / 4],
      [`${a * 4} × ${b / 4}`, a * b],
    ],
    /**
     * Neither the fixed 25 anchor nor the arbitrary other factor is a 2–12 table factor, so a halve
     * problem never occurs in the benchmark operand space and has no taxonomy cell: the hand-off
     * returns null for every draw of this technique and the UI hides its drill button — an honest
     * gap, not a hidden launch into an out-of-space pattern.
     */
    cellArgs: (a, b) => [a, b],
  },
};

/** Parsed, validated technique plans. `planForLesson` returns null unusable input — never throws on domain misses. */
export function planForLesson(lessonId, a, b) {
  const technique = TECHNIQUES[lessonId];
  const lesson = LESSONS.find(l => l.id === lessonId);
  if (!technique || !lesson || lesson.operation !== technique.op) return null;
  const [x, y] = [a, b];
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  const ok = technique.domain.ok;
  if (ok.length >= 2 ? !ok(x, y) : !ok(x)) return null;
  const parts = technique.plan(x, y);
  const steps = parts.map(([prompt, answer]) => ({ prompt, answer: Number(answer) }));
  if (steps.some(s => !Number.isSafeInteger(s.answer))) return null;
  const glyph = GLYPH[technique.op];
  return {
    lessonId, op: technique.op, glyph, a: x, b: y,
    problemText: `${x} ${glyph} ${y}`,
    steps,
    final: { prompt: `${x} ${glyph} ${y}`, answer: steps[steps.length - 1].answer },
    result: steps[steps.length - 1].answer,
  };
}

export const GUIDE_MODES = Object.freeze(['guided', 'partial', 'independent']);

/**
 * Which steps the learner computes in each mode. `guided` asks every step (the final step is the
 * composition); `partial` reveals steps 0..n−2 and asks only the last; `independent` asks the
 * final answer with no steps shown. Returns `{ showSteps, asks }` with asks sorted ascending.
 */
export function askPlan(plan, mode) {
  if (!plan || !GUIDE_MODES.includes(mode)) return null;
  const last = plan.steps.length - 1;
  if (mode === 'guided') return { showSteps: true, asks: Array.from({ length: plan.steps.length }, (_, i) => i) };
  return { showSteps: mode === 'partial', asks: [last] };
}

/** Strict answer rule, one source of truth with the game engine: trimmed exact decimal text. */
export function checkGuideAnswer(input, answer) { return matchesAnswer(input, answer); }

/**
 * Deterministic transfer draw for a technique's domain. Same seed → same problem; the seed travels
 * with the shown problem so any helper (or a later session) can replay it. Out-of-coverage lesson
 * ids (division techniques, unknown) return null — they stay display-only teaching cards.
 */
export function drawTransfer(lessonId, seed) {
  const technique = TECHNIQUES[lessonId];
  if (!technique || !technique.draw) return null;
  const rng = createRng(seed);
  return technique.draw(rng);
}

/** Deterministic plan for a transfer draw; null only for uncovered lesson ids (see above). */
export function transferPlan(lessonId, seed) {
  const drawn = drawTransfer(lessonId, seed);
  return drawn ? planForLesson(lessonId, drawn.a, drawn.b) : null;
}

/**
 * Practice hand-off seam: the operand cell in the shared F09/F17 taxonomy that matches a practiced
 * problem, ready for the existing 60-second pattern drill launch. Cell axes follow the generator's
 * source-operand order per technique (`cellArgs`) — for subtraction the (subtrahend, difference)
 * pair, for multiplication the table factor first — so a hand-off drill is exactly the practiced
 * pattern, never the composite display operands. Out-of-taxonomy problems return null: division
 * lessons (F26) and the fixed-25 halve card, whose operand pair never occurs in the benchmark
 * space, stay guide-only here like everywhere else.
 */
export function guideDrillTarget(lessonId, a, b) {
  const plan = planForLesson(lessonId, a, b);
  if (!plan) return null;
  const cellArgs = TECHNIQUES[lessonId].cellArgs?.(plan.a, plan.b) ?? [plan.a, plan.b];
  const cell = skillCellFor(plan.op, cellArgs[0], cellArgs[1]);
  return cell ?? null;
}
