import { BENCHMARK_RULES, customRules, OPERATIONS } from '../../core/src/rulesets.js';
import { diagnose } from '../../analytics/src/diagnostics.js';
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
  {id:'quant',title:'Quant interview prep',goal:'Fractions, percentages and EV',implemented:false},
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
const rangeLabel = r => Array.isArray(r) && r.length===2 && r.every(Number.isFinite) ? `${r[0]}–${r[1]}` : null;

/**
 * Practice drill for one skill cell (F17, M2). Extends `cellDrill`: same operand narrowing, but the
 * ruleset carries its own id/label and an honest explanation. Always a practice-namespace ruleset —
 * `benchmarkEquivalent` stays false even for a full-range cell because the id and label differ from
 * the benchmark's. No efficacy claims: whether pattern drills transfer to benchmark speed is an open
 * question tracked by F21/F22.
 * `cell` accepts a `skillCellFor` result or a `skillRollups` record (needs op, rowRange, colRange).
 */
export function patternDrill(cell, seconds=60) {
  if (!cell || typeof cell !== 'object') throw new RangeError('Pattern drill needs a skill cell');
  const { op, rowRange, colRange } = cell;
  if (!OPERATIONS.includes(op)) throw new RangeError('Pattern drill needs a valid operation');
  const row = rangeLabel(rowRange), col = rangeLabel(colRange);
  if (!row || !col) throw new RangeError('Pattern drill needs the cell operand ranges');
  const label = typeof cell.label === 'string' && cell.label ? cell.label : `${row} ${DRILL_GLYPH[op]} ${col}`;
  const rules = cellDrill(op, { rowRange, colRange }, seconds);
  return {
    ...rules,
    id: 'pattern-drill',
    label: `Pattern drill · ${label}`,
    explanation: `Practice limited to ${label} for ${seconds} seconds. This is a practice run — it never counts as a benchmark. It targets your slowest recorded pattern (descriptive, small samples). No claims yet that pattern drills raise benchmark scores; that is evaluated separately (F21/F22).`,
  };
}
