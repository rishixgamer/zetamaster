import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHMARK_RULES, benchmarkEquivalent } from '../packages/core/src/rulesets.js';
import { makeQuestion, createGenerator } from '../packages/core/src/generator.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { skillCellFor, weakestSkillCells } from '../packages/training/src/skills.js';
import { gauntletPlan, gauntletLaunch, gauntletGenerator, transferProbeSeed, transferProbe } from '../packages/training/src/gauntlet.js';
import { drillReviewEligible } from '../packages/training/src/reviews.js';

const NOW = new Date('2026-10-18T09:00:00.000Z');

/** Synthetic benchmark history from fact specs: `{op, a, b, ms, n}` — n solves of that fact at ms. */
function factRuns(specs) {
  const events = [];
  let seq = 0;
  for (const s of specs) for (let i = 0; i < s.n; i++) {
    const q = makeQuestion(s.op, s.a, s.b, ++seq);
    events.push({ ...q, responseMs: s.ms, firstInputMs: 300, entryMs: s.ms - 300, completedAtMs: seq * s.ms, correct: true });
  }
  return [{ id: 'synthetic-history', startedAt: '2026-10-17T08:00:00.000Z', mode: 'benchmark', benchmark: true, score: events.length, elapsedMs: 120000, events }];
}

test('weakestSkillCells: gated, ratio-ordered, deterministic, cap respected', () => {
  const history = factRuns([
    { op: 'mul', a: 10, b: 95, ms: 900, n: 9 },   // mul:8:9 fast baseline; op median = 2550
    { op: 'mul', a: 7, b: 40, ms: 4200, n: 9 },   // mul:5:4 slow → ratio ≈ 1.45
    { op: 'add', a: 2, b: 10, ms: 800, n: 6 },    // add:0:1 fast baseline; op median = 1100
    { op: 'add', a: 20, b: 20, ms: 1400, n: 6 },  // add:2:2 slow → ratio ≈ 1.19
  ]);
  const picked = weakestSkillCells(history, { limit: 2 });
  assert.equal(picked[0].id, 'mul:5:4', 'slowest ratio first');
  assert.equal(picked[1].id, 'add:2:2');
  assert.deepEqual(weakestSkillCells(history, { limit: 1 }).map(s => s.id), ['mul:5:4']);
  assert.deepEqual(weakestSkillCells(history, { limit: 3, minSamples: 100 }), []);
  assert.ok(picked.every(s => s.ratio > 1 && s.count >= 3), 'gate holds');
});

test('M2 GATE: weak skills are the ONLY cells gauntlet stages touch, and nothing here is a benchmark', () => {
  const mulGood = skillCellFor('mul', 10, 95), mulSlow = skillCellFor('mul', 7, 40);
  const addGood = skillCellFor('add', 2, 10), addSlow = skillCellFor('add', 20, 20);
  const history = factRuns([
    { op: 'mul', a: 10, b: 95, ms: 900, n: 9 },
    { op: 'mul', a: 7, b: 40, ms: 4200, n: 9 },
    { op: 'add', a: 2, b: 10, ms: 800, n: 6 },
    { op: 'add', a: 20, b: 20, ms: 1600, n: 6 },
  ]);
  const plan = gauntletPlan(history, { reviews: [], now: NOW, cellsLimit: 2 });
  assert.ok(plan.cells.length === 2, 'quota respected');
  const weakSweep = weakestSkillCells(history, { limit: 99 });
  const weakIds = new Set(weakSweep.map(s => s.id));
  // 1. Only genuinely slow, gated cells are selected, weakest first.
  assert.equal(weakIds.has(mulSlow.id), true);
  assert.equal(weakIds.has(addSlow.id), true);
  assert.equal(weakIds.has(mulGood.id), false, 'a fast cell is never weak');
  assert.equal(weakIds.has(addGood.id), false);
  assert.ok(plan.cells.every(c => weakIds.has(c.cell)), 'every planned cell is individually qualified');
  assert.equal(plan.cells[0].cell, mulSlow.id, 'slowest first');
  assert.ok(plan.cells.every(c => c.count >= 3 && c.ratio > 1));
  // 2. Every stage builds a practice ruleset; the benchmark ruleset is byte-identical after all of it.
  const before = JSON.stringify(BENCHMARK_RULES);
  for (const entry of plan.cells) for (const stage of ['train', 'probe']) {
    const launch = gauntletLaunch(plan, entry.cell, stage);
    assert.equal(launch.mode, 'drill');
    assert.equal(benchmarkEquivalent(launch.rules), false, `${stage} rules are never the benchmark`);
    assert.notEqual(launch.rules.id, 'zetamac-default-v1');
    assert.equal(launch.rules.enabled.length, 1);
    assert.equal(launch.drill.stage, stage);
  }
  assert.equal(JSON.stringify(BENCHMARK_RULES), before, 'benchmark ruleset untouched');
  // 3. Probe draws: every question provably inside the probed cell family (held-out, same family).
  for (const entry of plan.cells) {
    const launch = gauntletLaunch(plan, entry.cell, 'probe');
    const draw = gauntletGenerator(launch, launch.seed);
    for (let i = 0; i < 300; i++) {
      const q = draw();
      assert.equal(skillCellFor(q.op, q.sourceLeft, q.sourceRight)?.id, entry.cell, `${q.left}${q.symbol}${q.right} must stay in ${entry.cell}`);
    }
  }
});

test('probe seeds: day-scoped, deterministic, never confused with training seeds', () => {
  const history = factRuns([
    { op: 'mul', a: 10, b: 95, ms: 900, n: 9 },
    { op: 'mul', a: 7, b: 40, ms: 4200, n: 9 },
  ]);
  const day1 = gauntletPlan(history, { reviews: [], now: new Date('2026-10-18T10:00:00.000Z') });
  const day1Late = gauntletPlan(history, { reviews: [], now: new Date('2026-10-18T23:00:00.000Z') });
  const day2 = gauntletPlan(history, { reviews: [], now: new Date('2026-10-19T10:00:00.000Z') });
  assert.equal(day1.isoDay, '2026-10-18');
  assert.equal(day1.cells[0].probe.seed, day1Late.cells[0].probe.seed, 'same day → same probe stream');
  assert.notEqual(day1.cells[0].probe.seed, day2.cells[0].probe.seed, 'next day → fresh probe stream');
  assert.match(day1.cells[0].probe.seed, /^gauntlet-probe:2026-10-18:/);
  assert.equal(transferProbeSeed('2026-10-18', 'mul:5:4'), transferProbeSeed('2026-10-18', 'mul:5:4'));
  assert.throws(() => gauntletPlan(history, { reviews: [] }), RangeError, 'now is required');
});

test('thin history degrades honestly and stale/foreign launches are refused', () => {
  const thin = factRuns([{ op: 'mul', a: 7, b: 40, ms: 4200, n: 2 }]); // below MIN_CELL_SAMPLES
  const plan = gauntletPlan(thin, { reviews: [], now: NOW });
  assert.deepEqual(plan.cells, []);
  assert.ok(plan.emptyNote.length > 30);
  const planNothing = gauntletPlan([], { reviews: [], now: NOW });
  assert.deepEqual(planNothing.cells, []);
  const withData = factRuns([
    { op: 'mul', a: 10, b: 95, ms: 900, n: 9 },
    { op: 'mul', a: 7, b: 40, ms: 4200, n: 9 },
  ]);
  const real = gauntletPlan(withData, { reviews: [], now: NOW });
  assert.throws(() => gauntletLaunch(real, 'add:0:0', 'train'), RangeError, 'unplanned cell refused');
  assert.throws(() => gauntletLaunch(real, 'mul:5:4', 'fly'), RangeError, 'unknown stage refused');
  assert.throws(() => gauntletLaunch({ cells: [], isoDay: '2026-10-18' }, 'mul:5:4', 'train'), RangeError);
});

test('transfer probe: labeled as measurement, practice-only, family-matched draws', () => {
  const cell = skillCellFor('div', 5, 60);
  const probe = transferProbe(cell, 60, { label: cell.label });
  assert.equal(probe.id, 'transfer-probe');
  assert.equal(benchmarkEquivalent(probe), false);
  assert.ok(probe.explanation.includes('never counts as a benchmark'));
  assert.ok(probe.explanation.length > 80);
  assert.deepEqual(probe.enabled, ['div']);
  const gen = createGenerator(probe, 'probe-seed-x');
  for (let i = 0; i < 150; i++) {
    const q = gen();
    assert.equal(skillCellFor(q.op, q.sourceLeft, q.sourceRight)?.id, cell.id);
  }
  assert.throws(() => transferProbe({ op: 'florob' }, 60), RangeError);
});

test('drillReviewEligible: only complete pattern drills record; probes and flash never do', () => {
  // Inputs are persisted *results* (session.finish() output): they carry endedEarly and the drill
  // payload but no live state, so eligibility reads those plus the drill stage only.
  assert.deepEqual(drillReviewEligible(null), { ok: false, reason: 'not-drill' });
  assert.equal(drillReviewEligible({ drill: {} }).ok, false);
  assert.equal(drillReviewEligible({ drill: 'pattern' }).ok, false);
  const completeDrill = { op: 'mul', cell: 'mul:5:4', label: '7 × 40–49', tier: 2, stage: 'train', seconds: 60 };
  assert.deepEqual(drillReviewEligible({ endedEarly: false, drill: completeDrill }), { ok: true, cellId: 'mul:5:4', label: '7 × 40–49' });
  assert.equal(drillReviewEligible({ endedEarly: true, drill: completeDrill }).reason, 'ended-early');
  assert.equal(drillReviewEligible({ endedEarly: false, drill: { ...completeDrill, stage: 'probe', probeSeed: 'gauntlet-probe:2026-10-18:mul:5:4' } }).reason, 'probe');
  assert.equal(drillReviewEligible({ endedEarly: false, drill: { ...completeDrill, stage: 'flash' } }).reason, 'flash');
});

test('end-to-end probe run: practice-scoped, family-matched, review-ineligible', () => {
  const history = factRuns([
    { op: 'mul', a: 10, b: 95, ms: 900, n: 9 },
    { op: 'mul', a: 7, b: 40, ms: 4200, n: 9 },
  ]);
  const plan = gauntletPlan(history, { reviews: [], now: NOW });
  const cellId = plan.cells[0].cell;
  const launch = gauntletLaunch(plan, cellId, 'probe');
  let t = 0;
  const session = new ArithmeticSession({
    rules: launch.rules, mode: launch.mode, seed: launch.seed, drill: launch.drill,
    clock: () => t, wallClock: () => new Date(t).toISOString(), generator: gauntletGenerator(launch, launch.seed),
  });
  session.start();
  while (session.state === 'active' && t <= 60_500) {
    t += 70; // solve each fresh problem 70 ms after it is shown
    session.recordInput(String(session.current.answer));
    session.tick();
  }
  const r = session.finish();
  assert.equal(r.benchmark, false, 'a probe always stays practice');
  assert.equal(r.mode, 'drill');
  assert.equal(r.drill.stage, 'probe');
  assert.equal(r.drill.probeSeed, transferProbeSeed('2026-10-18', cellId));
  assert.ok(r.score >= 3, `probes produce evidence (${r.score} solved)`);
  assert.ok(r.events.every(e => skillCellFor(e.op, e.sourceLeft, e.sourceRight)?.id === cellId), 'every solved probe problem stays in the family');
  assert.equal(drillReviewEligible(r).ok, false, 'probes never write spaced reviews');
});

test('gauntlet quota: at most the daily cell cap, deterministic order, bounds validated', () => {
  // One weak cell and one fast cell per operation: four qualified weak cells in total.
  const history = factRuns([
    // add: median 1200 → slow cell ×1.60, fast cell ×0.80
    { op: 'add', a: 2, b: 10, ms: 800, n: 9 },    // add:0:1 fast
    { op: 'add', a: 20, b: 20, ms: 1600, n: 9 },  // add:1:1 slow
    // sub: median 2500 → slow ×1.47, fast ×0.53
    { op: 'sub', a: 10, b: 50, ms: 800, n: 9 },   // sub:1:5 fast
    { op: 'sub', a: 30, b: 95, ms: 4200, n: 9 },  // sub:2:9 slow
    // mul: median 2500 → slow ×1.47, fast ×0.53
    { op: 'mul', a: 10, b: 95, ms: 800, n: 9 },   // mul:8:9 fast
    { op: 'mul', a: 7, b: 40, ms: 4200, n: 9 },   // mul:5:4 slow
    // div: median 2500 → slow ×1.47, fast ×0.53
    { op: 'div', a: 10, b: 95, ms: 800, n: 9 },   // div:8:9 fast
    { op: 'div', a: 5, b: 60, ms: 4200, n: 9 },   // div:3:6 slow
  ]);
  // Ratios: sub/mul/div tie at ≈×1.47 (ties resolve by op order add→sub→mul→div), add sits at ≈×1.23.
  const capped = gauntletPlan(history, { reviews: [], now: NOW, cellsLimit: 2 });
  assert.deepEqual(capped.cells.map(c => c.cell), ['sub:3:9', 'mul:5:4'], 'slowest ratios first, ties by op order');
  const all = gauntletPlan(history, { reviews: [], now: NOW, cellsLimit: 10 });
  assert.deepEqual(all.cells.map(c => c.cell), ['sub:3:9', 'mul:5:4', 'div:3:6', 'add:2:2']);
  const none = gauntletPlan(history, { reviews: [], now: NOW, cellsLimit: 0 });
  assert.equal(none.cells.length, 0);
  assert.throws(() => gauntletPlan(history, { reviews: [], now: NOW, cellsLimit: 11 }), RangeError);
});

test('gauntlet honors the F18 tier ladder: tiers come from the stored review records', () => {
  const history = factRuns([
    { op: 'mul', a: 10, b: 95, ms: 900, n: 9 },
    { op: 'mul', a: 7, b: 40, ms: 4200, n: 9 },
  ]);
  const lapsed = gauntletPlan(history, { reviews: [{ id: 'mul:5:4', skillId: 'mul:5:4', successes: 0, failures: 1 }], now: NOW });
  const narrow = gauntletLaunch(lapsed, 'mul:5:4', 'train');
  assert.equal(narrow.drill.tier, 1, 'a lapsed review drills narrow');
  assert.match(narrow.rules.label, /narrow/i);
  const stretchedPlan = gauntletPlan(history, { reviews: [{ id: 'mul:5:4', skillId: 'mul:5:4', successes: 5, failures: 0 }], now: NOW });
  const stretch = gauntletLaunch(stretchedPlan, 'mul:5:4', 'train');
  assert.equal(stretch.drill.tier, 3, 'four consecutive fast runs mean stretch');
  assert.equal(benchmarkEquivalent(stretch.rules), false);
});
