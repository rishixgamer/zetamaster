import { mean } from '../../analytics/src/stats.js';
import { skillRollups, SKILL_MIN_SAMPLES, SKILL_STABLE_SAMPLES } from './skills.js';

/**
 * Transparent estimated score-impact heuristic (F20 substrate, F21 priority input, M2 slice 6).
 *
 * The model is deliberately simple and stated in full. A standard benchmark awards one point per
 * correct answer in `budgetMs`; across your recent verified runs you solve with an average pace of
 * `meanResponseMs` per question, so a run yields approximately
 *
 *     perRunSolved = budgetMs / meanResponseMs
 *
 * questions. A category (an operation, or one skill cell) whose typical solve runs `excessMs`
 * slower than its reference pulls your overall average up by roughly `share × excessMs`, where
 * `share` is that category's fraction of observed solves. Closing the gap would give approximately
 *
 *     estDelta = budgetMs / (meanResponseMs − share × excessMs) − budgetMs / meanResponseMs
 *
 * extra points per run. This is an arithmetic consequence of the inputs, NOT a validated
 * prediction of what practice will achieve: it assumes freed seconds convert into correct answers
 * at your average pace, and it ignores accuracy, fatigue and whether cell practice transfers to
 * mixed runs — the calibration functions here test exactly what they can (`calibrateImpactModel`
 * validates the questions-per-run basis against realized run scores), and the category step
 * stays an unvalidated extension until the M4 experiment machinery records treatment history.
 */

/** Point cap: a single category can never claim more than this, whatever degenerate history says. */
export const MAX_EST_DELTA = 30;
/** Degenerate-history guard: at a faster average pace than this the model is noise. */
export const MIN_MEAN_RESPONSE_MS = 300;
/** Recent verified runs the average pace reads from. */
export const IMPACT_RECENT_RUNS = 6;

export const IMPACT_NOTE =
  'rough estimate from your recorded medians; assumes extra time converts to extra correct answers at your average pace and ignores accuracy, fatigue and transfer — not a validated prediction';

/**
 * Average successful solve time over the most recent standard benchmark runs (the pace the model
 * assumes). Scope 'all' exists for practice-aware reads, but all point-impact claims must come
 * from scope 'benchmark'. Returns null with no usable data. Explicit inputs, no clock.
 */
export function benchmarkMeanResponseMs(sessions, { scope = 'benchmark', recentRuns = IMPACT_RECENT_RUNS } = {}) {
  const runs = (Array.isArray(sessions) ? sessions : [])
    .filter(s => s && Array.isArray(s.events) && (scope === 'all' || (s.benchmark === true && s.mode === 'benchmark')))
    .slice()
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .slice(-Math.max(0, recentRuns));
  const ms = runs.flatMap(s => s.events
    .filter(e => e.correct === true && Number.isFinite(e.responseMs) && e.responseMs > 0)
    .map(e => e.responseMs));
  const m = ms.length ? mean(ms) : null;
  return Number.isFinite(m) && m >= MIN_MEAN_RESPONSE_MS ? m : null;
}

/**
 * The arithmetic of the heuristic itself: pure, explicit, and null whenever an input is missing,
 * degenerate, or the projected average pace falls below a physical floor — this model never
 * extrapolates into impossible times-per-question. `share` is capped at 0.9 so a single category
 * that dominates a tiny history cannot claim the whole run.
 */
export function estimateScoreImpact({ meanResponseMs, budgetMs = 120000, share, excessMs } = {}) {
  if (!(Number.isFinite(meanResponseMs) && meanResponseMs >= MIN_MEAN_RESPONSE_MS)) return null;
  if (!(Number.isFinite(budgetMs) && budgetMs > 0)) return null;
  if (!(Number.isFinite(share) && share > 0 && share < 1)) return null;
  if (!(Number.isFinite(excessMs) && excessMs > 0)) return null;
  const p = Math.min(0.9, share);
  const newMean = meanResponseMs - p * excessMs;
  if (newMean < MIN_MEAN_RESPONSE_MS) return null;
  const perRunSolved = budgetMs / meanResponseMs;
  const perRunSolvedIfClosed = budgetMs / newMean;
  return {
    share: p,
    excessMs,
    meanResponseMs,
    budgetMs,
    perRunSolved,
    perRunSolvedIfClosed,
    estDelta: Math.min(MAX_EST_DELTA, Math.round((perRunSolvedIfClosed - perRunSolved) * 10) / 10),
    formula: 'budgetMs / (meanResponseMs − share·excessMs) − budgetMs / meanResponseMs',
    note: IMPACT_NOTE,
  };
}

/**
 * Ranked impact candidates from a history (F21 priority input). Rows come from two sources,
 * both benchmark-scoped:
 *
 * - op rows: an operation slower than the weighted average of the four operation medians;
 * - cell rows: a skill cell clearing the sample gate with a shrunken ratio above 1.
 *
 * `share` is each row's fraction of observed benchmark solves and `referenceMs` is stated on the
 * row (op rows compare against other operations, cell rows against their own operation's median),
 * so the arithmetic is reproducible from the row alone. Sorted by estimated delta, best first;
 * ties break by op order then label. Stable cells are flagged `stable: true` — a hint, not a
 * verdict. Pure and deterministic; no history in a category produces no row.
 */
export function impactCandidates(sessions, { meanResponseMs = null, minSamples = SKILL_MIN_SAMPLES, stableSamples = SKILL_STABLE_SAMPLES } = {}) {
  const avg = meanResponseMs ?? benchmarkMeanResponseMs(sessions);
  if (!avg) {
    return { meanResponseMs: null, candidates: [], emptyNote: 'No verified benchmark runs yet — point-impact estimates need them.' };
  }
  const rollups = skillRollups(sessions, { scope: 'benchmark' });
  const totalObs = Object.values(rollups.opObservations).reduce((a, b) => a + b, 0);
  if (!totalObs) {
    return { meanResponseMs: avg, candidates: [], emptyNote: 'No solved benchmark questions yet.' };
  }
  const opMedianMs = {};
  for (const skill of rollups.skills) if (opMedianMs[skill.op] === undefined) opMedianMs[skill.op] = skill.opMedianMs;
  const weightedRefs = Object.entries(opMedianMs)
    .map(([op, ms]) => ms * rollups.opObservations[op])
    .reduce((a, b) => a + b, 0);
  const crossOpMean = weightedRefs / totalObs;
  const opByName = Object.freeze({ add: 0, sub: 1, mul: 2, div: 3 });
  const candidates = [];
  for (const [op, opMedian] of Object.entries(opMedianMs)) {
    const excessMs = opMedian - crossOpMean;
    if (excessMs <= 0) continue;
    const est = estimateScoreImpact({ meanResponseMs: avg, share: rollups.opObservations[op] / totalObs, excessMs });
    if (est) candidates.push({
      kind: 'op', id: op, op, label: op, count: rollups.opObservations[op],
      medianMs: opMedian, referenceMs: crossOpMean, excessMs,
      share: est.share, estDelta: est.estDelta, stable: false, est,
    });
  }
  for (const skill of rollups.skills) {
    if (skill.count < minSamples || skill.ratio === null || skill.ratio <= 1) continue;
    const excessMs = skill.medianMs - skill.opMedianMs;
    if (excessMs <= 0) continue;
    const est = estimateScoreImpact({ meanResponseMs: avg, share: skill.count / totalObs, excessMs });
    if (est) candidates.push({
      kind: 'cell', id: skill.id, op: skill.op, label: skill.label, count: skill.count,
      medianMs: skill.medianMs, referenceMs: skill.opMedianMs, excessMs,
      share: est.share, estDelta: est.estDelta, stable: skill.count >= stableSamples, ratio: skill.ratio, est,
    });
  }
  candidates.sort((a, b) => b.estDelta - a.estDelta
    || (a.kind === 'cell' ? 0 : 1) - (b.kind === 'cell' ? 0 : 1) // equal scores: prefer the drillable cell
    || opByName[a.op] - opByName[b.op]
    || a.label.localeCompare(b.label));
  return { meanResponseMs: avg, totalObs, candidates, emptyNote: candidates.length ? null : 'Nothing observed slower than its reference yet — no estimated payoff above zero.' };
}

/**
 * Within-record calibration of the questions-per-run basis (F21, honest subset). Each verified
 * standard benchmark run predicts `budgetMs / meanResponse(run's solved events)` correct answers;
 * observations are the runs' own correct-answer counts (the engine's standard-run invariant), so the
 * reported errors measure exactly the pace-perception step of the heuristic. NOT included: the
 * category step (`share × excessMs`) — calibrating it requires treatment history from train/holdout
 * experiments that nothing has collected yet. Deterministic; gate and abstain above the minimum.
 */
export function calibrateImpactModel(sessions, { budgetMs = 120000, minRuns = 6, minSolvedPerRun = 5 } = {}) {
  const runs = (Array.isArray(sessions) ? sessions : [])
    .filter(s => s && s.benchmark === true && s.mode === 'benchmark' && Array.isArray(s.events))
    .slice()
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  if (runs.length < minRuns) {
    return { feasible: false, runsUsed: runs.length, minRuns, errors: [], note: `Calibration abstains below ${minRuns} verified benchmarks (observed ${runs.length}).` };
  }
  const errors = runs.map(run => {
    const solves = run.events.filter(e => e.correct === true && Number.isFinite(e.responseMs) && e.responseMs > 0);
    // The engine's own standard-run invariant: the benchmark score IS the correct-answer count, so
    // the realized observation comes from the events, never from the stored score field.
    const observed = solves.length;
    if (solves.length < minSolvedPerRun) return { id: run.id, observed, predicted: null, absError: null, absPct: null };
    const predicted = budgetMs / mean(solves.map(e => e.responseMs));
    const absError = Math.abs(predicted - observed);
    return { id: run.id, observed, predicted: Math.round(predicted * 10) / 10, absError: Math.round(absError * 10) / 10, absPct: observed > 0 ? absError / observed : null };
  }).filter(e => Number.isFinite(e.absError));
  const usable = errors.length;
  const meanAbsError = usable ? mean(errors.map(e => e.absError)) : null;
  const meanAbsPct = usable && errors.every(e => e.absPct !== null) ? mean(errors.map(e => e.absPct)) : null;
  const withinTenPct = usable ? errors.filter(e => e.absPct !== null && e.absPct <= 0.1).length / usable : null;
  return {
    feasible: usable >= minRuns,
    runsUsed: usable, minRuns,
    errors,
    meanAbsError: meanAbsError === null ? null : Math.round(meanAbsError * 100) / 100,
    meanAbsPct: meanAbsPct === null ? null : Math.round(meanAbsPct * 1000) / 1000,
    withinTenPctShare: withinTenPct === null ? null : Math.round(withinTenPct * 100) / 100,
    note: 'Validates the arithmetic that converts average pace into points per run (budget ÷ mean solve time) on realized benchmark runs. Deliberately same-data: it checks the formula, not the future — no claim of predicting behavior after training. The category step of the heuristic (share × excess) remains unvalidated: no treatment history exists.',
  };
}
