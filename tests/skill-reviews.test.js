import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeImportedSkillReview, parseSkillId } from '../packages/storage/src/sanitize.js';
import { skillReviewRecord } from '../packages/training/src/scheduler.js';
import { SKILL_TAXONOMY_VERSION, skillCellFor } from '../packages/training/src/skills.js';
import { heatmapLayout } from '../packages/analytics/src/heatmap.js';
import { createGenerator } from '../packages/core/src/generator.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { exportBundle, parseExportBundle } from '../packages/storage/src/export.js';
import { importSkillReviews, listSkillReviews, saveSkillReview, recordSkillReview, importSessions, listSessions } from '../packages/storage/src/db.js';

// Persistence invariants without a browser: Node has no IndexedDB, so db.js falls back to
// localStorage; we stub globalThis.localStorage per test to observe the fallback key behavior.

function stubStorage() {
  const data = {};
  globalThis.localStorage = {
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: key => { delete data[key]; },
  };
  return data;
}
const withStub = fn => async (...args) => { const data = stubStorage(); try { return await fn(data, ...args); } finally { delete globalThis.localStorage; } };

const T0 = '2026-10-17T12:00:00Z';
const BASE_RECORD = () => skillReviewRecord('mul:5:4', null, true, T0);

/** Play one real session like tests/fatigue.test.js, for the save/reload round trip. */
function playBenchmark(day = 1) {
  let t = 0;
  const s = new ArithmeticSession({ rules: BENCHMARK_RULES, generator: createGenerator(BENCHMARK_RULES, 'persist'), mode: 'benchmark', seed: 'persist', clock: () => t, wallClock: () => new Date(Date.UTC(2026, 0, day)).toISOString() });
  s.start();
  while (t + 1500 < 120000) { t += 1500; s.recordInput(String(s.current.answer)); }
  t = 120000; return s.finish();
}

test('every heatmap cell of the taxonomy parses as a skill id and back', () => {
  for (const op of ['add', 'sub', 'mul', 'div']) {
    const layout = heatmapLayout(op);
    for (let r = 0; r < layout.rows.length; r++) for (let c = 0; c < layout.cols.length; c++) {
      const id = `${op}:${r}:${c}`;
      const parsed = parseSkillId(id);
      assert.ok(parsed, id);
      assert.equal(skillCellFor(op, layout.rows[r].range[0], layout.cols[c].range[0]).id, id, 'skillCellFor goes back to the same id');
    }
  }
  for (const bad of ['mul:5', 'mul:5:', 'mul:x:4', 'power:0:0', 'mul:', 'mul:-1:0', 'add:10:0', 'mul:0:10', 'MUL:5:4']) {
    assert.equal(parseSkillId(bad), null, `reject ${bad}`);
  }
  assert.equal(parseSkillId('add:4:3').op, 'add');
  assert.equal(parseSkillId('mul:11:0'), null, 'row 11 is out of the 11-row layout (2..12 → 0..10)');
  assert.equal(parseSkillId('mul:10:9').row, 10, 'row 10 is the last table factor (12)');
  assert.equal(parseSkillId('add:9:9').row, 9, 'add rows go 0..9');
  assert.equal(parseSkillId('add:10:0'), null, 'add has 10 rows only');
  assert.equal(parseSkillId('mul:0:9').col, 9, '10 columns for every op');
  assert.equal(parseSkillId('mul:0:10'), null, 'no column 10');
});

test('skill review records sanitize round-trip, tampering drops', () => {
  const record = BASE_RECORD();
  assert.deepEqual(sanitizeImportedSkillReview(record), record, 'fully-valid record survives');
  // Stored nextReviewAt is recomputed, so a forged version that disagrees is rejected.
  assert.equal(sanitizeImportedSkillReview({ ...record, nextReviewAt: '2026-10-20T12:00:00Z' }), null);
  // Unknown taxonomy versions are dropped (never reinterpreted).
  for (const version of ['skill-taxonomy-v0', 'skill-taxonomy-v2', 'v1', null, 1]) {
    assert.equal(sanitizeImportedSkillReview({ ...record, taxonomyVersion: version }), null, `version ${version}`);
  }
  assert.equal(sanitizeImportedSkillReview({ ...record, id: 'mul:5:5' }), null, 'id must equal skillId');
  assert.equal(sanitizeImportedSkillReview({ ...record, id: 'add:10:0' }), null, 'row must exist in the taxonomy');
  for (const bad of [null, 'mul:5:4', {}, [], { id: 'mul:5:4' }, { ...record, successes: -1 }, { ...record, successes: 1.5 }, { ...record, failures: '2' }, { ...record, intervalDays: -1 }, { ...record, intervalDays: '2' }, { ...record, lastReviewedAt: 'nope' }, { ...record, lastReviewedAt: 12 }, { ...record, nextReviewAt: null }]) {
    assert.equal(sanitizeImportedSkillReview(bad), null);
  }
});

test('imports drop malformed and unknown-version records silently but count them', withStub(async data => {
  const good = [
    skillReviewRecord('mul:5:4', null, true, T0),
    skillReviewRecord('div:5:9', null, false, T0),
    skillReviewRecord('add:0:0', null, true, T0),
    skillReviewRecord('sub:9:9', null, true, T0),
  ];
  const junk = [
    null, 'record', {},
    { ...good[0], taxonomyVersion: 'skill-taxonomy-v9' },
    { ...good[0], successes: 2, nextReviewAt: '9999-01-01T00:00:00Z' },
    { id: 'mul:5:4', taxonomyVersion: SKILL_TAXONOMY_VERSION }, // no counters at all
  ];
  const result = await importSkillReviews([...good, ...junk]);
  assert.deepEqual(result, { imported: 4, dropped: 6, total: 10 });
  const stored = await listSkillReviews();
  assert.equal(stored.length, 4, 'only clean records persist');
  assert.deepEqual(new Set(stored.map(r => r.id)), new Set(['mul:5:4', 'div:5:9', 'add:0:0', 'sub:9:9']));
  assert.ok(Array.isArray(JSON.parse(data['zetamaster-skill-reviews-v1'])), 'fallback key mirrors the sessions key');
  // Re-importing the same skill replaces its record instead of duplicating it.
  const updated = skillReviewRecord('mul:5:4', good[0], true, T0);
  await importSkillReviews([updated]);
  const after = await listSkillReviews();
  assert.equal(after.length, 4);
  assert.equal(after.find(r => r.id === 'mul:5:4').successes, 2);
}));

test('sessions and skill records live in separate namespaces and cannot cross over', withStub(async data => {
  assert.equal(await importSessions([skillReviewRecord('mul:5:4', null, true, T0)]), 0, 'a skill record is not a session');
  assert.equal(data['zetamaster-sessions-v1'], undefined, 'rejected imports never write session storage');
  const skillImport = await importSkillReviews([JSON.parse(JSON.stringify(playBenchmark()))]);
  assert.equal(skillImport.imported, 0, 'a session is not a skill record');
  assert.equal(skillImport.dropped, 1);
  assert.equal(data['zetamaster-skill-reviews-v1'], undefined, 'rejected imports never write review storage');
  // Round trip one of each through its own namespace; the fallback keys stay separate.
  assert.equal(await importSessions([JSON.parse(JSON.stringify(playBenchmark()))]), 1, 'played session imports through the session path');
  await saveSkillReview(skillReviewRecord('mul:5:4', null, true, T0));
  assert.equal((await listSessions()).length, 1);
  assert.equal((await listSkillReviews()).length, 1);
  assert.ok('zetamaster-sessions-v1' in data && 'zetamaster-skill-reviews-v1' in data);
}));

test('export bundle shape includes skill records and parses both shapes', () => {
  const record = BASE_RECORD();
  const bundle = exportBundle([playBenchmark()], [record]);
  assert.equal(bundle.schema, 'zetamaster-export-v3', 'v3 adds dailyPlans; v1/v2 inputs still parse');
  assert.ok(bundle.exportedAt.startsWith('2026'));
  assert.equal(bundle.sessions.length, 1);
  assert.deepEqual(bundle.skillReviews, [record]);
  assert.equal(parseExportBundle(bundle.sessions), bundle.sessions, 'legacy v1 arrays pass through');
  assert.deepEqual(parseExportBundle(JSON.parse(JSON.stringify(bundle))), JSON.parse(JSON.stringify(bundle.sessions)), 'bundle exposes the sessions array');
  assert.deepEqual(parseExportBundle({ sessions: [1, 2] }), [1, 2]);
  assert.deepEqual(JSON.parse(JSON.stringify(parseExportBundle({ sessions: [{ x: 1 }], skillReviews: [record] }))), [{ x: 1 }]);
  for (const bad of [null, {}, '[],', { sessions: 'not-array' }, { skillReviews: [record] }]) assert.equal(parseExportBundle(bad), null, 'no sessions, no import');
});

test('recordSkillReview composes scheduleReview deterministically and persists', withStub(async () => {
  const first = await recordSkillReview('mul:5:4', true, T0);
  assert.deepEqual(first, BASE_RECORD());
  const second = await recordSkillReview('mul:5:4', true, T0);
  assert.equal(second.intervalDays, 2, 'streak grows with the existing stored record');
  const stored = await listSkillReviews();
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0], second);
  // Determinism for a fresh skill: same inputs, same record — no wall-clock leakage in the math.
  assert.deepEqual(await recordSkillReview('div:5:9', true, T0), skillReviewRecord('div:5:9', null, true, T0));
}));

test('saveSkillReview replaces by id and every taxonomy record fits under the fallback cap', withStub(async data => {
  await saveSkillReview(BASE_RECORD());
  const other = skillReviewRecord('add:0:0', null, true, T0);
  await saveSkillReview(other);
  let list = await listSkillReviews();
  assert.deepEqual(list.map(r => r.id).sort(), ['add:0:0', 'mul:5:4'], 'replace-by-id, never duplicates');
  // The whole 420-cell taxonomy coexists under the 500-record fallback cap.
  let count = 0;
  for (const op of ['add', 'sub', 'mul', 'div']) {
    const layout = heatmapLayout(op);
    for (let r = 0; r < layout.rows.length; r++) for (let c = 0; c < layout.cols.length; c++) {
      await saveSkillReview(skillReviewRecord(`${op}:${r}:${c}`, null, ++count % 2 === 0, T0));
    }
  }
  const all = await listSkillReviews();
  assert.equal(all.length, count, "every taxonomy record coexists under the cap");
  assert.ok(all.every(r => r.taxonomyVersion === SKILL_TAXONOMY_VERSION));
}));
