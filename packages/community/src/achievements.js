import { filterVerifiedBenchmarks } from './ranks.js';
import { goalStatus } from '../../analytics/src/consistency.js';

/**
 * Skill-Based Achievements Subsystem (F45, Milestone M5).
 *
 * Implements deterministic mastery achievements granted strictly on verified
 * arithmetic events.
 *
 * Explicit Invariants:
 * 1. Zero Idle Time Mechanics: Never rewards raw screen time, idle waiting,
 *    or compulsive login streaks. Every achievement requires verified problem solves.
 * 2. Deterministic Verification: Evaluates pure session records and skill review counters.
 * 3. Transparent Criteria: Every achievement states its concrete requirements and current progress.
 */

export const ACHIEVEMENT_CATALOG = Object.freeze([
  {
    id: 'first_benchmark',
    title: 'First Baseline',
    category: 'benchmark',
    icon: '🏁',
    description: 'Complete your first verified 120s standard benchmark.',
    evaluate(sessions) {
      const verified = filterVerifiedBenchmarks(sessions);
      const current = verified.length;
      const target = 1;
      return {
        unlocked: current >= target,
        progress: Math.min(1, current / target),
        current,
        target,
        unlockedAt: current >= target ? verified[0].at : null,
      };
    },
  },
  {
    id: 'pace_30',
    title: 'Breaking 30',
    category: 'benchmark',
    icon: '🌱',
    description: 'Achieve a verified benchmark score of 30 or higher.',
    evaluate(sessions) {
      const verified = filterVerifiedBenchmarks(sessions);
      const hit = verified.find(v => v.score >= 30);
      const maxScore = verified.reduce((m, v) => Math.max(m, v.score), 0);
      return {
        unlocked: Boolean(hit),
        progress: Math.min(1, maxScore / 30),
        current: maxScore,
        target: 30,
        unlockedAt: hit?.at ?? null,
      };
    },
  },
  {
    id: 'pace_50',
    title: 'Fifty Solves',
    category: 'benchmark',
    icon: '⚡',
    description: 'Achieve a verified benchmark score of 50 or higher.',
    evaluate(sessions) {
      const verified = filterVerifiedBenchmarks(sessions);
      const hit = verified.find(v => v.score >= 50);
      const maxScore = verified.reduce((m, v) => Math.max(m, v.score), 0);
      return {
        unlocked: Boolean(hit),
        progress: Math.min(1, maxScore / 50),
        current: maxScore,
        target: 50,
        unlockedAt: hit?.at ?? null,
      };
    },
  },
  {
    id: 'pace_70',
    title: 'Consistency Target',
    category: 'benchmark',
    icon: '🎯',
    description: 'Achieve a verified benchmark score of 70 or higher.',
    evaluate(sessions) {
      const verified = filterVerifiedBenchmarks(sessions);
      const hit = verified.find(v => v.score >= 70);
      const maxScore = verified.reduce((m, v) => Math.max(m, v.score), 0);
      return {
        unlocked: Boolean(hit),
        progress: Math.min(1, maxScore / 70),
        current: maxScore,
        target: 70,
        unlockedAt: hit?.at ?? null,
      };
    },
  },
  {
    id: 'pace_80',
    title: 'Eighty-in-Two',
    category: 'benchmark',
    icon: '👑',
    description: 'Achieve an elite verified benchmark score of 80 or higher.',
    evaluate(sessions) {
      const verified = filterVerifiedBenchmarks(sessions);
      const hit = verified.find(v => v.score >= 80);
      const maxScore = verified.reduce((m, v) => Math.max(m, v.score), 0);
      return {
        unlocked: Boolean(hit),
        progress: Math.min(1, maxScore / 80),
        current: maxScore,
        target: 80,
        unlockedAt: hit?.at ?? null,
      };
    },
  },
  {
    id: 'clean_benchmark',
    title: 'Flawless Benchmark',
    category: 'accuracy',
    icon: '✨',
    description: 'Complete a verified benchmark with score >= 30 and 0 wrong submissions.',
    evaluate(sessions) {
      const candidates = sessions.filter(
        s => s && s.benchmark === true && s.mode === 'benchmark' && s.score >= 30
      );
      for (const s of candidates) {
        const events = s.events || [];
        const hasWrong = events.some(e => (e.wrongSubmissions || 0) > 0 || (e.corrections || 0) > 0);
        if (!hasWrong && events.length >= 30) {
          return {
            unlocked: true,
            progress: 1,
            current: s.score,
            target: 30,
            unlockedAt: s.startedAt,
          };
        }
      }
      return {
        unlocked: false,
        progress: 0,
        current: 0,
        target: 1,
        unlockedAt: null,
      };
    },
  },
  {
    id: 'sub_second_solve',
    title: 'Sub-Second Reflex',
    category: 'speed',
    icon: '⏱️',
    description: 'Solve an arithmetic problem in under 1000 ms during a verified session.',
    evaluate(sessions) {
      for (const s of sessions) {
        if (!s || !s.benchmark) continue;
        const events = s.events || [];
        const hit = events.find(e => e.correct && e.responseMs < 1000);
        if (hit) {
          return {
            unlocked: true,
            progress: 1,
            current: hit.responseMs,
            target: 1000,
            unlockedAt: s.startedAt,
          };
        }
      }
      return {
        unlocked: false,
        progress: 0,
        current: 0,
        target: 1000,
        unlockedAt: null,
      };
    },
  },
  {
    id: 'lightning_solve',
    title: 'Lightning Draw',
    category: 'speed',
    icon: '⚡',
    description: 'Solve an arithmetic problem in under 500 ms in a verified session.',
    evaluate(sessions) {
      for (const s of sessions) {
        if (!s || !s.benchmark) continue;
        const events = s.events || [];
        const hit = events.find(e => e.correct && e.responseMs < 500);
        if (hit) {
          return {
            unlocked: true,
            progress: 1,
            current: hit.responseMs,
            target: 500,
            unlockedAt: s.startedAt,
          };
        }
      }
      return {
        unlocked: false,
        progress: 0,
        current: 0,
        target: 500,
        unlockedAt: null,
      };
    },
  },
  {
    id: 'quad_balanced',
    title: 'Quad Mastery',
    category: 'breadth',
    icon: '🧮',
    description: 'Solve at least 8 correct questions in each of the 4 operations in a single verified benchmark.',
    evaluate(sessions) {
      for (const s of sessions) {
        if (!s || !s.benchmark || s.mode !== 'benchmark') continue;
        const events = s.events || [];
        const counts = { add: 0, sub: 0, mul: 0, div: 0 };
        for (const e of events) {
          if (e.correct && counts[e.op] !== undefined) counts[e.op]++;
        }
        const minOp = Math.min(counts.add, counts.sub, counts.mul, counts.div);
        if (minOp >= 8) {
          return {
            unlocked: true,
            progress: 1,
            current: minOp,
            target: 8,
            unlockedAt: s.startedAt,
          };
        }
      }
      return {
        unlocked: false,
        progress: 0,
        current: 0,
        target: 8,
        unlockedAt: null,
      };
    },
  },
  {
    id: 'division_specialist',
    title: 'Division Specialist',
    category: 'mastery',
    icon: '➗',
    description: 'Solve at least 15 division questions in a single verified benchmark with 0 division errors.',
    evaluate(sessions) {
      for (const s of sessions) {
        if (!s || !s.benchmark) continue;
        const events = s.events || [];
        const divEvents = events.filter(e => e.op === 'div');
        const correctDiv = divEvents.filter(e => e.correct && !e.wrongSubmissions);
        if (correctDiv.length >= 15 && divEvents.every(e => !e.wrongSubmissions)) {
          return {
            unlocked: true,
            progress: 1,
            current: correctDiv.length,
            target: 15,
            unlockedAt: s.startedAt,
          };
        }
      }
      return {
        unlocked: false,
        progress: 0,
        current: 0,
        target: 15,
        unlockedAt: null,
      };
    },
  },
  {
    id: 'multiplication_surge',
    title: 'Multiplication Surge',
    category: 'mastery',
    icon: '✖️',
    description: 'Solve at least 20 multiplication questions in a single verified benchmark.',
    evaluate(sessions) {
      for (const s of sessions) {
        if (!s || !s.benchmark) continue;
        const mulCorrect = (s.events || []).filter(e => e.op === 'mul' && e.correct).length;
        if (mulCorrect >= 20) {
          return {
            unlocked: true,
            progress: 1,
            current: mulCorrect,
            target: 20,
            unlockedAt: s.startedAt,
          };
        }
      }
      return {
        unlocked: false,
        progress: 0,
        current: 0,
        target: 20,
        unlockedAt: null,
      };
    },
  },
  {
    id: 'sustained_mastery',
    title: 'Sustained Mastery',
    category: 'consistency',
    icon: '🏆',
    description: 'Meet the 8-of-10 70+ verified benchmark consistency goal.',
    evaluate(sessions) {
      const verified = filterVerifiedBenchmarks(sessions);
      const scores = verified.map(v => v.score);
      const status = goalStatus(scores);
      return {
        unlocked: status.met,
        progress: Math.min(1, status.hits / 8),
        current: status.hits,
        target: 8,
        unlockedAt: status.met && verified.length ? verified[verified.length - 1].at : null,
      };
    },
  },
  {
    id: 'century_solves',
    title: 'Century of Solves',
    category: 'mastery',
    icon: '💯',
    description: 'Solve 100 cumulative correct arithmetic questions across verified sessions.',
    evaluate(sessions) {
      let cumulative = 0;
      let hitAt = null;
      for (const s of sessions) {
        if (!s || !s.benchmark) continue;
        const correctCount = (s.events || []).filter(e => e.correct).length;
        cumulative += correctCount;
        if (cumulative >= 100 && !hitAt) {
          hitAt = s.startedAt;
        }
      }
      return {
        unlocked: cumulative >= 100,
        progress: Math.min(1, cumulative / 100),
        current: cumulative,
        target: 100,
        unlockedAt: hitAt,
      };
    },
  },
  {
    id: 'pattern_scholar',
    title: 'Taxonomy Scholar',
    category: 'breadth',
    icon: '📚',
    description: 'Practice and record reviews across at least 8 distinct arithmetic skills.',
    evaluate(sessions, { skillReviews = [] } = {}) {
      const distinctSkills = new Set();
      for (const r of skillReviews) {
        if (r && r.id) distinctSkills.add(r.id);
      }
      const count = distinctSkills.size;
      return {
        unlocked: count >= 8,
        progress: Math.min(1, count / 8),
        current: count,
        target: 8,
        unlockedAt: count >= 8 ? skillReviews[7]?.lastReviewedAt || null : null,
      };
    },
  },
  {
    id: 'automaticity_expert',
    title: 'Automaticity Recall',
    category: 'speed',
    icon: '🚀',
    description: 'Solve at least 25 problems with response time <= 2000 ms in a single session.',
    evaluate(sessions) {
      for (const s of sessions) {
        if (!s) continue;
        const events = s.events || [];
        const autoCount = events.filter(e => e.correct && e.responseMs <= 2000).length;
        if (autoCount >= 25) {
          return {
            unlocked: true,
            progress: 1,
            current: autoCount,
            target: 25,
            unlockedAt: s.startedAt,
          };
        }
      }
      return {
        unlocked: false,
        progress: 0,
        current: 0,
        target: 25,
        unlockedAt: null,
      };
    },
  },
]);

/**
 * Evaluate all achievements against session history and skill reviews.
 */
export function evaluateAchievements(sessions, { skillReviews = [] } = {}) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeReviews = Array.isArray(skillReviews) ? skillReviews : [];

  const results = ACHIEVEMENT_CATALOG.map(def => {
    const outcome = def.evaluate(safeSessions, { skillReviews: safeReviews });
    return {
      id: def.id,
      title: def.title,
      category: def.category,
      icon: def.icon,
      description: def.description,
      unlocked: outcome.unlocked,
      progress: outcome.progress,
      current: outcome.current,
      target: outcome.target,
      unlockedAt: outcome.unlockedAt,
    };
  });

  const unlocked = results.filter(r => r.unlocked);
  const locked = results.filter(r => !r.unlocked);

  return {
    achievements: results,
    unlocked,
    locked,
    totalUnlocked: unlocked.length,
    totalAchievements: results.length,
    completionPercentage: Math.round((unlocked.length / results.length) * 100),
    antiCompulsiveNotice: 'Achievements reward verified mental math accuracy and technique, never idle screen time.',
  };
}

export const AchievementPolicy = Object.freeze({
  evaluate: evaluateAchievements,
  catalog: ACHIEVEMENT_CATALOG,
});
