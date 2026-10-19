import { mean } from '../../analytics/src/stats.js';
import { buildHeatmap } from '../../analytics/src/heatmap.js';
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
 * mixed runs. What the validation here does cover: `calibrateImpactModel` validates the
 * questions-per-run basis against realized run scores, `validateImpactCategoryStep` recomputes
 * the share × excess category decomposition end-to-end from the raw benchmark events (exact
 * fixture values pinned in tests), and the randomized crossover trial (packages/training/src/
 * trial.js, F21/M4-F37) records per-policy outcome rows — the *training gain* the heuristic
 * implies stays an estimate everywhere; no result claims ride on any of it.
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
    note: 'Validates the arithmetic that converts average pace into points per run (budget ÷ mean solve time) on realized benchmark runs. Deliberately same-data: it checks the formula, not the future — no claim of predicting behavior after training. The category step (share × excess) is arithmetic-validated by validateImpactCategoryStep; the TRAINING GAIN it implies remains an estimate: the randomized crossover trial (trial.js) records outcomes, never proof a policy works.',
  };
}

/**
 * Automated per-category validation of the share × excess step (F20 close-out). Everything the
 * candidate rows carry is recomputed directly from the raw benchmark events — per-operation
 * medians and counts through an independent buildHeatmap call, the weighted cross-operation
 * reference, each candidate's excess, share and estDelta through the public `estimateScoreImpact`
 * — and compared against the produced rows. A mismatch is reported per row per claim, never
 * silently repaired. This pins the DECOMPOSITION (median → reference → excess → share → estDelta)
 * end-to-end; the heuristic's training-gain meaning stays exactly what the note above says.
 * Deterministic; degenerate histories return feasible:false with the empty note from candidates.
 */
export function validateImpactCategoryStep(sessions, { budgetMs = 120000, minSamples = SKILL_MIN_SAMPLES, stableSamples = SKILL_STABLE_SAMPLES } = {}) {
  const { meanResponseMs: avg, totalObs, candidates, emptyNote } = impactCandidates(sessions, { meanResponseMs: null, minSamples, stableSamples });
  if (!avg) return { feasible: false, checked: 0, mismatches: [], note: emptyNote };
  // Independent recomputation pass: raw events → per-op medians/counts → cross-op reference → cells.
  const recomputedOp = {};
  const recomputedCells = new Map();
  for (const op of ['add', 'sub', 'mul', 'div']) {
    const heatmap = buildHeatmap(sessions, op, { scope: 'benchmark' });
    recomputedOp[op] = { medianMs: heatmap.opMedianMs, count: heatmap.observations };
    for (const cell of heatmap.cells.flat()) if (cell.count > 0) recomputedCells.set(cell.key, cell);
  }
  const ops = Object.values(recomputedOp).filter(x => x.count > 0);
  const pooledCount = ops.reduce((a, x) => a + x.count, 0);
  if (!pooledCount) return { feasible: false, checked: 0, mismatches: [], note: 'No solved benchmark questions yet.' };
  const crossOpMean = ops.reduce((a, x) => a + x.medianMs * x.count, 0) / pooledCount;
  const mismatches = [];
  const rows = [];
  const near = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  for (const candidate of candidates) {
    const row = { kind: candidate.kind, id: candidate.id, claims: [] };
    let found = null, excessMs = null;
    if (candidate.kind === 'op') {
      found = recomputedOp[candidate.op];
      excessMs = found.medianMs - crossOpMean;
      row.claims = [
        ['medianMs', found.medianMs, candidate.medianMs],
        ['referenceMs', crossOpMean, candidate.referenceMs],
        ['count', found.count, candidate.count],
        ['excessMs', excessMs, candidate.excessMs],
        ['share', Math.min(0.9, found.count / pooledCount), candidate.share],
        ['estDelta', estimateScoreImpact({ meanResponseMs: avg, budgetMs, share: Math.min(0.9, found.count / pooledCount), excessMs })?.estDelta ?? null, candidate.estDelta],
      ];
    } else {
      found = recomputedCells.get(candidate.id);
      if (found) {
        excessMs = found.medianMs - recomputedOp[candidate.op]?.medianMs;
        const shareRaw = found.count / pooledCount;
        row.claims = [
          ['medianMs', found.medianMs, candidate.medianMs],
          ['referenceMs', recomputedOp[candidate.op]?.medianMs, candidate.referenceMs],
          ['count', found.count, candidate.count],
          ['excessMs', excessMs, candidate.excessMs],
          ['share', estimateScoreImpact({ meanResponseMs: avg, budgetMs, share: shareRaw, excessMs })?.share ?? null, candidate.share],
          ['estDelta', estimateScoreImpact({ meanResponseMs: avg, budgetMs, share: shareRaw, excessMs })?.estDelta ?? null, candidate.estDelta],
        ];
      } else row.claims = [['row-missing', null, candidate.id]];
    }
    for (const [claim, expected, observed] of row.claims) {
      const ok = Number.isFinite(expected) && Number.isFinite(observed) ? near(expected, observed) : expected === observed;
      if (!ok) mismatches.push({ kind: candidate.kind, id: candidate.id, claim, expected, observed });
    }
    rows.push(row);
  }
  return {
    feasible: candidates.length > 0 && mismatches.length === 0,
    meanResponseMs: avg,
    totalObs,
    crossOpMean: Math.round(crossOpMean * 1000) / 1000,
    checked: candidates.length,
    rows,
    mismatches,
    note: candidates.length
      ? 'Recomputes every candidate row (operation and cell) from the raw benchmark events through an independent pass: median, reference, excess, share and estDelta each checked. Validates the decomposition arithmetic only — what the estimates mean for future training gains stays subject to the calibrateImpactModel and trial caveats.'
      : emptyNote,
  };
}
