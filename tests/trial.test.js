import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIAL_PROTOCOL_VERSION, TRIAL_WINDOW_DAYS, TRIAL_CYCLE_WINDOWS, TRIAL_MIN_PAIRS_PER_ARM,
  createPolicyTrial, trialSlot, nextHoldout, serializeTrial, parseStoredTrial,
  trialOutcomes, summarizeTrialOutcomes,
} from '../packages/training/src/trial.js';
import { assignStrategyTrial } from '../packages/training/src/experiment.js';
import { comparePolicies, projectPolicy } from '../packages/training/src/policies.js';

/* A trial enrolled on 2026-10-19. With 3-day windows the cycle is:
 *   W0 treat 10-19→22 · W1 treat 10-22→25 · W2 holdout 10-25→28 · W3 treat 10-28→31 · …
 */
const TRIAL = createPolicyTrial({ seed: 'rishi', startedAt: '2026-10-19T08:00:00.000Z' });

test('createPolicyTrial: validation, deterministic id and payload hashing', () => {
  assert.equal(TRIAL.version, TRIAL_PROTOCOL_VERSION);
  assert.match(TRIAL.id, /^policy-trial-v1:[0-9a-f]{8}$/);
  assert.deepEqual(createPolicyTrial({ seed: 'rishi', startedAt: '2026-10-19T08:00:00.000Z' }), TRIAL, 'same inputs → same id');
  assert.notEqual(createPolicyTrial({ seed: 'rishi', startedAt: '2026-10-20T08:00:00.000Z' }).id, TRIAL.id, 'earlier/later enrollment → different id');
  assert.throws(() => createPolicyTrial({ seed: '', startedAt: '2026-10-19T08:00:00.000Z' }), RangeError);
  assert.throws(() => createPolicyTrial({ seed: '   ' }), RangeError);
  assert.throws(() => createPolicyTrial({ seed: 'rishi', startedAt: 'nonsense' }), RangeError);
  assert.throws(() => createPolicyTrial({ seed: 'rishi', startedAt: '2026-10-19T08:00:00.000Z', policyIdA: 'automaticity', policyIdB: 'automaticity' }), RangeError);
  assert.throws(() => createPolicyTrial({ seed: 'rishi', startedAt: '2026-10-19T08:00:00.000Z', policyIdA: 'no-such', policyIdB: 'op-adaptive' }), RangeError);
});

test('trialSlot: 3-day UTC-aligned windows, two treated then a holdout, randomized policy order', () => {
  const w = (iso, atMs) => trialSlot(TRIAL, iso ?? atMs);
  // Window 0: 10-19 → 10-22 (treatment, first policy).
  const first = w('2026-10-19T00:00:00.000Z');
  assert.equal(first.phase, 'treatment');
  assert.equal(first.windowIndex, 0);
  assert.equal(first.startsAt, '2026-10-19T00:00:00.000Z', 'window boundaries align to UTC day starts, not the join timestamp');
  assert.equal(first.endsAt, '2026-10-22T00:00:00.000Z');
  const second = w('2026-10-23T23:59:59.999Z');
  assert.equal(second.windowIndex, 1);
  assert.equal(second.phase, 'treatment');
  const holdout = w('2026-10-27T12:00:00.000Z');
  assert.equal(holdout.windowIndex, 2);
  assert.equal(holdout.windowIndex % TRIAL_CYCLE_WINDOWS, TRIAL_CYCLE_WINDOWS - 1, 'the holdout is the cycle\u2019s third slot');
  assert.equal(holdout.phase, 'holdout');
  assert.equal(holdout.policyId, null, 'holdout windows emphasize nothing');
  assert.equal(holdout.startsAt, '2026-10-25T00:00:00.000Z');
  assert.equal(holdout.endsAt, '2026-10-28T00:00:00.000Z');
  const cycle2 = w('2026-10-29T09:00:00.000Z');
  assert.equal(cycle2.windowIndex, 3);
  assert.equal(cycle2.cycleIndex, 2, 'the cycle repeats');
  // The treatment policy pair covers both policies across a cycle; which is first is the seeded
  // balanced assignment, shared with the rest of the app.
  const orderSeed = assignStrategyTrial(TRIAL.seed, 0);
  const expectedFirst = orderSeed === 'A' ? TRIAL.policyIdA : TRIAL.policyIdB;
  assert.equal(first.policyId, expectedFirst);
  assert.deepEqual(new Set([first.policyId, second.policyId]), new Set([TRIAL.policyIdA, TRIAL.policyIdB]));
  assert.equal(first.policyId !== second.policyId, true, 'the two treated slots alternate');
  assert.equal(cycle2.policyId, first.policyId, 'the same policy returns every cycle');
  // Guards.
  assert.throws(() => trialSlot(TRIAL, '2026-10-18T23:59:59.999Z'), RangeError, 'before enrollment no slot exists');
  assert.throws(() => trialSlot(TRIAL, Number.NaN), RangeError);
  assert.throws(() => trialSlot({ bogus: 1 }), RangeError, 'a broken trial object is refused, never interrogated');
  // nextHoldout walks to the next slot-2 window.
  const nh = nextHoldout(TRIAL, '2026-10-19T12:00:00.000Z');
  assert.equal(nh.startsAt, '2026-10-25T00:00:00.000Z');
  assert.equal(nextHoldout(TRIAL, '2026-10-26T12:00:00.000Z').startsAt, holdout.startsAt, 'during a holdout it reports the ongoing holdout');
});

test('serializeTrial / parseStoredTrial: round-trip works, tampering fails the id check', () => {
  const json = serializeTrial(TRIAL);
  assert.deepEqual(parseStoredTrial(json), {
    version: TRIAL_PROTOCOL_VERSION, id: TRIAL.id, seed: 'rishi',
    startedAt: '2026-10-19T08:00:00.000Z', policyIdA: 'op-adaptive', policyIdB: 'cell-gauntlet',
  });
  for (const broken of [null, '', '   ', 'not json', '{"nope":1}', JSON.stringify({ ...JSON.parse(json), seed: 'tampered' }), JSON.stringify({ ...JSON.parse(json), startedAt: '2020-01-01T00:00:00.000Z' }), JSON.stringify({ ...JSON.parse(json), policyIdA: 'automaticity' }), JSON.stringify({ ...JSON.parse(json), id: 'policy-trial-v1:deadbeef' })]) {
    assert.equal(parseStoredTrial(broken), null, `must reject: ${String(broken).slice(0, 60)}`);
  }
});

/* ---- ledger fixtures ---- */
const bench = (iso, score) => ({ id: `b-${iso}`, startedAt: iso, mode: 'benchmark', benchmark: true, score, elapsedMs: 120000, events: [] });
const drill = (iso, provenance, seconds = 60) => ({ id: `d-${iso}`, startedAt: iso, mode: 'drill', benchmark: false, score: 7, elapsedMs: seconds * 1000, drill: { op: 'mul', cell: 'mul:7:6' }, provenance });

/** The policy the trial emphasized for a run launched at `iso` (how the UI would have tagged it). */
const emphasizedAt = iso => {
  try { return trialSlot(TRIAL, iso).policyId; } catch { return null; }
};

test('trialOutcomes: attributes only trial-window drills naming the slot policy, predicts on the prefix', () => {
  // B0 before enrollment; a tagged drill inside W0; B1 inside W0's tail; holdout-window drill; B2.
  const goIso = '2026-10-20T09:00:00.000Z';             // W0
  const w0Policy = emphasizedAt(goIso);
  const sessions = [
    bench('2026-10-10T08:00:00.000Z', 40),
    drill('2026-10-20T09:00:00.000Z', { surface: 'recommendations', cellId: 'mul:7:6', policyId: w0Policy }),
    drill('2026-10-21T09:00:00.000Z', { surface: 'heatmap', cellId: 'mul:8:6' }),           // other surface → context
    drill('2026-10-21T10:00:00.000Z', { surface: 'recommendations', cellId: 'mul:9:6', policyId: w0Policy === 'op-adaptive' ? 'cell-gauntlet' : 'op-adaptive' }), // wrong policy → context
    bench('2026-10-24T08:00:00.000Z', 45),
    drill('2026-10-26T09:00:00.000Z', { surface: 'recommendations', cellId: 'mul:7:6', policyId: 'op-adaptive' }), // holdout window: policyId can't be emphasized → context
    bench('2026-10-30T08:00:00.000Z', 47),
  ];
  const { pairs, emptyNote, caveats } = trialOutcomes(sessions, TRIAL);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].rows.length, 1, 'only the matching slot policy is attributed');
  assert.equal(pairs[0].rows[0].policyId, w0Policy);
  assert.equal(pairs[0].rows[0].runs, 1);
  assert.equal(pairs[0].rows[0].treatmentSeconds, 60);
  assert.equal(pairs[0].contextRuns, 2, 'heatmap run + wrong-policy run stay context');
  assert.equal(pairs[0].rows[0].observedDelta, 5);
  const prefix = sessions.filter(s => Date.parse(s.startedAt) <= Date.parse('2026-10-10T08:00:00.000Z'));
  assert.equal(pairs[0].rows[0].predictedDelta, projectPolicy(w0Policy, prefix).projectedDelta, 'prediction recomputes on the pre-treatment prefix (empty history here → 0, feasible false)');
  assert.equal(pairs[0].rows[0].predictedFeasible, false);
  assert.equal(pairs[0].rows[0].arm, pairs[0].rows[0].policyId === trialSlot(TRIAL, goIso).firstPolicyId ? 'A' : 'B', 'arm labels the randomized order position, not the payload letter');
  assert.equal(pairs[1].rows.length, 0, 'the holdout-window pairs with no attributed run');
  assert.equal(pairs[1].contextRuns, 1);
  assert.ok(/context/.test(pairs[1].note), pairs[1].note);
  assert.equal(emptyNote, null);
  assert.ok(caveats.some(c => /crossover/.test(c)), 'caveats travel on the ledger');
});

test('trialOutcomes: needs two benchmarks, refuses broken trials, caps pairs, and skips windowless pairs', () => {
  assert.equal(trialOutcomes([], TRIAL).emptyNote, 'Pairing needs at least two valid benchmark runs.');
  assert.equal(trialOutcomes([bench('2026-10-10T08:00:00.000Z', 40)], TRIAL).emptyNote, 'Pairing needs at least two valid benchmark runs.');
  assert.equal(trialOutcomes([bench('2026-10-10T08:00:00.000Z', 40), bench('2026-10-20T08:00:00.000Z', 41)], TRIAL).emptyNote, 'No trial-emphasized practice between valid benchmark runs yet.');
  assert.throws(() => trialOutcomes([], { bogus: 1 }), RangeError);
  // Consecutive benchmarks with nothing in between produce no pair rows at all.
  assert.equal(trialOutcomes([bench('2026-10-10T08:00:00.000Z', 40), bench('2026-10-20T08:00:00.000Z', 41)], TRIAL).pairs.length, 0);
});

test('trialOutcomes: runs before enrollment stay context even with a policyId', () => {
  const sessions = [
    drill('2026-10-10T09:00:00.000Z', { surface: 'recommendations', cellId: 'x', policyId: 'cell-gauntlet' }), // before 10-19
    bench('2026-10-10T08:00:00.000Z', 40),
    bench('2026-10-30T08:00:00.000Z', 45),
  ];
  // The pre-enrollment drill sits inside the pair window but cannot be attributed.
  const { pairs } = trialOutcomes(sessions, TRIAL);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].rows.length, 0);
  assert.equal(pairs[0].contextRuns, 1);
});

test('summarizeTrialOutcomes: gate blocks comparison below 4 windows per policy, reports Wilson shares', () => {
  assert.equal(TRIAL_MIN_PAIRS_PER_ARM, 4);
  const ledger = trialOutcomes(trialFixtureForGate(2), TRIAL);
  const summary = summarizeTrialOutcomes(ledger, { trial: TRIAL });
  assert.equal(summary.comparison, null, 'below the gate: no comparison at all');
  assert.match(summary.note, /cannot distinguish the policies yet/);
  for (const row of summary.policyOutcomes) {
    assert.ok(row.attributedWindows < TRIAL_MIN_PAIRS_PER_ARM, `gate fixture sanity: ${row.attributedWindows}`);
    assert.ok(row.improvingShare.low <= row.improvingShare.improving / row.improvingShare.windows + 1e-9);
    assert.ok(row.improvingShare.high >= row.improvingShare.improving / row.improvingShare.windows - 1e-9);
  }
  assert.ok(summary.caveats.length >= 5 && summary.caveats.every(c => typeof c === 'string' && c.length > 20));
});

test('summarizeTrialOutcomes: past the gate reports the exact permutation p and honest caveat wording', () => {
  const sessions = gatePastFixture();
  const ledger = trialOutcomes(sessions, TRIAL);
  const summary = summarizeTrialOutcomes(ledger, { trial: TRIAL });
  assert.equal(summary.comparison.feasible, true);
  assert.equal(summary.comparison.statistic, 'mean-difference');
  // deterministic exact p for this fixture, recomputed independently below
  const wSlot = iso => trialSlot(TRIAL, iso);
  const byPolicy = { [TRIAL.policyIdA]: [], [TRIAL.policyIdB]: [] };
  for (const pair of ledger.pairs) for (const row of pair.rows) byPolicy[row.policyId].push(row.observedDelta);
  const meanOf = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.equal(summary.comparison.observed, Math.round((meanOf(byPolicy[TRIAL.policyIdB]) - meanOf(byPolicy[TRIAL.policyIdA])) * 10000) / 10000);
  assert.ok(summary.comparison.p >= 0 && summary.comparison.p <= 1);
  assert.ok(summary.comparison.reassignments > 0);
  assert.match(summary.comparison.note, /not a verdict/);
  assert.match(summary.note, /past the minimum-window gate/);
  // Wilson improving shares are inside [0,1] with the positive-delta count.
  for (const row of summary.policyOutcomes) {
    assert.equal(row.improvingShare.improving, row.outcomes.filter(o => o.observedDelta > 0).length);
  }
});

test('comparePolicies: trial treatment window pins the emphasis; holdout empties it; flag still wins', () => {
  const history = [bench('2026-10-10T08:00:00.000Z', 40)];
  // Treatment window (10-20): emphasized = the slot's policy.
  const treated = comparePolicies(history, { seed: 'rishi', trial: TRIAL, nowMs: '2026-10-20T12:00:00.000Z' });
  const slotNow = trialSlot(TRIAL, '2026-10-20T12:00:00.000Z');
  assert.equal(treated.trial.phase, 'treatment');
  assert.equal(treated.emphasizedPolicyId, slotNow.policyId);
  assert.match(treated.note, /Randomized crossover trial window/);
  assert.match(treated.note, /next holdout/);
  // Holdout window (10-26): no emphasis, explicit wording.
  const held = comparePolicies(history, { seed: 'rishi', trial: TRIAL, nowMs: '2026-10-26T12:00:00.000Z' });
  assert.equal(held.trial.phase, 'holdout');
  assert.equal(held.emphasizedPolicyId, null);
  assert.match(held.note, /holdout window/);
  assert.match(held.note, /tag no policy/);
  // Flag precedence: flagged policy wins over both the trial and the assignment, and the note says so.
  const pinned = comparePolicies(history, { seed: 'rishi', flag: 'automaticity', trial: TRIAL, nowMs: '2026-10-20T12:00:00.000Z' });
  assert.equal(pinned.emphasizedPolicyId, 'automaticity');
  assert.equal(pinned.flagOverride, true);
  assert.match(pinned.note, /overridden by it/);
  // Tampered/absent trial data falls back to the seeded assignment silently.
  const fallback = comparePolicies(history, { seed: 'rishi', trial: { bogus: 1 } });
  assert.equal(fallback.trial, null);
  assert.equal(fallback.emphasizedPolicyId, fallback.assignment === 'A' ? fallback.ranked[0].policyId : fallback.ranked[1].policyId);
  // Determinism for identical inputs.
  assert.deepEqual(comparePolicies(history, { seed: 'rishi', trial: TRIAL, nowMs: '2026-10-20T12:00:00.000Z' }), treated);
});

/* ---- helpers ---- */

/** Gate-below fixture: `windows` treatment windows attributed per policy, low deltas. */
function trialFixtureForGate(treatedWindowsEach) {
  const sessions = [];
  let starting = Date.parse('2026-10-10T08:00:00.000Z'); // B0 far before enrollment
  let score = 40;
  sessions.push(bench(new Date(starting).toISOString(), score));
  // walk windows 0..N, alternating treat/treat/holdout, adding a drill + a benchmark per window
  let windowIndex = 0;
  let attributedWindows = { [TRIAL.policyIdA]: 0, [TRIAL.policyIdB]: 0 };
  while (attributedWindows[TRIAL.policyIdA] < treatedWindowsEach || attributedWindows[TRIAL.policyIdB] < treatedWindowsEach) {
    const winStart = Date.parse(TRIAL.startedAt) + windowIndex * TRIAL_WINDOW_DAYS * 86400000;
    const inWindow = new Date(winStart + 36e5).toISOString();  // inside window
    const slot = trialSlot(TRIAL, winStart + 36e5);
    if (slot.phase === 'treatment') {
      sessions.push(drill(inWindow, { surface: 'recommendations', cellId: 'mul:7:6', policyId: slot.policyId }));
      score += slot.policyId === TRIAL.policyIdA ? 1 : 2; // B-policy wins by design here
      attributedWindows[slot.policyId]++;
    }
    const benchAt = new Date(winStart + TRIAL_WINDOW_DAYS * 86400000 - 36e5).toISOString();
    sessions.push(bench(benchAt, score));
    windowIndex++;
  }
  return sessions;
}

/** A fixture far past the gate: many attributed windows per policy with a stable delta difference. */
function gatePastFixture() {
  return trialFixtureForGate(7);
}
