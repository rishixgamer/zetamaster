/**
 * Persisted daily-plan completion (F34, M2 slice 5). The plan itself is regenerated every render
 * from session history (it must react to new evidence); what *persists* is only what you did: one
 * record per local day in the `dailyPlans` store (schema v3), keyed by the day's `'YYYY-MM-DD'`
 * key. Everything here is pure; storage wiring lives in `packages/storage/src/db.js` and import
 * sanitization in `packages/storage/src/sanitize.js`.
 */

/** Canonical step ids and order. Plan steps are always built from this list. */
export const PLAN_STEP_IDS = Object.freeze(['warmup', 'targeted', 'lesson', 'sprint', 'reflect']);

/** Local-day key ('YYYY-MM-DD'), the user's perceived day. UTC `toISOString` would roll the day
 * over at 16:00 in California, so plans would change mid-evening; local formatting via the fixed
 * `en-CA` locale gives exactly the ISO date. `now` is explicit in tests, default now in prod. */
export function dayLogKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new RangeError('dayLogKey needs a valid Date or ISO string');
  return date.toLocaleDateString('en-CA'); // en-CA formats as YYYY-MM-DD
}

/** Deterministic budget split: minutes per step summing EXACTLY to the target (largest-remainder
 * method). Weights are the training heuristics below; a step's share is `weight / Σweights`, the
 * integer floors cuddle leftovers to the biggest remainders (ties resolve to step order), so
 * `allocateBudget(7,…)` sums to 7, `allocateBudget(0,…)` is all zeros — nothing invented. */
export function allocateBudget(totalMinutes, steps) {
  if (!Number.isSafeInteger(totalMinutes) || totalMinutes < 0) throw new RangeError('Target minutes must be a non-negative integer');
  if (!Array.isArray(steps) || steps.length === 0) throw new RangeError('allocateBudget needs at least one step');
  const weightSum = steps.reduce((a, s) => a + Math.max(0, Number(s.weight) || 0), 0);
  if (weightSum <= 0) throw new RangeError('allocateBudget needs at least one positive weight');
  const shares = steps.map(s => (totalMinutes * (Math.max(0, Number(s.weight) || 0))) / weightSum);
  const minutes = shares.map(x => Math.floor(x));
  let left = totalMinutes - minutes.reduce((a, b) => a + b, 0);
  const order = shares
    .map((x, i) => [x - Math.floor(x), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; minutes[i] += 1; left--; }
  return minutes;
}

/**
 * Build the day's plan steps with stable ids, titles, modes and an exact-minute budget. The
 * targeted step is weighted by the operation weights (a slow operation earns more time); the warm-up
 * keeps a fixed share so the plan never collapses into pure drilling. When the plateau protocol
 * returns an intervention branch, its `why` is appended to the rationale and the branch is carried
 * on the plan as `intervention` — the plan suggests; it never relabels practice as treatment.
 */
export function planSteps(sessions, { minutes = 15, adaptive, intervention } = {}) {
  const weights = {
    warmup: 1,
    targeted: intervention?.name === 'gauntlet-rotate' ? 3.2 : 2,
    lesson: intervention?.name === 'method-work' ? 1.6 : 1.25,
    sprint: 1,
    reflect: 1,
  };
  const titles = {
    warmup: 'Recall warm-up',
    targeted: intervention?.name === 'gauntlet-rotate'
      ? 'Weakness gauntlet · targeted practice'
      : `Targeted ${adaptive?.primary ?? 'mul'} practice`,
    lesson: intervention?.name === 'method-work' ? 'Method lesson (plateau branch)' : 'Technique lesson',
    sprint: 'Mixed sprint',
    reflect: 'Review and reflect',
  };
  const modes = { warmup: 'isolation', targeted: 'adaptive', lesson: 'curriculum', sprint: 'sprint', reflect: 'review' };
  const steps = PLAN_STEP_IDS.map((id, i) => ({ id, title: titles[id], mode: modes[id], minutes: 0 }));
  const minutes_ = allocateBudget(minutes, PLAN_STEP_IDS.map(id => ({ weight: weights[id] })));
  steps.forEach((step, i) => { step.minutes = minutes_[i]; });
  return steps;
}

/** Merge a stored completion record into the freshly generated steps (by step id; minutes come
 * from today's plan, completion state survives from storage). Order is canonical. */
export function reconcilePlan(planSteps, record) {
  const completedById = new Map((Array.isArray(record?.steps) ? record.steps : []).map(s => [s.id ?? s.stepId, s]));
  return planSteps.map(step => {
    const stored = completedById.get(step.id);
    return { ...step, completed: stored?.completed === true, completedAt: typeof stored?.completedAt === 'string' ? stored.completedAt : null };
  });
}

/** Flip one step and return the next storage record (or null when `dateKey` is unusable). Pure. */
export function togglePlanStep(stepStates, stepId, completed, nowIso) {
  if (typeof nowIso !== 'string' || Number.isNaN(Date.parse(nowIso))) throw new RangeError('togglePlanStep needs a valid nowIso');
  const at = new Date(Date.parse(nowIso)).toISOString();
  return stepStates.map(step => (step.id === stepId ? { ...step, completed: Boolean(completed), completedAt: Boolean(completed) ? at : null } : step));
}

/** Progressive minutes for a step state: completed steps' plan minutes. Exact, no rounding. */
export function completedMinutes(stepStates) {
  return (Array.isArray(stepStates) ? stepStates : []).reduce((a, s) => a + (s.completed === true ? (Number.isFinite(s.minutes) ? s.minutes : 0) : 0), 0);
}

/** Serializable record for the `dailyPlans` store. Id = the local-day key. */
export function planRecordFrom(stepStates, { dateKey, targetMinutes, updatedAt }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey ?? ''))) throw new RangeError('planRecordFrom needs a YYYY-MM-DD dateKey');
  if (!Number.isSafeInteger(targetMinutes) || targetMinutes < 0) throw new RangeError('planRecordFrom needs a non-negative integer targetMinutes');
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) throw new RangeError('planRecordFrom needs a valid ISO updatedAt');
  const ordered = PLAN_STEP_IDS.map(id => {
    const step = (Array.isArray(stepStates) ? stepStates : []).find(s => s && s.id === id) ?? {};
    return { id, minutes: Number.isFinite(step.minutes) ? step.minutes : 0, completed: step.completed === true, completedAt: step.completedAt ?? null };
  });
  return {
    id: dateKey, date: dateKey, targetMinutes,
    steps: ordered,
    completedMinutes: completedMinutes(ordered),
    updatedAt: new Date(Date.parse(updatedAt)).toISOString(),
  };
}
