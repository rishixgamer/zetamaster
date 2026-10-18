import { createGenerator, varyStimulus } from '../../core/src/generator.js';
import { patternDrill, drillTierForRecord, cellDrill, drillRangesForTier, DRILL_GLYPH, DEFAULT_DRILL_TIER } from './drills.js';
import { weakestSkillCells, skillCellFromId } from './skills.js';

/**
 * Weakness gauntlet with an independent transfer probe (F32, M2 slice 4) — the milestone's
 * train/holdout protocol as one inspectable, pure data object:
 *
 *   1. **Select** — the weakest skill cells that clear the sample gate (`weakestSkillCells`,
 *      practice-aware scope 'all'), slowest first, at most `cellsLimit` per day.
 *   2. **Train** — one tier-aware pattern drill per selected cell (F17/F18 ladder intact; a random
 *      per-run seed, so training itself never turns into rote recall of a fixed sequence).
 *   3. **Probe** — one `transferProbe` per cell: practice problems drawn again from exactly the
 *      cell's operand family (its heatmap bands), but from a *deterministic, day-scoped seed that
 *      is never the training seed*: a held-out draw from the same family, not a replay.
 *   4. **Benchmark** — the plan asks for one standard 120 s benchmark afterwards. Every ruleset
 *      built here is a practice ruleset (`benchmarkEquivalent` false); the benchmark ruleset, its
 *      score identity, and all benchmark-scoped analytics stay untouched.
 *
 * Everything here is selection and ruleset construction — it launches nothing and claims nothing:
 * whether gauntlet training transfers to benchmark speed is exactly what F21/F22 evaluate, and the
 * probe carries its own caveat (small families can repeat exact problems across days even with
 * fresh seeds; the stimulus-variety guarantee is per adjacent pair).
 */

/** Day-scoped deterministic probe seed: reproducible for its day, never equal to the randomized
 * training seeds. Day boundary is the UTC date of `now`; the cell id disambiguates seeds. */
export function transferProbeSeed(isoDay, cellId) {
  return `gauntlet-probe:${isoDay}:${cellId}`;
}

const isoDayOf = now => {
  const date = now instanceof Date ? now : new Date(now);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError('gauntletPlan needs a valid `now` (Date or ISO string) for reproducible probe seeds');
  }
  return date.toISOString().slice(0, 10);
};

/**
 * The plan. `now` (Date or ISO string) is required because probe seeds are day-scoped on purpose:
 * the same plan on a different day probes a different draw. Options:
 * - `reviews` — persisted F19 review records; each cell's drill runs at the tier its record implies
 *   (`drillTierForRecord`), so the difficulty ladder survives inside the gauntlet;
 * - `cellsLimit` — the fixed daily quota of targeted categories (default 2);
 * - `drillSeconds` / `probeSeconds` — stage durations (default 60 s each);
 * - `minSamples` / `scope` — selection gate; the default is the module's 3-solve floor and the
 *   practice-aware scope 'all', because choosing practice needs practice evidence.
 *
 * Cells carry the evidence label their rollup earned ('emerging' < 8 solves, 'stable' ≥ 8). Empty
 * history stays honest: with no qualified cell there are no stages and an explicit empty note —
 * the gauntlet never fabricates weak patterns for a fresh profile.
 */
export function gauntletPlan(sessions, { reviews = [], cellsLimit = 2, drillSeconds = 60, probeSeconds = 60, minSamples, scope = 'all', now } = {}) {
  if (now === undefined || now === null) throw new RangeError('gauntletPlan needs an explicit `now` (Date or ISO string): probe seeds are day-scoped on purpose');
  const limit = Math.trunc(cellsLimit);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10) throw new RangeError('cellsLimit must be 0–10');
  const created = now instanceof Date ? now : new Date(now);
  const isoDay = isoDayOf(created);
  const bind = seconds => Math.trunc(seconds);
  if (![drillSeconds, probeSeconds].every(s => Number.isSafeInteger(bind(s)) && s >= 5 && s <= 600)) {
    throw new RangeError('Drill and probe durations must be 5–600 seconds');
  }
  if (minSamples !== undefined && (!Number.isSafeInteger(minSamples) || minSamples < 1)) throw new RangeError('minSamples must be a positive integer');
  const selected = weakestSkillCells(sessions, { scope, limit, minSamples });
  const records = new Map((Array.isArray(reviews) ? reviews : []).filter(r => r && typeof r === 'object').map(r => [r.id, r]));
  const cells = selected.map(skill => ({
    cell: skill.id, op: skill.op, row: skill.row, col: skill.col, label: skill.label,
    count: skill.count, ratio: skill.ratio, evidence: skill.evidence, tier: drillTierForRecord(records.get(skill.id) ?? null),
    train: { stage: 'train', seconds: bind(drillSeconds), seed: null, varied: false },
    probe: { stage: 'probe', seconds: bind(probeSeconds), seed: transferProbeSeed(isoDay, skill.id), varied: true },
  }));
  return {
    version: 1,
    policy: 'gated-weakest-v1',
    isoDay,
    createdAt: created.toISOString(),
    cells,
    benchmarkNote: 'After training and probing, run one standard 120-second benchmark. Drill and probe results stay practice runs; they never enter benchmark scores, medians, or benchmark-only analytics.',
    emptyNote: cells.length ? null : 'No skill pattern has enough recorded data yet: each candidate needs at least 3 solves and must be slower than its operation median. Play a benchmark or drill a heatmap cell first — the gauntlet does not invent weak patterns.',
  };
}

/**
 * Probe ruleset: the same operand family as a full (tier-2) pattern drill, relabeled as a
 * measurement. It exists so the probe is never confused with training and never mistaken for the
 * benchmark: own id/label, honest explanation naming its purpose and limits. Launching UIs wrap
 * its generator in `varyStimulus` (the `varied` flag in plan entries says so).
 */
export function transferProbe(cell, seconds = 60, { label } = {}) {
  const tierRanges = drillRangesForTier(cell, DEFAULT_DRILL_TIER); // validates op and range shape
  const rules = cellDrill(cell.op, { rowRange: tierRanges.rowRange, colRange: tierRanges.colRange }, seconds);
  const name = (label ?? (typeof cell.label === 'string' && cell.label ? cell.label : `${cell.op} cell`)).slice(0, 80);
  const row = [tierRanges.rowRange[0], tierRanges.rowRange[1]].join('–');
  const col = [tierRanges.colRange[0], tierRanges.colRange[1]].join('–');
  return {
    ...rules,
    id: 'transfer-probe',
    label: `Transfer probe · ${name}`,
    explanation: `Measured practice, not the benchmark: fresh problems from the same family as ${name} (${row} ${DRILL_GLYPH[cell.op] ?? cell.op} ${col}) for ${seconds} seconds, drawn from this day's probe seed. It screens whether that pattern's speed holds on unseen draws from the family; a low probe score may mean the training has not stuck, the family is genuinely hard, or the sample is too small to edge-probability. It records no spaced review, and it never counts as a benchmark.`,
  };
}

const STAGES = Object.freeze(['train', 'probe']);

/**
 * Build everything the game launcher needs for one stage of one planned cell. Throws RangeError
 * for an unknown stage, an unplanned cell, or a plan whose entries no longer match the current
 * taxonomy (`skillCellFromId` fails) — a stale plan is refused, never reinterpreted.
 *
 * - `stage: 'train'` → tier-aware `patternDrill` (seed null: the launcher picks a fresh random
 *   seed; every run should see a different draw order, avoiding rote sequencing).
 * - `stage: 'probe'` → `transferProbe` (seed = the plan's day-scoped probe seed; the launcher sets
 *   it so the probe is reproducible for its day) and a `varyStimulus`-wrapped generator flag.
 *
 * Returns `{ mode, rules, seed, varied, drill }` where `drill` is the session's drill payload:
 * `{ op, cell, label, tier, stage, seconds, probeSeed? }`. Probes carry `stage: 'probe'`, which the
 * review semantics (`drillReviewEligible` in reviews.js) treat as never-record-worthy.
 */
export function gauntletLaunch(plan, cellId, stage) {
  if (!STAGES.includes(stage)) throw new RangeError(`Unknown gauntlet stage: ${String(stage)}`);
  const entry = plan?.cells?.find(c => c.cell === cellId);
  if (!entry) throw new RangeError(`Cell is not in this gauntlet plan: ${String(cellId)}`);
  const cell = skillCellFromId(entry.cell);
  if (!cell) throw new RangeError('Planned cell no longer exists in the current skill taxonomy');
  if (stage === 'train') {
    const rules = patternDrill(cell, entry.train.seconds, { tier: entry.tier });
    return {
      mode: 'drill', rules, seed: null, varied: false,
      drill: { op: cell.op, cell: cell.id, label: cell.label, tier: entry.tier, stage: 'train', seconds: entry.train.seconds },
    };
  }
  const rules = transferProbe(cell, entry.probe.seconds, { label: cell.label });
  const seed = transferProbeSeed(plan.isoDay, cell.id);
  return {
    mode: 'drill', rules, seed, varied: true,
    drill: { op: cell.op, cell: cell.id, label: cell.label, stage: 'probe', seconds: entry.probe.seconds, probeSeed: seed },
  };
}

/**
 * Convenience for the launcher: a seeded generator for one gauntlet launch. `seed` null means the
 * caller should generate one (training stays random per run). Wrapping in `varyStimulus` is only
 * for probes training→ held-out draws, per the plan's `varied` flag.
 */
export function gauntletGenerator(launch, seed) {
  const picked = launch.seed ?? seed;
  if (picked === undefined || picked === null || picked === '') throw new RangeError('gauntletGenerator needs an explicit seed for this launch');
  const base = createGenerator(launch.rules, String(picked));
  return launch.varied ? varyStimulus(base) : base;
}
