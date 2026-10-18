import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyPlan, candidatePriority } from '../packages/training/src/planner.js';
import { allocateBudget, planSteps, reconcilePlan, togglePlanStep, completedMinutes, planRecordFrom, dayLogKey, PLAN_STEP_IDS } from '../packages/training/src/daylog.js';
import { plateauBranch, skillCoverage } from '../packages/training/src/plateau.js';
import { makeQuestion } from '../packages/core/src/generator.js';
import { sanitizeImportedDailyPlan } from '../packages/storage/src/sanitize.js';
import { exportBundle, parseExportBundle } from '../packages/storage/src/export.js';

const NOW = new Date('2026-10-18T09:00:00.000Z');

/** N synthetic standard benchmark runs with given flat scores (or a resolver by run index). */
function runs(scores, { startedBase = '2026-09-01T08:00:00.000Z', extraEvents = () => [] } = {}) {
  return scores.map((score, i) => ({
    id: `syn-${i}`, startedAt: new Date(Date.parse(startedBase) + i * 86400000).toISOString(),
    mode: 'benchmark', benchmark: true, score, elapsedMs: 120000, events: extraEvents(i),
  }));
}

test('allocateBudget: exact-minutes split follows weights, leftovers land on the biggest remainders', () => {
  const weights = PLAN_STEP_IDS.map(id => ({ id, weight: { warmup: 1, targeted: 2, lesson: 1.25, sprint: 1, reflect: 1 }[id] }));
  const at = total => Object.fromEntries(PLAN_STEP_IDS.map((id, i) => [id, allocateBudget(total, weights)[i]]));
  assert.equal(Object.values(at(15)).reduce((a, b) => a + b, 0), 15);
  assert.equal(at(15).targeted, 5, 'largest share to targeted practice (shares 2.4/4.8/3/2.4/2.4, leftovers to largest remainders)');
  assert.deepEqual(Object.values(at(3)), [1, 1, 1, 0, 0], 'tight budget still sums to 3 (remainders, ties to step order)');
  assert.equal(Object.values(at(0)).reduce((a, b) => a + b, 0), 0);
  assert.equal(Object.values(at(37)).reduce((a, b) => a + b, 0), 37, 'overshoot budget stays exact');
  assert.throws(() => allocateBudget(-1, weights), RangeError);
  assert.throws(() => allocateBudget(10, [{ id: 'a', weight: 0 }]), RangeError);
  // Determinism: same inputs, same split.
  assert.deepEqual(allocateBudget(15, weights), allocateBudget(15, weights));
});

test('dailyPlan: ids stable, budget totals to target, empty history still works', () => {
  for (const minutes of [15, 7, 0]) {
    const plan = dailyPlan([], minutes);
    assert.equal(plan.steps.reduce((a, s) => a + s.minutes, 0), minutes);
    assert.deepEqual(plan.steps.map(s => s.id), PLAN_STEP_IDS);
    assert.ok(plan.steps.every(s => Number.isSafeInteger(s.minutes) && s.minutes >= 0));
    assert.equal(plan.plateau, 'insufficient-data');
    assert.equal(plan.intervention, null);
    assert.equal(plan.coverage.observedCells, 0);
  }
  const empty = dailyPlan([], 15);
  assert.ok(empty.rationale.length > 20);
  assert.equal(empty.coverage.totalCells, 420, '10×10 add/sub + 11×10 mul/div');
});

/** One session carrying a reliably-observed slow cell (9 solves at 4200 ms) next to a fast
 * baseline cell (9 solves at 800 ms), so the slow cell's shrunken ratio exceeds the op median. */
function weakPatternSession() {
  const events = [];
  let seq = 0;
  for (let i = 0; i < 9; i++) events.push({ ...makeQuestion('mul', 7, 40 + i, ++seq), responseMs: 4200, firstInputMs: 300, entryMs: 3900, completedAtMs: i * 4200, correct: true });
  for (let i = 0; i < 9; i++) events.push({ ...makeQuestion('mul', 10, 90 + i, ++seq), responseMs: 800, firstInputMs: 200, entryMs: 600, completedAtMs: 40000 + i * 800, correct: true });
  return { id: 'weak-pattern', startedAt: '2026-09-14T08:00:00.000Z', mode: 'benchmark', benchmark: true, score: 18, elapsedMs: 120000, events };
}

test('coverage: observed and stable cell counts, per-op, scope-safe', () => {
  const events = [];
  let seq = 0;
  for (let i = 0; i < 9; i++) events.push({ ...makeQuestion('mul', 7, 40 + i, ++seq), responseMs: 4200, firstInputMs: 300, entryMs: 3900, completedAtMs: i * 4200, correct: true });
  for (let i = 0; i < 9; i++) events.push({ ...makeQuestion('mul', 10, 90 + i, ++seq), responseMs: 800, firstInputMs: 200, entryMs: 600, completedAtMs: 40000 + i * 800, correct: true });
  const sessions = [{ id: 's', startedAt: '2026-10-17T08:00:00.000Z', mode: 'benchmark', benchmark: true, score: 18, elapsedMs: 120000, events }];
  const cov = skillCoverage(sessions, { scope: 'benchmark' });
  assert.equal(cov.totalCells, 420);
  assert.equal(cov.observedCells, 2);
  assert.equal(cov.stableCells, 2, '9 solves in each cell is stable evidence');
  assert.ok(Math.abs(cov.observedShare - 2 / 420) < 1e-12);
  assert.equal(cov.perOp.mul.observed, 2);
  assert.equal(cov.perOp.mul.stable, 2);
  assert.equal(cov.perOp.add.observed, 0);
  const practiceOnly = [{ ...sessions[0], benchmark: false, mode: 'drill' }];
  assert.equal(skillCoverage(practiceOnly, { scope: 'benchmark' }).observedCells, 0, 'practice cannot touch the benchmark scope');
  assert.equal(skillCoverage(practiceOnly, { scope: 'all' }).observedCells, 2);
});

test('plateauBranch: flat lines map to intervention branches, improving history maps to none', () => {
  // Flat 12+ runs plus a reliable slow pattern → gauntlet branch.
  const flat = [...runs([31, 31, 30, 31, 30, 31, 30, 31, 30, 31, 30, 31]), weakPatternSession()];
  const plateau = plateauBranch(flat);
  assert.equal(plateau.status, 'possible-plateau');
  assert.equal(plateau.branch.name, 'gauntlet-rotate');
  assert.deepEqual(plateau.branch.actions, ['gauntlet', 'transfer-probe', 'standard-benchmark']);
  assert.ok(plateau.branch.why.includes('mul'), 'branch rationale names the evidence');
  // Improving trend → no intervention.
  const improving = plateauBranch(runs([30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85]));
  assert.equal(improving.status, 'improving');
  assert.equal(improving.branch, null);
  // Insufficient data → no intervention.
  const thin = plateauBranch(runs([30, 31]));
  assert.equal(thin.status, 'insufficient-data');
  assert.equal(thin.branch, null);
  // Flat but no weak pattern and a diagnosed slow operation → method-work branch. Fast add solves
  // against slow division solves give diagnose() the contrast it needs; no single cell clears the
  // stable gate (24 division solves spread over nine answer-band cells).
  const slowDivRuns = runs([31, 32, 30, 33, 34, 31, 32, 30, 33, 34, 31, 32], {
    extraEvents: () => {
      const ev = [];
      let seq = 0;
      for (let i = 0; i < 8; i++) ev.push({ ...makeQuestion('add', 30 + i, 40, ++seq), responseMs: 600, firstInputMs: 100, entryMs: 500, completedAtMs: i * 600, correct: true });
      for (const [a, b] of [[9, 90], [9, 95]]) ev.push({ ...makeQuestion('div', a, b, ++seq), responseMs: 5200, firstInputMs: 300, entryMs: 4900, completedAtMs: 5000 + seq * 5200, correct: true });
      return ev;
    },
  });
  const method = plateauBranch(slowDivRuns);
  assert.equal(method.status, 'possible-plateau');
  assert.equal(method.branch.name, 'method-work');
  // Flat, nothing diagnosable → consistency-rest.
  const nothing = runs([31, 32, 30, 33, 34, 31, 32, 30, 33, 34, 31, 32]);
  assert.equal(plateauBranch(nothing).branch.name, 'consistency-rest');
});

test('dailyPlan surfaces the intervention and biases allocation toward the branch', () => {
  const flat = [...runs([31, 31, 30, 31, 30, 31, 30, 31, 30, 31, 30, 31]), weakPatternSession()];
  const plan = dailyPlan(flat, 15);
  assert.equal(plan.intervention?.name, 'gauntlet-rotate');
  assert.equal(plan.plateau, 'possible-plateau');
  const mechanical = dailyPlan([], 15);
  const ta = plan.steps.find(s => s.id === 'targeted').minutes;
  const tb = mechanical.steps.find(s => s.id === 'targeted').minutes;
  assert.ok(ta > tb, `gauntlet branch should push more minutes into targeted practice (${ta} > ${tb})`);
  assert.equal(plan.steps.reduce((x, y) => x + y.minutes, 0), 15, '…without breaking the exact budget');
});

test('completion ledger: reconcile, toggle, minutes, record shape', () => {
  const plan = dailyPlan([], 15);
  // Toggling two steps persists those flags through a reconcile round-trip.
  let states = reconcilePlan(plan.steps, null);
  assert.equal(states.every(s => s.completed === false), true);
  const nowIso = '2026-10-18T10:30:00.000Z';
  states = togglePlanStep(states, 'warmup', true, nowIso);
  states = togglePlanStep(states, 'sprint', true, nowIso);
  assert.equal(completedMinutes(states), 5, 'warm-up (1) + sprint (4 at weight...');
  // planRecordFrom → sanitize round-trip keeps everything the record needs.
  const record = planRecordFrom(states, { dateKey: '2026-10-18', targetMinutes: 15, updatedAt: nowIso });
  assert.equal(record.id, '2026-10-18');
  assert.equal(record.completedMinutes, completedMinutes(states));
  assert.deepEqual(JSON.parse(JSON.stringify(record)).steps.map(s => s.id), PLAN_STEP_IDS);
  const re = reconcilePlan(plan.steps, record);
  assert.deepEqual(re.map(s => s.completed), [true, false, false, true, false]);
  // Later plan regenerations (e.g. reweighted steps) keep completion state, not stale minutes.
  const reshPlan = { ...plan, steps: plan.steps.map(s => ({ ...s, minutes: s.minutes + 1 })) };
  const re2 = reconcilePlan(reshPlan.steps, record);
  assert.equal(find2(re2, 'warmup').minutes, find2(plan.steps, 'warmup').minutes + 1, 'minutes follow the plan');
  assert.equal(find2(re2, 'warmup').completed, true, 'completion follows the record');
  function find2(xs, id) { return xs.find(x => x.id === id); }
});

test('dayLogKey: local-day formatting rejects garbage', () => {
  // Local-component construction makes the expectation TZ-independent: an instant built at local
  // 00:30 and one built at local 23:30 sit on the same LOCAL calendar day whatever the machine's
  // offset (a UTC-based key would diverge in most zones), so both keys must be that day.
  assert.equal(dayLogKey(new Date(2026, 9, 18, 0, 30)), '2026-10-18');
  assert.equal(dayLogKey(new Date(2026, 9, 18, 23, 30)), '2026-10-18');
  // Round-tripping the instant through its UTC ISO string cannot change its local day.
  assert.equal(dayLogKey(new Date(2026, 9, 18, 0, 30).toISOString()), '2026-10-18');
  // Exactly 48h of clock time advances the local calendar by two days (no offset jump that large
  // exists, and no DST boundary lies between 2026-09-30 and 2026-10-02 anywhere).
  const noonSep30 = new Date(2026, 8, 30, 12, 0).getTime();
  assert.equal(dayLogKey(new Date(noonSep30 + 2 * 86400000)), '2026-10-02', 'calendar math, not UTC math');
  assert.throws(() => dayLogKey('nonsense'), RangeError);
});

test('import sanitization: daily plans are whitelist-reconstructed and score-free', () => {
  const good = {
    id: '2026-10-18', date: '2026-10-18', targetMinutes: 15,
    steps: [
      { id: 'warmup', minutes: 2, completed: true, completedAt: '2026-10-18T10:30:00.000Z' },
      { id: 'targeted', minutes: 6, completed: false, completedAt: null },
      { id: 'lesson', minutes: 4, completed: false, completedAt: null },
      { id: 'sprint', minutes: 2, completed: false, completedAt: null },
      { id: 'reflect', minutes: 1, completed: false, completedAt: null },
    ],
    completedMinutes: 2, updatedAt: '2026-10-18T10:30:00.000Z',
    benchmark: 99, score: 999, benchmarkEquivalent: 'forge attempt',
  };
  const clean = sanitizeImportedDailyPlan(good);
  assert.equal(clean.id, '2026-10-18');
  assert.equal(clean.completedMinutes, 2);
  assert.equal('score' in clean, false, 'no score fields exist on plan records');
  assert.equal('benchmark' in clean, false);
  // Forged: bad date, impossible date, duplicate ids, negative minutes, wrong types.
  assert.equal(sanitizeImportedDailyPlan({ ...good, date: '2026-13-44' }), null);
  assert.equal(sanitizeImportedDailyPlan({ ...good, date: 'nonsense' }), null);
  assert.equal(sanitizeImportedDailyPlan({ ...good, targetMinutes: -3 }), null);
  assert.equal(sanitizeImportedDailyPlan({ ...good, steps: [...good.steps, { ...good.steps[0], minutes: 1 }] }), null, 'duplicate ids rejected');
  assert.equal(sanitizeImportedDailyPlan({ ...good, steps: good.steps.map((s, i) => i === 1 ? { ...s, minutes: -6 } : s) }), null);
  assert.equal(sanitizeImportedDailyPlan({ ...good, steps: good.steps.map((s, i) => i === 1 ? { ...s, completed: 'yes' } : s) }), null);
  assert.equal(sanitizeImportedDailyPlan(null), null);
  assert.equal(sanitizeImportedDailyPlan({ ...good, steps: 'nope' }), null);
});

test('export bundle v3: sessions + reviews + plans, older shapes still parse', () => {
  const sessions = [{ id: 's', startedAt: '2026-10-17T08:00:00.000Z' }];
  const reviews = [{ id: 'mul:5:4', skillId: 'mul:5:4', successes: 1, failures: 0, intervalDays: 1, lastReviewedAt: '2026-10-17T08:00:00.000Z', nextReviewAt: '2026-10-18T08:00:00.000Z', taxonomyVersion: 'skill-taxonomy-v1', op: 'mul' }];
  const plans = [{ id: '2026-10-18', date: '2026-10-18', targetMinutes: 15, steps: [], completedMinutes: 0, updatedAt: '2026-10-18T10:30:00.000Z' }];
  const bundle = exportBundle(sessions, reviews, plans);
  assert.equal(bundle.schema, 'zetamaster-export-v3');
  assert.equal(bundle.dailyPlans.length, 1);
  assert.equal(parseExportBundle(bundle), sessions);
  assert.deepEqual(parseExportBundle({ schema: 'zetamaster-export-v2', sessions, skillReviews: reviews }), sessions, 'v2 bundles still parse');
  assert.equal(parseExportBundle(sessions), sessions, 'legacy bare arrays still parse');
  assert.equal(parseExportBundle({ sessions: null }), null);
});
