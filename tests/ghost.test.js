import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGhostTrajectory,
  ghostScoreAt,
  compareGhostPace,
  selectPersonalBestBenchmark,
} from '../packages/analytics/src/ghost.js';

// Personal-best ghost racing (F33, M4):
// Optional cumulative pace visualization derived from stored benchmark run.

test('buildGhostTrajectory constructs cumulative step checkpoints from benchmark session', () => {
  const session = {
    id: 's-1',
    mode: 'benchmark',
    benchmark: true,
    score: 3,
    elapsedMs: 120000,
    startedAt: '2026-10-18T10:00:00Z',
    events: [
      { responseMs: 1500, correct: true },
      { responseMs: 2000, correct: false },
      { responseMs: 1500, correct: true },
      { responseMs: 3000, correct: true },
    ],
  };

  const ghost = buildGhostTrajectory(session);
  assert.ok(ghost);
  assert.equal(ghost.sessionId, 's-1');
  assert.equal(ghost.durationMs, 120000);
  assert.equal(ghost.finalScore, 3);
  assert.ok(ghost.checkpoints.length >= 4);

  // Checkpoints: (0,0), (1500, 1), (5000, 2), (8000, 3), (120000, 3)
  assert.deepEqual(ghost.checkpoints[0], { elapsedMs: 0, score: 0 });
  assert.deepEqual(ghost.checkpoints[1], { elapsedMs: 1500, score: 1 });
  assert.deepEqual(ghost.checkpoints[2], { elapsedMs: 5000, score: 2 });
  assert.deepEqual(ghost.checkpoints[3], { elapsedMs: 8000, score: 3 });

  // Non-benchmark sessions or sessions without events return null
  assert.equal(buildGhostTrajectory(null), null);
  assert.equal(buildGhostTrajectory({ benchmark: false, events: [] }), null);
  assert.equal(buildGhostTrajectory({ benchmark: true, events: null }), null);
});

test('ghostScoreAt returns step-interpolated score at any elapsed time', () => {
  const ghost = {
    durationMs: 120000,
    finalScore: 3,
    checkpoints: [
      { elapsedMs: 0, score: 0 },
      { elapsedMs: 1500, score: 1 },
      { elapsedMs: 5000, score: 2 },
      { elapsedMs: 8000, score: 3 },
      { elapsedMs: 120000, score: 3 },
    ],
  };

  assert.equal(ghostScoreAt(ghost, 0), 0);
  assert.equal(ghostScoreAt(ghost, 1000), 0);
  assert.equal(ghostScoreAt(ghost, 1500), 1);
  assert.equal(ghostScoreAt(ghost, 4999), 1);
  assert.equal(ghostScoreAt(ghost, 5000), 2);
  assert.equal(ghostScoreAt(ghost, 7999), 2);
  assert.equal(ghostScoreAt(ghost, 8000), 3);
  assert.equal(ghostScoreAt(ghost, 60000), 3);
  assert.equal(ghostScoreAt(ghost, 130000), 3); // clamped at duration

  // Gracefully handles empty or null trajectory
  assert.equal(ghostScoreAt(null, 5000), 0);
  assert.equal(ghostScoreAt({ checkpoints: [] }, 5000), 0);
});

test('compareGhostPace evaluates live pace ahead/behind/tied against ghost', () => {
  const ghost = {
    durationMs: 120000,
    finalScore: 40,
    checkpoints: [
      { elapsedMs: 0, score: 0 },
      { elapsedMs: 30000, score: 10 },
      { elapsedMs: 60000, score: 20 },
      { elapsedMs: 90000, score: 30 },
      { elapsedMs: 120000, score: 40 },
    ],
  };

  // Ahead of pace at 60s
  const ahead = compareGhostPace(25, 60000, ghost);
  assert.equal(ahead.currentScore, 25);
  assert.equal(ahead.ghostScore, 20);
  assert.equal(ahead.delta, 5);
  assert.equal(ahead.status, 'ahead');
  assert.equal(ahead.projectedFinal, 50); // (25 / 60) * 120 = 50

  // Behind pace at 60s
  const behind = compareGhostPace(15, 60000, ghost);
  assert.equal(behind.delta, -5);
  assert.equal(behind.status, 'behind');

  // Tied pace at 60s
  const tied = compareGhostPace(20, 60000, ghost);
  assert.equal(tied.delta, 0);
  assert.equal(tied.status, 'tied');

  assert.equal(compareGhostPace(20, 60000, null), null);
});

test('selectPersonalBestBenchmark chooses the highest-scoring verified benchmark', () => {
  const sessions = [
    { id: 'p1', benchmark: false, score: 80, events: [{ responseMs: 1000, correct: true }] },
    { id: 'b1', benchmark: true, score: 45, events: [{ responseMs: 1000, correct: true }], startedAt: '2026-10-18T10:00:00Z' },
    { id: 'b2', benchmark: true, score: 62, events: [{ responseMs: 1000, correct: true }], startedAt: '2026-10-18T11:00:00Z' },
    { id: 'b3', benchmark: true, score: 55, events: [{ responseMs: 1000, correct: true }], startedAt: '2026-10-18T12:00:00Z' },
  ];

  const best = selectPersonalBestBenchmark(sessions);
  assert.equal(best.id, 'b2');
  assert.equal(best.score, 62);

  assert.equal(selectPersonalBestBenchmark([]), null);
  assert.equal(selectPersonalBestBenchmark([{ benchmark: false, score: 70 }]), null);
});
