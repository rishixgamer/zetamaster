import { LESSONS } from './lessons.js';
import { GLYPH } from './guides.js';

/**
 * Deterministic math-coach verification (F29, M3 close-out). The Academy's technique cards are the
 * source of arithmetic truth; any externally produced prose explanation (an AI assistant's output,
 * pasted by the user after explicitly opting in — the app itself makes no network calls) is
 * *untrusted narrative* and may only be shown after `verifyCoachExplanation` checks every claim it
 * makes against the lesson plan's exact arithmetic.
 *
 * What the verifier guarantees:
 * - every arithmetic equation in the text (`a op b = c`, or the reversed `a = b op c`) is recomputed
 *   with the engine's answer rule semantics and must come out exact — one wrong number rejects the
 *   whole text;
 * - every number mentioned must belong to the plan's operand/result universe, so invented
 *   quantities ("this saves 45 seconds") are rejected even when they never form an equation;
 * - text with no checkable arithmetic at all is rejected as unverifiable — the coach never nods
 *   along to vibes.
 *
 * What it never does: grade answers. The only inputs are prose and a verified plan; the
 * rehearsal's own answer checking stays in the guides module (`checkGuideAnswer`), the session
 * engine never consults this file, and no score, latency or telemetry field is ever an input here.
 */

/** Operators the verifier reads, with their plain semantics..ui Uses the curriculum glyphs (+ − × ÷)
 * and accepts the ASCII spellings many models emit. */
const OP_TABLE = { '+': (a, b) => a + b, '-': (a, b) => a - b, '−': (a, b) => a - b, '×': (a, b) => a * b, '*': (a, b) => a * b, '÷': (a, b) => (b === 0 ? NaN : a / b), '/': (a, b) => (b === 0 ? NaN : a / b) };
const OP_CHARS = Object.keys(OP_TABLE).map(k => k.replace(/[-\\^\]]/g, '\\$&')).join('');

const satisfies = (expected, stated) => String(expected) === String(stated);

/**
 * Verify untrusted explanation prose against a verified lesson plan. Returns
 * `{ ok: true, claims }` where `claims` lists the recomputed statements, or
 * `{ ok: false, reason }` with one of: 'non-string' / 'no-plan' / 'unverifiable' /
 * 'wrong-arithmetic: …' (the exact failed claim) / 'unlisted-number: …'.
 */
export function verifyCoachExplanation(text, plan) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'non-string', note: 'an explanation must be non-empty prose' };
  if (!plan || !Array.isArray(plan.steps)) return { ok: false, reason: 'no-plan', note: 'verification needs a checked plan to compare against' };

  const EQ_FWD = new RegExp(`(\\d+)\\s*([${OP_CHARS}])\\s*(\\d+)\\s*=\\s*(-?\\d+)`, 'g');
  const EQ_REV = new RegExp(`(\\d+)\\s*=\\s*(\\d+)\\s*([${OP_CHARS}])\\s*(-?\\d+)`, 'g');
  const NUMBER_SCAN = /-?\d+(?:\\.\\d+)?/g;

  // The plan's number universe: operands, step prompts, step answers, the lesson result. Numbers
  // outside it can only be invented quantities, and invented quantities are exactly what the
  // deterministic gate exists to catch.
  const universe = new Set(
    [plan.a, plan.b, plan.result,
      ...plan.steps.flatMap(step => [step.answer, ...String(step.prompt).matchAll(/\d+/g).map(m => Number(m[0]))])
        .filter(Number.isSafeInteger),
    ],
  );
  const consumed = new Array(text.length).fill(false);
  const claims = [];
  const mark = match => {
    const start = typeof match.index === 'number' ? match.index : 0;
    for (let i = start; i < start + match[0].length; i++) consumed[i] = true;
  };
  const overlapsConsumed = match => {
    const start = typeof match.index === 'number' ? match.index : 0;
    return consumed.slice(start, start + match[0].length).some(Boolean);
  };
  const scan = (regex, build, { skipConsumed = false } = {}) => {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      if (skipConsumed && overlapsConsumed(match)) continue;
      mark(match);
      const statement = build(match);
      if (statement.check) claims.push(statement.claim);
      else return { ok: false, reason: `wrong-arithmetic: ${statement.claim}`, note: 'every equation in an explanation must be recomputed exactly before display' };
    }
    return null;
  };
  // Forward form `a op b = c`.
  let failure = scan(EQ_FWD, match => {
    const op = OP_TABLE[match[2]];
    const claim = `${match[1]} ${match[2]} ${match[3]} = ${match[4]}`;
    return { check: satisfies(op(Number(match[1]), Number(match[3])), match[4]), claim };
  });
  if (failure) return failure;
  // Reversed form `a = b op c` (as in "28 = 7 × 4").
  failure = scan(EQ_REV, match => {
    const op = OP_TABLE[match[3]];
    const claim = `${match[2]} ${match[3]} ${match[4]} = ${match[1]}` ;
    return { check: satisfies(op(Number(match[2]), Number(match[4])), match[1]), claim };
  });
  if (failure) return failure;
  // Plain equalities left over ("28 = 28") — number equality must hold exact. Spans already
  // consumed by the two equation forms above are skipped, so "68 + 50 = 118" is not re-read
  // as the failing equation "50 = 118".
  failure = scan(/(\d+)\s*=\s*(-?\d+)/g, match => ({ check: satisfies(match[1], match[2]), claim: `${match[1]} = ${match[2]}` }), { skipConsumed: true });
  if (failure) return failure;
  // Every surviving number token must be in the plan's universe.
  NUMBER_SCAN.lastIndex = 0;
  for (const match of text.matchAll(NUMBER_SCAN)) {
    if (overlapsConsumed(match)) continue;
    const value = Number(match[0]);
    if (!universe.has(value)) return { ok: false, reason: `unlisted-number: ${match[0]}`, note: 'numbers outside the plan’s operands and results are invented quantities, rejected before display' };
  }
  if (!claims.length) return { ok: false, reason: 'unverifiable', note: 'the text makes no checkable arithmetic claim — the coach never endorses unverifiable prose' };
  return { ok: true, claims };
}

/**
 * The deterministic local brief for one card: the human-written card content (title, domain
 * statement when the plan is present) plus the plan's own verified step statements. This is the
 * baseline explanation the Academy always shows; anything external is compared against it, never
 * replaces it as the source of truth.
 */
export function coachBrief(lessonId, plan = null) {
  const lesson = LESSONS.find(l => l.id === lessonId);
  if (!lesson) return null;
  const glyph = GLYPH[lesson.operation] ?? lesson.operation;
  return {
    lessonId,
    title: lesson.title,
    problem: lesson.example,
    steps: [...lesson.steps],
    result: lesson.result,
    glyph,
    plan: plan ? { steps: plan.steps.map(s => ({ prompt: s.prompt, answer: s.answer })) } : null,
    note: 'Composed from the human-verified card; a plan’s steps are recomputed by deterministic code, pinned by tests.',
  };
}
