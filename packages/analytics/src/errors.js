/**
 * Error typology for solved questions, derived only from recorded telemetry (see docs/TELEMETRY.md).
 * Ordered by severity; each event gets exactly one type.
 * - calculation: a complete wrong answer was typed (or Enter pressed on one) before the right one.
 * - slip: a wrong digit appeared mid-entry and was corrected before the answer was complete.
 * - revision: text was deleted although no wrong prefix was visible (e.g. reconsidered a correct digit).
 * - clean: typed straight through.
 * Engine-1 events lack wrongPrefixes/fullWrongAnswers and are classified from corrections only.
 */
export const ERROR_TYPES = Object.freeze(['clean', 'revision', 'slip', 'calculation']);

export function classifyError(e) {
  if ((e.fullWrongAnswers ?? 0) > 0 || (e.wrongSubmissions ?? 0) > 0) return 'calculation';
  if ((e.wrongPrefixes ?? 0) > 0) return 'slip';
  if ((e.corrections ?? 0) > 0) return e.wrongPrefixes === undefined ? 'slip' : 'revision';
  return 'clean';
}

/** Counts, shares, and median response time per type. Medians are null for empty types. */
export function errorTypology(events) {
  const solved = events.filter(e => e.correct && Number.isFinite(e.responseMs));
  const byType = Object.fromEntries(ERROR_TYPES.map(t => [t, []]));
  for (const e of solved) byType[classifyError(e)].push(e.responseMs);
  const med = xs => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  return {
    total: solved.length,
    types: ERROR_TYPES.map(type => ({ type, count: byType[type].length, share: solved.length ? byType[type].length / solved.length : null, medianMs: med(byType[type]) })),
  };
}
