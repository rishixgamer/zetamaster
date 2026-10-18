/**
 * Speed-interval sets (F30 close-out): several short work bouts (each an independent `sprint`
 * practice run, mode 'sprint') separated by recovery pauses. The module is pure data plus an
 * evidence-linked rationale; the UI in apps/web owns staging, the manual continue step and the
 * informational recovery meter.
 *
 * Integrity boundaries (unchanged by this feature):
 * - work bouts reuse `sprintRules` — practice modes only, `benchmark` false by construction;
 * - recovery is a *pause between sessions*: no engine timer, question budget or acceptance rule
 *   is touched, and no benchmark timing could ever take advantage of it;
 * - the set itself is deliberately not persisted (only the sprint runs are, like all practice);
 * - the link "recovery prevents late-run slowdown" is an untested hypothesis. The slowdown itself
 *   IS measured (`paceProfile().halfShift`, docs/FATIGUE.md); the protocol is not.
 */
export const SETS_DEFAULTS = Object.freeze({ sets: 3, workSeconds: 30, restSeconds: 15 });

/** One interval set: `sets` work stages interleaved with `sets − 1` recovery stages. */
export function intervalSet({ sets = SETS_DEFAULTS.sets, workSeconds = SETS_DEFAULTS.workSeconds, restSeconds = SETS_DEFAULTS.restSeconds } = {}) {
  if (!Number.isSafeInteger(sets) || sets < 1 || sets > 10) throw new RangeError('sets must be an integer of 1–10');
  if (!Number.isSafeInteger(workSeconds) || workSeconds < 10 || workSeconds > 300) throw new RangeError('workSeconds must be an integer of 10–300');
  if (!Number.isSafeInteger(restSeconds) || restSeconds < 5 || restSeconds > 120) throw new RangeError('restSeconds must be an integer of 5–120');
  const stages = [];
  for (let i = 1; i <= sets; i++) {
    stages.push({ kind: 'work', seconds: workSeconds, index: i });
    if (i < sets) stages.push({ kind: 'rest', seconds: restSeconds, index: i });
  }
  const roster = `${sets} × ${workSeconds} s sprints`;
  return {
    id: sets === SETS_DEFAULTS.sets && workSeconds === SETS_DEFAULTS.workSeconds && restSeconds === SETS_DEFAULTS.restSeconds
      ? 'interval-set-default'
      : `interval-set-${sets}x${workSeconds}x${restSeconds}`,
    label: restSeconds ? `${roster} · ${restSeconds} s recovery` : `${roster} · no recovery`,
    stages,
    workStages: sets,
    restStages: sets - 1,
    totalMinutes: Math.ceil((sets * workSeconds + (sets - 1) * restSeconds) / 60),
  };
}

/**
 * Evidence line for the set card, quoted from the measured pace split. Returns `null` when there
 * is not enough verified data to say anything (below 3 standard runs, or the within-run split
 * needs at least 3 runs with solves in both halves); the UI then falls back to an honest
 * "general practice structure" line instead of fabricating evidence. When `ci` is present it is
 * the pace split's own 95% interval (docs/FATIGUE.md); without it the claim names its sample.
 */
export function intervalSetRationale(pace) {
  if (!pace || !Number.isFinite(pace.runs) || pace.runs < 3) return null;
  const half = pace.halfShift;
  if (!half || !Number.isFinite(half.ratio)) return null;
  if (half.ratio <= 1) {
    return { grounded: true, slowHalf: false, ci: null,
      text: `your verified runs do not currently show a second-half slowdown (×${half.ratio.toFixed(2)} in ${half.runs} runs) — matching that reading, no recovery treatment is claimed` };
  }
  const ci = half.ci && Number.isFinite(half.ci.low) && Number.isFinite(half.ci.high)
    ? { low: half.ci.low, high: half.ci.high } : null;
  return {
    grounded: true, slowHalf: true, ci,
    text: `measured on your verified runs: ×${half.ratio.toFixed(2)} slower in the second half${ci ? ` (95% CI ×${ci.low.toFixed(2)}–×${ci.high.toFixed(2)})` : `, ${half.runs} runs, interval needs ≥6`}`,
  };
}
