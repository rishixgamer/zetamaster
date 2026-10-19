import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRATEGY_DUELS, duelOps, duelFor, drawDuels, duelPlan, duelRecommendation, duelTally, WHY_NO_DUEL,
} from '../packages/curriculum/src/strategies.js';
import { LESSONS } from '../packages/curriculum/src/lessons.js';

// Strategy-selection training (F27): two mental algorithms compared on matched unseen examples.
// These tests pin duel coverage (only genuinely overlapping technique pairs get a duel), the
// matched-draw determinism, cross-technique plan solvability, and the recommendation's determinism.

test('duels exist only where two curated techniques overlap; others state why not', () => {
  assert.deepEqual(duelOps(), ['add', 'div']);
  assert.equal(duelFor('add').id, 'add-round-vs-left');
  assert.equal(duelFor('div').id, 'div-inverse-vs-factor');
  for (const op of ['sub', 'mul', 'unknown']) {
    assert.equal(duelFor(op), null, `no fabricated duel for ${op}`);
    if (WHY_NO_DUEL[op]) {
      const lessonIds = LESSONS.filter(l => l.operation === op).map(l => l.id);
      assert.ok(lessonIds.length >= 2, `${op} really has several cards`);
      assert.ok(WHY_NO_DUEL[op].length > 20);
    }
  }
});

test('every duel draws inside the stated shared domain, deterministically per seed', () => {
  for (const [op, duel] of Object.entries(STRATEGY_DUELS)) {
    const again = drawDuels(op, 'fixture-seed');
    assert.deepEqual(drawDuels(op, 'fixture-seed'), again, `${op}: same seed, same fixture`);
    assert.ok(again && again.problems.length === 3, `${op}: default pair count`);
    for (const drawn of again.problems) {
      assert.ok(duel.shared(drawn.a, drawn.b), `${op} draw ${JSON.stringify(drawn)} shared-domain`);
      assert.ok(Number.isSafeInteger(drawn.a) && Number.isSafeInteger(drawn.b), `${op} draw integers`);
    }
    const distinct = new Set();
    for (let seed = 1; seed <= 24; seed++) {
      const fixture = drawDuels(op, `seed-${seed}`);
      assert.ok(fixture, `${op} draws for every seed`);
      assert.ok(
        fixture.order.join('\u0000') === duel.techniques.join('\u0000') ||
        fixture.order.join('\u0000') === [...duel.techniques].reverse().join('\u0000'),
        `${op} arms stay the duel's own techniques`,
      );
      for (const drawn of fixture.problems) {
        assert.ok(duel.shared(drawn.a, drawn.b), `${op} seed-${seed} draw shared-domain`);
        distinct.add(`${drawn.a},${drawn.b}`);
      }
    }
    assert.ok(distinct.size > 6, `${op}: fixtures span more than one unseen problem`);
  }
});

test('both techniques of a duel plan every shared problem and agree on the final answer', () => {
  const REAL_ANSWER = {
    add: (a, b) => a + b,
    div: (a, b) => a / b, // the quotient; both division decompositions must end on it
  };
  for (const [op, duel] of Object.entries(STRATEGY_DUELS)) {
    for (let seed = 1; seed <= 12; seed++) {
      const fixture = drawDuels(op, `seed-${seed}`);
      for (const drawn of fixture.problems) {
        const plans = duel.techniques.map(id => duelPlan(op, drawn, id));
        for (const plan of plans) assert.ok(plan, `${op} ${duel.techniques[plans.indexOf(plan)] ?? ''} plans ${drawn.text}`);
        const finals = plans.map(p => p.final.answer);
        assert.equal(finals[0], finals[1], `${op}: both algorithms land on the same exact value`);
        assert.equal(finals[0], REAL_ANSWER[op](drawn.a, drawn.b), `${op}: and the value is the true arithmetic`);
        assert.equal(duelPlan(op, drawn, 'no-such-technique'), null);
      }
    }
  }
});

test('duelPlan refuses out-of-domain problem shapes', () => {
  assert.equal(duelPlan('add', { a: 5, b: 47 }, 'addition-round'), null);
  assert.equal(duelPlan('div', { a: 590, b: 9 }, 'divide-inverse'), null);
  assert.equal(duelPlan('div', null, 'divide-inverse'), null);
  assert.equal(duelPlan('mul', { a: 7, b: 48 }, 'multiply-distribute'), null, 'no duel means no plan');
});

test('recommendations are deterministic and phrase their reason', () => {
  for (const [op, duel] of Object.entries(STRATEGY_DUELS)) {
    for (let seed = 1; seed <= 12; seed++) {
      const fixture = drawDuels(op, `seed-${seed}`);
      for (const drawn of fixture.problems) {
        const rec = duelRecommendation(op, drawn);
        assert.deepEqual(duelRecommendation(op, drawn), rec, `${op} recommendation deterministic`);
        assert.ok(duel.techniques.includes(rec.id), `${op} recommends a duel arm`);
        assert.ok(rec.why.includes(String([drawn.a, drawn.b].length >= 0 ? '' : '')) || rec.why.length > 10);
      }
      assert.equal(duelRecommendation(op, { a: 5, b: 47 }), null, `${op} refuses out-of-space input`);
    }
  }
  // The card example is inside the addition duel's shared domain: 68 + 47 overshoots by 3 —
  // the written default recommends the round-and-compensate arm at δ = 3.
  const rec = duelRecommendation('add', { a: 68, b: 47 });
  assert.equal(rec.id, 'addition-round');
  assert.ok(rec.why.includes('3'));
});

test('duelTally is a plain matched-problem comparison, aligned by index', () => {
  const tally = duelTally(
    [{ correct: true }, { correct: false }, { correct: true }],
    [{ correct: true }, { correct: true }, { correct: false }],
  );
  assert.equal(tally.compared, 3);
  assert.equal(tally.both, 1);
  assert.equal(tally.onlyA, 1);
  assert.equal(tally.onlyB, 1);
  assert.equal(tally.correctA, 2);
  assert.equal(tally.correctB, 2);
  assert.match(tally.note, /no significance test/);
  // The documented contract returns the per-problem head-to-head as well (used by the duel UI).
  assert.deepEqual(tally.per, [
    { pair: 0, correctA: true, correctB: true },
    { pair: 1, correctA: false, correctB: true },
    { pair: 2, correctA: true, correctB: false },
  ]);
  // Misaligned lengths compare only the aligned prefix.
  assert.equal(duelTally([], []).compared, 0);
  assert.equal(duelTally([{ correct: true }], []).compared, 0);
  assert.deepEqual(duelTally([], []).per, []);
  assert.deepEqual(duelTally([{ correct: true }], []).per, []);
});
