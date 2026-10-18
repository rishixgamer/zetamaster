import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeTrainingVolume,
  recommendVolume,
  DEFAULT_DAILY_BUDGET_MINUTES,
  MAX_SAFE_DAILY_MINUTES,
  FATIGUE_SLOWDOWN_THRESHOLD,
} from '../packages/training/src/volume.js';

// Adaptive training volume (F36, M4):
// Monitor signs of slowdown; recommendations never force continued practice.

test('analyzeTrainingVolume calculates daily practice minutes and detects latency slowdown', () => {
  const baseTime = Date.parse('2026-10-18T16:00:00Z');

  // Three sessions today: session 1 fast (1200ms), session 2 normal (1300ms), session 3 slow (1800ms)
  const sessions = [
    {
      startedAt: '2026-10-18T10:00:00Z',
      elapsedMs: 120000,
      events: [
        { responseMs: 1200, correct: true },
        { responseMs: 1200, correct: true },
      ],
    },
    {
      startedAt: '2026-10-18T12:00:00Z',
      elapsedMs: 120000,
      events: [
        { responseMs: 1300, correct: true },
        { responseMs: 1300, correct: true },
      ],
    },
    {
      startedAt: '2026-10-18T15:30:00Z',
      elapsedMs: 120000,
      events: [
        { responseMs: 1800, correct: true },
        { responseMs: 1800, correct: true },
      ],
    },
  ];

  const analysis = analyzeTrainingVolume(sessions, { now: baseTime });
  assert.equal(analysis.sessionCount, 3);
  assert.equal(analysis.todayMinutes, 6); // 3 * 2 min = 6 min
  assert.equal(analysis.slowdownDetected, true); // 1800 / 1200 = 1.5 >= 1.2
  assert.ok(analysis.fatigueRatio >= FATIGUE_SLOWDOWN_THRESHOLD);
});

test('recommendVolume prioritizes rest on cognitive slowdown and never forces practice', () => {
  // Case 1: Slowdown detected
  const fatiguedAnalysis = {
    todayMinutes: 8,
    slowdownDetected: true,
    fatigueRatio: 1.35,
  };
  const recFatigued = recommendVolume(fatiguedAnalysis);
  assert.equal(recFatigued.action, 'rest-recommended');
  assert.equal(recFatigued.recommendedMinutes, 0);
  assert.equal(recFatigued.neverForce, true);
  assert.equal(recFatigued.isOptional, true);
  assert.equal(recFatigued.restDayAllowed, true);
  assert.match(recFatigued.reason, /slowdown/i);

  // Case 2: Daily cap reached (e.g. 32 min)
  const cappedAnalysis = {
    todayMinutes: 32,
    slowdownDetected: false,
    fatigueRatio: 1.05,
  };
  const recCapped = recommendVolume(cappedAnalysis);
  assert.equal(recCapped.action, 'daily-cap-reached');
  assert.equal(recCapped.recommendedMinutes, 0);
  assert.equal(recCapped.neverForce, true);

  // Case 3: Target achieved (e.g. 15 min)
  const achievedAnalysis = {
    todayMinutes: 15,
    slowdownDetected: false,
    fatigueRatio: 1.0,
  };
  const recAchieved = recommendVolume(achievedAnalysis);
  assert.equal(recAchieved.action, 'target-achieved');
  assert.equal(recAchieved.recommendedMinutes, 0);

  // Case 4: Fresh user with remaining budget (e.g. 5 min done of 15 min target)
  const freshAnalysis = {
    todayMinutes: 5,
    slowdownDetected: false,
    fatigueRatio: 1.02,
  };
  const recFresh = recommendVolume(freshAnalysis);
  assert.equal(recFresh.action, 'standard-practice');
  assert.equal(recFresh.recommendedMinutes, 10);
  assert.equal(recFresh.neverForce, true);
  assert.equal(recFresh.restDayAllowed, true);
});

test('empty or sparse session histories degrade gracefully', () => {
  const emptyAnalysis = analyzeTrainingVolume([]);
  assert.equal(emptyAnalysis.sessionCount, 0);
  assert.equal(emptyAnalysis.todayMinutes, 0);
  assert.equal(emptyAnalysis.slowdownDetected, false);

  const rec = recommendVolume(emptyAnalysis);
  assert.equal(rec.recommendedMinutes, DEFAULT_DAILY_BUDGET_MINUTES);
  assert.equal(rec.neverForce, true);
});
