import { detectPlateau } from '../../analytics/src/progress.js';
import { diagnose } from '../../analytics/src/diagnostics.js';
import { heatmapLayout } from '../../analytics/src/heatmap.js';
import { weakestSkillCell, skillRollups, SKILL_STABLE_SAMPLES } from './skills.js';

/**
 * Plateau intervention branches (F22, M2 slice 5). `detectPlateau` (analytics) stays the single
 * conservative *signal* — it only ever says "possible-plateau" and stays descriptive. This module
 * adds the *decision layer* on top: given the same history, which of three pre-named intervention
 * branches the daily plan should surface, chosen deterministically from the evidence already in the
 * record, never from sentiment:
 *
 * | plateau status       | reliable weak pattern   | method headroom   | branch |
 * |---|---|---|---|
 * | possible-plateau     | yes (≥ stable samples, ratio > 1)          | any | `gauntlet-rotate` |
 * | possible-plateau     | no, but slow tags/ops diagnosed            | yes | `method-work` |
 * | possible-plateau     | no, and no diagnosed weakness              | —   | `consistency-rest` |
 * | improving / insufficient-data | — | — | `null` (no intervention) |
 *
 * "Reliable weak pattern" uses the practice-aware weakest-cell gate (`STABLE_CELL_SAMPLES` — the
 * stricter evidence label, because acting on a sparse cell is exactly the overfitting plateau
 * detection tries to avoid). "Method headroom" is simply a diagnosed slow operation/tag with at
 * least `minSamples` observations: something concretely to study in the curriculum.
 *
 * Evaluation protocol: the branch is a hypothesis to *test*, not a treatment with evidence. Any
 * before/after comparison must pin the same windows (`detectPlateau` uses a pinned 12-run split)
 * and stay honest about seasonality and streak structure; causal claims come from the M4 A/B
 * machinery (F37), not from replaying this table. Returns `{ status, count, medianShift, branch }`
 * where `branch` is null or `{ name, why, actions }` — pure, deterministic, no clock.
 */

const MIN_TAG_SAMPLES = 5;
/** Stricter evidence gate for acting on a weak pattern (stable, not merely emerging), as pinned by
 * the heatmap labels and mirrored through skills.js. */
const STABLE_CELL_SAMPLES = SKILL_STABLE_SAMPLES;
const signedShift = shift => shift === null || shift === undefined ? '±0' : (shift > 0 ? '+' : shift < 0 ? '−' : '±') + Math.abs(Number(shift)).toFixed(1);

export function plateauBranch(sessions, { minRuns = 12 } = {}) {
  const signal = detectPlateau(sessions, minRuns);
  if (signal.status !== 'possible-plateau') {
    return { ...signal, branch: null };
  }
  const weak = weakestSkillCell(sessions, { scope: 'all', minSamples: STABLE_CELL_SAMPLES });
  if (weak) {
    return {
      ...signal,
      branch: {
        name: 'gauntlet-rotate',
        why: `${weak.label} is your slowest recorded pattern over ${weak.count} solves (×${weak.ratio.toFixed(2)} vs your ${weak.op} median, stable evidence), yet benchmark medians have not moved (12-run shift: ${signedShift(signal.medianShift)} points). Run the weakness gauntlet on this category and verify with a probe before trusting any gain.`,
        actions: ['gauntlet', 'transfer-probe', 'standard-benchmark'],
      },
    };
  }
  const diagnosis = diagnose(sessions);
  const diagnosed = diagnosis.weaknesses.find(w => w.count >= MIN_TAG_SAMPLES);
  if (diagnosed) {
    return {
      ...signal,
      branch: {
        name: 'method-work',
        why: `${diagnosed.key === diagnosed.kind ? diagnosed.key : diagnosed.kind + ' ' + diagnosed.key} is diagnosed slow over ${diagnosed.count} solves (+${Math.round(diagnosed.excessMs)} ms vs global median), but no reliable skill cell stands out, so the flat line looks like a method gap, not a pattern gap. Work the curriculum for that class and re-measure.`,
        actions: ['curriculum-lesson', 'isolation-practice', 'standard-benchmark'],
      },
    };
  }
  return {
    ...signal,
    branch: {
      name: 'consistency-rest',
      why: 'No reliable weak pattern and no diagnosed weakness while benchmark medians stay flat: either the bottlenecks are distributed too thinly to show above noise, or more running volume will not help today. Prioritize sleep between runs and vary the daily mix across the next week instead of adding volume.',
      actions: ['rest', 'curriculum-lesson', 'standard-benchmark'],
    },
  };
}

/**
 * Coverage meters for the plan (F34/F38): how much of the 420-cell taxonomy any session history
 * touches at all (≥ 1 solve), and how many cells carry stable evidence (≥ `STABLE_CELL_SAMPLES`).
 * Pure, benchmark-namespace-safe via the same `scope` switch as the rollups ('benchmark' reads only
 * verified standard runs; 'all' adds practice for training decisions). Zero history degrades to
 * zeros — the UI only surfaces the line once something is observed.
 */
export function skillCoverage(sessions, { scope = 'all' } = {}) {
  let totalCells = 0;
  const perOp = {};
  for (const op of ['add', 'sub', 'mul', 'div']) {
    const layout = heatmapLayout(op);
    totalCells += layout.rows.length * layout.cols.length;
    perOp[op] = { total: layout.rows.length * layout.cols.length, observed: 0, stable: 0 };
  }
  const rollups = skillRollups(sessions, { scope });
  let observedCells = 0, stableCells = 0;
  for (const skill of rollups.skills) {
    observedCells++;
    stableCells += skill.count >= STABLE_CELL_SAMPLES ? 1 : 0;
    perOp[skill.op].observed++;
    perOp[skill.op].stable += skill.count >= STABLE_CELL_SAMPLES ? 1 : 0;
  }
  return {
    taxonomyVersion: rollups.taxonomyVersion, scope,
    totalCells, observedCells, stableCells,
    observedShare: totalCells ? observedCells / totalCells : 0,
    perOp,
  };
}
