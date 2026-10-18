import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_TAXONOMY_VERSION, skillCellFor, skillOf, skillRollups, weakestSkillCell, SKILL_MIN_SAMPLES, SKILL_STABLE_SAMPLES } from '../packages/training/src/skills.js';
import { buildHeatmap, heatmapLayout, TABLE_FACTORS, OPERAND_BANDS, MIN_CELL_SAMPLES, STABLE_CELL_SAMPLES } from '../packages/analytics/src/heatmap.js';
import { patternDrill, cellDrill } from '../packages/training/src/drills.js';
import { dailyPlan } from '../packages/training/src/planner.js';
import { skillReviewRecord } from '../packages/training/src/scheduler.js';
import { makeQuestion, createGenerator } from '../packages/core/src/generator.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';

// Fixture idioms follow tests/fatigue.test.js / tests/entry-quality.test.js: real ArithmeticSessions
// played with a fake clock, plus small planted bare-event sessions for exact medians.

const ev = (op, a, b, responseMs, extra = {}) => ({ ...makeQuestion(op, a, b), responseMs, correct: true, corrections: 0, wrongPrefixes: 0, fullWrongAnswers: 0, wrongSubmissions: 0, ...extra });
const session = (events, benchmark = true, mode = benchmark ? 'benchmark' : 'custom') => ({ benchmark, mode, events, startedAt: '2026-10-01T00:00:00Z', score: events.length });

/** Play a real benchmark where each solve takes timeFor(question) ms. */
function play(seed, timeFor, day = 1) {
  let t = 0;
  const s = new ArithmeticSession({ rules: BENCHMARK_RULES, generator: createGenerator(BENCHMARK_RULES, seed), mode: 'benchmark', seed, clock: () => t, wallClock: () => new Date(Date.UTC(2026, 0, day)).toISOString() });
  s.start();
  while (true) {
    const dt = timeFor(s.current);
    if (t + dt >= 120000) break;
    t += dt; s.recordInput(String(s.current.answer));
  }
  t = 120000; return s.finish();
}

const BASE = { add: 1000, sub: 1300, mul: 1800, div: 2200 };
const bandOf = x => OPERAND_BANDS.findIndex(([lo, hi]) => x >= lo && x <= hi);
const bandRange = x => OPERAND_BANDS.find(([lo, hi]) => x >= lo && x <= hi);

test('taxonomy version constant is pinned and stamped into review records', () => {
  assert.equal(SKILL_TAXONOMY_VERSION, 'skill-taxonomy-v1');
  assert.ok(Object.isFrozen(SKILL_TAXONOMY_VERSION));
  assert.ok(Object.isFrozen(skillCellFor('mul', 7, 45)), 'cells are immutable value objects');
  assert.equal(skillReviewRecord('mul:5:4', null, true, '2026-10-17T12:00:00Z').taxonomyVersion, SKILL_TAXONOMY_VERSION);
});

test('every band edge lands in exactly the right cell for every operation', () => {
  const edges = OPERAND_BANDS.flatMap(([lo, hi]) => [lo, hi]);
  for (const op of ['add', 'sub']) {
    for (const a of edges) for (const b of edges) {
      const cell = skillCellFor(op, a, b);
      assert.ok(cell, `${op} ${a}/${b} should be inside the taxonomy`);
      assert.equal(cell.row, bandOf(a)); assert.equal(cell.col, bandOf(b));
      assert.deepEqual(cell.rowRange, bandRange(a)); assert.deepEqual(cell.colRange, bandRange(b));
      assert.equal(cell.id, `${op}:${cell.row}:${cell.col}`);
    }
    for (const bad of [1, 0, 101, -3]) assert.equal(skillCellFor(op, bad, 45), null, `${op} band reject ${bad}`);
  }
  // mul/div rows are exact table factors, not bands; other-axis edges are bands as above.
  for (const op of ['mul', 'div']) {
    for (const factor of TABLE_FACTORS) {
      const cell = skillCellFor(op, factor, 45);
      assert.ok(cell, `${op} factor ${factor}`);
      assert.equal(cell.row, factor - 2, 'table-factor row index over TABLE_FACTORS order');
      assert.deepEqual(cell.rowRange, [factor, factor], 'factor row is a point range');
      assert.equal(cell.id, `${op}:${factor - 2}:${bandOf(45)}`);
    }
    for (const bad of [1, 13, 0, -7]) assert.equal(skillCellFor(op, bad, 45), null, `${op} factor reject ${bad}`);
    for (const b of edges) assert.equal(skillCellFor(op, 7, b).col, bandOf(b));
    for (const bad of [1, 101]) assert.equal(skillCellFor(op, 7, bad), null, `${op} band reject ${bad}`);
  }
  assert.equal(skillCellFor('pow', 7, 45), null, 'unknown operations stay out of the taxonomy');
  assert.equal(skillOf(null), null); assert.equal(skillOf({}), null);
  assert.equal(skillOf({ op: 'div', sourceLeft: 7, sourceRight: 50 }).id, 'div:5:5');
});

test('skill ids are a bijection with heatmap cell keys, sharing axis banding', () => {
  for (const op of ['add', 'sub', 'mul', 'div']) {
    const layout = heatmapLayout(op);
    for (let r = 0; r < layout.rows.length; r++) for (let c = 0; c < layout.cols.length; c++) {
      // Source operands at the row/col axes' lower edge: generated question, then both views agree.
      const sourceLeft = layout.rows[r].range[0], sourceRight = layout.cols[c].range[0];
      const cell = skillCellFor(op, sourceLeft, sourceRight);
      assert.ok(cell, `${op}:${r}:${c}`);
      assert.equal(cell.id, `${op}:${r}:${c}`, 'id equals the heatmap key format');
      const q = makeQuestion(op, sourceLeft, sourceRight);
      assert.equal(q.sourceLeft, sourceLeft);
      const heatmap = buildHeatmap([session([ev(op, q.sourceLeft, q.sourceRight, 1000)])], op, { scope: 'all' });
      const hc = heatmap.cells[r][c];
      assert.equal(hc.key, cell.id);
      assert.equal(hc.label, cell.label);
      assert.deepEqual([...hc.rowRange], cell.rowRange);
      assert.deepEqual([...hc.colRange], cell.colRange);
    }
  }
});

test('division maps through its generated source operands in a real played session', () => {
  const run = play('divcheck', q => BASE[q.op]);
  const divs = run.events.filter(e => e.op === 'div');
  assert.ok(divs.length > 5, 'fixture contains divisions');
  for (const e of divs) {
    // Generated as a×b ÷ a = b: sourceLeft is the divisor (table factor), sourceRight the quotient
    // (and the answer). Display operands are composite and must never be used for skills.
    assert.ok(e.sourceLeft >= 2 && e.sourceLeft <= 12, 'divisor is a table factor');
    assert.ok(e.sourceRight >= 2 && e.sourceRight <= 100, 'quotient is in the band space');
    assert.equal(e.answer, e.sourceRight, 'answer is the second source operand');
    assert.equal(e.right, e.sourceLeft, 'first displayed operand is the divisor');
    assert.equal(e.left, e.sourceLeft * e.sourceRight, 'dividend is the lifted product');
    assert.equal(skillOf(e).row, e.sourceLeft - 2, 'divisor lands on the table-factor row');
    assert.equal(skillOf(e).op, 'div');
  }
  // Bulk agreement between the heatmap built from the played session and per-event skill ids.
  const h = buildHeatmap([run], 'div');
  assert.equal(h.cells.flat().reduce((s, c) => s + c.count, 0), divs.length);
  for (const e of divs) {
    const s = skillOf(e);
    assert.ok(h.cells[s.row][s.col].count > 0);
  }
});

test('rollups reproduce exact planted medians and counts', () => {
  const planted = [3000, 1000, 4000, 2000].map(ms => ev('mul', 7, 45, ms));
  const rolls = skillRollups([session(planted)], { scope: 'all' });
  const cell = rolls.skills.find(s => s.id === 'mul:5:4');
  assert.ok(cell);
  assert.equal(cell.count, 4, 'even count median');
  assert.equal(cell.medianMs, 2500, 'median of [1000,2000,3000,4000]');
  assert.equal(cell.opMedianMs, 2500, 'operation median over the same four solves');
  assert.equal(cell.ratio, 1, 'a single cell equals its own operation after smoothing');
  const odd = skillRollups([session([ev('add', 40, 32, 1500), ev('add', 40, 32, 1000), ev('add', 40, 32, 1000)])], { scope: 'all' });
  const addCell = odd.skills.find(s => s.id === 'add:4:3');
  assert.equal(addCell.medianMs, 1000, 'odd count median');
  assert.equal(odd.taxonomyVersion, SKILL_TAXONOMY_VERSION);
  assert.deepEqual(odd.opObservations, { add: 3, sub: 0, mul: 0, div: 0 });
  assert.equal(SKILL_MIN_SAMPLES, 3); assert.equal(SKILL_STABLE_SAMPLES, 8);
  assert.equal(MIN_CELL_SAMPLES, 3); assert.equal(STABLE_CELL_SAMPLES, 8);
});

test('sample-size gates mark insufficient and emerging cells, CI needs six', () => {
  const one = skillRollups([session([ev('mul', 3, 20, 1000), ev('mul', 7, 45, 9000)])], { scope: 'all' });
  const single = one.skills.find(s => s.id === 'mul:5:4');
  assert.equal(single.evidence, 'insufficient');
  assert.equal(single.ci, null, 'no CI below 6 samples');
  assert.equal(one.skills.find(s => s.id === 'mul:1:2').evidence, 'insufficient', 'fast baseline cell shares the gate');
  assert.ok(single.ratio > 1 && single.ratio < 3, 'sparse ratio is shrunk toward the operation median');
  const six = skillRollups([session([ev('div', 11, 92, 7000), ...Array.from({ length: 5 }, () => ev('div', 11, 92, 2000))])], { scope: 'all' });
  const divCell = six.skills.find(s => s.id === 'div:9:9');
  assert.equal(divCell.evidence, 'emerging');
  assert.ok(divCell.ci, 'six samples unlock the CI');
  const missing = skillRollups([session([])]);
  assert.equal(missing.skills.length, 0);
  assert.equal(weakestSkillCell([session([])]), null);
  assert.equal(weakestSkillCell([session([ev('mul', 7, 45, 9000)])]), null, 'insufficient cells never become weaknesses');
});

test('practice runs can never influence a benchmark-scoped skill summary', () => {
  const runs = [
    session([ev('mul', 7, 45, 3000), ev('mul', 8, 45, 1200), ev('mul', 9, 45, 1200)]),
    session([ev('mul', 7, 45, 300), ev('mul', 7, 45, 300), ev('mul', 7, 45, 300)], false, 'drill'),
    session([ev('mul', 7, 45, 9000), ev('mul', 7, 46, 9000)], false, 'drill'),
  ];
  const scoped = skillRollups(runs, { scope: 'benchmark' });
  const cell = scoped.skills.find(s => s.id === 'mul:5:4');
  assert.equal(cell.count, 1, 'only the benchmark event counts');
  assert.equal(cell.medianMs, 3000);
  assert.equal(scoped.opObservations.mul, 3);
  const all = skillRollups(runs, { scope: 'all' });
  assert.equal(all.skills.find(s => s.id === 'mul:5:4').count, 6, 'all scope: benchmark + practice events blend deliberately');
  assert.throws(() => skillRollups(runs, { scope: 'nope' }), 'unknown scopes are rejected, not merged');
});

test('weakest skill selection is deterministic and gated', () => {
  const runs = Array.from({ length: 3 }, (_, i) => session([
    ...Array.from({ length: 4 }, () => ev('div', 7, 40 + i, 8000)),
    ...Array.from({ length: 4 }, () => ev('div', 3, 50, 1200)),
    ...Array.from({ length: 4 }, () => ev('add', 40, 50 + i, 1100)),
  ]));
  const best = weakestSkillCell(runs);
  assert.equal(best.id, 'div:5:4');
  const reordered = weakestSkillCell([runs[2], runs[0], runs[1]]);
  assert.equal(reordered.id, best.id, 'session order cannot change the pick');
  assert.equal(weakestSkillCell(runs, { minSamples: 15 }), null, 'stricter gate yields nothing rather than a near-miss');
});

test('pattern drill equals an exact customRules equivalent with pinned ranges', () => {
  const cell = skillCellFor('mul', 7, 45);
  const drill = patternDrill(cell, 60);
  const equivalent = { ...cellDrill('mul', { rowRange: [7, 7], colRange: [40, 49] }, 60), id: 'pattern-drill', label: 'Pattern drill · 7 × 40–49', explanation: drill.explanation };
  assert.deepEqual(drill, equivalent);
  assert.equal(drill.durationSeconds, 60);
  assert.equal(drill.id, 'pattern-drill');
  assert.ok(drill.label.includes('7 × 40–49'));
  assert.ok(drill.explanation.includes('Practice'), 'honest framing present');
  assert.ok(!/raise your score|guarantee|proven/i.test(drill.explanation), 'no efficacy promises');
});

test('drill problems stay inside the cell and div drills map through the source operands', () => {
  const nm = createGenerator(patternDrill(skillCellFor('mul', 7, 45)), 'pin1');
  const nd = createGenerator(patternDrill(skillCellFor('div', 7, 95)), 'pin2');
  const ns = createGenerator(patternDrill(skillCellFor('sub', 47, 29)), 'pin3');
  for (let i = 0; i < 1500; i++) {
    const m = nm(); assert.equal(m.sourceLeft, 7); assert.ok(m.sourceRight >= 40 && m.sourceRight <= 49);
    assert.equal(skillOf(m).id, 'mul:5:4');
    // div drill: divisor pinned to the row factor, quotient pinned to the col band; the generator
    // lifts left=a*b and keeps right=a, and skillOf must agree with the intended cell.
    const d = nd(); assert.equal(d.sourceLeft, 7); assert.ok(d.sourceRight >= 90 && d.sourceRight <= 100);
    assert.equal(d.right, 7); assert.equal(d.answer, d.sourceRight);
    assert.equal(skillOf(d).id, 'div:5:9');
    const s = ns(); assert.equal(s.op, 'sub');
    assert.ok(s.sourceLeft >= 40 && s.sourceLeft <= 49, 'subtrahend stays in the row band');
    assert.ok(s.sourceRight >= 20 && s.sourceRight <= 29, 'answer stays in the col band');
    assert.equal(s.answer, s.sourceRight, 'col axis is the answer band');
    assert.equal(skillOf(s).id, 'sub:4:2');
  }
});

test('drill rules can never equal the benchmark ruleset, even for full-range cells', () => {
  const full = { op: 'mul', label: 'whole table', rowRange: [2, 12], colRange: [2, 100] };
  const drill = patternDrill(full, 120);
  assert.deepEqual(drill.multiplication, BENCHMARK_RULES.multiplication, 'ranges match the benchmark');
  assert.notEqual(drill.id, BENCHMARK_RULES.id, 'id still differs');
  assert.ok(drill.label.startsWith('Pattern drill · '), 'label still differs');
  const benchmarkEquivalent = rhs => rhs.id === BENCHMARK_RULES.id && JSON.stringify(rhs) === JSON.stringify(BENCHMARK_RULES);
  assert.equal(benchmarkEquivalent(drill), false);
  assert.equal(drill.enabled.includes('div'), false, 'single-operation namespaces stay single');
  for (const bad of [null, {}, { op: 'pow' }, { op: 'mul' }, { op: 'mul', rowRange: [7] }, { op: 'mul', rowRange: [7, 7] }]) {
    assert.throws(() => patternDrill(bad), RangeError);
  }
  assert.equal(patternDrill({ op: 'mul', rowRange: [7, 7], colRange: [40, 49] }).label, 'Pattern drill · 7–7 × 40–49', 'fallback label from ranges');
});

test('main gate: drills over-represent the weak skill; benchmark generation and scoring stay byte-identical to baseline', () => {
  // Planted history: every solve is fast (1200 ms) except on the ÷7 with answers 90–99 cell.
  const runs = Array.from({ length: 6 }, (_, i) => session([
    ...Array.from({ length: 2 }, () => ev('div', 7, 90 + i * 2, 8000)),
    ...Array.from({ length: 6 }, () => ev('div', 3, 50, 1100)),
    ...Array.from({ length: 6 }, () => ev('mul', 3, 20, 1100)),
  ]));
  const weak = weakestSkillCell(runs, { scope: 'benchmark' });
  assert.equal(weak.id, 'div:5:9');
  const drill = patternDrill(weak, 60);
  const generated = Array.from({ length: 1000 }, createGenerator(drill, 'gate'));
  const drillShare = generated.filter(q => skillOf(q)?.id === 'div:5:9').length / generated.length;
  assert.equal(drillShare, 1);
  // Benchmark share of that cell by construction: divisor 1/11 × quotient band 10/99 = 10/1089 ≈ 0.9%.
  const benchmarkShare = (10 / 99) / 11;
  const next = createGenerator(BENCHMARK_RULES, 'pin-share');
  const draws = Array.from({ length: 11000 }, () => next());
  const observed = draws.filter(q => skillOf(q)?.id === 'div:5:9').length / draws.length;
  assert.ok(observed <= 0.03, `measured benchmark share stays tiny, was ${observed}`);
  assert.ok(drillShare > observed * 30 && drillShare > benchmarkShare * 30, 'drill selection over-represents the weak skill');
  // ---- Benchmark byte-identity: generation is pinned to the pre-M2 baseline (captured 2026-10-17). ----
  const capture = seed => {
    const gen = createGenerator(BENCHMARK_RULES, seed);
    return JSON.stringify(Array.from({ length: 40 }, () => { const q = gen(); return [q.op, q.sourceLeft, q.sourceRight, q.left, q.right, q.answer]; }));
  };
  assert.equal(capture('m2-gate'),
    '[[\"add\",27,11,27,11,38],[\"mul\",10,39,10,39,390],[\"div\",10,36,360,10,36],[\"sub\",49,51,100,49,51],[\"div\",10,64,640,10,64],[\"sub\",72,72,144,72,72],[\"div\",12,15,180,12,15],[\"mul\",3,96,3,96,288],[\"sub\",94,33,127,94,33],[\"div\",8,18,144,8,18],[\"sub\",5,61,66,5,61],[\"div\",7,75,525,7,75],[\"add\",53,23,53,23,76],[\"mul\",11,9,11,9,99],[\"mul\",12,61,12,61,732],[\"add\",21,35,21,35,56],[\"div\",12,15,180,12,15],[\"div\",7,49,343,7,49],[\"mul\",3,40,3,40,120],[\"mul\",6,91,6,91,546],[\"div\",12,44,528,12,44],[\"add\",9,54,9,54,63],[\"sub\",74,83,157,74,83],[\"div\",12,66,792,12,66],[\"div\",9,40,360,9,40],[\"sub\",89,21,110,89,21],[\"mul\",10,85,10,85,850],[\"sub\",80,83,163,80,83],[\"div\",5,78,390,5,78],[\"add\",36,31,36,31,67],[\"div\",12,39,468,12,39],[\"add\",51,57,51,57,108],[\"sub\",81,58,139,81,58],[\"add\",44,89,44,89,133],[\"mul\",5,93,5,93,465],[\"div\",5,94,470,5,94],[\"div\",4,44,176,4,44],[\"div\",5,67,335,5,67],[\"mul\",12,48,12,48,576],[\"add\",7,60,7,60,67]]');
  assert.equal(capture('parity-pin'),
    '[[\"div\",8,92,736,8,92],[\"mul\",9,68,9,68,612],[\"sub\",36,90,126,36,90],[\"mul\",3,67,3,67,201],[\"add\",60,98,60,98,158],[\"div\",11,87,957,11,87],[\"div\",12,80,960,12,80],[\"sub\",94,96,190,94,96],[\"div\",8,35,280,8,35],[\"add\",70,95,70,95,165],[\"div\",10,99,990,10,99],[\"sub\",17,12,29,17,12],[\"add\",4,46,4,46,50],[\"sub\",21,97,118,21,97],[\"add\",28,83,28,83,111],[\"sub\",17,62,79,17,62],[\"sub\",14,51,65,14,51],[\"mul\",12,53,12,53,636],[\"add\",83,26,83,26,109],[\"div\",3,47,141,3,47],[\"mul\",5,11,5,11,55],[\"div\",4,48,192,4,48],[\"sub\",5,17,22,5,17],[\"div\",4,49,196,4,49],[\"sub\",76,37,113,76,37],[\"mul\",3,88,3,88,264],[\"mul\",5,54,5,54,270],[\"mul\",10,18,10,18,180],[\"sub\",48,20,68,48,20],[\"div\",9,81,729,9,81],[\"mul\",5,40,5,40,200],[\"div\",11,88,968,11,88],[\"add\",55,47,55,47,102],[\"div\",10,39,390,10,39],[\"add\",42,93,42,93,135],[\"mul\",2,82,2,82,164],[\"mul\",11,80,11,80,880],[\"div\",12,80,960,12,80],[\"sub\",85,8,93,85,8],[\"mul\",11,89,11,89,979]]');
  assert.equal(JSON.stringify(BENCHMARK_RULES),
    '{"id":"zetamac-default-v1","label":"Standard 120s","durationSeconds":120,"enabled":["add","sub","mul","div"],"addition":{"left":[2,100],"right":[2,100]},"multiplication":{"left":[2,12],"right":[2,100]},"skipAllowed":false,"pauseAllowed":false,"feedback":false}');
  // Scoring path: a played run is a valid benchmark with score = solved events.
  const run = play('score-pin', q => BASE[q.op], 3);
  assert.equal(run.score, run.events.length);
  assert.equal(run.benchmark, true);
});

test('daily plan surfaces the weakest pattern only when skill history exists', () => {
  const bare = dailyPlan([]);
  assert.ok(!bare.rationale.includes('Slowest recorded pattern'), 'no skill history keeps today\u2019s rationale');
  const runs = Array.from({ length: 3 }, (_, i) => session([
    ...Array.from({ length: 3 }, () => ev('div', 11, 90 + i, 9000)),
    ...Array.from({ length: 3 }, () => ev('div', 3, 50, 1200)),
    ...Array.from({ length: 3 }, () => ev('add', 40, 50, 1100)),
  ]));
  const planned = dailyPlan(runs);
  assert.ok(planned.rationale.includes('11 ÷ 90–100'), 'weakest label appears (div labels keep the heatmap wording)');
  assert.ok(planned.rationale.includes('descriptive'), 'honest caveat present');
  assert.equal(planned.steps.reduce((a, b) => a + b.minutes, 0), 15, 'plan budget unchanged');
  assert.equal(planned.plateau, bare.plateau, 'plateau signal unchanged');
});

test('deterministic scheduling composes skillReviewRecord across fixed clocks', () => {
  const T = '2026-10-17T12:00:00.000Z'; // toISOString() precision, like other persisted timestamps
  const first = skillReviewRecord('mul:5:4', null, true, T);
  assert.deepEqual(first, {
    id: 'mul:5:4', skillId: 'mul:5:4', op: 'mul', taxonomyVersion: SKILL_TAXONOMY_VERSION,
    successes: 1, failures: 0, intervalDays: 1,
    lastReviewedAt: T, nextReviewAt: '2026-10-18T12:00:00.000Z',
  });
  const second = skillReviewRecord('mul:5:4', first, true, T);
  assert.equal(second.intervalDays, 2);
  assert.equal(second.successes, 2);
  assert.equal(second.nextReviewAt, '2026-10-19T12:00:00.000Z');
  const lapse = skillReviewRecord('mul:5:4', second, false, T);
  assert.equal(lapse.intervalDays, 1);
  assert.equal(lapse.successes, 0);
  assert.equal(lapse.failures, 1);
  assert.equal(skillReviewRecord('mul:5:4', lapse, true, new Date(T)).nextReviewAt, '2026-10-18T12:00:00.000Z', 'Date and ISO now are equivalent');
  for (const bad of [null, '', 'x'.repeat(41), 42]) assert.throws(() => skillReviewRecord(bad, null, true, T), RangeError);
  assert.throws(() => skillReviewRecord('mul:5:4', null, true, 'not a date'), RangeError);
});
