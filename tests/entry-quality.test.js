import test from 'node:test';
import assert from 'node:assert/strict';
import { entryQuality, cleanMediansByOp } from '../packages/analytics/src/entry-quality.js';
import { classifyError } from '../packages/analytics/src/errors.js';
import { makeQuestion } from '../packages/core/src/generator.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';

// Planted fixture: real ArithmeticSessions played with a fake clock, with keystroke scripts that
// plant each entry type on purpose. Every question of a kind gets identical, exact timings.

/** Question pairs chosen so every answer is a positive two-digit number that never starts with 8. */
const PAIR = { add: [40, 32], sub: [40, 32], mul: [7, 11], div: [7, 11] };
const BASE = { add: 1000, sub: 1300, mul: 1800, div: 2200 };
/** Extra solve time per entry kind: the lost time per event of kind k is exactly EXTRA[k]. */
const EXTRA = { clean: 0, revision: 500, slip: 800, calculation: 1100 };
const THINK = 400; // time to first key, identical for every question

/** Keystroke scripts planting each type (values are the full field text after each input event). */
const SCRIPTS = {
  clean: a => [a[0], a],
  revision: a => [a[0], '', a[0], a],
  slip: a => [a[0] === '8' ? '9' : '8', '', a[0], a],
  calculation: a => { const bad = (a[0] === '8' ? '9' : '8') + a.slice(1); return [bad[0], bad, '', a[0], a]; },
};

/** play() from tests/fatigue.test.js, but the driver also types the planted error scripts. */
function playPlan(kinds, day, ops = kinds.map((_, i) => ['add', 'sub', 'mul', 'div'][i % 4])) {
  let t = 0;
  const pulled = [];
  const plan = kinds.map((kind, i) => ({ op: ops[i], kind }));
  const session = new ArithmeticSession({
    rules: BENCHMARK_RULES, mode: 'benchmark', seed: 'eq' + day,
    clock: () => t, wallClock: () => new Date(Date.UTC(2026, 0, day)).toISOString(),
    generator: () => { const p = plan[pulled.length % plan.length]; pulled.push(p); return makeQuestion(p.op, ...PAIR[p.op], pulled.length); },
  });
  session.start();
  while (true) {
    const p = pulled[pulled.length - 1];
    const steps = SCRIPTS[p.kind](String(session.current.answer));
    const dur = BASE[p.op] + EXTRA[p.kind];
    if (t + dur >= 120000) break;
    t += THINK; session.recordInput(steps[0]);
    for (let i = 1; i < steps.length - 1; i++) { t += 100; session.recordInput(steps[i]); }
    t += dur - THINK - 100 * (steps.length - 2);
    session.recordInput(steps[steps.length - 1]);
  }
  t = 120000; return session.finish();
}

/** Main fixture: slips on sub, calculations on div, revisions on mul; every op keeps ≥11 clean solves. */
const KINDS = ['clean', 'clean', 'clean', 'clean', 'clean', 'slip', 'clean', 'calculation', 'clean', 'clean', 'revision', 'clean'];

test('type rates and per-type costs match the planted data exactly', () => {
  const runs = Array.from({ length: 6 }, (_, i) => playPlan(KINDS, i + 1));
  const q = entryQuality(runs);
  assert.equal(q.runs, 6);
  assert.equal(q.observations, 402);

  // Rates: 306 clean, 30 revisions (mul), 36 slips (sub), 30 calculations (div).
  assert.deepEqual(q.rates.map(x => x.type), ['clean', 'revision', 'slip', 'calculation']);
  assert.deepEqual(q.rates.map(x => x.count), [306, 30, 36, 30]);
  assert.equal(q.rates[3].share, 5 / 67);

  // Operation adjustment: each event is costed against its own operation's clean median.
  assert.deepEqual(q.clean, { add: 1000, sub: 1300, mul: 1800, div: 2200 });
  const [clean, rev, slip, calc] = q.costs;
  // Calc sits on slow division: 3300 ÷ 2200. The unadjusted (global-median) version would be 3300 ÷ 1800.
  assert.equal(clean.ratio, 1);
  assert.ok(Math.abs(calc.ratio - 3300 / 2200) < 1e-12, String(calc.ratio));
  assert.ok(Math.abs(slip.ratio - 2100 / 1300) < 1e-12, String(slip.ratio));
  assert.ok(Math.abs(rev.ratio - 2300 / 1800) < 1e-12, String(rev.ratio));
  assert.ok(calc.baseline === 'clean' && slip.baseline === 'clean');
  assert.equal(calc.costed, 30);
  // Seconds lost per run: EXTRA per event × count (calc 1100×5, slip 800×6, revision 500×5); clean 0.
  assert.equal(clean.lostMs, 0);
  assert.equal(rev.lostMs, 2500);
  assert.equal(slip.lostMs, 4800);
  assert.equal(calc.lostMs, 5500);
  assert.deepEqual(calc.lostCI, { low: 5500, high: 5500, confidence: 0.95, n: 6 });
  assert.deepEqual(q.lostTotalCI, { low: 12800, high: 12800, confidence: 0.95, n: 6 });
  assert.equal(q.lostTotal, 5500 + 4800 + 2500);
  // Both lenses agree on what matters but can disagree in order: by relative time the sub slip
  // (2100/1300) is farther from clean-entry than the div calculation (3300/2200), yet per run the
  // calculation costs more absolute time (5×1100 > 6×800) — exactly the split the panel shows.
  assert.ok(calc.ratio < slip.ratio);
  assert.ok(calc.lostMs > slip.lostMs);
  // ≈ questions conversion is a rough upper bound against the overall median solve time.
  assert.equal(q.overallMedianMs, 1800);
  assert.equal(q.questionsPerRun, (5500 + 4800 + 2500) / 1800);

  // Where the time goes: proxy split. First key exactly THINK; typing takes the rest of the solve.
  assert.equal(calc.splitN, 30);
  // Clean entry mixes operations: 600 (add) ×102, 900 (sub) ×66, 1400 (mul) ×72, 1800 (div) ×66 → median 900.
  assert.equal(clean.firstMs, 400); assert.equal(clean.entryMs, 900);
  assert.equal(slip.firstMs, 400); assert.equal(slip.entryMs, 2100 - 400);
  assert.equal(calc.firstMs, 400); assert.equal(calc.entryMs, 3300 - 400);

  // Per-operation breakdown with the planted cells and gated exact ratios.
  const div = q.byOp.find(o => o.op === 'div');
  assert.equal(div.n, 16 * 6);
  assert.equal(div.types.find(c => c.type === 'calculation').n, 30);
  assert.ok(Math.abs(div.types.find(c => c.type === 'calculation').ratio - 1.5) < 1e-12);
  assert.equal(div.types.find(c => c.type === 'clean').n, 66);
  const sub = q.byOp.find(o => o.op === 'sub');
  assert.equal(sub.types.find(c => c.type === 'slip').n, 36);
  assert.equal(sub.types.find(c => c.type === 'clean').n, 66);
});

test('calculation errors on division alone are not inflated by division being slow', () => {
  const divOnly = Array.from({ length: 9 }, (_, i) => i === 8 ? 'calculation' : 'clean');
  const divOps = Array.from({ length: 9 }, () => 'div');
  const runs = Array.from({ length: 6 }, (_, i) => playPlan(divOnly, i + 1, divOps));
  const q = entryQuality(runs);
  const calc = q.costs.find(c => c.type === 'calculation');
  assert.equal(q.observations, (47 + 5) * 6);
  assert.equal(calc.count, 30);
  assert.ok(Math.abs(calc.ratio - 3300 / 2200) < 1e-12, 'adjusted to the division clean median');
  assert.equal(calc.lostMs, 5 * (3300 - 2200), 'only extra time counts, not division typical time');
  assert.ok(q.perRun.every(r => r.calculation === 5 && r.lostMs === 5500));
});

test('calculation-share trend is direction-correct over the last runs', () => {
  const calcHeavy = ['clean', 'clean', 'clean', 'clean', 'clean', 'calculation', 'clean', 'calculation', 'clean', 'clean', 'revision', 'clean'];
  const light = ['clean', 'clean', 'clean', 'clean', 'clean', 'clean', 'clean', 'calculation', 'clean', 'clean', 'revision', 'clean'];
  const runs = [...Array.from({ length: 3 }, (_, i) => playPlan(calcHeavy, i + 1)),
                ...Array.from({ length: 3 }, (_, i) => playPlan(light, i + 4))];
  const q = entryQuality(runs);
  assert.ok(q.calcTrend, '6 runs unlock the trend');
  assert.equal(q.calcTrend.n, 6);
  assert.ok(q.calcTrend.slope < 0, 'calculation share falls: 6/67 per run then none');
  const constant = entryQuality(Array.from({ length: 6 }, (_, i) => playPlan(KINDS, i + 1)));
  assert.equal(constant.calcTrend.slope, 0);
  assert.equal(constant.calcTrend.low, 0);
  assert.equal(constant.calcTrend.high, 0);
});

test('practice sessions are excluded, but scope all can include them', () => {
  const runs = Array.from({ length: 6 }, (_, i) => playPlan(KINDS, i + 1));
  const practice = { ...playPlan(KINDS, 9), benchmark: false, mode: 'drill' };
  const q = entryQuality([...runs, practice]);
  assert.equal(q.runs, 6);
  assert.equal(q.observations, 402);
  const all = entryQuality([...runs, practice], { scope: 'all' });
  assert.equal(all.runs, 7);
  assert.ok(all.observations > 67);
});

test('engine-1 records: every correction counts as a slip and the proxy split is missing', () => {
  const event = ms => ({ op: 'add', correct: true, responseMs: ms, completedAtMs: ms, corrections: 0 });
  const legacy = { benchmark: true, startedAt: '2026-03-01T00:00:00Z',
    events: [...Array.from({ length: 6 }, () => event(1200)),
             ...Array.from({ length: 2 }, () => ({ op: 'add', correct: true, responseMs: 2000, completedAtMs: 8000, corrections: 2 }))] };
  const q = entryQuality([legacy]);
  assert.equal(q.runs, 1);
  assert.deepEqual(q.rates.map(x => x.count), [6, 0, 2, 0]);
  assert.equal(q.engine1Events, 8);
  const slip = q.costs.find(c => c.type === 'slip');
  assert.ok(Math.abs(slip.ratio - 2000 / 1200) < 1e-12);
  assert.equal(slip.lostMs, 2 * (2000 - 1200));
  assert.equal(slip.lostCI, null);
  assert.equal(slip.splitN, 0);
  assert.equal(slip.firstMs, null);
  assert.equal(slip.entryMs, null);
  assert.equal(q.lostTotalCI, null);
  assert.equal(q.byOp[0].types.find(c => c.type === 'slip').ratio, null, 'cell gated below MIN_TYPE_SAMPLES');
});

test('costs fall back to the operation median when clean samples are short', () => {
  const div = ms => ({ op: 'div', correct: true, responseMs: ms, completedAtMs: 30000 });
  const ok = { benchmark: true, startedAt: '2026-04-01T00:00:00Z',
    events: [...Array.from({ length: 5 }, () => div(2000)), ...Array.from({ length: 3 }, () => ({ ...div(2400), corrections: 2 }))] };
  const q = entryQuality([ok]);
  assert.equal(q.clean.div, 2000); assert.equal(q.clean.add, null);
  const slip = q.costs.find(c => c.type === 'slip');
  assert.equal(slip.count, 3);
  assert.equal(slip.baseline, 'clean');
  assert.ok(Math.abs(slip.ratio - 2400 / 2000) < 1e-12);
  assert.equal(slip.lostMs, 3 * (2400 - 2000));

  const short = { benchmark: true, startedAt: '2026-05-01T00:00:00Z',
    events: [...Array.from({ length: 4 }, (_, i) => div(2000 + i)), ...Array.from({ length: 4 }, (_, i) => ({ ...div(2400 + i), corrections: 2 }))] };
  const q2 = entryQuality([short]);
  assert.equal(q2.clean.div, null, 'fewer than 5 clean solves');
  const s2 = q2.costs.find(c => c.type === 'slip');
  assert.equal(s2.baseline, 'op');
  assert.equal(s2.lostMs, 0, 'no clean-entry reference, so nothing is costed');
  assert.equal(s2.lostCI, null);
  // Relative to the all-solve operation median: popover div median (2003+2400)/2 = 2201.5 and the
  // slip-log median maps back to sqrt(2401·2402).
  assert.ok(Math.abs(s2.ratio - Math.sqrt(2401 * 2402) / 2201.5) < 1e-12);
  assert.equal(q2.baselineMixed, true);
});

test('empty and sparse data degrade gracefully', () => {
  const empty = entryQuality([]);
  assert.equal(empty.runs, 0); assert.equal(empty.observations, 0);
  assert.ok(empty.rates.every(x => x.share === null));
  assert.equal(empty.lostTotal, null); assert.equal(empty.questionsPerRun, null);
  assert.equal(empty.calcTrend, null); assert.equal(empty.perRun.length, 0);
  assert.ok(empty.byOp.every(o => o.n === 0 && o.types.every(c => c.n === 0 && c.ratio === null && c.medianMs === null)));
  assert.equal(cleanMediansByOp([]).add, null);
  const sparse = entryQuality([playPlan(KINDS, 1), playPlan(KINDS, 2)]);
  assert.equal(sparse.runs, 2); assert.equal(sparse.observations, 134);
  assert.equal(sparse.calcTrend, null, 'trend needs ≥6 runs');
  assert.equal(sparse.costs[0].lostCI, null, 'median CI needs ≥6 runs');
  assert.equal(sparse.costs[3].lostMs, 5500, 'per-run medians still computed');
});
