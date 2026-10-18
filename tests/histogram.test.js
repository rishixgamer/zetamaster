import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeHistogram, HIST_EDGES, TAIL_EDGE, MIN_HIST_OBS, MOVEMENT_RUNS } from '../packages/analytics/src/histogram.js';
import { makeQuestion } from '../packages/core/src/generator.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';

// Planted fixtures: real ArithmeticSessions played with a fake clock (same idiom as
// tests/entry-quality.test.js: playPlan with lists of question kinds). Division-only plans keep
// per-solve times at exact base multiples, so every bin count below is analytic, not probabilistic.

const PAIR = { add: [40, 32], sub: [40, 32], mul: [7, 11], div: [7, 11] };
const BASE = { add: 1000, sub: 1300, mul: 1800, div: 2200 };
/** Extra solve time per kind; the resulting ratio is EXTRA[k]/2200 on division. */
const EXTRA = { clean: 0, mid: 1100, edge: 2200, deep: 4400 };

function playPlan(kinds, day, ops = kinds.map((_, i) => ['add', 'sub', 'mul', 'div'][i % 4])) {
  let t = 0;
  const pulled = [];
  const plan = kinds.map((k, i) => ({ op: ops[i], k }));
  const session = new ArithmeticSession({
    rules: BENCHMARK_RULES, mode: 'benchmark', seed: 'hist' + day,
    clock: () => t, wallClock: () => new Date(Date.UTC(2026, 0, day)).toISOString(),
    generator: () => { const p = plan[pulled.length % plan.length]; pulled.push(p); return makeQuestion(p.op, ...PAIR[p.op], pulled.length); },
  });
  session.start();
  while (true) {
    const p = pulled[pulled.length - 1];
    const dur = BASE[p.op] + EXTRA[p.k];
    if (t + dur >= 120000) break;
    t += dur;
    session.recordInput(String(session.current.answer));
  }
  t = 120000;
  return session.finish();
}

const divOnly = kinds => Array.from({ length: kinds.length }, () => 'div');
const runCycle = kinds => ({ cycleMs: kinds.reduce((s, k) => s + BASE.div + EXTRA[k], 0), kinds });

// Cycle arithmetic checked by hand: each plan repeats kinds in order until 120 s is reached.
const CLEAN9 = Array.from({ length: 9 }, () => 'clean');            // 54 solves/run at exactly ×1
const MID9 = [...Array.from({ length: 8 }, () => 'clean'), 'mid'];   // 47 clean + 5 at exactly ×1.5
const DEEP9 = [...Array.from({ length: 8 }, () => 'clean'), 'deep']; // 40 clean + 4 at exactly ×3
const EDGE4 = ['clean', 'clean', 'clean', 'edge'];                   // 33 clean + 10 at exactly ×2
const HEAVY9 = [...Array.from({ length: 7 }, () => 'clean'), 'deep', 'deep']; // 30 clean + 8 at ×3
const divOps9 = divOnly(Array.from({ length: 9 }, () => 'clean'));

test('bins use the fixed log edges [×0.5,0.75,1,1.5,2,3) with lower edges inclusive', () => {
  const clean = relativeHistogram(Array.from({ length: 6 }, (_, i) => playPlan(CLEAN9, i + 1, divOps9)));
  assert.deepEqual(clean.edges, [0.5, 0.75, 1, 1.5, 2, 3]);
  assert.ok(Object.isFrozen(HIST_EDGES));
  assert.equal(MOVEMENT_RUNS, 6); assert.equal(TAIL_EDGE, 2); assert.equal(MIN_HIST_OBS, 30);
  assert.equal(clean.bins.length, 7);
  assert.deepEqual(clean.bins.map(b => b.label), ['<×0.5', '×0.5–0.75', '×0.75–1', '×1–1.5', '×1.5–2', '×2–3', '≥×3']);
  // 54 solves per run × 6 runs, all at ratio exactly 1 — the first bin whose lower edge is reached
  // (lower edges inclusive) is ×1–1.5, so that modal bin holds every solve.
  assert.equal(clean.observations, 324);
  assert.equal(clean.bins[3].count, 324);
  assert.ok(clean.bins.every((b, i) => i === 3 ? b.count === 324 : b.count === 0));
  assert.equal(clean.bins[3].share, 1);
  assert.equal(clean.tailShare, 0);
  assert.equal(clean.slowShare, 0);
  assert.equal(clean.cutoffRatio, 2, 'zero MAD leaves the cutoff at exactly ×2');
  assert.equal(clean.cutoffOnEdge, true);
  assert.equal(clean.insufficient, false);
  assert.ok(clean.perRunTail.every(r => r.solves === 54 && r.tailShare === 0));
});

test('planted ×1.5 stalls are exact in the ×1.5–2 bin and outside the tail bins', () => {
  assert.equal(runCycle(MID9).cycleMs, 8 * 2200 + 3300);
  const mid = relativeHistogram(Array.from({ length: 6 }, (_, i) => playPlan(MID9, i + 1, divOps9)));
  assert.equal(mid.observations, (47 + 5) * 6);
  assert.equal(mid.bins[3].count, 282, 'exactly the ×1 solves');
  assert.equal(mid.bins[4].count, 30, 'exactly the stalls, by half-open lower-edge rule');
  assert.equal(mid.tailShare, 0, '×1.5 is short of the ×2 edge');
  assert.equal(mid.slowShare, 0, 'the cutoff is ×2 here (zero MAD), so the two views agree');
  assert.ok(Math.abs(mid.bins.reduce((s, b) => s + b.share, 0) - 1) < 1e-12);
});

test('planted ×3 stalls land exactly in the tail bins and match the slow rule at cutoff ×2', () => {
  assert.equal(runCycle(DEEP9).cycleMs, 8 * 2200 + 6600);
  const deep = relativeHistogram(Array.from({ length: 6 }, (_, i) => playPlan(DEEP9, i + 1, divOps9)));
  assert.equal(deep.observations, (40 + 4) * 6);
  assert.equal(deep.bins[3].count, 240);
  assert.equal(deep.bins[5].count, 0, 'nothing between ×2 and ×3');
  assert.equal(deep.bins[6].count, 24, 'exactly the deep stalls in ≥×3');
  assert.equal(deep.tailShare, 24 / 264, 'share against the ×2 edge, not the median');
  assert.equal(deep.slowShare, 24 / 264, 'equal slow share because the robust cutoff sits on ×2');
  assert.equal(deep.cutoffOnEdge, true);
  assert.ok(deep.tailShare >= deep.slowShare);
  assert.ok(deep.bins.every(b => b.tail === (b.lo >= TAIL_EDGE)));
});

test('a solve exactly twice typical is counted by bins but missed by the strict slow rule', () => {
  assert.equal(runCycle(EDGE4).cycleMs, 3 * 2200 + 4400);
  const edge = relativeHistogram(Array.from({ length: 6 }, (_, i) => playPlan(EDGE4, i + 1, divOps9)));
  assert.equal(edge.observations, (33 + 10) * 6);
  assert.equal(edge.bins[5].count, 60, '×2.0 enters the ×2–3 bin (lower edge inclusive)');
  assert.equal(edge.bins[6].count, 0);
  assert.equal(edge.tailShare, 60 / 258, 'share at ≥×2 counts the on-edge solves');
  assert.equal(edge.slowShare, 0, 'the slow rule needs strictly above its cutoff, and the cutoff is ×2');
  assert.equal(edge.cutoffOnEdge, true);
  assert.ok(edge.tailShare > edge.slowShare, 'documented differ case');
});

test('tail-share movement reuses the Theil–Sen trend from consistency (min 6 runs)', () => {
  assert.equal(runCycle(HEAVY9).cycleMs, 7 * 2200 + 2 * 6600);
  const heavy = Array.from({ length: 3 }, (_, i) => playPlan(HEAVY9, i + 1, divOps9));
  const light = Array.from({ length: 3 }, (_, i) => playPlan(CLEAN9, i + 4, divOps9));
  const falling = relativeHistogram([...heavy, ...light]);
  assert.ok(falling.tailTrend, '6 runs unlock the trend');
  assert.equal(falling.tailTrend.n, 6);
  assert.ok(falling.tailTrend.slope < 0, 'share falls from 8/38 to 0');
  assert.deepEqual(falling.perRunTail.slice(0, 3).map(r => r.tailShare), [8 / 38, 8 / 38, 8 / 38]);
  assert.ok(falling.perRunTail.slice(3).every(r => r.solves === 54 && r.tailShare === 0));
  const constant = relativeHistogram(Array.from({ length: 6 }, (_, i) => playPlan(HEAVY9, i + 1, divOps9)));
  assert.equal(constant.tailTrend.slope, 0);
  assert.equal(constant.tailTrend.low, 0);
  assert.equal(constant.tailTrend.high, 0);
  const five = relativeHistogram(Array.from({ length: 5 }, (_, i) => playPlan(HEAVY9, i + 1, divOps9)));
  assert.equal(five.tailTrend, null);
});

test('practice and drill runs stay out; scope all can include them', () => {
  const runs = Array.from({ length: 2 }, (_, i) => playPlan(CLEAN9, i + 1, divOps9));
  const drill = { ...playPlan(CLEAN9, 9, divOps9), benchmark: false, mode: 'drill' };
  const only = relativeHistogram([...runs, drill]);
  assert.equal(only.runs, 2);
  assert.equal(only.observations, 108);
  const all = relativeHistogram([...runs, drill], { scope: 'all' });
  assert.equal(all.runs, 3);
  assert.equal(all.observations, 162);
});

test('empty, sparse, engine-1 and short-operation data degrade gracefully', () => {
  const empty = relativeHistogram([]);
  assert.equal(empty.runs, 0); assert.equal(empty.observations, 0);
  assert.equal(empty.insufficient, true);
  assert.ok(empty.bins.every(b => b.count === 0 && b.share === null));
  assert.equal(empty.tailShare, null); assert.equal(empty.slowShare, null);
  assert.equal(empty.cutoffRatio, null); assert.equal(empty.cutoffOnEdge, false);
  assert.equal(empty.tailTrend, null); assert.equal(empty.perRunTail.length, 0);
  assert.equal(empty.engine1, 0);

  const legacyRun = stamp => ({ benchmark: true, startedAt: stamp,
    events: [...Array.from({ length: 28 }, () => ({ op: 'div', correct: true, responseMs: 2200, completedAtMs: 60000 })),
             ...Array.from({ length: 2 }, () => ({ op: 'div', correct: true, responseMs: 6600, completedAtMs: 70000 })),
             ...Array.from({ length: 4 }, () => ({ op: 'add', correct: true, responseMs: 1000, completedAtMs: 8000 }))] });
  const legacy = relativeHistogram([legacyRun('2026-05-01T00:00:00Z')]);
  assert.equal(legacy.runs, 1);
  assert.equal(legacy.observations, 30, 'the four add solves are skipped (op median needs ≥5 samples)');
  assert.equal(legacy.engine1, 30, 'no shownAtMs: start times were derived');
  assert.equal(legacy.bins[3].count, 28);
  assert.equal(legacy.bins[6].count, 2);
  assert.equal(legacy.insufficient, false, '30 meets the stated minimum exactly');
  assert.equal(relativeHistogram([legacyRun('2026-05-01T00:00:00Z'), legacyRun('2026-05-02T00:00:00Z')]).insufficient, false);

  const sparse = relativeHistogram([legacyRun('2026-05-01T00:00:00Z'), legacyRun('2026-05-02T00:00:00Z')].map(s => ({ ...s, events: s.events.slice(0, 6) })));
  assert.equal(sparse.runs, 2);
  assert.equal(sparse.observations, 12);
  assert.equal(sparse.insufficient, true, '12 is below the stated minimum of 30');
  assert.equal(sparse.bins[3].count, 12);
  assert.equal(sparse.tailTrend, null, 'trend needs 6 runs anyway');
  assert.equal(sparse.perRunTail.length, 2);
});
