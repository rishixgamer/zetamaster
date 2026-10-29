import { median, percentile } from '../../analytics/src/stats.js';
import { benchmarkSeries } from '../../analytics/src/consistency.js';

/**
 * Community Ranking System (F44, Milestone M5).
 *
 * Implements sustained verified benchmark ranks strictly isolated from practice modes.
 *
 * Key Design Invariants:
 * 1. Benchmark-Only Isolation: Practice modes (drills, sprints, endurance, custom, etc.)
 *    are NEVER included in rank calculation.
 * 2. Minimum Verification Gate: Requires at least 5 completed, verified standard 120s
 *    benchmark sessions to establish a sustained rank.
 * 3. Sustained Rolling Median: Rather than a single lucky spike, rank is determined
 *    by the rolling median of the player's trailing verified benchmarks (window of up to 10).
 * 4. Stability Metric: Computes interquartile spread (p75 - p25) to measure performance
 *    consistency across benchmark runs.
 */

export const MIN_VERIFIED_BENCHMARKS = 5;
export const DEFAULT_RANK_WINDOW = 10;

export const COMMUNITY_RANKS = Object.freeze([
  {
    id: 'unranked',
    level: 0,
    title: 'Unranked',
    minScore: 0,
    maxScore: 0,
    badge: '⚪',
    description: 'Complete at least 5 standard 120s benchmarks to calibrate a sustained rank.',
  },
  {
    id: 'novice',
    level: 1,
    title: 'Novice',
    minScore: 0,
    maxScore: 29,
    badge: '🌱',
    description: 'Foundational arithmetic rhythm. Sustained pace below 30 solves per 120s.',
  },
  {
    id: 'apprentice',
    level: 2,
    title: 'Apprentice',
    minScore: 30,
    maxScore: 39,
    badge: '🥉',
    description: 'Fluency emerging across operations. Sustained pace of 30–39 solves per 120s.',
  },
  {
    id: 'practitioner',
    level: 3,
    title: 'Practitioner',
    minScore: 40,
    maxScore: 49,
    badge: '🥈',
    description: 'Solid automaticity and high pacing. Sustained pace of 40–49 solves per 120s.',
  },
  {
    id: 'adept',
    level: 4,
    title: 'Adept',
    minScore: 50,
    maxScore: 59,
    badge: '🥇',
    description: 'Optimized calculation shortcuts with minimal stalls. Sustained pace of 50–59 solves.',
  },
  {
    id: 'expert',
    level: 5,
    title: 'Expert',
    minScore: 60,
    maxScore: 69,
    badge: '💎',
    description: 'Exceptional speed and mental agility. Sustained pace of 60–69 solves.',
  },
  {
    id: 'master',
    level: 6,
    title: 'Master',
    minScore: 70,
    maxScore: 79,
    badge: '🏆',
    description: 'Consistent 70+ performance meeting the benchmark mastery threshold.',
  },
  {
    id: 'grandmaster',
    level: 7,
    title: 'Grandmaster',
    minScore: 80,
    maxScore: Infinity,
    badge: '👑',
    description: 'Pinnacle mental arithmetic mastery. Sustained pace of 80+ solves per 120s.',
  },
]);

/**
 * Maps a sustained score value to its corresponding COMMUNITY_RANKS tier.
 */
export function getRankForScore(score) {
  if (!Number.isFinite(score)) return COMMUNITY_RANKS[0]; // unranked
  for (let i = COMMUNITY_RANKS.length - 1; i >= 1; i--) {
    const tier = COMMUNITY_RANKS[i];
    if (score >= tier.minScore) return tier;
  }
  return COMMUNITY_RANKS[1]; // novice
}

/**
 * Stored verified benchmarks, oldest first. Practice and non-finite scores stay out.
 * A repeated seed stays in this list: achievements read it. Rank does not — see
 * `evaluateBenchmarkRank`, which uses the score series and drops later copies.
 */
export function filterVerifiedBenchmarks(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions.filter(s => s.benchmark === true && Number.isFinite(s.score))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((s, i) => ({ run: i + 1, score: s.score, at: s.startedAt }));
}

/**
 * Summarize practice activity separately from benchmark rankings.
 */
export function evaluatePracticeActivity(sessions) {
  if (!Array.isArray(sessions)) return { sessionsCount: 0, totalSolves: 0, modes: {} };
  const practiceSessions = sessions.filter(s => s && s.benchmark !== true);
  const modes = {};
  let totalSolves = 0;

  for (const s of practiceSessions) {
    const mode = s.mode || 'custom';
    modes[mode] = (modes[mode] || 0) + 1;
    totalSolves += Number.isFinite(s.score) ? s.score : 0;
  }

  return {
    sessionsCount: practiceSessions.length,
    totalSolves,
    modes,
    notice: 'Practice and drill activity is tracked for skill growth and never contaminates verified benchmark rankings.',
  };
}

/**
 * Evaluates the community rank based on the player's verified benchmark sessions.
 *
 * @param {Array<object>} sessions - Session history records
 * @param {object} [options]
 * @param {number} [options.window=10] - Number of trailing benchmarks in rolling evaluation
 * @returns {object} Rank evaluation result
 */
export function evaluateBenchmarkRank(sessions, { window = DEFAULT_RANK_WINDOW } = {}) {
  // Score series, not the achievement list: a later run on the same seed does not move rank.
  const verified = Array.isArray(sessions) ? benchmarkSeries(sessions) : [];
  const verifiedCount = verified.length;

  if (verifiedCount < MIN_VERIFIED_BENCHMARKS) {
    return {
      calibrated: false,
      rank: COMMUNITY_RANKS[0],
      sustainedScore: null,
      verifiedCount,
      minRequired: MIN_VERIFIED_BENCHMARKS,
      runsNeeded: MIN_VERIFIED_BENCHMARKS - verifiedCount,
      recentScores: verified.map(v => v.score),
      stability: null,
      nextRank: COMMUNITY_RANKS[1],
      pointsToNext: null,
      isolationNotice: 'Practice scores never affect rank. Only verified 120s standard benchmarks qualify.',
    };
  }

  const trailing = verified.slice(-window);
  const scores = trailing.map(v => v.score);
  const sustained = median(scores);
  const rank = getRankForScore(sustained);

  // Compute stability: p75 - p25 IQR
  const p75 = percentile(scores, 0.75);
  const p25 = percentile(scores, 0.25);
  const iqr = Number.isFinite(p75) && Number.isFinite(p25) ? p75 - p25 : 0;

  const nextTierIndex = COMMUNITY_RANKS.findIndex(r => r.id === rank.id) + 1;
  const nextRank = nextTierIndex < COMMUNITY_RANKS.length ? COMMUNITY_RANKS[nextTierIndex] : null;
  const pointsToNext = nextRank ? Math.max(0, nextRank.minScore - sustained) : 0;

  return {
    calibrated: true,
    rank,
    sustainedScore: sustained,
    verifiedCount,
    minRequired: MIN_VERIFIED_BENCHMARKS,
    runsNeeded: 0,
    windowEvaluated: trailing.length,
    recentScores: scores,
    stability: {
      iqr,
      p25,
      p75,
      min: Math.min(...scores),
      max: Math.max(...scores),
      isConsistent: iqr <= 6,
    },
    nextRank,
    pointsToNext,
    isolationNotice: 'Practice scores never affect rank. Only verified 120s standard benchmarks qualify.',
  };
}

/**
 * Unified RankPolicy contract.
 */
export const RankPolicy = Object.freeze({
  evaluate: evaluateBenchmarkRank,
  evaluatePractice: evaluatePracticeActivity,
  getRankForScore,
  filterVerifiedBenchmarks,
  ranks: COMMUNITY_RANKS,
});
