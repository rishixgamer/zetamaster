import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENT_CATALOG,
  evaluateAchievements,
} from '../packages/community/src/achievements.js';

test('achievement catalog contains skill-based goals with explicit criteria', () => {
  assert.ok(ACHIEVEMENT_CATALOG.length >= 10);
  for (const ach of ACHIEVEMENT_CATALOG) {
    assert.ok(ach.id.length > 0);
    assert.ok(ach.title.length > 0);
    assert.ok(ach.description.length > 0);
    assert.ok(typeof ach.evaluate === 'function');
  }
});

test('empty history unlocks zero achievements', () => {
  const result = evaluateAchievements([], { skillReviews: [] });
  assert.equal(result.totalUnlocked, 0);
  assert.equal(result.completionPercentage, 0);
  assert.equal(result.unlocked.length, 0);
  assert.equal(result.locked.length, ACHIEVEMENT_CATALOG.length);
});

test('first benchmark and pace achievements unlock upon meeting verified thresholds', () => {
  const session = {
    score: 52,
    mode: 'benchmark',
    benchmark: true,
    elapsedMs: 120000,
    startedAt: '2026-10-18T10:00:00Z',
    events: [
      { op: 'add', correct: true, responseMs: 950 },
      { op: 'mul', correct: true, responseMs: 450 },
    ],
  };

  const res = evaluateAchievements([session]);
  const unlockedIds = res.unlocked.map(a => a.id);

  assert.ok(unlockedIds.includes('first_benchmark'));
  assert.ok(unlockedIds.includes('pace_30'));
  assert.ok(unlockedIds.includes('pace_50'));
  assert.ok(!unlockedIds.includes('pace_70'));
  assert.ok(unlockedIds.includes('sub_second_solve'));
  assert.ok(unlockedIds.includes('lightning_solve'));
});

test('clean benchmark requires zero wrong attempts and score >= 30', () => {
  const dirty = {
    score: 40,
    mode: 'benchmark',
    benchmark: true,
    elapsedMs: 120000,
    startedAt: '2026-10-18T10:00:00Z',
    events: [
      { op: 'add', correct: true, responseMs: 1200, wrongSubmissions: 1 },
      ...Array.from({ length: 39 }, () => ({ op: 'add', correct: true, responseMs: 1200 })),
    ],
  };

  const clean = {
    score: 35,
    mode: 'benchmark',
    benchmark: true,
    elapsedMs: 120000,
    startedAt: '2026-10-18T11:00:00Z',
    events: Array.from({ length: 35 }, () => ({ op: 'add', correct: true, responseMs: 1200, wrongSubmissions: 0 })),
  };

  assert.equal(evaluateAchievements([dirty]).unlocked.some(a => a.id === 'clean_benchmark'), false);
  assert.equal(evaluateAchievements([clean]).unlocked.some(a => a.id === 'clean_benchmark'), true);
});

test('quad mastery unlocks only with >= 8 solves in all 4 operations', () => {
  const balanced = {
    score: 36,
    mode: 'benchmark',
    benchmark: true,
    elapsedMs: 120000,
    startedAt: '2026-10-18T12:00:00Z',
    events: [
      ...Array.from({ length: 9 }, () => ({ op: 'add', correct: true, responseMs: 1200 })),
      ...Array.from({ length: 9 }, () => ({ op: 'sub', correct: true, responseMs: 1200 })),
      ...Array.from({ length: 9 }, () => ({ op: 'mul', correct: true, responseMs: 1200 })),
      ...Array.from({ length: 9 }, () => ({ op: 'div', correct: true, responseMs: 1200 })),
    ],
  };

  const res = evaluateAchievements([balanced]);
  assert.ok(res.unlocked.some(a => a.id === 'quad_balanced'));
});

test('taxonomy scholar tracks distinct skill reviews', () => {
  const reviews = Array.from({ length: 10 }, (_, i) => ({
    id: `skill-${i}`,
    lastReviewedAt: '2026-10-18T12:00:00Z',
  }));

  const res = evaluateAchievements([], { skillReviews: reviews });
  assert.ok(res.unlocked.some(a => a.id === 'pattern_scholar'));
});
