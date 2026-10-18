import { median } from '../../analytics/src/stats.js';
import { benchmarkSeries, goalStatus } from '../../analytics/src/consistency.js';

/**
 * Skill Progression Ladder (F35, M3 close-out).
 *
 * Defines explicit 30 → 40 → 50 → 60 → 70+ milestone stages guided by rolling median benchmarks:
 * - Foundation (0–29): focus on accuracy, basic operation techniques, clean input.
 * - Fluency (30–39): focus on automaticity, table facts, reducing pauses.
 * - Speed (40–49): focus on high-tempo sprint intervals, tail reduction.
 * - Optimization (50–59): focus on weakness gauntlet, strategy duels, bottleneck elimination.
 * - Mastery (60–70+): focus on sustained 70+ consistency (8-of-10 runs ≥ 70).
 *
 * All progression metrics are derived strictly from verified standard benchmark runs.
 * Practice runs, drills, and unverified imports never alter the ladder standing.
 */

export const MIN_PROGRESSION_BENCHMARKS = 3;
export const DEFAULT_PROGRESSION_WINDOW = 10;

export const PROGRESSION_STAGES = Object.freeze([
  {
    id: 'foundation',
    name: 'Foundation',
    level: 1,
    minScore: 0,
    targetScore: 30,
    focus: 'Accuracy & technique foundations',
    description: 'Establish clean input, avoid wrong attempts, and master core single-operation techniques.',
    recommendedActions: ['addition-round', 'subtract-round', 'multiply-five'],
  },
  {
    id: 'fluency',
    name: 'Fluency',
    level: 2,
    minScore: 30,
    targetScore: 40,
    focus: 'Fact automaticity & hesitation reduction',
    description: 'Eliminate hesitation on multiplication tables and round-number additions.',
    recommendedActions: ['multiply-eleven', 'multiply-distribute', 'automaticity-drills'],
  },
  {
    id: 'speed',
    name: 'Speed',
    level: 3,
    minScore: 40,
    targetScore: 50,
    focus: 'Pacing intervals & tail reduction',
    description: 'Compress response-time distribution and train with 30s sprint intervals.',
    recommendedActions: ['speed-intervals', 'complement-100', 'tail-reduction'],
  },
  {
    id: 'optimization',
    name: 'Optimization',
    level: 4,
    minScore: 50,
    targetScore: 60,
    focus: 'Weakness gauntlet & strategy duels',
    description: 'Target persistent bottleneck cells and select optimal mental shortcuts.',
    recommendedActions: ['weakness-gauntlet', 'strategy-duels', 'divide-inverse'],
  },
  {
    id: 'mastery',
    name: 'Mastery',
    level: 5,
    minScore: 60,
    targetScore: 70,
    focus: 'Sustained 70+ consistency',
    description: 'Maintain 70+ across consecutive standard runs; achieve the 8-of-10 consistency goal.',
    recommendedActions: ['standard-benchmark', 'consistency-protocol', 'fatigue-resistance'],
  },
]);

/** Return the stage matching a given score */
export function getStageForScore(score) {
  if (!Number.isFinite(score)) return PROGRESSION_STAGES[0];
  if (score < 30) return PROGRESSION_STAGES[0];
  if (score < 40) return PROGRESSION_STAGES[1];
  if (score < 50) return PROGRESSION_STAGES[2];
  if (score < 60) return PROGRESSION_STAGES[3];
  return PROGRESSION_STAGES[4];
}

/** Return stage by id */
export function getProgressionStage(stageId) {
  return PROGRESSION_STAGES.find(s => s.id === stageId) ?? null;
}

/**
 * Evaluate progression stage from historical sessions.
 * Only verified benchmark sessions are counted.
 */
export function evaluateProgression(sessions = [], { window = DEFAULT_PROGRESSION_WINDOW, minRuns = MIN_PROGRESSION_BENCHMARKS } = {}) {
  const series = benchmarkSeries(sessions);
  const scores = series.map(s => s.score);
  const count = scores.length;

  if (count < minRuns) {
    return {
      status: 'establishing-baseline',
      stage: PROGRESSION_STAGES[0],
      nextStage: PROGRESSION_STAGES[1],
      medianScore: count > 0 ? median(scores) : null,
      benchmarkCount: count,
      minRunsNeeded: minRuns,
      runsRemaining: minRuns - count,
      pointsToNext: null,
      progressPct: 0,
      mastery70Met: false,
      note: `Complete at least ${minRuns} standard benchmark sessions to establish a stable ladder stage (${count}/${minRuns} recorded).`,
    };
  }

  const recentScores = scores.slice(-window);
  const medianScore = median(recentScores);
  const currentStage = getStageForScore(medianScore);
  const currentIndex = PROGRESSION_STAGES.findIndex(s => s.id === currentStage.id);
  const nextStage = currentIndex < PROGRESSION_STAGES.length - 1 ? PROGRESSION_STAGES[currentIndex + 1] : null;

  const pointsToNext = nextStage ? Math.max(0, currentStage.targetScore - medianScore) : 0;
  const stageRange = currentStage.targetScore - currentStage.minScore;
  const progressPct = stageRange > 0
    ? Math.min(100, Math.max(0, Math.round(((medianScore - currentStage.minScore) / stageRange) * 100)))
    : 100;

  const consistency = goalStatus(scores);

  return {
    status: 'active',
    stage: currentStage,
    nextStage,
    medianScore,
    benchmarkCount: count,
    windowRuns: recentScores.length,
    pointsToNext,
    progressPct,
    mastery70Met: consistency.met,
    consistency,
    note: nextStage
      ? `Current median is ${medianScore.toFixed(1)} (${currentStage.name}). Reach median ${currentStage.targetScore} to advance to ${nextStage.name}.`
      : (consistency.met
        ? `Mastery achieved: trailing median is ${medianScore.toFixed(1)} and 8-of-10 consistency goal is met!`
        : `Mastery tier active (median ${medianScore.toFixed(1)}). Complete 8 of 10 runs ≥ 70 to lock in full mastery.`),
  };
}
