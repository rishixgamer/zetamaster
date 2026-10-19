import { TRAINING_POLICIES, projectPolicy } from './policies.js';

/**
 * Run provenance (F20/F21 substrate, the M4 experiment door).
 *
 * Until this module existed, nothing remembered *which training surface* (or which emphasized
 * policy) produced a practice run — so predicted-versus-observed training-gain calibration had no
 * treatment history to work on, and `comparePolicies` could never honestly compare outcomes. The
 * provenance record rides on the session result as bounded, whitelist-validated metadata:
 *
 *   surface  — one fixed, enum-validated launch surface ('recommendations', 'review-queue',
 *              'heatmap', 'gauntlet', 'academy'),
 *   policyId — for drills launched from the Train recommendation panel, the policy the panel
 *              emphasized at launch time (a *context tag*, not a randomized treatment arm),
 *   cellId   — the drilled skill cell when the run is cell-limited,
 *   stage    — free-form launch stage ('train', 'probe', 'flash', 'benchmark-hand-off').
 *
 * Honesty rules baked into every consumer:
 * 1. Provenance is metadata only — it never touches scoring, benchmark eligibility or validity
 *    (`benchmark` is recomputed from rules/mode/duration exactly as before), and a benchmark run
 *    may carry `{surface:'gauntlet', stage:'benchmark'}` without either flag changing meaning.
 * 2. `policyId` records the emphasized-policy CONTEXT, not a signed-up experiment arm: no
 *    randomization, no holdout, so pairing it with outcomes supports diagnostics, never causal
 *    claims. `treatmentOutcomes` restores those caveats on every row.
 * 3. Import round-trips preserve only whitelisted, revalidated provenance; malformed provenance is
 *    dropped entirely rather than repaired.
 */

/** where a run can be launched from in a way training modules need to know about. */
export const PROVENANCE_SURFACES = Object.freeze(['recommendations', 'review-queue', 'heatmap', 'gauntlet', 'academy']);
/** The only policy ids a provenance record may name (same enum the flag resolves against). */
export const PROVENANCE_POLICY_IDS = new Set(TRAINING_POLICIES.map(p => p.id));
const CELL_ID_MAX = 60;

/** Bounded identifier text: whitespace-collapsed, capped, never empty after cleanup. */
function boundedId(raw, max = CELL_ID_MAX) {
  if (typeof raw !== 'string') return null;
  const value = raw.replace(/\s+/g, ' ').trim().slice(0, max);
  return value.length ? value : null;
}

/**
 * Whitelist-rebuild a provenance record (same contract family as storage's import sanitizers).
 * Returns null unless the surface is valid and at least one attribute is present — an all-null
 * record would claim attribution while carrying none.
 */
export function sanitizeProvenance(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!PROVENANCE_SURFACES.includes(raw.surface)) return null;
  const policyId = typeof raw.policyId === 'string' && PROVENANCE_POLICY_IDS.has(raw.policyId) ? raw.policyId : null;
  const cellId = boundedId(raw.cellId);
  const stage = typeof raw.stage === 'string' && /^[a-z0-9-]{1,24}$/.test(raw.stage.trim()) ? raw.stage.trim() : null;
  if (policyId === null && cellId === null && stage === null) return null;
  return { surface: raw.surface, policyId, cellId, stage };
}

/** True when a stored session is a provenance-tagged practice run worth counting as treatment. */
function treatmentRun(s) {
  if (!s || typeof s !== 'object' || s.benchmark === true) return false; // treatments are practice runs
  if (typeof s.startedAt !== 'string' || Number.isNaN(Date.parse(s.startedAt))) return false;
  return sanitizeProvenance(s.provenance) !== null;
}

/**
 * Predicted-versus-observed outcome rows between consecutive valid benchmark runs (F21 calibration
 * ledger; F20's category step rides the same substrate later).
 *
 * For each consecutive pair of valid standard runs (before → after), practices carrying
 * provenance launched in between are grouped by their provenance policyId (unattributed tagged
 * runs are counted separately and never folded into a policy row). `predictedDelta` recomputes the
 * policy's transparent impact projection on exactly the history that existed before the
 * treatment — deterministic and reproducible from the stored record set. `observedDelta` is the
 * raw benchmark score change; everything else that changed between those two runs rides in it.
 *
 * Every row carries the caveat: observational pairing, no randomized arm in this ledger (the
 * opt-in policy trial holds the assigned arms and holdouts), tiny n — this is a ledger that makes
 * calibration *possible*, not evidence that any policy works.
 */
export function treatmentOutcomes(sessions, { minTreatmentSeconds = 30, maxPairs = 12, minTreatmentRuns = 1 } = {}) {
  if (!Array.isArray(sessions)) return { pairs: [], emptyNote: 'No sessions to pair yet.', caveats: TREATMENT_CAVEATS };
  const benchmarks = sessions
    .filter(s => s?.benchmark === true && typeof s.startedAt === 'string' && !Number.isNaN(Date.parse(s.startedAt)))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  if (benchmarks.length < 2) return { pairs: [], emptyNote: 'Pairing needs at least two valid benchmark runs.', caveats: TREATMENT_CAVEATS };
  const treatments = sessions.filter(treatmentRun).filter(s => (Number.isFinite(s.elapsedMs) ? s.elapsedMs : 0) >= minTreatmentSeconds * 1000);
  const allPairs = [];
  for (let i = 1; i < benchmarks.length; i++) {
    const before = benchmarks[i - 1], after = benchmarks[i];
    const fromMs = Date.parse(before.startedAt), toMs = Date.parse(after.startedAt);
    const windowRuns = treatments.filter(s => { const t = Date.parse(s.startedAt); return t >= fromMs && t < toMs; });
    const attributed = new Map();
    let unattributed = 0;
    for (const run of windowRuns) {
      const provenance = sanitizeProvenance(run.provenance);
      if (provenance?.policyId === null) { unattributed++; continue; }
      const bucket = attributed.get(provenance.policyId) ?? { runs: 0, seconds: 0 };
      bucket.runs++; bucket.seconds += Math.round((Number.isFinite(run.elapsedMs) ? run.elapsedMs : 0) / 1000);
      attributed.set(provenance.policyId, bucket);
    }
    if (attributed.size === 0 && unattributed === 0) continue;
    // History prefix the treatment decision was made from: everything at or before the first benchmark.
    const prefix = sessions.filter(s => typeof s.startedAt === 'string' && !Number.isNaN(Date.parse(s.startedAt)) && Date.parse(s.startedAt) <= fromMs);
    const rows = [];
    for (const [policyId, bucket] of attributed) {
      const projection = projectPolicy(policyId, prefix);
      rows.push({
        policyId,
        runs: bucket.runs,
        treatmentSeconds: bucket.seconds,
        predictedDelta: Number.isFinite(projection.projectedDelta) ? projection.projectedDelta : 0,
        predictedFeasible: projection.feasible === true,
        observedDelta: Math.trunc(after.score) - Math.trunc(before.score),
      });
    }
    rows.sort((a, b) => b.runs - a.runs || (a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0));
    if (rows.length < minTreatmentRuns && unattributed === 0) continue;
    allPairs.push({
      beforeStartedAt: before.startedAt,
      afterStartedAt: after.startedAt,
      beforeScore: Math.trunc(before.score),
      afterScore: Math.trunc(after.score),
      unattributedRuns: unattributed,
      rows,
      note: rows.length
        ? `Observational pairing over ${rows[0].runs} provenance-tagged ${minTreatmentSeconds}s+ run(s): the benchmark change also includes everything else that happened between the two runs. No randomized arm in this ledger — the opt-in policy trial holds the assigned arms and the gate-gated comparison.`
        : 'Only unattributed tagged practice between these two runs — consistent practice, no policy to pair it with.',
    });
  }
  const pairs = allPairs.slice(-maxPairs);
  return {
    pairs,
    emptyNote: pairs.length ? null : 'No treatment context between valid benchmark runs yet.',
    caveats: TREATMENT_CAVEATS,
  };
}

const TREATMENT_CAVEATS = Object.freeze([
  'treatmentOutcomes pairs provenance-tagged practice with the surrounding benchmark runs; policy-attributed rows appear only where tagged practice carries a policyId, and tagged-but-unattributed practice is counted separately, never folded into a policy row',
  'predicted deltas recompute the impact heuristic on the pre-treatment history prefix (share \u00d7 excess, F20) and stay estimates',
  'no causal claim: emphasis-context tagging is not itself a randomized experiment — the opt-in policy trial (trial-window.js/trial.js) is where assigned arms and holdouts live, and only its gate-gated numbers exist as comparison evidence',
  'observational pairing: the observed benchmark change also includes everything else between the two runs',
]);
