import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRESSION_STAGES,
  MIN_PROGRESSION_BENCHMARKS,
  getStageForScore,
  getProgressionStage,
  evaluateProgression,
} from '../packages/training/src/progression.js';

// Skill progression ladder (F35, M3 close-out):
// Explicit 30 → 40 → 50 → 60 → 70+ milestone stages guided by median benchmarks.

test('progression stages define the five milestone tiers with explicit thresholds', () => {
  assert.equal(PROGRESSION_STAGES.length, 5);
  const ids = PROGRESSION_STAGES.map(s => s.id);
  assert.deepEqual(ids, ['foundation', 'fluency', 'speed', 'optimization', 'mastery']);

  // Check explicit 30 → 40 → 50 → 60 → 70 progression thresholds
  assert.equal(PROGRESSION_STAGES[0].targetScore, 30);
  assert.equal(PROGRESSION_STAGES[1].minScore, 30);
  assert.equal(PROGRESSION_STAGES[1].targetScore, 40);
  assert.equal(PROGRESSION_STAGES[2].minScore, 40);
  assert.equal(PROGRESSION_STAGES[2].targetScore, 50);
  assert.equal(PROGRESSION_STAGES[3].minScore, 50);
  assert.equal(PROGRESSION_STAGES[3].targetScore, 60);
  assert.equal(PROGRESSION_STAGES[4].minScore, 60);
  assert.equal(PROGRESSION_STAGES[4].targetScore, 70);

  for (const stage of PROGRESSION_STAGES) {
    assert.ok(stage.name.length > 0);
    assert.ok(stage.focus.length > 0);
    assert.ok(stage.description.length > 0);
    assert.ok(Array.isArray(stage.recommendedActions) && stage.recommendedActions.length > 0);
  }
});

test('getStageForScore maps benchmark scores to correct tiers', () => {
  assert.equal(getStageForScore(0).id, 'foundation');
  assert.equal(getStageForScore(25).id, 'foundation');
  assert.equal(getStageForScore(29.5).id, 'foundation');

  assert.equal(getStageForScore(30).id, 'fluency');
  assert.equal(getStageForScore(35).id, 'fluency');
  assert.equal(getStageForScore(39).id, 'fluency');

  assert.equal(getStageForScore(40).id, 'speed');
  assert.equal(getStageForScore(45).id, 'speed');
  assert.equal(getStageForScore(49.9).id, 'speed');

  assert.equal(getStageForScore(50).id, 'optimization');
  assert.equal(getStageForScore(58).id, 'optimization');

  assert.equal(getStageForScore(60).id, 'mastery');
  assert.equal(getStageForScore(72).id, 'mastery');
  assert.equal(getStageForScore(100).id, 'mastery');

  // Non-finite scores default safely to foundation
  assert.equal(getStageForScore(NaN).id, 'foundation');
  assert.equal(getStageForScore(null).id, 'foundation');
});

test('getProgressionStage looks up stage definition by id', () => {
  assert.equal(getProgressionStage('speed').name, 'Speed');
  assert.equal(getProgressionStage('mastery').level, 5);
  assert.equal(getProgressionStage('nonexistent'), null);
});

test('evaluating progression with insufficient benchmark data establishes baseline', () => {
  const resultEmpty = evaluateProgression([]);
  assert.equal(resultEmpty.status, 'establishing-baseline');
  assert.equal(resultEmpty.benchmarkCount, 0);
  assert.equal(resultEmpty.runsRemaining, MIN_PROGRESSION_BENCHMARKS);
  assert.equal(resultEmpty.stage.id, 'foundation');

  // Practice sessions must not count toward benchmark baseline
  const practiceSessions = [
    { mode: 'drill', benchmark: false, score: 45, startedAt: '2026-10-18T10:00:00Z' },
    { mode: 'custom', benchmark: false, score: 55, startedAt: '2026-10-18T11:00:00Z' },
  ];
  const resultPracticeOnly = evaluateProgression(practiceSessions);
  assert.equal(resultPracticeOnly.status, 'establishing-baseline');
  assert.equal(resultPracticeOnly.benchmarkCount, 0);
  assert.equal(resultPracticeOnly.runsRemaining, MIN_PROGRESSION_BENCHMARKS);

  // Partial benchmark sessions (below gate)
  const partial = [
    { mode: 'benchmark', benchmark: true, score: 32, startedAt: '2026-10-18T10:00:00Z' },
  ];
  const resultPartial = evaluateProgression(partial);
  assert.equal(resultPartial.status, 'establishing-baseline');
  assert.equal(resultPartial.benchmarkCount, 1);
  assert.equal(resultPartial.runsRemaining, MIN_PROGRESSION_BENCHMARKS - 1);
});

test('active progression accurately evaluates stage, median, points to next, and mastery criteria', () => {
  // Fluency level: 5 runs with scores around 34
  const fluencyRuns = [
    { mode: 'benchmark', benchmark: true, score: 32, startedAt: '2026-10-18T10:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 35, startedAt: '2026-10-18T11:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 34, startedAt: '2026-10-18T12:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 36, startedAt: '2026-10-18T13:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 33, startedAt: '2026-10-18T14:00:00Z' },
  ];
  const evalFluency = evaluateProgression(fluencyRuns);
  assert.equal(evalFluency.status, 'active');
  assert.equal(evalFluency.stage.id, 'fluency');
  assert.equal(evalFluency.nextStage.id, 'speed');
  assert.equal(evalFluency.medianScore, 34);
  assert.equal(evalFluency.pointsToNext, 6); // 40 - 34 = 6
  assert.equal(evalFluency.progressPct, 40); // (34 - 30) / (40 - 30) * 100 = 40%
  assert.equal(evalFluency.mastery70Met, false);

  // Speed level: scores around 46
  const speedRuns = [
    { mode: 'benchmark', benchmark: true, score: 44, startedAt: '2026-10-18T15:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 46, startedAt: '2026-10-18T16:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 45, startedAt: '2026-10-18T17:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 47, startedAt: '2026-10-18T18:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 48, startedAt: '2026-10-18T19:00:00Z' },
  ];
  const evalSpeed = evaluateProgression(speedRuns);
  assert.equal(evalSpeed.stage.id, 'speed');
  assert.equal(evalSpeed.nextStage.id, 'optimization');
  assert.equal(evalSpeed.medianScore, 46);
  assert.equal(evalSpeed.pointsToNext, 4);

  // Optimization level: scores around 55
  const optRuns = [
    { mode: 'benchmark', benchmark: true, score: 53, startedAt: '2026-10-18T20:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 55, startedAt: '2026-10-18T21:00:00Z' },
    { mode: 'benchmark', benchmark: true, score: 56, startedAt: '2026-10-18T22:00:00Z' },
  ];
  const evalOpt = evaluateProgression(optRuns);
  assert.equal(evalOpt.stage.id, 'optimization');
  assert.equal(evalOpt.nextStage.id, 'mastery');

  // Mastery level: 10 runs with 8 >= 70
  const masteryRuns = Array.from({ length: 10 }, (_, i) => ({
    mode: 'benchmark',
    benchmark: true,
    score: i < 2 ? 68 : 72 + i,
    startedAt: `2026-10-18T${String(10 + i).padStart(2, '0')}:00:00Z`,
  }));
  const evalMastery = evaluateProgression(masteryRuns);
  assert.equal(evalMastery.stage.id, 'mastery');
  assert.equal(evalMastery.nextStage, null);
  assert.equal(evalMastery.pointsToNext, 0);
  assert.equal(evalMastery.progressPct, 100);
  assert.equal(evalMastery.mastery70Met, true);
});
