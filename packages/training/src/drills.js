import { BENCHMARK_RULES, customRules, OPERATIONS } from '../../core/src/rulesets.js';
import { diagnose } from '../../analytics/src/diagnostics.js';
import { heatmapLayout } from '../../analytics/src/heatmap.js';
import { AUTOMATICITY_MS } from '../../analytics/src/skill-model.js';
export const DRILL_CATALOG = [
  {id:'benchmark',title:'Classic benchmark',goal:'Measure real 120-second performance',implemented:true},
  {id:'adaptive',title:'Train my weaknesses',goal:'Spend more attempts on slow operations',implemented:true},
  {id:'isolation',title:'Operation isolation',goal:'Focus on one arithmetic operation',implemented:true},
  {id:'sprint',title:'Speed interval',goal:'Fast 15–30 second practice',implemented:true},
  {id:'endurance',title:'Endurance',goal:'Sustain concentration over 3–10 minutes',implemented:true},
  {id:'replay',title:'Slow question replay',goal:'Retry problems lost to latency',implemented:true},
  {id:'accuracy',title:'Accuracy mode',goal:'Untimed precise solving',implemented:false},
  {id:'ladder',title:'Difficulty ladder',goal:'Graduated difficulty',implemented:false},
  {id:'interleaving',title:'Mixed interleaving',goal:'Improve skill transfer',implemented:false},
  {id:'flash',title:'Flash recall',goal:'Automatic fact retrieval',implemented:false},
  {id:'technique',title:'Technique trainer',goal:'Use efficient methods',implemented:false},
  {id:'gauntlet',title:'Weakness gauntlet',goal:'Intensive targeted practice',implemented:false},
  {id:'ghost',title:'Personal best ghost',goal:'Pace against previous run',implemented:false},
  {id:'daily',title:'Daily challenge',goal:'Common seeded test',implemented:false},
  {id:'duel',title:'Head-to-head duel',goal:'Live competition',implemented:false},
  {id:'quant',title:'Quant interview prep',goal:'Fractions, percentages and EV',implemented:true},
];
export function chooseAdaptive(sessions, durationSeconds=120) {
  const diagnostics=diagnose(sessions);
  const operationWeaknesses=diagnostics.weaknesses.filter(w=>w.kind==='operation'&&w.evidence==='emerging');
  const primary=operationWeaknesses[0]?.key??'mul';
  const enabled=['add','sub','mul','div'];
  const weights=Object.fromEntries(enabled.map(op=>[op,op===primary?4:1]));
  return { primary, weights, diagnostics, rules:customRules({durationSeconds,enabled}), explanation:operationWeaknesses.length?`Prioritizing ${primary} based on smoothed response times.`:'Not enough evidence yet: using multiplication-focused practice as a starting point.' };
}
export function operationDrill(op, seconds=120) {
  return customRules({enabled:[op],durationSeconds:seconds});
}
export function sprintRules(seconds=30) { return customRules({durationSeconds:seconds}); }
export function enduranceRules(seconds=300) { return customRules({durationSeconds:seconds}); }
/**
 * Practice rules restricted to one heatmap cell. Only the cell's operation is enabled and the source
 * operand ranges are narrowed to the cell; always a custom (non-benchmark) ruleset.
 */
export function cellDrill(op, { rowRange, colRange }, seconds=60) {
  const ranges = { left:[...rowRange], right:[...colRange] };
  const base = { enabled:[op], durationSeconds:seconds, label:'Heatmap drill' };
  return op==='add'||op==='sub' ? customRules({ ...base, addition:ranges }) : customRules({ ...base, multiplication:ranges });
}

const DRILL_GLYPH = { add:'+', sub:'–', mul:'×', div:'÷' };
export { DRILL_GLYPH };
const rangeLabel = r => Array.isArray(r) && r.length===2 && r.every(Number.isFinite) ? `${r[0]}–${r[1]}` : null;

/**
 * Adaptive drill difficulty (F18, M2 slice 3). A pattern drill runs at one of three tiers inside its
 * skill cell; the tier is chosen across runs from the F19 spaced-review record (`drillTierForRecord`),
 * never mid-run, so a single run's generated pool — and therefore its per-run review — stays
 * interpretable.
 *
 * | tier | name    | operand ranges |
 * |---|---|---|
 * | 1 | Narrow  | each band trimmed to its lower half (smaller operands are the easier entry point; single-value bands stay single) |
 * | 2 | Full    | exactly the cell's bands — the pre-F18 behavior and the default |
 * | 3 | Stretch | full cell plus exactly one adjacent band along one axis (row axis first, then col), interleaving two neighboring patterns |
 *
 * A stretch always points to numerically larger operands and never leaves the benchmark operand
 * space: the widening anchor is the last layout band the range touches, so when both axes of a cell
 * already end at their axis' top band, tier 3 keeps the full ranges (`capped: true`) — the
 * benchmark's own maximum is the ladder's ceiling. The ladder never loosens the benchmark: every
 * tier is a practice-only ruleset (`benchmarkEquivalent` stays false), and the benchmark ruleset is
 * untouched. This is a heuristic on speed evidence, not a validated difficulty model.
 */
export const DRILL_TIERS = Object.freeze({ 1: 'Narrow', 2: 'Full', 3: 'Stretch' });
export const DEFAULT_DRILL_TIER = 2;
const TIER_SUFFIX = { 1: ' · narrow', 2: '', 3: ' · stretch' };

const halfDown = ([lo, hi]) => [lo, lo + Math.floor((hi - lo) / 2)];

/**
 * Operand ranges and mix metadata for one tier, pure and total: `mixed` is true only when tier 3
 * actually widened a band, `axis` names the widened axis ('row' | 'col' | null) and `capped` is true
 * only for that capped tier-3 case above. Layout bands partition each axis, so widened union ranges
 * touch exactly the bands the original range touched plus (at most) their upper neighbor — for
 * taxonomy cells that is precisely "the cell and one adjacent cell", pinned property in
 * tests/drill-tiers.test.js. Throws RangeError for invalid tiers, operations or ranges.
 */
export function drillRangesForTier(cell, tier = DEFAULT_DRILL_TIER) {
  if (!Number.isInteger(tier) || tier < 1 || tier > 3) throw new RangeError('Drill tier must be 1, 2 or 3');
  const op = cell?.op;
  if (!OPERATIONS.includes(op)) throw new RangeError('Pattern drill needs a valid operation');
  const shapeOk = ([r, c]) => [r, c].every(a => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite));
  if (!shapeOk([cell.rowRange, cell.colRange])) throw new RangeError('Pattern drill needs the cell operand ranges');
  const rowRange = [...cell.rowRange], colRange = [...cell.colRange];
  if (tier === 1) return { rowRange: halfDown(rowRange), colRange: halfDown(colRange), mixed: false, capped: false, axis: null };
  if (tier === 2) return { rowRange, colRange, mixed: false, capped: false, axis: null };
  const layout = heatmapLayout(op);
  // Stretch into the layout band just above the topmost band the range touches, along one axis.
  const stretch = (bands, [lo, hi]) => {
    const last = bands.reduce((acc, band, i) => (band.range[0] <= hi ? i : acc), 0);
    const next = bands[last + 1];
    return next ? [lo, next.range[1]] : null; // null = this axis already ends at the benchmark ceiling
  };
  const row = stretch(layout.rows, rowRange);
  if (row) return { rowRange: row, colRange, mixed: true, capped: false, axis: 'row' };
  const col = stretch(layout.cols, colRange);
  if (col) return { rowRange, colRange: col, mixed: true, capped: false, axis: 'col' };
  return { rowRange, colRange, mixed: false, capped: true, axis: null };
}

/**
 * Tier for the next pattern drill of a cell, decided across runs from the cell's F19 review record —
 * never mid-run. Uses the record's success streak (the same counters that drive the interval
 * ladder 1 → 2 → 4 … days):
 * - no record, or anything but a non-negative integer: 2 — the full pattern is measured first;
 * - streak 0 (the last review lapsed): 1 — ease back into the narrower, smaller operands;
 * - streak ≥ 4 (four consecutive fast runs): 3 — stretch into the neighboring band;
 * otherwise 2 (fresh streaks 1–3, or no usable evidence). Descriptive and pinned by tests; the tier
 * follows speed evidence only, because the engine does not persist accuracy (F07).
 */
export function drillTierForRecord(record) {
  const streak = record?.successes;
  if (!Number.isInteger(streak) || streak < 0) return DEFAULT_DRILL_TIER;
  if (streak === 0) return 1;
  if (streak >= 4) return 3;
  return DEFAULT_DRILL_TIER;
}

/**
 * Practice drill for one skill cell at a difficulty tier (F17/F18, M2). Extends `cellDrill`: same
 * operand narrowing, but the ruleset carries its own id/label and an honest explanation, and the
 * ranges come from `drillRangesForTier`. Always a practice-namespace ruleset — `benchmarkEquivalent`
 * stays false even for a full-range cell because the id and label differ from the benchmark's. No
 * efficacy claims: whether pattern drills transfer to benchmark speed is an open question tracked by
 * F21/F22.
 * `cell` accepts a `skillCellFor` result, a `skillRollups` record or a `skillCellFromId`/review-queue
 * cell (needs op, rowRange, colRange, all hand-built-compatible); `options.tier` selects the
 * difficulty (default 2, the historical behavior).
 */
export function patternDrill(cell, seconds = 60, { tier = DEFAULT_DRILL_TIER } = {}) {
  if (!cell || typeof cell !== 'object') throw new RangeError('Pattern drill needs a skill cell');
  const { op } = cell;
  const tierRanges = drillRangesForTier(cell, tier);
  const row = rangeLabel(tierRanges.rowRange), col = rangeLabel(tierRanges.colRange);
  const label = typeof cell.label === 'string' && cell.label ? cell.label : `${row} ${DRILL_GLYPH[op]} ${col}`;
  const rules = cellDrill(op, { rowRange: tierRanges.rowRange, colRange: tierRanges.colRange }, seconds);
  const noClaims = 'This is a practice run — it never counts as a benchmark. No claims yet that pattern drills raise benchmark scores; that is evaluated separately (F21/F22).';
  const explanation = tier === 1
    ? `Practice narrowed to the lower half of each band — ${row} ${DRILL_GLYPH[op]} ${col} — for ${seconds} seconds. A lapsed review eases back into smaller operands. ${noClaims}`
    : tier === 3 && tierRanges.mixed
      ? `Practice on ${label}, stretched by the neighboring ${tierRanges.axis} band — ${row} ${DRILL_GLYPH[op]} ${col} — for ${seconds} seconds, two adjacent patterns interleaved. ${noClaims}`
      : tier === 3
        ? `Practice limited to ${label} for ${seconds} seconds. A stretch was requested, but both axes already end at the benchmark's operand ceiling, so the full pattern is used. ${noClaims}`
        : `Practice limited to ${label} for ${seconds} seconds. This is a practice run — it never counts as a benchmark. It targets your slowest recorded pattern (descriptive, small samples). No claims yet that pattern drills raise benchmark scores; that is evaluated separately (F21/F22).`;
  return {
    ...rules,
    id: 'pattern-drill',
    label: `Pattern drill · ${label}${TIER_SUFFIX[tier]}`,
    explanation,
  };
}

/**
 * Automaticity / "flash" drill for one skill cell (F31, M2). Same operand narrowing as a full tier-2
 * pattern drill, plus a hard per-question latency budget (`budgetMs` default = the shared
 * `AUTOMATICITY_MS` 2000 ms line, one definition across F19/F20/F31): a problem not answered inside
 * the budget is *missed* and replaced — recall that is not automatic is exactly what the drill does
 * not reward. The seeded draw is wrapped in `varyStimulus`, so the same fact never appears twice in
 * a row and a repeat cannot be answered from short-term memory ("avoids rote sequence recall").
 * Practice-only (`benchmarkEquivalent` false, benchmark ruleset untouched), `stage: 'flash'` so the
 * spaced-review ladder (F19) ignores these runs — automaticity checks and pattern reviews measure
 * different things and must not contaminate each other's evidence. Speed heuristic: no claim that
 * flash drills raise benchmark scores (F21/F22 evaluate transfer separately).
 *
 * Statistics caveat: on a small cell (a table factor × one band) even the varied draw eventually
 * repeats facts within one 60-second run; the variety guarantee is strictly "no adjacent repeats",
 * a property pinned by tests.
 */
export function automaticityDrill(cell, seconds = 60, { budgetMs = AUTOMATICITY_MS } = {}) {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 100 || budgetMs > 60000) throw new RangeError('Per-question budget must be 100–60000 ms');
  const tierRanges = drillRangesForTier(cell, DEFAULT_DRILL_TIER); // validates op/shape; full cell
  const rules = cellDrill(cell.op, { rowRange: tierRanges.rowRange, colRange: tierRanges.colRange }, seconds);
  const row = rangeLabel(tierRanges.rowRange), col = rangeLabel(tierRanges.colRange);
  const label = typeof cell.label === 'string' && cell.label ? cell.label : `${row} ${DRILL_GLYPH[cell.op]} ${col}`;
  return {
    ...rules,
    id: 'automaticity-drill',
    questionBudgetMs: budgetMs,
    label: `Automaticity drill · ${label}`,
    explanation: `Latency-bound practice on ${label} for ${seconds} seconds: each question is replaced after ${(budgetMs / 1000).toFixed(1)} s and counts as missed, and the same fact never repeats back to back. Speed heuristic only — recall that is not automatic never scores here, and there is no claim yet that flash drills raise benchmark scores (evaluated separately, F21/F22). It is a practice run and never counts as a benchmark.`,
  };
}
