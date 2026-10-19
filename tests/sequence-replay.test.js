import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceRows, sequenceSummary, sequencePlayback } from '../packages/analytics/src/sequence.js';
import { makeQuestion } from '../packages/core/src/generator.js';
import { matchesAnswer } from '../packages/core/src/session.js';

// Sequence history (F04, M1 close-out). Pure analytics over immutable session records: rows are
// the recorded question stream in order (never re-ordered, never re-scored), the final unanswered
// problem is flagged and never a solve, engine-1 records without wrong-attempt history read as
// accuracy-unknown (null, never fabricated clean), and the playback payload rebuilds displayed
// problems losslessly from stored source operands via the engine's own makeQuestion.

const solvedEvent = (op, a, b, i, extra = {}) => {
  const q = makeQuestion(op, a, b, i);
  return { ...q, responseMs: 1400 + i * 10, firstInputMs: 300 + i, entryMs: 1100, corrections: 0, wrongSubmissions: 0, fullWrongAnswers: 0, inputChanges: 3, completedAtMs: 1400 + i * 10, correct: true, ...extra };
};

const SESSION = {
  id: 's-1',
  mode: 'benchmark',
  seed: 'seed-α',
  benchmark: true,
  score: 3,
  endedEarly: false,
  events: [
    solvedEvent('mul', 7, 96, 1, { wrongAttempts: [{ value: '691', atMs: 700 }], wrongSubmissions: 1 }),
    solvedEvent('add', 68, 47, 2),
    solvedEvent('div', 8, 36, 3),
  ],
  finalUnanswered: { ...makeQuestion('sub', 47, 29, 4), responseMs: 2500, firstInputMs: null, entryMs: null },
};

test('sequenceRows lists every recorded question in recorded order with the full telemetry', () => {
  const rows = sequenceRows(SESSION);
  assert.equal(rows.length, 4, '3 solves + the final unanswered problem');
  assert.deepEqual(rows.map(r => r.index), [1, 2, 3, 4]);
  assert.equal(rows[0].label, '7 × 96');
  assert.equal(rows[0].answer, 672);
  assert.equal(rows[1].label, '68 + 47');
  assert.equal(rows[2].label, '288 ÷ 8');
  assert.deepEqual(rows[0].wrongAttempts, [{ value: '691', atMs: 700 }]);
  assert.equal(rows[0].wrongSubmissions, 1);
  assert.equal(rows[0].responseMs, 1410);
  assert.ok(rows[0].correct && rows[1].correct && rows[2].correct);
  assert.ok(Array.isArray(rows[0].tags) && rows[0].tags.includes('mul'));
  // The final unanswered problem is flagged and never miscounted as a solve.
  assert.equal(rows[3].unanswered, true);
  assert.equal(rows[3].correct, false);
  assert.equal(rows[3].label, '76 – 47');
});

test('engine-1 records without wrong-attempt history read as accuracy-unknown, not clean', () => {
  const [row] = sequenceRows({ events: [solvedEvent('add', 5, 6, 1)] });
  assert.equal(row.wrongAttempts, null, 'absence of the field is never read as evidence of no errors');
});

test('sequenceSummary degrades gracefully and keeps the benchmark flag exact', () => {
  assert.deepEqual(sequenceSummary(SESSION), {
    mode: 'benchmark', seed: 'seed-α', score: 3, questions: 4, benchmark: true,
    startedAt: null, endedEarly: false,
    note: 'Standard benchmark — the replay of it below is practice, never a new benchmark.',
  });
  assert.equal(sequenceSummary(null).benchmark, false);
  assert.equal(sequenceSummary({}).mode, 'unknown');
  assert.equal(sequenceSummary({ events: [] }).questions, 0);
});

test('sequencePlayback returns lossless source-operand items, unanswered problem last', () => {
  const items = sequencePlayback(SESSION);
  assert.deepEqual(items, [
    { op: 'mul', sourceLeft: 7, sourceRight: 96 },
    { op: 'add', sourceLeft: 68, sourceRight: 47 },
    { op: 'div', sourceLeft: 8, sourceRight: 36 },
    { op: 'sub', sourceLeft: 47, sourceRight: 29 },
  ]);
  // Roundtrip: the game rebuilds each displayed problem from source operands through makeQuestion.
  for (const item of items) {
    const q = makeQuestion(item.op, item.sourceLeft, item.sourceRight, 1);
    assert.ok(Number.isSafeInteger(q.answer) && matchesAnswer(String(q.answer), q.answer));
    if (item.op === 'div') assert.equal(q.sourceLeft * q.sourceRight, q.left);
    if (item.op === 'sub') assert.equal(q.sourceLeft + q.sourceRight, q.left);
  }
});

test('malformed and empty sessions degrade to empty analyses — never a throw', () => {
  assert.deepEqual(sequenceRows(null), []);
  assert.deepEqual(sequenceRows({}), []);
  assert.deepEqual(sequenceRows({ events: [null, undefined, {}, solvedEvent('add', 5, 6, 9)] }).length, 4, 'even blank members become rows, labeled from whatever exists');
  assert.deepEqual(sequencePlayback({}), []);
  assert.deepEqual(sequencePlayback(null), []);
  assert.deepEqual(sequencePlayback({ events: [{ op: 'mul', sourceLeft: 7, sourceRight: 96 }, { op: 'mul', sourceLeft: 7 }], finalUnanswered: null }).length, 1, 'items missing source operands are skipped, not guessed');
});
