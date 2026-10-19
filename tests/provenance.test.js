import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeProvenance, treatmentOutcomes, PROVENANCE_SURFACES, PROVENANCE_POLICY_IDS } from '../packages/training/src/provenance.js';
import { TRAINING_POLICIES, projectPolicy } from '../packages/training/src/policies.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { makeQuestion } from '../packages/core/src/generator.js';
import { customRules, BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { sanitizeImportedSession } from '../packages/storage/src/sanitize.js';

const TAG = { surface: 'recommendations', cellId: 'mul:06-09×14-19', policyId: 'cell-gauntlet' };

test('sanitizeProvenance: whitelist surfaces, known policy ids, bounded text', () => {
  const normalized = sanitizeProvenance(TAG);
  assert.deepEqual(normalized, { ...TAG, stage: null }); // every record carries all four keys
  assert.deepEqual(sanitizeProvenance({ surface: 'gauntlet', stage: 'benchmark' }), { surface: 'gauntlet', policyId: null, cellId: null, stage: 'benchmark' });
  for (const surface of PROVENANCE_SURFACES) assert.notEqual(sanitizeProvenance({ surface, cellId: 'c' }), null);
  assert.equal(sanitizeProvenance({ surface: 'quant' }), null); // quant stays its own namespace
  assert.equal(sanitizeProvenance({ surface: 'recommendations', policyId: 'made-up' }), null); // unknown id leaves nothing attributable
  assert.equal(sanitizeProvenance(null), null);
  assert.equal(sanitizeProvenance('recommendations'), null); // never trust strings
  assert.equal(sanitizeProvenance({}), null); // surface missing
  assert.equal(sanitizeProvenance({ surface: 'heatmap' }), null); // no attribute at all claims nothing
  assert.deepEqual(sanitizeProvenance({ surface: 'heatmap', policyId: 'cell-gauntlet', cellId: '  ', stage: 'PROBE' }), { surface: 'heatmap', policyId: 'cell-gauntlet', cellId: null, stage: null }); // context-only is still attribution
  const ids = TRAINING_POLICIES.map(p => p.id).sort();
  assert.deepEqual([...PROVENANCE_POLICY_IDS].sort(), ids); // same source of truth as the flag resolver
});

test('sanitizeProvenance: identifiers collapse whitespace and cap at 60 chars', () => {
  const long = 'mul:' + '0'.repeat(120);
  assert.equal(sanitizeProvenance({ surface: 'heatmap', cellId: '  mul:06-09\n×14-19  ' }).cellId, 'mul:06-09 ×14-19');
  assert.equal(sanitizeProvenance({ surface: 'heatmap', cellId: long }).cellId.length, 60);
  assert.equal(sanitizeProvenance({ surface: 'heatmap', cellId: 42 }), null);
  assert.equal(sanitizeProvenance({ surface: 'gauntlet', stage: 'benchmark hand-off!' }), null, 'stage stays a bounded slug');
});

test('engine: provenance rides the result verbatim; drill context coexists; absent stays absent', () => {
  let t = 0, q = 0;
  const tag = { surface: 'recommendations', cellId: 'mul:06-09×14-19', policyId: 'cell-gauntlet' };
  const session = new ArithmeticSession({
    rules: customRules({ durationSeconds: 5, enabled: ['add'] }),
    clock: () => t, wallClock: () => new Date(0).toISOString(),
    generator: () => makeQuestion('add', 2, 3, ++q),
    mode: 'drill', seed: 'seed-p', drill: { op: 'add', cell: 'add:02-09', label: 'low bonds', tier: 2 },
    provenance: tag,
  });
  session.start();
  const result = session.finish({ endedEarly: true });
  // The engine is a dumb, consumption-safe passthrough: normalization happens at the edges
  // (storage import, treatmentOutcomes), never inside the scoring path.
  assert.deepEqual(result.provenance, tag);
  assert.deepEqual(result.drill, { op: 'add', cell: 'add:02-09', label: 'low bonds', tier: 2 });
  assert.equal(result.benchmark, false); // practice is practice, with or without provenance
  const stripped = new ArithmeticSession({
    rules: customRules({ durationSeconds: 5, enabled: ['add'] }),
    clock: () => t, wallClock: () => new Date(0).toISOString(), generator: () => makeQuestion('add', 2, 3, 1), mode: 'custom', seed: 's',
  });
  stripped.start();
  assert.equal('provenance' in stripped.finish({ endedEarly: true }), false);
});

/** A full-length seeded standard benchmark through the real engine (validity recomputable on import). */
function benchmarkRun({ seed, startedIso, score, provenance }) {
  let q = 0;
  const session = new ArithmeticSession({
    rules: BENCHMARK_RULES, wallClock: () => startedIso,
    // 120 s spread evenly over the answered questions: startedAt is read before the first advance,
    // so after `score` solves the virtual clock sits exactly on the deadline.
    clock: () => (BENCHMARK_RULES.durationSeconds * 1000) * q / (score + 1),
    generator: () => makeQuestion('add', 2, 9, ++q), mode: 'benchmark', seed, provenance,
  });
  session.start();
  for (let i = 0; i < score; i++) assert.equal(session.recordInput(String(session.current.answer), ''), true, `solve ${i + 1} should score`);
  session.finish();
  return JSON.parse(JSON.stringify(session.summary()));
}

test('benchmark hand-off: provenance never touches validity, import round-trips it', () => {
  const run = benchmarkRun({ seed: 'handoff', startedIso: '2026-10-19T08:00:00.000Z', score: 8, provenance: { surface: 'gauntlet', stage: 'benchmark' } });
  assert.equal(run.benchmark, true, 'tagged hand-off benchmark stays valid');
  assert.deepEqual(run.provenance, { surface: 'gauntlet', stage: 'benchmark' }); // verbatim at the engine
  assert.equal(run.elapsedMs >= 120000, true);
  const imported = sanitizeImportedSession(run);
  assert.equal(imported.benchmark, true);
  // Import whitelist rebuilds the full four-key shape — never accepts a partial dossier.
  assert.deepEqual(imported.provenance, { surface: 'gauntlet', stage: 'benchmark', policyId: null, cellId: null });
  // Malformed provenance is dropped, not repaired — and never salvages or invalidates the run.
  for (const garbage of [{ surface: 'nope' }, 42, { surface: 'heatmap', cellId: { evil: 1 } }]) {
    const bad = sanitizeImportedSession({ ...run, provenance: garbage });
    if (bad) assert.equal('provenance' in bad, false, 'malformed provenance must not survive import');
  }
});

/* ---- treatmentOutcomes fixtures: reuse tests/impact-policy.test.js's proven run shape ---- */
function events(n, op, a, b, ms) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ ...makeQuestion(op, a, b + i, i + 1), responseMs: ms, firstInputMs: Math.floor(ms / 10), entryMs: ms - Math.floor(ms / 10), completedAtMs: i * ms, correct: true });
  return out;
}
/** A benchmark-run-shaped history record with the given solved-event mix (one slow mul cell next to a fast one). */
function richRun(dayIso) {
  const mix = [{ op: 'mul', a: 7, b: 40, ms: 4200, n: 9 }, { op: 'mul', a: 10, b: 90, ms: 800, n: 9 }, { op: 'add', a: 20, b: 30, ms: 400, n: 12 }];
  const ev = mix.flatMap(m => events(m.n, m.op, m.a, m.b, m.ms));
  return { id: `s-${dayIso}`, startedAt: dayIso, mode: 'benchmark', benchmark: true, score: ev.length, elapsedMs: 120000, events: ev };
}
function benchDay(iso, score) {
  return { id: `b-${iso}`, startedAt: iso, mode: 'benchmark', benchmark: true, score, elapsedMs: 120000, events: [] };
}
function drillRun(iso, { seconds = 60, provenance } = {}) {
  return { startedAt: iso, mode: 'drill', benchmark: false, score: 7, elapsedMs: seconds * 1000, events: [], drill: { op: 'mul', cell: 'mul:07-07×40-48', label: 'slow cell' }, ...(provenance ? { provenance } : {}) };
}
const D0 = '2026-10-01T08:00:00.000Z', D2 = '2026-10-03T08:00:00.000Z', D4 = '2026-10-05T08:00:00.000Z', D6 = '2026-10-07T08:00:00.000Z';

test('treatmentOutcomes: pairs consecutive benchmarks, groups attributed runs, predicts on the prefix', () => {
  const sessions = [
    richRun('2026-09-28T08:00:00.000Z'), richRun('2026-09-29T08:00:00.000Z'), // history for a real cell-gauntlet projection
    benchDay(D0, 40),
    drillRun('2026-10-02T08:00:00.000Z', { provenance: { surface: 'recommendations', cellId: 'mulA', policyId: 'cell-gauntlet' } }),
    drillRun('2026-10-02T10:00:00.000Z', { provenance: { surface: 'gauntlet', cellId: 'mulB', stage: 'train' } }), // tagged, no policy
    drillRun('2026-10-02T11:00:00.000Z', { provenance: 'garbage' }), // unsanitizable → not a treatment at all
    benchDay(D2, 46),
    drillRun('2026-10-04T08:00:00.000Z', { provenance: { surface: 'heatmap', cellId: 'mulC', policyId: 'op-adaptive' } }),
    benchDay(D4, 52),
  ];
  const { pairs } = treatmentOutcomes(sessions);
  assert.equal(pairs.length, 2);
  const [first, second] = pairs;
  assert.equal(first.beforeScore, 40); assert.equal(first.afterScore, 46);
  assert.equal(first.unattributedRuns, 1);
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].policyId, 'cell-gauntlet');
  assert.equal(first.rows[0].runs, 1);
  assert.equal(first.rows[0].treatmentSeconds, 60);
  assert.equal(first.rows[0].observedDelta, 6);
  // The prediction recomputes the policy projection on exactly the pre-treatment prefix — and the
  // fixtures give that prefix a real slow cell, so the predicted delta is a positive estimate, not a stub.
  const prefix = sessions.filter(s => Date.parse(s.startedAt) <= Date.parse(D0));
  const expected = projectPolicy('cell-gauntlet', prefix).projectedDelta;
  assert.equal(first.rows[0].predictedDelta, expected);
  assert.ok(first.rows[0].predictedDelta > 0, `expected a positive projection (heuristic fixtures), got ${first.rows[0].predictedDelta}`);
  assert.equal(first.rows[0].predictedFeasible, true);
  assert.equal(second.rows[0].policyId, 'op-adaptive');
  assert.equal(second.rows[0].observedDelta, 6);
  assert.equal(second.unattributedRuns, 0);
});

test('treatmentOutcomes: filters sub-threshold runs, keeps unattributed-only windows honest, caps pairs', () => {
  const sessions = [
    benchDay(D0, 40),
    drillRun('2026-10-02T08:00:00.000Z', { seconds: 10, provenance: { surface: 'heatmap', cellId: 'x', policyId: 'op-adaptive' } }), // too short to be treatment
    benchDay(D2, 46),
    drillRun('2026-10-03T08:00:00.000Z', { provenance: { surface: 'academy', cellId: 'addition-round' } }), // tagged but unattributed
    benchDay(D4, 46),
    drillRun('2026-10-06T08:00:00.000Z', { provenance: { surface: 'recommendations', cellId: 'mulD', policyId: 'automaticity' } }),
    benchDay(D6, 49),
  ];
  const { pairs, emptyNote } = treatmentOutcomes(sessions);
  // Window D0→D2 held only a sub-threshold run → skipped entirely, never dressed up as a pair.
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].beforeStartedAt, D2);
  assert.equal(pairs[0].rows.length, 0);
  assert.equal(pairs[0].unattributedRuns, 1);
  assert.ok(/no policy to pair/.test(pairs[0].note));
  assert.equal(pairs[1].beforeStartedAt, D4);
  assert.equal(pairs[1].rows[0].policyId, 'automaticity');
  assert.equal(pairs[1].rows[0].observedDelta, 3);
  const capped = treatmentOutcomes(sessions, { maxPairs: 1 });
  assert.equal(capped.pairs.length, 1);
  assert.equal(capped.pairs[0].afterStartedAt, D6, 'cap keeps the most recent pair');
  assert.deepEqual(treatmentOutcomes([benchDay(D0, 40)]).emptyNote, 'Pairing needs at least two valid benchmark runs.');
  assert.equal(treatmentOutcomes([]).pairs.length, 0);
  assert.equal(emptyNote, null);
});

test('treatmentOutcomes: practice runs never become pair endpoints and caveats are restated, not implicit', () => {
  const sessions = [
    benchDay(D0, 40),
    drillRun('2026-10-02T08:00:00.000Z', { provenance: { surface: 'gauntlet', cellId: 'mulB', stage: 'probe', policyId: 'automaticity' } }),
    drillRun('2026-10-02T09:00:00.000Z', { provenance: { surface: 'heatmap', cellId: 'mulZ', policyId: 'automaticity' } }),
  ];
  const { pairs, caveats, emptyNote } = treatmentOutcomes(sessions);
  assert.equal(pairs.length, 0);
  assert.ok(emptyNote);
  const text = caveats.join(' ');
  assert.ok(text.includes('no causal claim'), 'caveats must be restated, not implicit');
  assert.ok(text.includes('share \u00d7 excess'), 'F20 category step is named as the still-estimative basis');
  assert.match(text, /observational/i, 'every ledger consumer sees the pairing limitation');
});
