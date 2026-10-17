import test from 'node:test';
import assert from 'node:assert/strict';
import { ArithmeticSession, matchesAnswer, MAX_TRACE, ENGINE_VERSION } from '../packages/core/src/session.js';
import { BENCHMARK_RULES, customRules } from '../packages/core/src/rulesets.js';
import { makeQuestion } from '../packages/core/src/generator.js';
import { classifyError, errorTypology } from '../packages/analytics/src/errors.js';
import { sanitizeImportedSession } from '../packages/storage/src/sanitize.js';
import { benchmarkProgress } from '../packages/analytics/src/progress.js';

// Every question is 40 + 32 = 72 unless overridden.
function harness({ rules = BENCHMARK_RULES, mode = 'benchmark', q = () => makeQuestion('add', 40, 32) } = {}) {
  let t = 1000;
  const session = new ArithmeticSession({ rules, mode, seed: 's', clock: () => t, wallClock: () => new Date(t).toISOString(), generator: q });
  return { session, move: ms => { t += ms; }, type: (...values) => values.map(v => session.recordInput(v)) };
}

test('answer matching follows original: trimmed exact string, no leading zeros', () => {
  assert.equal(matchesAnswer('72', 72), true);
  assert.equal(matchesAnswer(' 72 ', 72), true);
  assert.equal(matchesAnswer('072', 72), false);
  assert.equal(matchesAnswer('72.0', 72), false);
  assert.equal(matchesAnswer('7 2', 72), false);
});

test('correct prefix typing scores once with clean telemetry', () => {
  const { session, move, type } = harness(); session.start(); move(900);
  assert.deepEqual(type('7'), [false]); move(150);
  assert.deepEqual(type('72'), [true]);
  const e = session.events[0];
  assert.equal(session.score, 1);
  assert.equal(e.responseMs, 1050); assert.equal(e.firstInputMs, 900); assert.equal(e.entryMs, 150);
  assert.equal(e.corrections, 0); assert.equal(e.wrongPrefixes, 0); assert.equal(e.fullWrongAnswers, 0);
  assert.deepEqual(e.trace, [[900, '7'], [1050, '72']]);
  assert.equal(classifyError(e), 'clean');
});

test('leading zero and stray non-digits must be deleted before the answer counts', () => {
  const { session, type } = harness(); session.start();
  assert.deepEqual(type('0', '07', '072'), [false, false, false]);
  assert.deepEqual(type('07', '0', '', '7', '7a', '72a'), [false, false, false, false, false, false]);
  assert.deepEqual(type('72'), [true]);
  const e = session.events[0];
  assert.ok(e.corrections >= 4);
  assert.equal(e.wrongPrefixes, 2, 'entered wrong state twice: "0" and "7a"');
  assert.equal(classifyError(e), 'calculation', '"072" and "72a" are complete wrong values');
});

test('slip, revision and calculation errors are distinguished', () => {
  const slip = harness(); slip.session.start(); slip.type('8', '', '7', '72');
  assert.equal(classifyError(slip.session.events[0]), 'slip');
  const revision = harness(); revision.session.start(); revision.type('7', '', '7', '72');
  assert.equal(classifyError(revision.session.events[0]), 'revision');
  const calc = harness(); calc.session.start(); calc.type('6', '62', '6', '', '7', '72');
  assert.equal(calc.session.events[0].fullWrongAnswers, 1);
  assert.equal(classifyError(calc.session.events[0]), 'calculation');
  const t = errorTypology([...slip.session.events, ...revision.session.events, ...calc.session.events]);
  assert.equal(t.total, 3);
  assert.deepEqual(t.types.map(x => x.count), [0, 1, 1, 1]);
  assert.equal(errorTypology([]).types[0].share, null);
});

test('Enter only counts on a non-empty non-answer and never scores', () => {
  const { session, type } = harness(); session.start();
  session.markWrongSubmission();
  type('6'); type('62'); session.markWrongSubmission();
  assert.equal(session.score, 0);
  type('6'); type(''); type('7'); type('72');
  assert.equal(session.events[0].wrongSubmissions, 1);
});

test('duplicate input events and stale values cannot double-score', () => {
  const pairs = [[40, 32], [10, 5], [40, 32]];
  let n = 0;
  const { session, type } = harness({ q: () => makeQuestion('add', ...pairs[n % 3], ++n) }); session.start();
  assert.deepEqual(type('7', '7'), [false, false]);
  assert.equal(session.inputChanges, 1, 'repeated identical value is a no-op');
  assert.deepEqual(type('72', '72'), [true, false], 'stale "72" against 10 + 5 does not score');
  assert.deepEqual(type(''), [false]);
  assert.deepEqual(type('1', '15'), [false, true]);
  assert.equal(session.score, 2);
  assert.equal(session.events[0].inputChanges, 2);
});

test('multi-character insertions are flagged as paste', () => {
  const { session, type } = harness(); session.start(); type('72');
  assert.equal(session.events[0].pasted, true);
  assert.equal(session.finish().integrity.pasteEvents, 1);
});

test('backgrounded tab: clock keeps running, hidden time is recorded, benchmark stays valid', () => {
  const { session, move, type } = harness(); session.start();
  move(10000); session.recordVisibility(true); move(5000); session.recordVisibility(false);
  move(1000); type('72');
  assert.equal(session.events[0].responseMs, 16000);
  session.recordVisibility(true); move(200000);
  const r = session.finish();
  assert.equal(r.integrity.hiddenCount, 2);
  assert.equal(r.integrity.hiddenMs, 5000 + (120000 - 16000));
  assert.equal(r.benchmark, true);
  assert.equal(r.elapsedMs, 120000);
});

test('deadline boundary: answer at 119 999 ms counts, at 120 000 ms it does not', () => {
  const a = harness(); a.session.start(); a.move(119999);
  assert.deepEqual(a.type('72'), [true]);
  const b = harness(); b.session.start(); b.move(120000);
  assert.deepEqual(b.type('72'), [false]);
  assert.equal(b.session.state, 'finished');
  assert.equal(b.session.result.score, 0);
  assert.equal(b.session.result.finalUnanswered.answer, 72);
});

test('tick finishes expired sessions; manual end at full duration is still not a benchmark', () => {
  const a = harness(); a.session.start(); a.move(119000);
  assert.equal(a.session.tick(), 1000); assert.equal(a.session.state, 'active');
  a.move(1000); assert.equal(a.session.tick(), 0); assert.equal(a.session.state, 'finished');
  assert.equal(a.session.result.benchmark, true);
  assert.equal(a.session.result.engineVersion, ENGINE_VERSION);
  const b = harness(); b.session.start(); b.move(120000);
  assert.equal(b.session.finish({ endedEarly: true }).benchmark, false);
  const c = harness(); c.session.start(); c.move(30000);
  const early = c.session.finish();
  assert.equal(early.benchmark, false); assert.equal(early.endedEarly, true);
});

test('input before start and after finish is ignored', () => {
  const { session, move, type } = harness();
  assert.deepEqual(type('72'), [false]);
  session.start(); move(120000); session.tick();
  assert.deepEqual(type('72'), [false]);
  assert.equal(session.score, 0);
});

test('trace is bounded per question', () => {
  const { session, type } = harness(); session.start();
  for (let i = 0; i < 200; i++) type(i % 2 ? '' : '9');
  type('72');
  assert.equal(session.events[0].trace.length, MAX_TRACE);
});

test('practice modes never become benchmarks, even with default rules', () => {
  for (const mode of ['custom', 'adaptive', 'replay', 'drill', 'sprint']) {
    const { session, move } = harness({ mode }); session.start(); move(120000);
    assert.equal(session.finish().benchmark, false, mode);
  }
  const { session, move } = harness({ rules: customRules() }); session.start(); move(120000);
  assert.equal(session.finish().benchmark, false);
});

function validBenchmarkRecord() {
  const { session, move, type } = harness(); session.start(); move(2000); type('7', '72'); move(118000);
  return JSON.parse(JSON.stringify(session.finish()));
}

test('import keeps a genuine benchmark and recomputes question text', () => {
  const raw = validBenchmarkRecord();
  raw.events[0].symbol = '<img src=x onerror=alert(1)>';
  raw.events[0].left = 999;
  const s = sanitizeImportedSession(raw);
  assert.equal(s.benchmark, true);
  assert.equal(s.events[0].symbol, '+'); assert.equal(s.events[0].left, 40); assert.equal(s.events[0].answer, 72);
});

test('import never trusts forged benchmark flags', () => {
  const forge = patch => sanitizeImportedSession({ ...validBenchmarkRecord(), ...patch });
  assert.equal(forge({ rules: { ...BENCHMARK_RULES, durationSeconds: 30 } }).benchmark, false, 'rule id kept but snapshot modified');
  assert.equal(forge({ rules: { ...BENCHMARK_RULES, multiplication: { left: [2, 5], right: [2, 100] } } }).benchmark, false);
  assert.equal(forge({ mode: 'custom' }).benchmark, false);
  assert.equal(forge({ mode: 'quant' }).benchmark, false);
  assert.equal(forge({ elapsedMs: 60000 }).benchmark, false);
  assert.equal(forge({ endedEarly: true }).benchmark, false);
  assert.equal(forge({ score: 95 }).benchmark, false, 'score must match solved events');
  assert.equal(forge({ benchmark: 'true' }).benchmark, false);
  assert.equal(sanitizeImportedSession({ score: 'x' }), null);
  assert.equal(sanitizeImportedSession({ score: 1, events: [], startedAt: 'nope' }), null);
  const forged = [forge({ mode: 'custom', score: 1 }), forge({ elapsedMs: 1 })];
  assert.equal(benchmarkProgress(forged).count, 0);
});

test('import drops malformed events', () => {
  const raw = validBenchmarkRecord();
  raw.events.push({ op: 'pow', sourceLeft: 2, sourceRight: 3, responseMs: 5 }, { op: 'add', sourceLeft: -4, sourceRight: 2, responseMs: 5 }, { op: 'mul', sourceLeft: 3, sourceRight: 4 }, null);
  const s = sanitizeImportedSession(raw);
  assert.equal(s.events.length, 1);
});
