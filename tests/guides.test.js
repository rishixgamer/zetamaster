import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS } from '../packages/curriculum/src/lessons.js';
import {
  GUIDE_LESSON_IDS, GUIDE_MODES, planForLesson, askPlan, drawTransfer, transferPlan,
  checkGuideAnswer, guideDrillTarget,
} from '../packages/curriculum/src/guides.js';
import { skillCellFromId } from '../packages/training/src/skills.js';
import { patternDrill } from '../packages/training/src/drills.js';
import { benchmarkEquivalent } from '../packages/core/src/rulesets.js';

// Interactive guided lessons (M3 slice 1, F23–F25). The curriculum card text in lessons.js is the
// human explanation; guides.js must reproduce its arithmetic exactly — computed here by plain
// arithmetic from the example operands, never a learned or inferred answer. These tests pin the
// canonical reproduction step by step, verify every transfer draw against an independently written
// domain oracle, and check that the practice hand-off stays on the practice-only drill path.

const TWO_DIGIT = /(\d+) ([+−×÷]) (\d+)/;
const EXAMPLE_OPS = { '+': 'add', '−': 'sub', '×': 'mul', '÷': 'div' };

/** Parse a card's canonical example text in the test itself — the UI and module exports are not trusted for this. */
function parseExample(text) {
  const match = TWO_DIGIT.exec(text);
  if (!match) throw new Error(`Unparsed lesson example: ${text}`);
  return { op: EXAMPLE_OPS[match[2]], a: Number(match[1]), b: Number(match[3]) };
}

/**
 * Independent recomputation of each technique's step answers, written out per technique in this
 * test — deliberately NOT calling the module's planner — so a wrong formula in guides.js cannot
 * agree with itself and pass. Order matches the curated card steps.
 */
const RECOMPUTERS = {
  'addition-round': (a, b) => {
    const up = b + (10 - (b % 10)), delta = up - b;
    return [a + up, a + b];
  },
  'addition-left': (a, b) => {
    const at = a - (a % 10), bt = b - (b % 10);
    return [at + bt, (a % 10) + (b % 10), at + bt + (a % 10) + (b % 10)];
  },
  'subtraction-round': (a, b) => {
    const up = b + (10 - (b % 10)), delta = up - b;
    return [a - up, a - b];
  },
  'subtraction-complement': (a, b) => {
    const rest = a - b;
    const fill2 = rest % 10;                 // last units to reach the target
    return [b + (rest - fill2), a, rest];    // b + the big stride, then at the target, then the sum
  },
  'multiply-nine': a => [a * 10, a * 9],
  'multiply-distribute': (a, b) => [a * (b - (b % 10)), a * (b % 10), a * b],
  'multiply-five': a => [a * 10, a * 5],
  'multiply-eleven': a => [a * 10, a * 11],
  'multiply-halve': (a, b) => [a * 4, b / 4, a * b],
  // Division recomputers work on (dividend, divisor); every intermediate is exact integer math.
  'divide-inverse': (a, b) => {
    const t = a / b, p = t + (10 - (t % 10));
    return [b * p, b * p - a, (b * p - a) / b, t];
  },
  'divide-factor': (a, b) => {
    const prime = [2, 3, 5, 7, 11].find(p => b % p === 0);
    let k = 0, rest = b;
    while (rest % prime === 0) { rest /= prime; k++; }
    const answers = [];
    let cur = a;
    for (let i = 0; i < k; i++) { answers.push(cur / prime); cur /= prime; }
    if (rest > 1) answers.push(cur / rest);
    return answers;
  },
  'divide-estimate': (a, b) => {
    const t = a / b, est = Math.round(t / 10) * 10, gap = b * est - a, size = Math.abs(gap);
    return [b * est, size, size / b, t];
  },
};

/** The transfer domain per technique, written independently of the module — every draw must satisfy it. */
const DRAW_DOMAINS = {
  'addition-round': d => d.a >= 10 && d.a <= 99 && d.b >= 11 && d.b <= 99 && d.b % 10 !== 0,
  'addition-left': d => d.a >= 11 && d.a <= 98 && d.b >= 11 && d.b <= 98 && d.a % 10 !== 0 && d.b % 10 !== 0,
  'subtraction-round': d => d.b >= 11 && d.b <= 88 && d.b % 10 !== 0 && d.a >= d.b + 10 && d.a <= 98,
  'subtraction-complement': d => d.a === 100 && d.b >= 21 && d.b <= 78 && d.b % 10 !== 0,
  'multiply-nine': d => d.a >= 2 && d.a <= 99 && d.b === 9,
  'multiply-distribute': d => d.a >= 2 && d.a <= 9 && d.b >= 11 && d.b <= 98 && d.b % 10 !== 0,
  'multiply-five': d => d.a >= 2 && d.a <= 99 && d.b === 5,
  'multiply-eleven': d => d.a >= 2 && d.a <= 99 && d.b === 11,
  'multiply-halve': d => d.a === 25 && d.b >= 8 && d.b <= 100 && d.b % 4 === 0,
  // Division draws land inside the benchmark space: divisor (drawn second, .b) 2–12 and
  // quotient 2–99 or 2–100 (drawn first, .a); quotient-domain inequalities mirror each technique.
  'divide-inverse': d => {
    const q = d.a / d.b;
    return d.b >= 2 && d.b <= 12 && Number.isInteger(q) && q >= 2 && q <= 99 && q % 10 !== 0;
  },
  'divide-factor': d => {
    const q = d.a / d.b;
    return d.b >= 2 && d.b <= 12 && Number.isInteger(q) && q >= 2 && q <= 100;
  },
  'divide-estimate': d => {
    const q = d.a / d.b;
    return d.b >= 2 && d.b <= 12 && Number.isInteger(q) && q >= 2 && q <= 99 && q % 10 !== 0;
  },
};

const COVERED = LESSONS;

test('the guide covers every Academy card, including division', () => {
  assert.deepEqual(GUIDE_LESSON_IDS, COVERED.map(l => l.id));
  assert.equal(COVERED.length, 12);
  assert.deepEqual(
    COVERED.map(l => l.operation),
    ['add', 'add', 'sub', 'sub', 'mul', 'mul', 'mul', 'mul', 'mul', 'div', 'div', 'div'],
  );
});

for (const lesson of COVERED) {
  test(`planForLesson reproduces card "${lesson.title}" exactly: ${lesson.example}`, () => {
    const { a, b } = parseExample(lesson.example);
    const plan = planForLesson(lesson.id, a, b);
    assert.ok(plan, 'a curated in-domain example must always plan');
    assert.equal(plan.problemText, lesson.example);
    assert.equal(plan.result, lesson.result);
    // Step prompts and shown answers must round-trip to the exact curated card lines.
    assert.deepEqual(
      plan.steps.map(s => `${s.prompt} = ${s.answer}`),
      lesson.steps,
      'every planned step string equals the human-written step line',
    );
    // Step answers equal an independently recomputed ladder, all safe integers.
    const expected = RECOMPUTERS[lesson.id](a, b);
    assert.deepEqual(plan.steps.map(s => s.answer), expected);
    for (const answer of plan.steps.map(s => s.answer)) assert.ok(Number.isSafeInteger(answer));
    // Composition completes on the last step: it is the lesson's own result.
    assert.equal(plan.final.prompt, lesson.example);
    assert.equal(plan.final.answer, plan.steps.at(-1).answer);
    assert.equal(plan.steps.at(-1).answer, lesson.result);
    assert.equal(plan.steps.length, lesson.steps.length);
  });
}

test('out-of-domain and malformed operands return null instead of a wrong plan', () => {
  const cases = [
    ['addition-round', 5, 47],      // a below 10
    ['addition-round', 68, 40],     // addend a multiple of 10
    ['addition-round', 680, 47],    // out of every valid band
    ['addition-left', 60, 28],      // first operand no unit digit
    ['subtraction-round', 45, 47],  // minuend less than subtrahend
    ['subtraction-round', 90, 90],  // subtrahend a multiple of 10
    ['subtraction-complement', 99, 68],  // target must be exactly 100
    ['subtraction-complement', 100, 80], // complement keeps a unit digit
    ['multiply-nine', 1, 9],        // below the 2–99 factor space
    ['multiply-nine', 9, 78],       // swapped operands rejected, never mis-planned
    ['multiply-distribute', 13, 48], // factor above the table
    ['multiply-distribute', 7, 40],  // units part would be zero
    ['multiply-five', 5, 86],       // swapped operands rejected
    ['multiply-eleven', 11, 43],    // swapped operands rejected
    ['multiply-halve', 26, 48],     // anchor card keeps ×25 exactly
    ['multiply-halve', 25, 50],     // other factor must stay a multiple of 4
    ['multiply-halve', 25, 4],      // below the draw's 8 floor
    ['divide-inverse', 280, 7],     // quotient 40 is its own next ten — no overshoot to pay back
    ['divide-inverse', 672, 96],    // 96 is a dividend-band operand, not a 2–12 divisor
    ['divide-inverse', 30, 7],      // quotient must be at least 2
    ['divide-factor', 290, 8],      // dividend is not divisor × quotient (integral check fails)
    ['divide-factor', 288, 96],     // swapped operands are rejected, never mis-planned
    ['divide-factor', 288, 13],     // divisor outside the 2–12 table factor axis
    ['divide-estimate', 590, 9],    // quotient 65.55… is not a benchmark question
    ['divide-estimate', 540, 9],    // quotient 60 ends in 0 — already its own ten-estimate
    ['divide-estimate', 594, 99],   // divisor outside the 2–12 table factor axis
    ['addition-round', 2.5, 47],    // non-integer operands
    ['addition-round', Number.NaN, 47],
  ];
  for (const [id, a, b] of cases) assert.equal(planForLesson(id, a, b), null, `${id} (${a}, ${b})`);
});

test('unknown ids return null from every guide entry point', () => {
  for (const id of ['no-such-lesson', '']) {
    assert.equal(planForLesson(id, 10, 5), null, `planForLesson ${JSON.stringify(id)}`);
    assert.equal(drawTransfer(id, 100), null, `drawTransfer ${JSON.stringify(id)}`);
    assert.equal(transferPlan(id, 100), null, `transferPlan ${JSON.stringify(id)}`);
    assert.equal(guideDrillTarget(id, 10, 5), null, `guideDrillTarget ${JSON.stringify(id)}`);
  }
});

test('askPlan: guided asks every step, partial shows steps but asks the last, independent asks only the final', () => {
  assert.deepEqual(GUIDE_MODES, ['guided', 'partial', 'independent']);
  for (const id of GUIDE_LESSON_IDS) {
    const { a, b } = parseExample(LESSONS.find(l => l.id === id).example);
    const plan = planForLesson(id, a, b);
    const last = plan.steps.length - 1;
    const guided = askPlan(plan, 'guided');
    assert.deepEqual(guided.asks, Array.from({ length: plan.steps.length }, (_, i) => i), `${id} guided walks all steps`);
    assert.equal(guided.showSteps, true);
    const partial = askPlan(plan, 'partial');
    assert.deepEqual(partial.asks, [last], `${id} partial asks only the last step`);
    assert.equal(partial.showSteps, true, `${id} partial still reveals the worked steps`);
    const independent = askPlan(plan, 'independent');
    assert.deepEqual(independent.asks, [last], `${id} independent asks the final`);
    assert.equal(independent.showSteps, false, `${id} independent shows no steps`);
  }
  assert.equal(askPlan(null, 'guided'), null, 'a null plan has no mode');
  assert.equal(askPlan(null, 'not-a-mode'), null);
});

test('checkGuideAnswer uses the engine rule: trimmed exact decimal text', () => {
  assert.equal(checkGuideAnswer(' 72 ', 72), true, 'surrounding spaces are trimmed');
  assert.equal(checkGuideAnswer('72', 72), true);
  assert.equal(checkGuideAnswer('072', 72), false, 'a leading zero is not the exact text');
  assert.equal(checkGuideAnswer('7+2', 72), false);
  assert.equal(checkGuideAnswer('', 72), false);
  assert.equal(checkGuideAnswer('72', 73), false);
});

test('drawTransfer is deterministic per seed and every draw satisfies the technique domain', () => {
  const seedRange = 40;
  for (const id of GUIDE_LESSON_IDS) {
    const oracle = DRAW_DOMAINS[id];
    assert.ok(oracle, `domain oracle written for ${id}`);
    const again = drawTransfer(id, 'repeat-seed');
    assert.deepEqual(drawTransfer(id, 'repeat-seed'), again, `${id}: same seed, same problem`);
    assert.ok(again && Number.isSafeInteger(again.a) && Number.isSafeInteger(again.b), `${id} draw uses integers`);
    const distinct = new Set();
    for (let seed = 1; seed <= seedRange; seed++) {
      const drawn = drawTransfer(id, `seed-${seed}`);
      assert.ok(drawn, `${id} draws for every seed`);
      assert.ok(oracle(drawn), `${id} draw ${JSON.stringify(drawn)} inside the hand-chosen domain`);
      assert.ok(planForLesson(id, drawn.a, drawn.b), `${id} draw always plans (transfer rehearsal never dead-ends)`);
      distinct.add(`${drawn.a},${drawn.b}`);
    }
    assert.ok(distinct.size > 1, `${id}: transfer draws more than one unseen problem`);
  }
});

test('transferPlan couples draw and plan so rehearsal is playable from a stored seed', () => {
  const plan = transferPlan('subtraction-complement', 'seed-7');
  assert.ok(plan);
  assert.equal(plan.lessonId, 'subtraction-complement');
  assert.equal(plan.op, 'sub');
  const redrawn = drawTransfer('subtraction-complement', 'seed-7');
  assert.equal(plan.problemText, `100 − ${redrawn.b}`);
  assert.equal(plan.result, 100 - redrawn.b, 'transfer result agrees with plain arithmetic');
});

test('guideDrillTarget lands on the shared taxonomy cell of the actually-practiced pattern', () => {
  // Pinned concrete ids: documents the source-operand mapping (bands and factor axes) per technique
  // — for subtraction the (subtrahend, difference) generator order, for multiplication the table
  // factor first. Band indexes: 2–9=0 … 90–100=9; mul rows are table factors 2–12=0…10.
  const pinned = {
    'addition-round': ['add:6:4', '68 → row 6, 47 → col 4'],
    'addition-left': ['add:4:2', '47 → row 4, 28 → col 2'],
    'subtraction-round': ['sub:4:3', 'subtrahend 47 → row 4, difference 35 → col 3'],
    'subtraction-complement': ['sub:6:3', 'subtrahend 68 → row 6, difference 32 → col 3'],
    'multiply-nine': ['mul:7:7', 'table factor 9 → row 7, 78 → col 7'],
    'multiply-distribute': ['mul:5:4', 'table factor 7 → row 5, 48 → col 4'],
    'multiply-five': ['mul:3:8', 'table factor 5 → row 3, 86 → col 8'],
    'multiply-eleven': ['mul:9:4', 'table factor 11 → row 9, 43 → col 4'],
    'divide-inverse': ['div:5:9', 'divisor 7 → row 5, quotient 96 → col 9'],
    'divide-factor': ['div:6:3', 'divisor 8 → row 6, quotient 36 → col 3'],
    'divide-estimate': ['div:7:6', 'divisor 9 → row 7, quotient 66 → col 6'],
  };
  for (const [id, [expectedId, note]] of Object.entries(pinned)) {
    const { a, b } = parseExample(LESSONS.find(l => l.id === id).example);
    const cell = guideDrillTarget(id, a, b);
    assert.equal(cell?.id, expectedId, `${id}: ${note}`);
    assert.equal(skillCellFromId(cell.id)?.id, cell.id, `${id} cell id round-trips through the taxonomy`);
    assert.ok(Array.isArray(cell.rowRange) && cell.rowRange.length === 2 && cell.rowRange[0] <= cell.rowRange[1]);
    assert.ok(Array.isArray(cell.colRange) && cell.colRange.length === 2 && cell.colRange[0] <= cell.colRange[1]);
    const rules = patternDrill(cell, 60);
    assert.equal(rules.id, 'pattern-drill');
    assert.equal(rules.durationSeconds, 60);
    assert.equal(benchmarkEquivalent(rules), false, `no ${id} hand-off can ever validate as the benchmark`);
  }
});

test('the halve card has no drill hand-off: its fixed-25 pair never occurs in the benchmark space', () => {
  const { a, b } = parseExample(LESSONS.find(l => l.id === 'multiply-halve').example);
  assert.equal(guideDrillTarget('multiply-halve', a, b), null, '25 × 48: neither factor is a 2–12 table factor');
  // Even the friendliest draw keeps the anchor at 25, so the null is stable across every transfer seed.
  for (let seed = 1; seed <= 12; seed++) {
    const drawn = drawTransfer('multiply-halve', `seed-${seed}`);
    assert.equal(guideDrillTarget('multiply-halve', drawn.a, drawn.b), null);
  }
});
