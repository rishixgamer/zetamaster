import { buildHeatmap, heatmapLayout, MIN_CELL_SAMPLES, STABLE_CELL_SAMPLES } from '../../analytics/src/heatmap.js';
import { OPERATIONS } from '../../core/src/rulesets.js';

/**
 * Versioned skill taxonomy (F17 backbone, M2 slice 1). See docs/SKILLS.md.
 *
 * DESIGN CHOICE — shared banding with the F09 heatmaps: a skill cell *is* a heatmap cell. The axes
 * come from `heatmapLayout`, the id string is exactly the heatmap cell `key`, and per-skill metrics
 * are computed by `buildHeatmap` itself, so the two surfaces cannot drift apart. A separate shared
 * banding module was rejected: analytics is already the single home of the operand taxonomy and
 * training already imports analytics (drills.js, planner.js), so this adds no dependency direction.
 *
 * `SKILL_TAXONOMY_VERSION` pins that interpretation: v1 = OPERAND_BANDS (2–9, 10–19, …, 90–100) ×
 * TABLE_FACTORS (2–12) as laid out by `heatmapLayout`. Changing banding later requires a new
 * version, a review-record migration (or explicit drop), and a note in docs/SKILLS.md.
 */
export const SKILL_TAXONOMY_VERSION = Object.freeze('skill-taxonomy-v1');

/**
 * Map a benchmark question to its stable skill cell. Arguments are the *source* operands of the
 * underlying problem (never the composite display operands): for division the source operands are
 * the divisor (2–12, the table factor) and the quotient (2–100) — verified against played sessions
 * and pinned by tests/skills.test.js; the same holds for the heatmap axes.
 * Returns a frozen { op, row, col, id, label, rowRange, colRange } or null when the operands fall
 * outside the taxonomy (unknown op, factor outside 2–12 for mul/div, operand outside 2–100 for
 * bands, non-finite input). Null is deliberate: rollups must ignore out-of-space data, not crash.
 */
export function skillCellFor(op, sourceLeft, sourceRight) {
  if (!OPERATIONS.includes(op)) return null; // unknown operation: out of taxonomy, never a crash
  const layout = heatmapLayout(op);
  if (!Number.isFinite(sourceLeft) || !Number.isFinite(sourceRight)) return null;
  const { row, col } = cellIndexes(layout, sourceLeft, sourceRight);
  if (row === null) return null;
  const cell = {
    op, row, col,
    id: `${op}:${row}:${col}`,
    label: `${layout.rows[row].label} ${glyphOf(op)} ${layout.cols[col].label}`,
    rowRange: [...layout.rows[row].range],
    colRange: [...layout.cols[col].range],
  };
  return Object.freeze(cell);
}

function cellIndexes(layout, sourceLeft, sourceRight) {
  const row = indexIn(layout.rows, sourceLeft), col = indexIn(layout.cols, sourceRight);
  if (row === null || col === null) return { row: null, col: null };
  return { row, col };
}

const indexIn = (axis, value) => {
  const i = axis.findIndex(({ range: [lo, hi] }) => value >= lo && value <= hi);
  return i >= 0 ? i : null;
};

const GLYPH = Object.freeze({ add: '+', sub: '–', mul: '×', div: '÷' });
const glyphOf = op => GLYPH[op] ?? op;

/**
 * Reconstruct a skill cell from its stored id (a review record id or `session.drill.cell`), against
 * the CURRENT taxonomy: labels/ranges come from `heatmapLayout` so they stay authoritative with the
 * taxonomy itself. Returns null for anything the current taxonomy does not name (unknown op,
 * out-of-range row/col, malformed string) — stale-version records are hidden from the UI, never
 * reinterpreted. `skillCellFor(...).id === skillCellFromId(that id).id` holds for every cell in
 * tests/skills.test.js and tests/reviews.test.js.
 */
export function skillCellFromId(id) {
  if (typeof id !== 'string') return null;
  const match = /^([a-z]+):(\d+):(\d+)$/.exec(id);
  if (!match || !OPERATIONS.includes(match[1])) return null;
  const op = match[1], layout = heatmapLayout(op);
  const row = Number(match[2]), col = Number(match[3]);
  if (row >= layout.rows.length || col >= layout.cols.length) return null;
  return {
    op, row, col, id,
    label: `${layout.rows[row].label} ${glyphOf(op)} ${layout.cols[col].label}`,
    rowRange: [...layout.rows[row].range], colRange: [...layout.cols[col].range],
  };
}

/** Skill id for one solved/attempted question's *source* operands. Never falls back to left/right:
 * for sub/div those are the composite question text, which would land in the wrong cell. */
export function skillOf(event) {
  return event && typeof event === 'object' ? skillCellFor(event.op, event.sourceLeft, event.sourceRight) : null;
}

/** Cells with fewer samples than this show no relative-time claim; between MIN_CELL_SAMPLES and
 * STABLE_CELL_SAMPLES the evidence is 'emerging'. Definitions mirrored from the heatmap. */
export { MIN_CELL_SAMPLES as SKILL_MIN_SAMPLES, STABLE_CELL_SAMPLES as SKILL_STABLE_SAMPLES };

/**
 * Per-skill rollups from sessions. Built on `buildHeatmap` (F09), so every metric — counts,
 * raw median, shrunken ratio relative to the operation median, distribution-free median CI,
 * not-clean share and the sample-size gates (insufficient < 3, emerging < 8) — uses exactly the
 * heatmap definitions (docs/SKILLS.md carries the caveat text).
 *
 * Namespace discipline mirrors the F41/heatmap scope pattern: scope 'benchmark' (default) uses only
 * verified standard benchmarks, so a drill or practice run can never influence a benchmark-scoped
 * summary; scope 'all' adds practice sessions for training-time decisions. Scopes, not blending:
 * the two namespaces are never mixed within one record.
 *
 * Returns { taxonomyVersion, scope, opObservations, skills } where `skills` lists only cells with
 * at least one observation (count: n), sorted deterministically by op (add, sub, mul, div), row, col.
 */
export function skillRollups(sessions, { scope = 'benchmark' } = {}) {
  const opObservations = {};
  const skills = [];
  const cms = { add: 0, sub: 0, mul: 0, div: 0 };
  for (const op of ['add', 'sub', 'mul', 'div']) {
    const heatmap = buildHeatmap(sessions, op, { scope });
    opObservations[op] = heatmap.observations;
    for (const [r, rowCells] of heatmap.cells.entries()) for (const [c, cell] of rowCells.entries()) {
      if (!cell.count) continue;
      skills.push({
        op, row: r, col: c, id: cell.key, label: cell.label,
        rowRange: [...cell.rowRange], colRange: [...cell.colRange],
        count: cell.count, medianMs: cell.medianMs, ci: cell.ci,
        smoothedMs: cell.smoothedMs, ratio: cell.ratio, flawedShare: cell.flawedShare,
        evidence: cell.evidence, opMedianMs: heatmap.opMedianMs, opSolves: heatmap.observations,
      });
    }
  }
  return { taxonomyVersion: SKILL_TAXONOMY_VERSION, scope, opObservations, skills };
}

/**
 * Slowest reliable skill cell, or null when nothing clears the gate. Gate: at least `minSamples`
 * (default MIN_CELL_SAMPLES = 3; below that the smoothed ratio is already biased toward the
 * operation median, so a "slow" label would be noise) and a shrunken ratio above 1. Ties resolve to
 * the deterministic op/row/col order above. Planning input only: descriptive, not calibrated.
 */
export function weakestSkillCell(sessions, { scope = 'all', minSamples = MIN_CELL_SAMPLES } = {}) {
  const { skills } = skillRollups(sessions, { scope });
  let best = null;
  for (const skill of skills) {
    if (skill.count < minSamples || skill.ratio === null || skill.ratio <= 1) continue;
    if (best === null || skill.ratio > best.ratio) best = skill;
  }
  return best;
}

const OP_RANK = Object.freeze(['add', 'sub', 'mul', 'div']);
const cellRank = skill => OP_RANK.indexOf(skill.op) * 1e6 + skill.row * 1e3 + skill.col;

/**
 * The `limit` most reliably-observed slow cells, slowest first (F32 gauntlet selection; the
 * single-cell `weakestSkillCell` stays the planner'spick). Same gate as `weakestSkillCell`:
 * `count >= minSamples` and a shrunken ratio above 1, ties resolved to the rollup order (op
 * add→sub→mul→div, then row, then col); below the gate or at ratio ≤ 1 a cell is never "weak" —
 * no speculative selection on thin or average data. Planning heuristic, not a diagnosis.
 */
export function weakestSkillCells(sessions, { scope = 'all', limit = 2, minSamples = MIN_CELL_SAMPLES } = {}) {
  const { skills } = skillRollups(sessions, { scope });
  return skills
    .filter(s => s.count >= minSamples && s.ratio !== null && s.ratio > 1)
    .sort((a, b) => b.ratio - a.ratio || cellRank(a) - cellRank(b))
    .slice(0, Math.max(0, Math.trunc(limit)));
}
