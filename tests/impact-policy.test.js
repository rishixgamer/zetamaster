import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkMeanResponseMs, estimateScoreImpact, impactCandidates, calibrateImpactModel, validateImpactCategoryStep, IMPACT_NOTE, MAX_EST_DELTA, MIN_MEAN_RESPONSE_MS } from '../packages/training/src/impact.js';
import { buildRecommendations } from '../packages/training/src/recommendations.js';
import { resolvePolicyFlag, projectPolicy, comparePolicies, DEFAULT_POLICY_ID, TRAINING_POLICIES } from '../packages/training/src/policies.js';
import { makeQuestion } from '../packages/core/src/generator.js';
import { skillCellFor } from '../packages/training/src/skills.js';

const NOW = '2026-10-18T09:00:00.000Z';

/** Events builder: n solves of (op, a, b+i) — the factor stays fixed so the mix sits in one
 * operand band on each axis (mirroring how a reliable pattern actually accumulates). */
function events(n, op, a, b, ms) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ ...makeQuestion(op, a, b + i, i + 1), responseMs: ms, firstInputMs: Math.floor(ms / 10), entryMs: ms - Math.floor(ms / 10), completedAtMs: i * ms, correct: true });
  return out;
}

/** A benchmark-run-shaped history record with the given solved-event mix. */
function run(day, mix) {
  const ev = mix.flatMap(m => events(m.n, m.op, m.a, m.b, m.ms));
  return { id: `s${day}`, startedAt: new Date(Date.parse('2026-09-01T08:00:00.000Z') + day * 86400000).toISOString(), mode: 'benchmark', benchmark: true, score: ev.length, elapsedMs: 120000, events: ev };
}

/** One slow mul cell next to a fast mul cell plus a fast add baseline. */
const SLOW_MUL = { op: 'mul', a: 7, b: 40, ms: 4200, n: 9 };
const FAST_MUL = { op: 'mul', a: 10, b: 90, ms: 800, n: 9 };
const FAST_ADD = { op: 'add', a: 20, b: 30, ms: 400, n: 12 };

test('estimateScoreImpact: worked example, guard rails and hard cap', () => {
  // 4000 ms average pace, a category on 50% share running 2000 ms slower → +10 points:
  // 120000/3000 − 120000/4000 = 40 − 30.
  const est = estimateScoreImpact({ meanResponseMs: 4000, share: 0.5, excessMs: 2000 });
  assert.equal(est.estDelta, 10);
  assert.equal(est.note, IMPACT_NOTE);
  // Garbage inputs return null instead of inventing numbers.
  for (const bad of [{}, { meanResponseMs: 100, share: 0.5, excessMs: 500 }, { meanResponseMs: 4000, share: 0.5, excessMs: -1 }, { meanResponseMs: 4000, share: 0, excessMs: 500 }]) {
    assert.equal(estimateScoreImpact(bad), null);
  }
  // Projections that would imply an impossible pace are refused before any capping.
  assert.equal(estimateScoreImpact({ meanResponseMs: MIN_MEAN_RESPONSE_MS, share: 0.9, excessMs: 2000 }), null);
  // A category worth the whole remaining budget hits the MAX_EST_DELTA cap, not more.
  const capped = estimateScoreImpact({ meanResponseMs: 800, share: 0.5, excessMs: 400 });
  assert.equal(capped.estDelta, MAX_EST_DELTA);
});

test('benchmarkMeanResponseMs: benchmark scope only, recent runs, degenerate null', () => {
  const runs = [
    run(0, [{ n: 10, op: 'add', a: 20, b: 30, ms: 6000 }]),
    run(1, [{ n: 10, op: 'add', a: 20, b: 30, ms: 500 }]),
    run(2, [{ n: 10, op: 'add', a: 20, b: 30, ms: 500 }]),
  ];
  const practice = { ...runs[0], id: 'p', benchmark: false, mode: 'drill' };
  assert.ok(Math.abs(benchmarkMeanResponseMs([...runs, practice]) - 70000 / 30) < 1e-9, 'practice runs never enter the benchmark-scoped read');
  assert.equal(benchmarkMeanResponseMs([...runs, practice], { recentRuns: 2 }), 500, 'only the most recent N standard runs');
  assert.equal(benchmarkMeanResponseMs([]), null);
  assert.equal(benchmarkMeanResponseMs([run(0, [{ n: 1, op: 'add', a: 20, b: 30, ms: 50 }])]), null, 'below the noise floor → null');
});

test('impactCandidates: cells and operations ranked, benchmark-scoped, deterministic', () => {
  const history = [run(0, [SLOW_MUL, FAST_MUL, FAST_ADD])];
  const first = impactCandidates(history);
  const cell = skillCellFor('mul', 7, 40);
  const top = first.candidates[0];
  assert.equal(top.kind, 'cell');
  assert.equal(top.id, cell.id, 'the slowest demonstrable pattern ranks first');
  assert.equal(top.stable, true, '9 solves ≥ stable gate');
  assert.ok(top.estDelta > 0 && top.estDelta <= MAX_EST_DELTA);
  const opRow = first.candidates.find(c => c.kind === 'op');
  assert.ok(opRow && opRow.id === 'mul', 'the slow operation itself is a candidate');
  assert.ok(opRow.excessMs > 0);
  assert.equal(first.candidates.some(c => c.id === 'add'), false, 'fast operations are never candidates');
  // Deterministic and self-contained rows (each row states share, medians and the estimate).
  assert.deepEqual(impactCandidates(history), first);
  assert.ok(top.est.note.includes('not a validated prediction'));
  // Practice-only categories never produce impact rows.
  const practiceOnly = [{ ...run(0, [SLOW_MUL]), benchmark: false, mode: 'drill' }];
  assert.equal(impactCandidates(practiceOnly).candidates.length, 0);
});

test('calibrateImpactModel: abstains under 6 runs, measures pace→points error honestly', () => {
  const thin = Array.from({ length: 5 }, (_, i) => run(i, [{ n: 60, op: 'add', a: 20, b: 30, ms: 2000 }]));
  const abstain = calibrateImpactModel(thin);
  assert.equal(abstain.feasible, false);
  assert.ok(/abstains/i.test(abstain.note));
  // Exact-fill runs (60 solves × 2000 ms = 120 s of correct answers) predict the observed count perfectly.
  const exact = Array.from({ length: 6 }, (_, i) => run(i, [{ n: 60, op: 'add', a: 20, b: 30, ms: 2000 }]));
  const cal = calibrateImpactModel(exact);
  assert.equal(cal.feasible, true);
  assert.equal(cal.meanAbsError, 0);
  assert.equal(cal.withinTenPctShare, 1);
  // A short run (10 solves × 1000 ms → 120 predicted, 10 observed) shows up as a real miss.
  const mixed = [...exact.slice(0, 5), run(5, [{ n: 10, op: 'add', a: 20, b: 30, ms: 1000 }])];
  const mixedCal = calibrateImpactModel(mixed);
  assert.equal(mixedCal.errors.at(-1).absError, 110);
  assert.ok(mixedCal.meanAbsPct > 0.1, 'a run that fills 10 s cannot be read as 120 points');
  // Runs under the per-run solve floor are excluded before the mean.
  const guarded = [...exact.slice(0, 5), run(5, [{ n: 3, op: 'add', a: 20, b: 30, ms: 1000 }])];
  const guardedCal = calibrateImpactModel(guarded);
  assert.equal(guardedCal.errors.length, 5, 'the five intact runs stay; the sub-floor run drops');
  assert.equal(guardedCal.feasible, false, 'dropping the sub-floor run leaves fewer than minRuns');
});

test('buildRecommendations: merged, evidence-first, deterministic and no fabricated homework', () => {
  const reviewRecord = { id: 'mul:5:4', skillId: 'mul:5:4', op: 'mul', successes: 1, failures: 0, intervalDays: 1, lastReviewedAt: '2026-10-15T08:00:00.000Z', nextReviewAt: '2026-10-16T08:00:00.000Z', taxonomyVersion: 'skill-taxonomy-v1' };
  // A due review outranks everything and carries its launch data.
  const withDue = buildRecommendations({ sessions: [], reviews: [reviewRecord], now: NOW });
  assert.equal(withDue.items[0].kind, 'review');
  assert.equal(withDue.items[0].launch.type, 'drill');
  assert.equal(withDue.items[0].launch.cell.id, 'mul:5:4');
  assert.ok(withDue.items[0].why.includes('due'), `expected a due hint, saw: ${withDue.items[0].why}`);
  // Weak-cell item for gated slow patterns, quoting the measured ratio and count.
  const weakHistory = [run(0, [SLOW_MUL, FAST_MUL])];
  const withWeak = buildRecommendations({ sessions: weakHistory, reviews: [], now: NOW });
  assert.equal(withWeak.items[0].kind, 'weak-cell');
  assert.ok(/×1\.\d\d your mul median over 9 solves/.test(withWeak.items[0].why), `saw: ${withWeak.items[0].why}`);
  // The plateau branch surfaces as a protocol item on a flat history.
  const flatHistory = Array.from({ length: 12 }, (_, i) => run(i, [SLOW_MUL, FAST_MUL]));
  const withPlateau = buildRecommendations({ sessions: flatHistory, reviews: [], now: NOW });
  assert.ok(withPlateau.items.some(i => i.kind === 'plateau' && i.title.includes('gauntlet-rotate')));
  // Impact fallback (weak cell present, impact second) and the honest empty state.
  const fallback = buildRecommendations({ sessions: [run(0, [SLOW_MUL, FAST_MUL, FAST_ADD])], reviews: [], now: NOW });
  assert.ok(fallback.items.some(i => i.kind === 'impact' && i.why.includes('not a validated prediction')));
  const empty = buildRecommendations({ sessions: [], reviews: [], now: NOW });
  assert.equal(empty.items[0].kind, 'coverage');
  assert.ok(/no skill-pattern data yet/i.test(empty.items[0].why));
  // Deterministic; garbage now rejects.
  assert.deepEqual(buildRecommendations({ sessions: flatHistory, reviews: [], now: NOW }), withPlateau);
  assert.throws(() => buildRecommendations({ sessions: [], reviews: [], now: 'nonsense' }), RangeError);
});

test('policies: flagged comparison is allow-listed, deterministic, seeded only for placement', () => {  assert.deepEqual(TRAINING_POLICIES.map(p => p.id), ['op-adaptive', 'cell-gauntlet', 'automaticity']);
  assert.equal(DEFAULT_POLICY_ID, 'op-adaptive');
  assert.equal(resolvePolicyFlag('nonsense').valid, false);
  assert.equal(resolvePolicyFlag('nonsense').value, DEFAULT_POLICY_ID);
  assert.equal(resolvePolicyFlag('cell-gauntlet').valid, true);
  const history = [run(0, [SLOW_MUL, FAST_MUL, FAST_ADD])];
  // Projections: op-adaptive takes the single op candidate; cell-gauntlet the gated cells.
  const opP = projectPolicy('op-adaptive', history);
  assert.equal(opP.feasible, true);
  assert.equal(opP.candidates.length, 1);
  assert.equal(opP.candidates[0].kind, 'op');
  const cellP = projectPolicy('cell-gauntlet', history);
  assert.equal(cellP.candidates.length >= 1, true);
  assert.ok(cellP.candidates.every(c => c.kind === 'cell'));
  // Automaticity requires stable evidence.
  const autoP = projectPolicy('automaticity', history);
  assert.ok(autoP.candidates.every(c => c.stable));
  assert.equal(projectPolicy('no-such', history).feasible, false);
  // Comparison: identical projections, placement from the seed without touching them.
  const a = comparePolicies(history, { seed: 'rishi' });
  const b = comparePolicies(history, { seed: 'rishi' });
  assert.deepEqual(a, b);
  assert.ok(['A', 'B'].includes(a.assignment));
  assert.equal(a.emphasizedPolicyId, a.assignment === 'A' ? a.ranked[0].policyId : (a.ranked[1] ?? a.ranked[0]).policyId);
  assert.equal(a.ranked[0].feasible >= a.ranked[1].feasible, true, 'ranking keeps feasible policies first');
  const pinned = comparePolicies(history, { seed: 'rishi', flag: 'automaticity' });
  assert.equal(pinned.emphasizedPolicyId, 'automaticity');
  assert.equal(pinned.flagOverride, true);
  assert.throws(() => comparePolicies(history, {}), RangeError);
});

/* ---- F20 close-out: the share × excess category step is now recomputed from raw events ---- */

const VAL_MUL_SLOW = { op: 'mul', a: 7, b: 40, ms: 1400, n: 9 };
const VAL_MUL_FAST = { op: 'mul', a: 10, b: 90, ms: 800, n: 9 };
const VAL_ADD_FAST = { op: 'add', a: 20, b: 30, ms: 400, n: 12 };

test('validateImpactCategoryStep: recomputes every row from the raw events; hand-computed exact values', () => {
  // Hand computation (exact):
  //   meanResponse = (1400·9 + 800·9 + 400·12)/30 = 820 ms
  //   mul op median = (1400+800)/2 = 1100; add median = 400
  //   crossOp mean  = (1100·18 + 400·12)/30 = 820
  //   op row (mul): excess = 280, share = 0.6, estDelta = 120000/652 − 120000/820 = 37.7 → capped at 30
  //   cell row (7×40–49): excess = 1400 − 1100 = 300, share = 0.3, estDelta = 120000/730 − 120000/820 = 18.0
  const history = [run(0, [VAL_MUL_SLOW, VAL_MUL_FAST, VAL_ADD_FAST])];
  const validation = validateImpactCategoryStep(history);
  assert.equal(validation.feasible, true);
  assert.equal(validation.checked, 2, 'one op row and one gated cell row');
  assert.deepEqual(validation.mismatches, []);
  const candidates = impactCandidates(history);
  const opRow = candidates.candidates.find(c => c.kind === 'op' && c.op === 'mul');
  const cellRow = candidates.candidates.find(c => c.kind === 'cell');
  assert.equal(validation.crossOpMean, 820);
  assert.equal(cellRow.estDelta, 18, 'the uncapped cell estimate is exactly 18.0');
  assert.equal(opRow.estDelta, MAX_EST_DELTA, 'the op row saturates the cap, not more');
  assert.equal(opRow.excessMs, 280);
  assert.equal(cellRow.excessMs, 300);
  assert.equal(cellRow.share, 0.3);
  // Every claim row must carry recomputed numbers matching the emitted ones.
  for (const row of validation.rows) {
    for (const [claim, expected, observed] of row.claims) {
      assert.ok(Number.isFinite(expected) || expected === null, `${row.id}.${claim}: recomputation produced a value`);
      if (Number.isFinite(expected) && Number.isFinite(observed)) assert.ok(Math.abs(expected - observed) < 1e-9, `${row.id}.${claim}: ${expected} vs ${observed}`);
      else assert.equal(expected, observed, `${row.id}.${claim}`);
    }
  }
});

test('validateImpactCategoryStep: degenerate and practice-only histories return infeasible, never numbers', () => {
  const none = validateImpactCategoryStep([]);
  assert.equal(none.feasible, false);
  assert.equal(none.checked, 0);
  assert.ok(none.note, 'still names why in a note');
  const practiceOnly = [{ ...run(0, [VAL_MUL_SLOW]), benchmark: false, mode: 'drill' }];
  const empty2 = validateImpactCategoryStep(practiceOnly);
  assert.equal(empty2.feasible, false);
});

test('heatmap cells carry the probabilistic mastery posterior (F20 surface wiring)', async () => {
  const { buildHeatmap } = await import('../packages/analytics/src/heatmap.js');
  const history = [run(0, [
    { op: 'mul', a: 7, b: 40, ms: 1800, n: 5 },   // fast-and-correct solves (≤ 2000 ms)
    { op: 'mul', a: 7, b: 45, ms: 2600, n: 3 },   // slow solves
  ])];
  const heatmap = buildHeatmap(history, 'mul', { scope: 'benchmark' });
  const masteredCell = heatmap.cells.flat().find(c => c.rowRange[0] === 7 && c.colRange[0] === 40);
  assert.ok(masteredCell.mastery, 'the mastery posterior rides every cell');
  assert.equal(masteredCell.mastery.samples, 8, 'the cell row sees all 8 solves');
  assert.equal(masteredCell.mastery.passes, 5);
  assert.equal(masteredCell.mastery.estimate, 0.6111, 'Jeffreys posterior mean (5.5/9), not the raw share');
  assert.ok(masteredCell.mastery.ci.high < 0.9 && masteredCell.mastery.ci.low > 0.2, `wide on thin evidence: ${masteredCell.mastery.ci.low}–${masteredCell.mastery.ci.high}`);
  assert.equal(masteredCell.mastery.calibrated, false);
  const untouched = heatmap.cells.flat().find(c => c.rowRange[0] === 12);
  assert.equal(untouched.mastery.samples, 0);
  assert.equal(untouched.mastery.estimate, 0.5, 'empty cells show the prior, never a fabricated number');
});
