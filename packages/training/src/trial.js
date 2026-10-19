import {
  TRIAL_PROTOCOL_VERSION, TRIAL_MIN_PAIRS_PER_ARM, isTrial, trialSlot,
} from './trial-window.js';
import { exactPermutationTest, mean, median, wilsonInterval } from '../../analytics/src/stats.js';
import { sanitizeProvenance } from './provenance.js';
import { projectPolicy } from './policies.js';

export { TRIAL_PROTOCOL_VERSION } from './trial-window.js';
export {
  TRIAL_WINDOW_DAYS, TRIAL_CYCLE_WINDOWS, TRIAL_MIN_PAIRS_PER_ARM, isTrial, createPolicyTrial,
  trialSlot, nextHoldout, serializeTrial, parseStoredTrial,
} from './trial-window.js';

/**
 * Randomized crossover policy trial, shared with the window math. Kept in one place so the
 * acceptance wording, docs, gate and UI never drift.
 */
/**
 * Outcome ledger + summary for the randomized crossover policy trial (F21/M4-F37 close-out) —
 * the randomized-arm layer the provenance ledger documented as missing.
 *
 * What the ledger does with a stored history:
 *
 * - Consecutive valid standard benchmarks are paired exactly like `treatmentOutcomes` does
 *   (before → after; observedDelta = raw score change, which rides in everything else that
 *   changed between the two runs).
 * - A practice run between two benchmarks counts as *treatment* only when its provenance names
 *   the policy the trial emphasized at that run's own start (whitelist-revalidated here). Runs
 *   from other surfaces, holdout windows, mismatched policies, interrupted pre-enrollment
 *   history are context: counted, never attributed.
 * - `predictedDelta` recomputes the policy projection on exactly the pre-treatment prefix —
 *   deterministic and reproducible from the stored records alone.
 * - Summary: per policy, the improving share of attributed windows carries a Wilson interval;
 *   the between-policy comparison runs an exact permutation test on the observed-delta lists —
 *   no asymptotics anywhere, refused rather than approximated past its guards. Below
 *   TRIAL_MIN_PAIRS_PER_ARM attributed windows per policy NO comparison is computed at all.
 *
 * Claims this module never makes: carryover between alternating windows is real and unmodeled; a
 * single-device crossover sees one learner; the gates let a number through, not a verdict.
 */

/** Attributed windows per policy required before ANY between-policy number is reported. */
const TRIAL_CAVEATS = Object.freeze([
  'trial attribution counts a practice run only when it was launched from a tagged surface while the trial emphasized that exact policy; runs from other surfaces, holdout windows, mismatched policies or before enrollment stay context and are never attributed',
  'crossover: each treatment window follows the other policy (or a holdout), so carryover of learned skill into the next window is real and unmodeled',
  'one device: this is a within-learner comparison, never a population claim',
  'observed benchmark deltas also include everything else that happened between the paired runs',
  'below the minimum-window gate no comparison is computed at all; at the gate the exact permutation p is a number, not a verdict',
]);

const runStartedMs = run => (typeof run?.startedAt === 'string' ? Date.parse(run.startedAt) : NaN);

/** A stored practice run eligible for pairing: provenance-tagged, dated, and ≥ minTreatmentSeconds. */
function isCandidateTreatment(run, minSeconds) {
  const ms = runStartedMs(run);
  if (Number.isNaN(ms) || run?.benchmark === true) return false;
  if (sanitizeProvenance(run.provenance) === null) return false;
  return (Number.isFinite(run.elapsedMs) ? run.elapsedMs : 0) >= minSeconds * 1000;
}

/**
 * The trial outcome ledger. Deterministic; pairs capped at the most recent `maxPairs`. Structure
 * mirrors treatmentOutcomes: { pairs: [{beforeStartedAt, afterStartedAt, beforeScore, afterScore,
 * contextRuns, rows: [{policyId, arm, runs, treatmentSeconds, predictedDelta, predictedFeasible,
 * observedDelta}], note}], emptyNote, caveats }.
 */
export function trialOutcomes(sessions, trial, { minTreatmentSeconds = 30, maxPairs = 24 } = {}) {
  const empty = { pairs: [], emptyNote: null, caveats: TRIAL_CAVEATS };
  if (!Array.isArray(sessions)) return { ...empty, emptyNote: 'No sessions to pair yet.' };
  if (!isTrial(trial)) throw new RangeError('trialOutcomes needs a valid trial object (createPolicyTrial)');
  const benchmarks = sessions
    .filter(s => s?.benchmark === true && typeof s.startedAt === 'string' && !Number.isNaN(Date.parse(s.startedAt)))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  if (benchmarks.length < 2) return { ...empty, emptyNote: 'Pairing needs at least two valid benchmark runs.' };
  const treatments = sessions.filter(s => isCandidateTreatment(s, minTreatmentSeconds));
  const allPairs = [];
  for (let i = 1; i < benchmarks.length; i++) {
    const before = benchmarks[i - 1], after = benchmarks[i];
    const fromMs = Date.parse(before.startedAt), toMs = Date.parse(after.startedAt);
    const windowRuns = treatments.filter(s => { const t = runStartedMs(s); return t >= fromMs && t < toMs; });
    const attributed = new Map();
    let contextRuns = 0;
    for (const run of windowRuns) {
      const provenance = sanitizeProvenance(run.provenance);
      let slot = null;
      try { slot = trialSlot(trial, runStartedMs(run)); } catch { slot = null; } // pre-enrollment → context
      if (slot && slot.phase === 'treatment' && provenance.policyId !== null && provenance.policyId === slot.policyId) {
        const bucket = attributed.get(slot.policyId) ?? { arm: slot.policyId === slot.firstPolicyId ? 'A' : 'B', runs: 0, seconds: 0 };
        bucket.runs++;
        bucket.seconds += Math.round((Number.isFinite(run.elapsedMs) ? run.elapsedMs : 0) / 1000);
        attributed.set(slot.policyId, bucket);
      } else contextRuns++;
    }
    if (attributed.size === 0 && contextRuns === 0) continue;
    // History prefix the treatment decision was made from: everything at or before the first benchmark.
    const prefix = sessions.filter(s => typeof s.startedAt === 'string' && !Number.isNaN(Date.parse(s.startedAt)) && Date.parse(s.startedAt) <= fromMs);
    const rows = [];
    for (const [policyId, bucket] of attributed) {
      const projection = projectPolicy(policyId, prefix);
      rows.push({
        policyId,
        arm: bucket.arm,
        runs: bucket.runs,
        treatmentSeconds: bucket.seconds,
        predictedDelta: Number.isFinite(projection.projectedDelta) ? projection.projectedDelta : 0,
        predictedFeasible: projection.feasible === true,
        observedDelta: Math.trunc(after.score) - Math.trunc(before.score),
      });
    }
    rows.sort((a, b) => (a.arm < b.arm ? -1 : a.arm > b.arm ? 1 : 0));
    allPairs.push({
      beforeStartedAt: before.startedAt,
      afterStartedAt: after.startedAt,
      beforeScore: Math.trunc(before.score),
      afterScore: Math.trunc(after.score),
      contextRuns,
      rows,
      note: rows.length
        ? `Attributed over ${rows.map(r => `${r.runs} trial-window run(s) ≥${minTreatmentSeconds}s`).join(' + ')}; the ${contextRuns} context run(s) in this window (holdout, other surfaces, other policies) are excluded. No causal claim — a crossover sees one learner.`
        : `No trial-emphasized practice between these two runs — ${contextRuns} context run(s) only, never dressed up as an outcome.`,
    });
  }
  const pairs = allPairs.slice(-maxPairs);
  return {
    pairs,
    emptyNote: pairs.length ? null : 'No trial-emphasized practice between valid benchmark runs yet.',
    caveats: TRIAL_CAVEATS,
  };
}

/**
 * Summarize the ledger into per-policy outcome rows and (only past the gate) the exact
 * permutation comparison. Outcomes use every attributed window's observed delta; the improving
 * share carries a Wilson interval on the positive-delta share, and `comparison` is null below
 * TRIAL_MIN_PAIRS_PER_ARM.
 */
export function summarizeTrialOutcomes(ledger, { trial } = {}) {
  const pairs = Array.isArray(ledger?.pairs) ? ledger.pairs : [];
  const caveats = ledger?.caveats ?? TRIAL_CAVEATS;
  const byPolicy = new Map();
  for (const pair of pairs) {
    for (const row of pair.rows) {
      const entry = byPolicy.get(row.policyId) ?? { policyId: row.policyId, arm: row.arm, runs: 0, seconds: 0, outcomes: [] };
      entry.runs += row.runs;
      entry.seconds += row.treatmentSeconds;
      entry.outcomes.push({ observedDelta: row.observedDelta, predictedDelta: row.predictedDelta, afterStartedAt: pair.afterStartedAt });
      byPolicy.set(row.policyId, entry);
    }
  }
  const policyOutcomes = [...byPolicy.values()].map(entry => {
    const deltas = entry.outcomes.map(o => o.observedDelta);
    const improving = deltas.filter(d => d > 0).length;
    return {
      policyId: entry.policyId,
      arm: entry.arm,
      attributedRuns: entry.runs,
      attributedSeconds: entry.seconds,
      attributedWindows: deltas.length,
      medianDelta: median(deltas),
      meanDelta: deltas.length ? Math.round(mean(deltas) * 100) / 100 : null,
      improvingShare: { improving, windows: deltas.length, ...wilsonInterval(improving, deltas.length) },
      outcomes: entry.outcomes,
    };
  }).sort((a, b) => (a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0));
  const gate = TRIAL_MIN_PAIRS_PER_ARM;
  let comparison = null;
  const [a, b] = policyOutcomes.filter(r => r.policyId === trial?.policyIdA || r.policyId === trial?.policyIdB);
  if (a && b && a.attributedWindows >= gate && b.attributedWindows >= gate) {
    const test = exactPermutationTest(a.outcomes.map(o => o.observedDelta), b.outcomes.map(o => o.observedDelta), { statistic: 'mean' });
    comparison = {
      feasible: test.feasible,
      gate,
      statistic: test.statistic,
      observed: test.observed,
      p: test.p,
      reassignments: test.reassignments,
      improvingShares: {
        [a.policyId]: a.improvingShare,
        [b.policyId]: b.improvingShare,
      },
      note: test.feasible
        ? `Difference of mean observed benchmark deltas (${b.policyId} − ${a.policyId}) = ${test.observed}; exact permutation p = ${test.p} over ${test.reassignments} reassignments. The gate lets a number through, not a verdict: carryover between alternating windows and everything-else-changed apply fully.`
        : test.note,
    };
  }
  const note = comparison?.feasible
    ? `Trial at or past the minimum-window gate (≥${gate} attributed windows per policy): numbers above, caveats below.`
    : `Below the minimum evidence gate (≥${gate} attributed windows per policy): the trial cannot distinguish the policies yet — no comparison computed.`;
  return { policyOutcomes, comparison, caveats, note };
}
