import test from 'node:test';
import assert from 'node:assert/strict';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { BENCHMARK_RULES, customRules } from '../packages/core/src/rulesets.js';
import { validateRules, benchmarkEquivalent } from '../packages/core/src/rulesets.js';
import { makeQuestion, varyStimulus, createGenerator } from '../packages/core/src/generator.js';
import { skillCellFor } from '../packages/training/src/skills.js';
import { automaticityDrill } from '../packages/training/src/drills.js';

// Deterministic harness identical to tests/input-state.test.js, plus a budget knob. `rotate`
// alternates two distinct facts, so a stale answer cannot accidentally solve the next question.
function harness({ rules = BENCHMARK_RULES, rotate = false } = {}) {
  let t = 1000, drawn = 0;
  const q = () => makeQuestion('add', ...(rotate && ++drawn % 2 === 0 ? [41, 39] : [40, 32]), drawn);
  const session = new ArithmeticSession({ rules, mode: 'drill', seed: 's', clock: () => t, wallClock: () => new Date(t).toISOString(), generator: q });
  return { session, move: ms => { t += ms; }, now: () => t };
}

test('question budget validation: optional, 100–60000 ms, benchmark rules stay clean', () => {
  assert.equal(validateRules({ ...customRules(), questionBudgetMs: 2000 }).questionBudgetMs, 2000);
  assert.throws(() => validateRules({ ...customRules(), questionBudgetMs: 99 }), RangeError);
  assert.throws(() => validateRules({ ...customRules(), questionBudgetMs: 60001 }), RangeError);
  assert.throws(() => validateRules({ ...customRules(), questionBudgetMs: 2500.5 }), RangeError);
  assert.equal(validateRules(customRules()).questionBudgetMs, undefined);
  assert.equal('questionBudgetMs' in JSON.parse(JSON.stringify(BENCHMARK_RULES)), false, 'benchmark snapshot carries no budget');
  assert.equal(benchmarkEquivalent(BENCHMARK_RULES), true);
});

test('no budget set: every mechanism is a no-op and telemetry is untouched', () => {
  const { session, move, now } = harness(); session.start();
  move(1500);
  assert.equal(session.maybeExpireQuestion(), false, 'no budget, no expiry');
  assert.equal(session.recordInput('72'), true);
  assert.equal(session.score, 1);
  assert.equal(session.missedEvents.length, 0);
  assert.equal(session.events[0].responseMs, 1500, 'solve telemetry unchanged');
  const r = session.finish();
  assert.deepEqual(r.missedEvents, []);
  assert.equal(r.missedCount, 0);
  assert.equal(now() - 1000, 1500);
});

test('budgeted question expires, is recorded as missed, and never scores', () => {
  const rules = customRules({ durationSeconds: 30, questionBudgetMs: 2000 });
  const { session, move } = harness({ rules, rotate: true });
  session.start(); move(1000);
  assert.equal(session.recordInput('7'), false, 'wrong answer does not solve');
  move(1000); // exactly at the 2000 ms budget line
  assert.equal(session.maybeExpireQuestion(), true, 'at or past the budget line the question is gone');
  assert.equal(session.recordInput('72'), false, 'the stale answer of the expired fact scores nothing');
  assert.equal(session.score, 0, 'misses never become points');
  assert.equal(session.missedEvents.length, 1);
  const missed = session.missedEvents[0];
  assert.equal(missed.missed, true);
  assert.equal(missed.responseMs, 2000, 'miss telemetry is the budget itself');
  assert.equal(missed.left, 40); assert.equal(missed.right, 32);
  assert.equal(session.events.length, 0, 'solved events are untouched by misses');
  move(1999);
  assert.equal(session.maybeExpireQuestion(), false, 'the next question gets a fresh budget');
  move(1);
  assert.equal(session.maybeExpireQuestion(), true);
  assert.equal(session.missedEvents.length, 2);
});

test('expiry is enforced on recordInput even when the tick never ran', () => {
  const rules = customRules({ durationSeconds: 60, questionBudgetMs: 1000 });
  const { session, move } = harness({ rules });
  session.start(); // question 1 shown at t=1000, deadline 2000
  move(999);
  assert.equal(session.recordInput('71'), false);
  move(1); // budget boundary crossed with no tick in between
  assert.equal(session.recordInput('72'), false, 'a solve typed past the budget is refused');
  assert.equal(session.missedEvents.length, 1);
  assert.equal(session.score, 0);
  move(999); // question 2 (same fact) gets its own full window from 2000, deadline 3000
  assert.equal(session.recordInput('72'), true, 'the next question answers within its own window');
  assert.equal(session.score, 1);
  assert.equal(session.missedEvents.length, 1);
});

test('session tick consumes expiry once for the UI to clear the field', () => {
  const rules = customRules({ durationSeconds: 60, questionBudgetMs: 500 });
  const { session, move } = harness({ rules });
  session.start(); move(500);
  session.tick();
  assert.equal(session.consumeExpiry(), true, 'tick path flags expiry for the UI');
  assert.equal(session.consumeExpiry(), false, 'one-shot flag');
});

test('automaticity drill ruleset: budget line shared with F19/F20, practice-only, honest copy', () => {
  const cell = skillCellFor('mul', 7, 40);
  const drill = automaticityDrill(cell, 60);
  assert.equal(drill.id, 'automaticity-drill');
  assert.equal(drill.questionBudgetMs, 2000);
  assert.equal(benchmarkEquivalent(drill), false);
  assert.equal(drill.enabled.length, 1);
  assert.ok(drill.explanation.includes('missed'));
  assert.ok(!drill.explanation.toLowerCase().includes('will raise'), 'no efficacy claims');
  assert.throws(() => automaticityDrill(cell, 60, { budgetMs: 50 }), RangeError);
  assert.throws(() => automaticityDrill(null), RangeError);
});

test('varyStimulus: no adjacent identical facts, deterministic, in-range, bounded under redraw pressure', () => {
  const rules = customRules({ enabled: ['mul'], durationSeconds: 60, multiplication: { left: [7, 7], right: [2, 9] } });
  const a = varyStimulus(createGenerator(rules, 'seed-a'))();
  const seq = (() => { const g = varyStimulus(createGenerator(rules, 'seed-a')); return Array.from({ length: 200 }, () => g()); })();
  const base = (() => { const g = createGenerator(rules, 'seed-a'); return Array.from({ length: 400 }, () => g()); })();
  // Determinism: same seed produces the identical sequence.
  const b = (() => { const g = varyStimulus(createGenerator(rules, 'seed-a')); return Array.from({ length: 200 }, () => g()); })();
  assert.deepEqual(seq, b);
  // No adjacent repeat anywhere in the output, though the base draw contains them under these ranges.
  for (let i = 1; i < seq.length; i++) {
    assert.ok(!((prev => prev.op === seq[i].op && prev.sourceLeft === seq[i].sourceLeft && prev.sourceRight === seq[i].sourceRight)(seq[i - 1])), `adjacent repeat at ${i}`);
  }
  const baseHasRepeats = base.some((q, i) => i > 0 && q.op === base[i - 1].op && q.sourceLeft === base[i - 1].sourceLeft && q.sourceRight === base[i - 1].sourceRight);
  assert.ok(baseHasRepeats, 'base stream actually contains adjacent repeats, so the guard does something');
  // Draw quality is preserved: every emitted question is valid and in range.
  for (const q of [...seq, a]) {
    assert.equal(q.sourceLeft, 7);
    assert.ok(q.sourceRight >= 2 && q.sourceRight <= 9);
    assert.equal(q.answer, 7 * q.sourceRight);
  }
});

test('varyStimulus terminates on a single-fact range (cap emits regardless)', () => {
  const rules = customRules({ enabled: ['mul'], durationSeconds: 60, multiplication: { left: [5, 5], right: [5, 5] } });
  const g = varyStimulus(createGenerator(rules, 'x'), { maxRedraws: 4 });
  for (let i = 0; i < 10; i++) {
    const q = g();
    assert.equal(`${q.sourceLeft}*${q.sourceRight}`, '5*5');
  }
  assert.throws(() => varyStimulus(() => makeQuestion('add', 1, 1), { maxRedraws: -1 }), RangeError);
});
