import test from 'node:test';
import assert from 'node:assert/strict';
import { drillRangesForTier, drillTierForRecord, patternDrill, DRILL_TIERS, DEFAULT_DRILL_TIER } from '../packages/training/src/drills.js';
import { cellDrill } from '../packages/training/src/drills.js';
import { skillCellFor, skillCellFromId, skillOf } from '../packages/training/src/skills.js';
import { skillReviewRecord } from '../packages/training/src/scheduler.js';
import { drillReviewOutcome, SKILL_REVIEW_MIN_SOLVES } from '../packages/training/src/reviews.js';
import { heatmapLayout } from '../packages/analytics/src/heatmap.js';
import { createGenerator } from '../packages/core/src/generator.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { customRules, BENCHMARK_RULES } from '../packages/core/src/rulesets.js';

// F18 (M2 slice 3): adaptive drill difficulty and mix. All tests are seeded (no wall clock).
// The design: three tiers inside one skill cell — Narrow (lower half of each band), Full (exact
// cell, the pre-F18 default), Stretch (full cell plus exactly one adjacent band, capped at the
// benchmark operand space); the tier is chosen across runs from the F19 streak counters, never
// mid-run, so one run's generated pool and per-run review stay interpretable (docs/SKILLS.md).
const OPS = ['add', 'sub', 'mul', 'div'];

const drawQ = (rules, seed, n = 1200) => Array.from({ length: n }, createGenerator(rules, seed));

test('tier constants are exposed for the queue UI', () => {
  assert.deepEqual(DRILL_TIERS, { 1: 'Narrow', 2: 'Full', 3: 'Stretch' });
  assert.equal(DEFAULT_DRILL_TIER, 2);
});

test('tier ranges: tier 1 halves each band, tier 2 keeps the cell, tier 3 adds exactly one adjacent band or caps', () => {
  const capped = new Set();
  for (const op of OPS) {
    const layout = heatmapLayout(op);
    for (let r = 0; r < layout.rows.length; r++) for (let c = 0; c < layout.cols.length; c++) {
      const cell = skillCellFromId(`${op}:${r}:${c}`);
      const t1 = drillRangesForTier(cell, 1);
      for (const [band, sliced] of [[cell.rowRange, t1.rowRange], [cell.colRange, t1.colRange]]) {
        const [lo, hi] = band;
        assert.deepEqual(sliced, [lo, lo + Math.floor((hi - lo) / 2)], `${cell.id} tier 1 trims to the lower half`);
        assert.ok(sliced[0] >= lo && sliced[1] <= hi, 'tier 1 stays inside the cell');
      }
      const t2 = drillRangesForTier(cell, 2);
      assert.deepEqual(t2.rowRange, cell.rowRange);
      assert.deepEqual(t2.colRange, cell.colRange);
      assert.equal(t2.mixed, false); assert.equal(t2.capped, false); assert.equal(t2.axis, null);
      const t3 = drillRangesForTier(cell, 3);
      if (t3.capped) {
        capped.add(cell.id);
        assert.equal(t3.mixed, false); assert.equal(t3.axis, null);
        assert.deepEqual(t3.rowRange, cell.rowRange, 'capped stretch equals the full cell');
        assert.deepEqual(t3.colRange, cell.colRange);
      } else if (t3.axis === 'row') {
        assert.deepEqual(t3.rowRange, [cell.rowRange[0], layout.rows[r + 1].range[1]], `${cell.id} row stretch spans the cell band plus exactly the next band`);
        assert.deepEqual(t3.colRange, cell.colRange);
        assert.equal(t3.mixed, true);
      } else {
        assert.equal(t3.axis, 'col');
        assert.deepEqual(t3.colRange, [cell.colRange[0], layout.cols[c + 1].range[1]], `${cell.id} column stretch spans the cell band plus exactly the next band`);
        assert.deepEqual(t3.rowRange, cell.rowRange);
        assert.equal(t3.mixed, true);
      }
    }
  }
  assert.deepEqual([...capped].sort(), ['add:9:9', 'div:10:9', 'mul:10:9', 'sub:9:9'], 'exactly the four double-top cells reach the benchmark operand ceiling');
});

test('generated problems map to exactly the tier\'s cell set across operations', () => {
  const cases = [
    { cell: skillCellFor('mul', 7, 45), stretchIds: ['mul:5:4', 'mul:6:4'] },                       // stretch into the neighboring table factor
    { cell: skillCellFor('add', 40, 50), stretchIds: ['add:4:5', 'add:5:5'] },                      // stretch into the next left-addend band
    { cell: skillCellFor('sub', 47, 29), stretchIds: ['sub:4:2', 'sub:5:2'] },
    { cell: skillCellFor('div', 7, 95), stretchIds: ['div:5:9', 'div:6:9'] },                       // divisor quotient drills stretch the divisor
    { cell: skillCellFor('mul', 12, 45), stretchIds: ['mul:10:4', 'mul:10:5'] },                    // top factor stretches the quotient band instead
    { cell: skillCellFor('mul', 12, 95), stretchIds: ['mul:10:9'], capped: true },                  // both bands top: no harder partner exists
  ];
  for (const { cell, stretchIds, capped } of cases) {
    for (const tier of [1, 2]) {
      const ids = new Set(drawQ(patternDrill(cell, 60, { tier }), `tier-${tier}-${cell.id}`).map(q => skillOf(q).id));
      assert.deepEqual([...ids], [cell.id], `${cell.id} tier ${tier}: every problem lands in the drilled cell`);
    }
    const seen = new Set();
    for (const q of drawQ(patternDrill(cell, 60, { tier: 3 }), `tier-3-${cell.id}`)) {
      const id = skillOf(q)?.id;
      assert.ok(stretchIds.includes(id), `${cell.id} tier 3 must stay inside ${stretchIds.join(' / ')}, saw ${id}`);
      seen.add(id);
    }
    assert.deepEqual([...seen].sort(), [...stretchIds].sort(), capped ? 'capped stretch stays inside the cell' : 'both adjacent patterns are actually interleaved');
  }
});

test('stretch exposes the wider operand space itself, not just two cell labels', () => {
  const stretch = drillRangesForTier(skillCellFor('mul', 7, 45), 3);
  assert.deepEqual(stretch.rowRange, [7, 8]);
  const ids = new Set();
  for (const q of drawQ(patternDrill(skillCellFor('mul', 7, 45), 60, { tier: 3 }), 'operand-space')) {
    assert.ok(q.sourceLeft >= 7 && q.sourceLeft <= 8, 'stretch covers the union range, not a hand-picked subset');
    assert.ok(q.sourceRight >= 40 && q.sourceRight <= 49);
    ids.add(q.sourceLeft);
  }
  assert.deepEqual([...ids].sort(), [7, 8], 'both neighbor factors actually appear');
});

test('pattern drill tier surfaces: exact ruleset equivalents and honest explanations', () => {
  const cell = skillCellFor('mul', 7, 45);
  const tier1 = patternDrill(cell, 60, { tier: 1 });
  assert.deepEqual(tier1, { ...cellDrill('mul', { rowRange: [7, 7], colRange: [40, 44] }, 60), id: 'pattern-drill', label: 'Pattern drill · 7 × 40–49 · narrow', explanation: tier1.explanation });
  assert.match(tier1.explanation, /narrowed to the lower half of each band — 7–7 × 40–44 —/);
  const tier3 = patternDrill(cell, 60, { tier: 3 });
  assert.deepEqual(tier3, { ...cellDrill('mul', { rowRange: [7, 8], colRange: [40, 49] }, 60), id: 'pattern-drill', label: 'Pattern drill · 7 × 40–49 · stretch', explanation: tier3.explanation });
  assert.match(tier3.explanation, /stretched by the neighboring row band — 7–8 × 40–49 —/);
  // Default tier is the historical behavior, byte for byte below the label.
  assert.deepEqual(patternDrill(cell, 60, {}), patternDrill(cell, 60));
  assert.equal(patternDrill(cell, 60).label, 'Pattern drill · 7 × 40–49');
  // Capped stretch: honest copy about the ceiling, ranges equal the full cell.
  const capped = patternDrill(skillCellFor('add', 92, 92), 60, { tier: 3 });
  assert.deepEqual([...capped.addition.left], [90, 100]);
  assert.match(capped.explanation, /both axes already end at the benchmark\'s operand ceiling/);
  assert.ok(capped.label.endsWith('· stretch'));
  for (const rules of [tier1, tier3, capped, patternDrill(cell, 60)]) {
    assert.ok(!/raise your score|guarantee|proven/i.test(rules.explanation), 'no efficacy promises at any tier');
  }
  assert.equal(patternDrill({ op: 'mul', rowRange: [7, 7], colRange: [40, 49] }, 60, { tier: 1 }).label, 'Pattern drill · 7–7 × 40–44 · narrow', 'tier suffix and the actual narrowed ranges, for hand-built cells too');
  for (const badTier of [0, 4, -1, 2.5, '2', null]) assert.throws(() => patternDrill(cell, 60, { tier: badTier }), RangeError);
  for (const badCell of [null, {}, { op: 'pow', rowRange: [1, 2], colRange: [1, 2] }, { op: 'mul', rowRange: [7] }, { op: 'mul', rowRange: [7, 7] }]) {
    assert.throws(() => patternDrill(badCell), RangeError);
  }
});

function ladderRecord(successes) { return { id: 'mul:5:4', successes, intervalDays: successes ? Math.pow(2, Math.min(6, successes - 1)) : 1 }; }

test('drillTierForRecord follows the spaced-review ladder exactly, on the streak counters', () => {
  assert.equal(drillTierForRecord(null), 2, 'no record: measure the full pattern first');
  assert.equal(drillTierForRecord(undefined), 2);
  assert.equal(drillTierForRecord({}), 2, 'empty record is not evidence');
  assert.equal(drillTierForRecord({ successes: '3' }), 2, 'garbage streaks keep the full pattern');
  assert.equal(drillTierForRecord({ successes: -1 }), 2);
  assert.equal(drillTierForRecord(ladderRecord(0)), 1, 'a lapse narrows the next drill');
  assert.equal(drillTierForRecord(ladderRecord(1)), 2);
  assert.equal(drillTierForRecord(ladderRecord(2)), 2);
  assert.equal(drillTierForRecord(ladderRecord(3)), 2);
  assert.equal(drillTierForRecord(ladderRecord(4)), 3, 'four consecutive fast runs stretch');
  assert.equal(drillTierForRecord(ladderRecord(6)), 3, 'the capped streak still stretches');
  assert.equal(drillTierForRecord(ladderRecord(999)), 3);
});

test('tier ladder walks the whole streak cycle with real review records (fixed clock)', () => {
  const T = Date.parse('2026-10-17T12:00:00Z');
  const day = (n) => new Date(T + n * 86400000).toISOString();
  const id = 'mul:5:4';
  let rec = null;
  const drillRecord = (wasFast, at) => (rec = skillReviewRecord(id, rec, wasFast, at));
  const tierOf = () => drillTierForRecord(rec);
  assert.equal(tierOf(), 2, 'fresh cell: Full');
  assert.equal(tierOf(drillRecord(true, day(1))), 2, 'one fast run is not mastery yet');
  assert.equal(tierOf(drillRecord(true, day(2))), 2);
  assert.equal(tierOf(drillRecord(true, day(4))), 2);
  assert.equal(tierOf(drillRecord(true, day(8))), 3, 'fourth consecutive fast run unlocks Stretch');
  assert.equal(tierOf(drillRecord(false, day(9))), 1, 'a lapse eases back to Narrow');
  assert.equal(tierOf(drillRecord(true, day(10))), 2, 'recovery raises the tier again from the start');
});

/** Play a real 60 s stretch drill the way the UI runs it (mode 'drill', fixed solving pace). */
function playStretchDrill({ seed, tier = 3, seconds = 60, timePerSolve = 1500 } = {}) {
  const cell = skillCellFor('mul', 7, 45);
  const rules = patternDrill(cell, seconds, { tier });
  let t = 0;
  const s = new ArithmeticSession({ rules, generator: createGenerator(rules, seed), mode: 'drill', seed, clock: () => t, wallClock: () => '2026-10-17T12:00:00Z', drill: { op: 'mul', cell: cell.id, label: cell.label, tier } });
  s.start();
  while (s.state === 'active') {
    if (t + timePerSolve > seconds * 1000) break;
    t += timePerSolve;
    s.recordInput(String(s.current.answer));
  }
  t = seconds * 1000;
  return { cell, result: s.finish() };
}

test('a played stretch drill interleaves both cells and still records its review', () => {
  const { cell, result } = playStretchDrill({ seed: 'stretch-mix' });
  assert.equal(result.endedEarly, false);
  const byCell = { 'mul:5:4': 0, 'mul:6:4': 0 };
  for (const e of result.events) {
    const id = skillOf(e)?.id;
    assert.ok(id in byCell, `stretch problems stay in the two adjacent cells, saw ${id}`);
    byCell[id]++;
  }
  assert.ok(byCell['mul:5:4'] > 0 && byCell['mul:6:4'] > 0, 'both neighbors really are interleaved');
  const inCell = result.events.filter(e => skillOf(e)?.id === cell.id);
  assert.ok(inCell.length >= SKILL_REVIEW_MIN_SOLVES, 'the drilled cell keeps its share of a 60 s run');
  const outcome = drillReviewOutcome(inCell, { endedEarly: result.endedEarly });
  assert.equal(outcome.wasFastAndCorrect, true, 'review gating is unchanged by difficulty tiers');
});

test('every tier stays practice-only and out of the benchmark namespace', () => {
  const full = { op: 'mul', label: 'whole table', rowRange: [2, 12], colRange: [2, 100] };
  const benchmarkEquivalent = r => r.id === BENCHMARK_RULES.id && JSON.stringify(r) === JSON.stringify(BENCHMARK_RULES);
  for (const tier of [1, 2, 3]) {
    const drill = patternDrill(full, 120, { tier });
    assert.equal(benchmarkEquivalent(drill), false, `tier ${tier} is practice-only even on a full-range cell`);
    assert.equal(drill.id, 'pattern-drill');
    assert.deepEqual(drill.enabled, ['mul'], 'single-mode namespaces stay single');
    assert.ok(drill.label.startsWith('Pattern drill · '));
    assert.ok(drill.durationSeconds === 120);
  }
  const t3 = drillRangesForTier(full, 3);
  assert.equal(t3.capped, true, 'the widest cell cannot stretch without leaving the benchmark operand space');
  assert.deepEqual(t3.rowRange, [2, 12]); assert.deepEqual(t3.colRange, [2, 100]);
});

test('drill operands stay safe integers and inside the taxonomy even on top-band stretch cells', () => {
  const stretched = drillRangesForTier(skillCellFor('div', 11, 95), 3);
  assert.deepEqual(stretched.rowRange, [11, 12], 'max table-factor cell stretches by one divisor only');
  const halved = drillRangesForTier(skillCellFor('div', 11, 95), 1);
  assert.deepEqual(halved.rowRange, [11, 11], 'single-value divisor bands cannot halve');
  const rules = customRules({ enabled: ['div'], multiplication: { left: stretched.rowRange, right: stretched.colRange }, durationSeconds: 60 });
  for (const q of drawQ(rules, 'edge-draw', 2000)) {
    assert.ok(q.sourceLeft >= 11 && q.sourceLeft <= 12);
    assert.ok(q.sourceRight >= 90 && q.sourceRight <= 100);
    assert.ok(Number.isSafeInteger(q.left) && q.answer === q.sourceRight);
  }
});
