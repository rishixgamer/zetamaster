import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDuelState, duelPlanFor, duelFeedAnswer, duelWalkHtml } from '../apps/web/src/duel-ui.js';
import { drawDuels, duelFor, duelPlan, duelTally } from '../packages/curriculum/src/strategies.js';
import { checkGuideAnswer } from '../packages/curriculum/src/guides.js';

// Strategy duel UI (F27, M3 close-out): pure state-machine behavior. The math belongs to
// strategies.js/guides.js (pinned there); these tests drive one full duel walk end to end,
// proving the tally stays aligned per arm over the identical problems, that a wrong entry costs
// first-try but never blocks the walk, and that the state machine finishes exactly after
// problems × arms steps. Nothing here is timed, scored, or persisted.

const walkCorrect = (state, planOf) => {
  let results = [];
  let guard = 0;
  while (!state.done && guard++ < 200) {
    const plan = planOf(state);
    const step = plan.steps[state.step];
    const feed = duelFeedAnswer(state, String(step.answer));
    results.push({ correct: feed.correct, armDone: feed.armDone, duelDone: feed.duelDone });
    state = feed.state;
  }
  return { state, results };
};

test('a duel state covers every problem with both arms, and finishing needs exactly problems×arms answer sequences', () => {
  const seed = 'duel-walk-seed';
  const fixture = drawDuels('add', seed, { pairs: 3 });
  assert.equal(fixture.problems.length, 3);
  assert.equal(fixture.order.length, 2);
  let state = freshDuelState('add', seed);
  assert.ok(state.usable);
  assert.deepEqual(state.tally[fixture.order[0]], []);
  const { state: final, results } = walkCorrect(state, duelPlanFor);
  assert.equal(final.done, true);
  // Each arm of each problem produced one step-batch success and one arm completion.
  assert.equal(results.filter(r => r.armDone).length, 6); // 3 problems × 2 arms
  assert.equal(results.filter(r => r.duelDone).length, 1, 'the duel completes exactly once');
  assert.deepEqual(final.tally[fixture.order[0]], [{ correct: true }, { correct: true }, { correct: true }]);
  assert.deepEqual(final.tally[fixture.order[1]], [{ correct: true }, { correct: true }, { correct: true }]);
  const tally = duelTally(final.tally[fixture.order[0]], final.tally[fixture.order[1]]);
  assert.equal(tally.both, 3);
  assert.equal(tally.correctA, 3);
  assert.equal(tally.correctB, 3);
});

test('a wrong entry marks the side first-try-lost but the walk continues to completion', () => {
  const seed = 'duel-wrong-seed';
  const fixture = drawDuels('add', seed, { pairs: 3 });
  const [armA, armB] = fixture.order;
  let state = freshDuelState('add', seed);
  // First arm, first step: feed a deliberately wrong value once.
  const plan = duelPlanFor(state);
  const feed = duelFeedAnswer(state, '99999');
  assert.equal(feed.correct, false);
  assert.equal(feed.duelDone, false);
  state = feed.state;
  assert.equal(state.firstTry, false, 'the cost of a wrong entry is exactly first-try status');
  assert.equal(state.step, 0, 'the step does not advance on a wrong entry');
  const { state: final } = walkCorrect(state, duelPlanFor);
  assert.equal(final.done, true);
  // armA's first problem is the flawed one; everything else stays first-try clean.
  const expectedA = fixture.order.indexOf(armA) === 0 ? [{ correct: false }, { correct: true }, { correct: true }] : [{ correct: true }, { correct: true }, { correct: true }];
  assert.deepEqual(final.tally[armA], expectedA);
  assert.deepEqual(final.tally[armB], [{ correct: true }, { correct: true }, { correct: true }]);
  const tally = duelTally(final.tally[armA], final.tally[armB]);
  assert.ok(tally.onlyA === 1 || tally.onlyB === 1, 'exactly one head-to-head line differs after one wrong entry');
});

test('both arms plan every fixture problem to the same final answer via the game answer rule', () => {
  const seed = 'duel-agree-seed';
  const duel = duelFor('div');
  const fixture = drawDuels('div', seed, { pairs: 3 });
  for (const problem of fixture.problems) {
    const plans = duel.techniques.map(id => duelPlan('div', problem, id));
    for (const plan of plans) {
      assert.ok(plan, 'both curated arms plan every shared-domain problem');
      for (const step of plan.steps) {
        assert.ok(checkGuideAnswer(String(step.answer), step.answer), 'the exact computed answer always checks');
        assert.ok(!checkGuideAnswer(`${step.answer}9`, step.answer), 'wrong text never checks');
      }
      assert.equal(plan.result, plans[0].result, `both arms end at ${problem.text}'s quotient`);
    }
  }
});

test('operations without overlapping card pairs yield unusable state and honest empty views', () => {
  // Only 'add' and 'div' have real duels; 'sub'/'mul' state is unusable by design (WHY_NO_DUEL).
  const subDuel = freshDuelState('sub', 'x');
  assert.equal(subDuel.usable, false);
  assert.equal(duelPlanFor(subDuel), null);
  assert.equal(duelWalkHtml(subDuel), '', 'nothing renders for an operation with no duel');
  const finishedFeed = duelFeedAnswer(subDuel, '1');
  assert.equal(finishedFeed.duelDone, true);
  // The complete-duel view still renders for usable duels, in both walk and tally shapes.
  const addState = freshDuelState('add', 'duel-walk-seed');
  assert.ok(duelWalkHtml(addState).includes('Problem 1 of 3'));
  assert.ok(duelWalkHtml({ ...addState, done: true }).includes('Duel complete'), 'the tally view renders for real duels');
});

test('fixture problems render with their operation glyph and the shown seed', () => {
  const state = freshDuelState('div', 'glyph-seed');
  const html = duelWalkHtml(state);
  assert.ok(html.includes('Problem 1 of 3'), 'progress markers render');
  assert.ok(html.includes('side 1 of 2'));
  assert.ok(html.includes('seed glyph-seed'), 'the seed travels with the problems for reproducibility');
  assert.ok(html.includes('÷'), 'division problems show the division glyph');
});
