import { assignStrategyTrial } from './experiment.js';
import { impactCandidates } from './impact.js';
import { isTrial, trialSlot, nextHoldout } from './trial-window.js';

/**
 * Feature-flag-controlled policy comparison (F21/F22 evaluation substrate, M2 slice 6). Policies
 * are named, deterministic practices for choosing *what the daily plan concentrates on*; a
 * comparison today can honestly say only:
 *
 * 1. how each policy's candidate set scores under the transparent impact heuristic
 *    (`projectPolicy`, sum of its candidates' estimated deltas, capped by the heuristic itself),
 * 2. which policy the Train tab emphasizes next, from a seeded A/B assignment
 *    (`assignStrategyTrial` — balanced, reproducible by seed; the assignment is advisory, any
 *     panel lets you run whatever policy you like),
 * 3. what a stored feature flag overrides.
 *
 * With a joined randomized crossover trial (F21/M4-F37, packages/training/src/trial-window.js +
 * trial.js), precedence becomes: feature flag → trial window → seeded assignment. During a
 * treatment window the trial's policy IS the emphasis (the window's policy, randomized order per
 * device); during a holdout window nothing is emphasized (`emphasizedPolicyId` is null and
 * recommendation drills launch unattributed). The assignment stays computed and reported either
 * way so the ledger can show what would have happened unrandomized. NO outcome comparison exists
 * here: outcome rows live in trial.js's `trialOutcomes`/`summarizeTrialOutcomes`, where practice
 * runs are paired with benchmarks under the caveat list. Deterministic: `seed` drives only the
 * assignment, never the projections; `nowMs` only the trial slot lookup.
 */

export const TRAINING_POLICIES = Object.freeze([
  {
    id: 'op-adaptive',
    name: 'Operation-adaptive mix (current default)',
    description: 'Concentrate on the single slowest operation, as the daily plan and adaptive weighting already do.',
    candidates: ctx => [ctx.candidates.find(c => c.kind === 'op') ?? ctx.candidates[0]].filter(Boolean),
  },
  {
    id: 'cell-gauntlet',
    name: 'Cell gauntlet rotation',
    description: 'Concentrate on the weakest sample-gated skill cells (the F32 selection), up to two per day.',
    candidates: ctx => ctx.candidates.filter(c => c.kind === 'cell').slice(0, 2),
  },
  {
    id: 'automaticity',
    name: 'Automaticity ladder',
    description: 'Latency-budget flash runs on stable slow cells — recall-speed practice, not method work.',
    candidates: ctx => ctx.candidates.filter(c => c.kind === 'cell' && c.stable).slice(0, 2),
  },
]);

/** Valid flag values are allow-listed policy ids; anything else resolves to the default. */
export const DEFAULT_POLICY_ID = 'op-adaptive';

export function resolvePolicyFlag(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (TRAINING_POLICIES.some(p => p.id === value)) return { value, valid: true };
  return { value: DEFAULT_POLICY_ID, valid: false, rejected: raw ?? null };
}

/** Total projected impact of one policy's rough candidate choice, summed and rounded. Pure. */
export function projectPolicy(policyId, sessions, { meanResponseMs = null } = {}) {
  const policy = TRAINING_POLICIES.find(p => p.id === policyId);
  if (!policy) return { policyId, feasible: false, note: `unknown policy id (${policyId})`, candidates: [], projectedDelta: 0 };
  const { candidates, emptyNote, meanResponseMs: avg } = impactCandidates(sessions, { meanResponseMs });
  if (!avg) {
    return { policyId, feasible: false, note: emptyNote, candidates: [], projectedDelta: 0 };
  }
  const policyCtx = { candidates };
  const rows = policy.candidates(policyCtx);  const projectedDelta = rows.reduce((a, c) => a + c.estDelta, 0);
  return {
    policyId,
    feasible: rows.length > 0,
    projectedDelta: Math.round(projectedDelta * 10) / 10,
    candidates: rows.map(c => ({ kind: c.kind, id: c.id, label: c.label, op: c.op, count: c.count, estDelta: c.estDelta, stable: c.stable })),
    note: rows.length > 0
      ? 'Summed over this policy\u2019s selected categories using the transparent impact heuristic; estimates share its caveats and ignore interaction and order effects.'
      : emptyNote ?? 'No eligible candidates for this policy in this history.',
  };
}

/**
 * Ranked projections plus the emphasis decision. `flag` (a validated policy id, e.g. from a
 * UI/localStorage control) pins the emphasized policy; a joined `trial` (parseStoredTrial shape)
 * otherwise pins it from the current crossover window; neither → the seeded assignment. The
 * response states which happened and, for trials, names the window phase and boundaries. No
 * outcome claims here — those live in trial.js under explicit caveat rows.
 */
export function comparePolicies(sessions, { seed, flag, trial, nowMs = Date.now() } = {}) {
  if (!seed) throw new RangeError('comparePolicies needs a seed for balanced assignment');
  const projections = TRAINING_POLICIES.map(p => projectPolicy(p.id, sessions));
  const ranked = [...projections].sort((a, b) =>
    b.feasible - a.feasible || b.projectedDelta - a.projectedDelta
    || TRAINING_POLICIES.findIndex(p => p.id === a.policyId) - TRAINING_POLICIES.findIndex(p => p.id === b.policyId));
  const assignment = assignStrategyTrial(seed, 0);
  const byAssignment = assignment === 'A' ? ranked[0] : (ranked[1] ?? ranked[0]);
  const resolved = resolvePolicyFlag(flag);
  const unresolvedTrial = isTrial(trial) ? (() => {
    try { return { slot: trialSlot(trial, nowMs) }; } catch { return null; }
  })() : null;
  let trialInfo = null;
  if (unresolvedTrial) {
    const slot = unresolvedTrial.slot;
    trialInfo = {
      id: trial.id,
      phase: slot.phase,
      windowIndex: slot.windowIndex,
      policyId: slot.policyId,
      order: slot.order,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      nextHoldout: nextHoldout(trial, nowMs),
      overriddenByFlag: resolved.valid,
    };
  }
  // Precedence: feature flag → trial window → seeded assignment (holdout empties the emphasis).
  let emphasized = resolved.valid ? resolved.value
    : trialInfo?.phase === 'treatment' ? (trialInfo.policyId ?? byAssignment.policyId)
    : trialInfo?.phase === 'holdout' ? null
    : byAssignment.policyId;
  const note = resolved.valid
    ? `Feature flag pinned the emphasis to ${resolved.value}; the seeded assignment (${assignment}) is advisory and logged above${trialInfo ? `, and the trial's ${trialInfo.phase} window (window ${trialInfo.windowIndex}) is overridden by it` : ''}.`
    : trialInfo?.phase === 'treatment'
      ? `Randomized crossover trial window ${trialInfo.windowIndex} (${trialInfo.startsAt.slice(0, 10)} → ${trialInfo.endsAt.slice(0, 10)}, ${trialInfo.order}): emphasis is ${emphasized} until ${trialInfo.endsAt.slice(0, 10)}; the next holdout window starts ${trialInfo.nextHoldout.startsAt.slice(0, 10)}. Runs launched here record this policy as treatment provenance; outcome pairing stays a one-learner crossover, never a population claim.`
      : trialInfo?.phase === 'holdout'
        ? `Trial holdout window ${trialInfo.windowIndex} (${trialInfo.startsAt.slice(0, 10)} → ${trialInfo.endsAt.slice(0, 10)}): emphasis is OFF, runs launched here tag no policy, and unemphasized practice stays the measurable contrast. Normal emphasis returns ${trialInfo.endsAt.slice(0, 10)}.`
        : `Seeded assignment ${assignment} → ${byAssignment.policyId} emphasis. Practice runs record this emphasis as launch context (provenance); without a joined trial or flag, no randomized outcome test exists and this comparison cannot claim one policy is better.`;
  return {
    assignment,
    assignmentBasedOn: assignment === 'A' ? 'seed → first-ranked policy' : 'seed → runner-up policy',
    flag: resolved,
    trial: trialInfo,
    emphasizedPolicyId: emphasized,
    flagOverride: resolved.valid,
    projections,
    ranked,
    note,
  };
}
