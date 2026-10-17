import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkSeries, rollingBands, goalStatus, trend, consistencySummary, GOAL } from '../packages/analytics/src/consistency.js';
import { benchmarkProgress } from '../packages/analytics/src/progress.js';
import { createRng } from '../packages/core/src/rng.js';
import { scoreChartSvg, yDomain, chartLayout, nearestIndex, CHART } from '../apps/web/src/score-chart.js';

const run = (score, day, benchmark = true, mode = benchmark ? 'benchmark' : 'custom') => ({ score, benchmark, mode, startedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), events: [] });

test('series uses verified benchmarks only, in chronological order', () => {
  const xs = [run(50, 3), run(99, 2, false, 'drill'), run(40, 1), run(88, 4, false), { ...run(77, 5), benchmark: 'true' }];
  assert.deepEqual(benchmarkSeries(xs).map(x => [x.run, x.score]), [[1, 40], [2, 50]]);
  assert.equal(consistencySummary(xs).personalBest, 50);
});

test('goal status matches the existing 8-of-10 mastery rule on random histories', () => {
  const rng = createRng('goal-property');
  for (let trial = 0; trial < 500; trial++) {
    const n = Math.floor(rng() * 16);
    const sessions = Array.from({ length: n }, (_, i) => run(55 + Math.floor(rng() * 25), i + 1));
    const g = consistencySummary(sessions).goal;
    assert.equal(g.met, benchmarkProgress(sessions).mastery70, `trial ${trial}`);
    const scores = sessions.map(s => s.score);
    // runsToGoal is minimal: that many target runs meet the goal; one fewer does not.
    const after = k => goalStatus([...scores, ...Array(k).fill(GOAL.target)]).met;
    assert.equal(after(g.runsToGoal), true);
    if (g.runsToGoal > 0) assert.equal(after(g.runsToGoal - 1), false);
  }
});

test('kth-best and points short', () => {
  const g = goalStatus([70, 71, 72, 73, 74, 75, 62, 60, 50, 99]);
  assert.equal(g.hits, 7); assert.equal(g.met, false);
  assert.equal(g.kthBest, 62); assert.equal(g.pointsShort, 8);
  // The six oldest runs are hits, so each new 70+ run only replaces a hit until the 62 ages out.
  assert.equal(goalStatus([70, 71, 72, 73, 74, 75, 62, 60, 50, 99, 70]).hits, 7);
  assert.equal(g.runsToGoal, 7);
  assert.equal(goalStatus([]).runsToGoal, 10);
  assert.equal(goalStatus([]).kthBest, null);
  assert.equal(goalStatus(Array(10).fill(80)).runsToGoal, 0);
  assert.equal(goalStatus(Array(10).fill(80)).pointsShort, 0);
});

test('rolling bands start after three runs and use a trailing window', () => {
  const b = rollingBands([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  assert.equal(b[1].median, null); assert.equal(b[2].median, 20);
  assert.equal(b[11].n, 10); assert.equal(b[11].median, 75);
  assert.equal(b[11].p10, 39); assert.equal(b[11].p90, 111);
});

test('Theil–Sen trend with Sen interval', () => {
  assert.equal(trend([1, 2, 3, 4, 5]), null);
  const line = trend([30, 32, 34, 36, 38, 40, 42, 44]);
  assert.deepEqual([line.slope, line.low, line.high], [2, 2, 2]);
  const flat = trend([50, 52, 49, 51, 50, 48, 52, 50, 49, 51]);
  assert.ok(flat.low <= 0 && flat.high >= 0, 'noisy flat series has an interval spanning 0');
  const robust = trend([30, 31, 32, 33, 34, 35, 36, 37, 0, 39]);
  assert.equal(robust.slope, 1, 'one outlier does not move the median slope');
  assert.equal(trend(Array.from({ length: 40 }, (_, i) => i)).n, 20, 'only the last 20 runs');
});

test('summary degrades gracefully with no or few runs', () => {
  const empty = consistencySummary([]);
  assert.deepEqual([empty.series.length, empty.recent.median, empty.recent.ci, empty.trend, empty.personalBest, empty.goal.met], [0, null, null, null, null, false]);
  const few = consistencySummary([run(30, 1), run(35, 2)]);
  assert.equal(few.recent.p10, null); assert.equal(few.recent.ci, null);
  const six = consistencySummary([30, 40, 35, 45, 50, 38].map((s, i) => run(s, i + 1)));
  assert.deepEqual([six.recent.ci.low, six.recent.ci.high], [30, 50]);
});

test('chart geometry contains every score and the target', () => {
  assert.deepEqual(yDomain([31, 45], 70), [20, 80]);
  assert.deepEqual(yDomain([72, 96], 70), [60, 110]);
  const pts = consistencySummary(Array.from({ length: 55 }, (_, i) => run(30 + (i % 40), i + 1))).series;
  const L = chartLayout(pts, 70);
  assert.equal(L.shown.length, CHART.maxRuns);
  for (const p of L.shown) { const y = L.y(p.score); assert.ok(y >= CHART.top - 0.01 && y <= CHART.height - CHART.bottom + 0.01); }
  assert.equal(nearestIndex(L.xs, L.xs[7] + 1), 7);
  assert.equal(nearestIndex(L.xs, -100), 0);
  const svg = scoreChartSvg(pts, 70);
  assert.equal((svg.match(/<circle /g) || []).length, CHART.maxRuns);
  assert.ok(svg.includes('70 target'));
  assert.ok(!/NaN|undefined/.test(svg));
  const single = scoreChartSvg(consistencySummary([run(42, 1)]).series, 70);
  assert.equal((single.match(/<circle /g) || []).length, 1);
  assert.ok(!/NaN|undefined/.test(single));
});

test('operation summaries carry a median CI once samples allow', async () => {
  const { operationSummary } = await import('../packages/analytics/src/stats.js');
  const ev = (op, ms) => ({ op, responseMs: ms, correct: true, corrections: 0 });
  const rows = operationSummary([...[900, 1000, 1100, 1200, 1300, 1400].map(ms => ev('add', ms)), ev('mul', 2000)]);
  assert.deepEqual(rows.find(r => r.op === 'add').ci, { low: 900, high: 1400, confidence: 0.95, n: 6 });
  assert.equal(rows.find(r => r.op === 'mul').ci, null);
  assert.equal(rows.find(r => r.op === 'div').ci, null);
});
