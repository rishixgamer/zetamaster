import { chooseAdaptive } from './drills.js';
import { weakestSkillCell, SKILL_MIN_SAMPLES } from './skills.js';
import { plateauBranch, skillCoverage } from './plateau.js';
import { planSteps } from './daylog.js';

/**
 * The daily plan (F34, M2 slice 5). Largely the historical shape — 15 fixed-purpose steps plus the
 * operation-level rationale — composed now from three deterministic pieces:
 *
 * - **Allocation** (`daylog.planSteps`): an exact-minutes split weighted toward targeted practice
 *   (a slow operation earns more time; the gauntlet branch triples the targeted weight). The
 *   "optimization" this satisfies is transparent weighting with an exact budget, not a fitted model;
 *   keep claiming only that.
 * - **Plateau intervention branch** (`plateau.plateauBranch`, F22): `plan.intervention` is null or
 *   `{ name, why, actions }` — a hypothesis to test, attached to the rationale verbatim.
 * - **Pattern surface** (F17 hook, unchanged): the weakest gated cell, when it exists, names itself
 *   with its measured ratio and points at the heatmap/review launch points.
 *
 * Scope note: choosing practice uses scope 'all' (practice attempts are legitimate evidence for
 * choosing practice); every progress/consistency display stays benchmark-scoped.
 */
export function dailyPlan(sessions, minutes = 15) {
  const adaptive = chooseAdaptive(sessions);
  const plateau = plateauBranch(sessions);
  const coverage = skillCoverage(sessions, { scope: 'all' });
  const weak = weakestSkillCell(sessions, { scope: 'all', minSamples: SKILL_MIN_SAMPLES });
  const pattern = weak
    ? ` Slowest recorded pattern so far: ${weak.label} — ×${weak.ratio.toFixed(2)} vs your ${weak.op} median over ${weak.count} solves (small samples, descriptive only). Drill it from a heatmap cell or the due pattern reviews panel; each finished drill schedules the next repetition.`
    : '';
  const interventionNote = plateau.branch ? ` ${plateau.branch.why}` : '';
  const steps = planSteps(sessions, { minutes, adaptive, intervention: plateau.branch });
  return {
    targetMinutes: minutes,
    rationale: adaptive.explanation + pattern + interventionNote,
    steps,
    plateau: plateau.status,
    intervention: plateau.branch,
    coverage,
  };
}

/** Transparent priority score (F21 substrate): opportunity × excess × trainability per practice
 * minute. Deliberately simple — a ranker, not a model of learning. */
export function candidatePriority({ frequency, excessMs, trainability, practiceMinutes }) {
  if (practiceMinutes <= 0) return 0;
  return Math.max(0, frequency) * Math.max(0, excessMs) * Math.max(0, trainability) / practiceMinutes;
}
