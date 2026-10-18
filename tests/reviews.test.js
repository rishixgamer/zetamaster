import test from 'node:test';
import assert from 'node:assert/strict';
import { drillReviewOutcome, reviewQueue, nearestRankMedian, eventHadWrongAttempt, SKILL_REVIEW_FAST_MS, SKILL_REVIEW_MIN_SOLVES } from '../packages/training/src/reviews.js';
import { skillCellFromId, skillCellFor, skillOf, SKILL_MIN_SAMPLES } from '../packages/training/src/skills.js';
import { skillReviewRecord } from '../packages/training/src/scheduler.js';
import { parseSkillId } from '../packages/storage/src/sanitize.js';
import { masteryProxy, AUTOMATICITY_MS } from '../packages/analytics/src/skill-model.js';
import { patternDrill } from '../packages/training/src/drills.js';
import { makeQuestion, createGenerator } from '../packages/core/src/generator.js';
import { ArithmeticSession } from '../packages/core/src/session.js';

// Review semantics (F19 slice 2): tests are fixed-clock with explicit evidence. The defining rule:
// a completed pattern-drill run with at least SKILL_REVIEW_MIN_SOLVES in-cell solves records one
// review that succeeds when at least half those solves finished at or under SKILL_REVIEW_FAST_MS —
// the nearest-rank median formulation of the same share statement (see docs/SKILLS.md).

const NOW = Date.parse('2026-10-17T12:00:00Z');
const T = '2026-10-17T12:00:00Z';
const DAY = 86400000;
const ev = (a, b, responseMs) => ({ ...makeQuestion('mul', a, b), responseMs, correct: true });
const cell7x45 = skillCellFor('mul', 7, 45);

test('review thresholds are shared with the F20 mastery proxy, not re-declared', () => {
  assert.equal(SKILL_REVIEW_FAST_MS, 2000);
  assert.equal(AUTOMATICITY_MS, 2000);
  assert.equal(SKILL_REVIEW_MIN_SOLVES, 3);
  assert.equal(SKILL_MIN_SAMPLES, SKILL_REVIEW_MIN_SOLVES, 'run-length gate mirrors the rollup gate');
  assert.equal(masteryProxy([{ tags: ['x'], correct: true, responseMs: 2000 }], 'x').estimate, (1 + 4) / 9, 'the shared line still decides mastery passes');
});

test('nearest-rank median: smallest value with at least half the values at or below it', () => {
  assert.equal(nearestRankMedian([5]), 5, 'single value');
  assert.equal(nearestRankMedian([3, 1, 4, 1, 5]), 3, 'n=5 → 3rd smallest');
  assert.equal(nearestRankMedian([9, 1, 7, 2]), 2, 'n=4 → 2nd smallest');
  assert.equal(nearestRankMedian([1900, 2100]), 1900, 'n=2 lowers to the smaller value');
  assert.equal(nearestRankMedian([2000, 3000]), 2000);
  assert.equal(nearestRankMedian([900, 1000, 1200, 2400]), 1000, 'unsorted input');
  assert.equal(nearestRankMedian([]), null);
  assert.equal(nearestRankMedian(['x', null, 3]), 3, 'non-finite entries ignored');
});

test('outcome success rule: at least half the solves at or under the 2000 ms line', () => {
  assert.equal(drillReviewOutcome([ev(7, 45, 1900), ev(7, 46, 1900), ev(7, 47, 1900)]).wasFastAndCorrect, true, 'all fast');
  assert.equal(drillReviewOutcome([ev(7, 45, 1900), ev(7, 46, 2000), ev(7, 47, 3000), ev(7, 48, 3000)]).wasFastAndCorrect, true, 'exactly half inside the line passes (nearest-rank 50th = 2000 ≤ 2000)');
  assert.equal(drillReviewOutcome([ev(7, 45, 1900), ev(7, 46, 2100), ev(7, 47, 3000), ev(7, 48, 3000)]).wasFastAndCorrect, false, 'nearest-rank (2100 > 2000) decides, not the interpolated median (would be 2000)');
  assert.equal(drillReviewOutcome([ev(7, 45, 2000), ev(7, 46, 2100), ev(7, 47, 2200)]).wasFastAndCorrect, false, '1 of 3 inside the line fails');
  assert.equal(drillReviewOutcome([ev(7, 45, 2001), ev(7, 46, 2100), ev(7, 47, 3000)]).wasFastAndCorrect, false, '2001 ms median is above the line');
  const meta = drillReviewOutcome([ev(7, 45, 1900), ev(7, 46, 2000), ev(7, 47, 3000)]);
  assert.equal(meta.wasFastAndCorrect, true, 'the share rule decides, and the deciding median is reported');
  assert.equal(meta.solveCount, 3);
  assert.equal(meta.medianMs, 2000);
  assert.equal(meta.fastMs, 2000);
});

test('outcome is null for interrupted or too-thin runs, and ignores unusable times', () => {
  for (const bad of [null, 'x', undefined, {}, []]) assert.equal(drillReviewOutcome(bad), null, 'non-array input');
  assert.equal(drillReviewOutcome([ev(7, 45, 10)]), null, '1 solve');
  assert.equal(drillReviewOutcome([ev(7, 45, 900), ev(7, 46, 1000), ev(7, 47, 1100)]).wasFastAndCorrect, true, '3 solves is the gate');
  assert.equal(drillReviewOutcome([ev(7, 45, 900), ev(7, 46, 1000)]), null, '2 solves is not enough');
  assert.equal(drillReviewOutcome([ev(7, 45, 900), ev(7, 46, 1000), ev(7, 47, 1100)], { minSolves: 4 }), null, 'explicit gate override');
  assert.equal(drillReviewOutcome([ev(7, 45, 900), ev(7, 46, 2600), ev(7, 47, 2800)], { fastMs: 3000 }).wasFastAndCorrect, true, 'explicit threshold override with the run-length gate met');
  const messy = [ev(7, 45, 900), { ...ev(7, 46, 950), responseMs: undefined }, { ...ev(7, 47, 950), responseMs: -5 }, { ...ev(7, 48, 950), responseMs: 'later' }, {}, { ...ev(7, 49, 950), responseMs: null }, ev(7, 50, 1000), ev(7, 51, 940)];
  const out = drillReviewOutcome(messy);
  assert.equal(out.solveCount, 3, 'non-finite and negative times are ignored, not counted');
  assert.equal(out.medianMs, 940, 'median computed over only the usable times');
  assert.equal(out.wasFastAndCorrect, true);
  assert.equal(drillReviewOutcome([ev(7, 45, 900), ev(7, 46, 950), ev(7, 47, 1100)], { endedEarly: true }), null, 'interrupted drills never schedule');
});

// Accuracy half (F07/F11/F39 follow-up): a solved question that shows a wrong answer first — a
// complete wrong value typed or Enter pressed on a wrong field — is not automatic recall. The
// clean share decides like the speed share does: at least half. Two helpers: `dirtyCarried`
// models an engine-3 solve with the persisted history, `dirtyCounter` a pre-history engine-2
// solve judged from its counters.
const dirtyCarried = ms => ({ ...ev(7, 46, ms), wrongSubmissions: 1, wrongAttempts: [{ value: '62', atMs: 300 }] });
const dirtyCounter = ms => ({ ...ev(7, 46, ms), wrongSubmissions: 2 });

test('accuracy half-rule: at least half of the in-cell solves must avoid a wrong answer', () => {
  const a = drillReviewOutcome([dirtyCarried(900), ev(7, 45, 1000), ev(7, 47, 1100)]);
  assert.equal(a.wasFastAndCorrect, true, '2 of 3 solves clean passes with a fast median');
  assert.deepEqual([a.solveCount, a.cleanCount, a.wrongAttemptSolves], [3, 2, 1]);
  assert.ok(Math.abs(a.cleanShare - 2 / 3) < 1e-12);
  const b = drillReviewOutcome([dirtyCarried(900), dirtyCarried(950), ev(7, 45, 1000), ev(7, 47, 1000)]);
  assert.equal(b.wasFastAndCorrect, true, 'exactly half clean passes, mirroring the speed share shape');
  assert.equal(b.cleanShare, 0.5);
  const c = drillReviewOutcome([dirtyCarried(900), dirtyCarried(950), dirtyCarried(1000), ev(7, 45, 1000)]);
  assert.equal(c.wasFastAndCorrect, false, 'majority dirty fails even when the medians are fast');
  assert.equal(c.cleanCount, 1);
  const slow = drillReviewOutcome([ev(7, 45, 1900), ev(7, 46, 2100), ev(7, 47, 3000)]);
  assert.equal(slow.wasFastAndCorrect, false, 'a clean-but-slow run fails on speed only — the two rules need both');
  assert.equal(slow.cleanCount, 3);
});

test('pre-engine-3 solves are judged from their counters; field absence is never guilt', () => {
  const counter = drillReviewOutcome([dirtyCounter(1000), dirtyCounter(1000), ev(7, 45, 1000)]);
  assert.equal(counter.wasFastAndCorrect, false, 'engine-2 events with no wrongAttempts list are still caught via wrongSubmissions');
  assert.deepEqual([counter.cleanCount, counter.wrongAttemptSolves], [1, 2]);
  const mild = drillReviewOutcome([dirtyCounter(1000), ev(7, 45, 1000), ev(7, 47, 1000)]);
  assert.equal(mild.wasFastAndCorrect, true, 'one counter-recorded wrong attempt among three is still majority clean');
  const full = { ...ev(7, 46, 1000), fullWrongAnswers: 1 };
  assert.equal(drillReviewOutcome([full, full, ev(7, 45, 1000)]).wasFastAndCorrect, false, 'a complete wrong value typed without Enter counts too (majority dirty fails)');
  const naive = drillReviewOutcome([{ ...ev(7, 45, 1000), wrongSubmissions: undefined }, ev(7, 46, 1000), ev(7, 47, 1000)]);
  assert.equal(naive.wasFastAndCorrect, true, 'engine-1-era events without counters lean clean: accuracy unknown, never invented');
  assert.equal(naive.cleanCount, 3);
  assert.equal(eventHadWrongAttempt({ wrongAttempts: [] }), false, 'an empty history is exactly "no wrong attempts recorded"');
  assert.equal(eventHadWrongAttempt({ wrongSubmissions: 0, fullWrongAnswers: 0, wrongAttempts: [] }), false);
  assert.equal(eventHadWrongAttempt(null), false);
});


test('skill cells reconstruct from stored ids against the current taxonomy', () => {
  for (const [a, b] of [[7, 45], [2, 2], [12, 100], [3, 9]]) {
    const direct = skillCellFor('mul', a, b), fromId = skillCellFromId(direct.id);
    assert.equal(fromId.id, direct.id);
    assert.equal(fromId.label, direct.label);
    assert.deepEqual(fromId.rowRange, direct.rowRange);
    assert.deepEqual(fromId.colRange, direct.colRange);
    assert.equal(parseSkillId(direct.id).id, direct.id, 'sanitize delegates to the same grammar');
  }
  const cell = skillCellFromId('mul:5:4');
  assert.deepEqual(cell.rowRange, [7, 7]);
  assert.deepEqual(cell.colRange, [40, 49]);
  assert.equal(cell.label, '7 × 40–49');
  assert.equal(cell.id, cell7x45.id);
  for (const bad of [null, undefined, 12, '', 'mul:5', 'mul:5:', 'mul:x:4', 'mul:99:0', 'add:10:0', 'mul:0:10', 'quant:0:0', 'MUL:5:4', 'mul:-1:2']) {
    assert.equal(skillCellFromId(bad), null, `reject ${JSON.stringify(bad)}`);
    assert.equal(parseSkillId(bad), null, `parse rejects ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(parseSkillId('sub:3:4'), { id: 'sub:3:4', op: 'sub', row: 3, col: 4 }, 'parse keeps its documented return shape');
});

/** Play a real 60-second pattern drill the way the UI runs it (mode 'drill', fixed solve pace). */
function playPatternDrill({ timePerSolve = 1800, seed = 'review-drill', seconds = 60 } = {}) {
  const rules = patternDrill(cell7x45, seconds);
  let t = 0;
  const s = new ArithmeticSession({ rules, generator: createGenerator(rules, seed), mode: 'drill', seed, clock: () => t, wallClock: () => T, drill: { op: 'mul', cell: cell7x45.id, label: '7 × 40–49' } });
  s.start();
  while (s.state === 'active') {
    if (t + timePerSolve > seconds * 1000) break;
    t += timePerSolve;
    s.recordInput(String(s.current.answer));
  }
  t = seconds * 1000;
  return s.finish();
}

test('a played pattern drill feeds the outcome and then the scheduling chain', () => {
  const result = playPatternDrill({ timePerSolve: 1800, seed: 'review-drill-1' });
  assert.equal(result.endedEarly, false, 'a full drill is never ended early');
  assert.ok(result.events.length >= 10, `drill generated ${result.events.length} solves`);
  assert.ok(result.events.every(e => skillOf(e)?.id === cell7x45.id), 'every drill problem lands in its cell');
  assert.ok(result.events.every(e => Array.isArray(e.wrongAttempts)), 'engine-3 events carry a (here empty) wrong-attempt history');
  assert.ok(result.events.every(e => eventHadWrongAttempt(e) === false), 'clean typing stays clean under both rules');
  const inCell = result.events.filter(e => skillOf(e)?.id === cell7x45.id);
  const outcome = drillReviewOutcome(inCell, { endedEarly: result.endedEarly });
  assert.equal(outcome.wasFastAndCorrect, true, '1.8 s solves are inside the automatization line');
  assert.equal(outcome.solveCount, result.events.length);
  assert.equal(outcome.medianMs, 1800);
  // Chain exactly like the UI does: outcome → record, with explicit clocks at each step.
  const first = skillReviewRecord(cell7x45.id, null, outcome.wasFastAndCorrect, T);
  assert.equal(first.intervalDays, 1, 'first success: 1 day');
  const lapse = skillReviewRecord(cell7x45.id, first, false, '2026-10-18T12:00:00Z');
  assert.equal(lapse.successes, 0, 'lapse resets the streak');
  assert.equal(lapse.failures, 1);
  assert.equal(lapse.intervalDays, 1, 'back to 1 day after a lapse');
  assert.equal(skillReviewRecord(cell7x45.id, lapse, true, '2026-10-19T12:00:00Z').intervalDays, 1);
  assert.equal(skillReviewRecord(cell7x45.id, first, true, '2026-10-18T12:00:00Z').intervalDays, 2, 'second success doubles the spacing');
});

const record = (id, nextReviewAt, successes = 0, failures = 0) => ({ id, skillId: id, op: id.split(':')[0], taxonomyVersion: 'skill-taxonomy-v1', successes, failures, intervalDays: 1, lastReviewedAt: T, nextReviewAt });

test('review queue prompts exactly the at-or-overdue records, deterministically', () => {
  const records = [
    record('murky:0:0', new Date(NOW - 3 * DAY).toISOString()),                 // unknown op → skipped
    record('mul:99:0', new Date(NOW - DAY).toISOString()),                      // out-of-range row → skipped
    record('mul:5:4', 'not-a-date'),                                            // unparseable → skipped
    record('add:0:0', new Date(NOW - 5 * DAY).toISOString()),                   // overdue
    record('div:0:0', new Date(NOW).toISOString()),                             // due exactly now (boundary)
    record('mul:5:4', new Date(NOW - DAY).toISOString()),                       // overdue, same cell again
    record('sub:1:0', new Date(NOW + 2 * DAY).toISOString()),                   // upcoming within window
    record('add:1:0', new Date(NOW + 7 * DAY).toISOString()),                   // window edge, inclusive
    record('div:9:9', new Date(NOW + 8 * DAY).toISOString()),                   // just outside the window
  ];
  const q = reviewQueue(records, NOW);
  assert.equal(q.total, 9);
  assert.equal(q.skipped, 3, 'malformed and foreign ids are counted, not crashed on');
  assert.deepEqual(q.due.map(x => x.id), ['add:0:0', 'mul:5:4', 'div:0:0'], 'op order add→sub→mul→div, then row/col');
  assert.ok(q.due[1].label.startsWith('7 ×'), `label comes from the taxonomy: ${q.due[1].label}`);
  assert.deepEqual(q.upcoming.map(x => x.id), ['sub:1:0', 'add:1:0'], 'upcoming sorted by next review time');
  for (const item of [...q.due, ...q.upcoming]) {
    assert.equal(item.nextMs, Date.parse(item.nextReviewAt), 'preparsed time matches the record');
    assert.ok(item.rowRange && item.colRange, 'launch needs the cell ranges');
  }
  const empty = { all: [], due: [], upcoming: [], skipped: 0, total: 0 };
  assert.deepEqual(reviewQueue([], NOW), empty, 'empty history degrades gracefully');
  assert.deepEqual(reviewQueue(null, NOW), empty);
  assert.deepEqual(reviewQueue([...records].reverse(), NOW).due.map(x => x.id), q.due.map(x => x.id), 'input order never changes the output order');
});
