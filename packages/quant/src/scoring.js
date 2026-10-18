/**
 * Quant Scoring, Analytics & Namespace Isolation (F49–F55, Milestone M6).
 * Quant-only score data CANNOT enter standard benchmark/goal progress even with malformed import.
 * Provides distinct analytics and progress metrics; never blends into a 'Zetamac score'.
 */
import { MODE_NAMESPACE } from '../../contracts/src/schema.js';
import { BENCHMARK_RULES } from '../../core/src/rulesets.js';

export const QUANT_NAMESPACE = MODE_NAMESPACE.quant || 'quant-practice';

/**
 * Checks whether a session belongs to the quant academy namespace.
 */
export function isQuantSession(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.mode === 'quant') return true;
  if (typeof session.rules?.id === 'string' && (session.rules.id.startsWith('quant') || session.rules.id === 'historical-80-in-8')) {
    return true;
  }
  if (session.namespace === QUANT_NAMESPACE) return true;
  return false;
}

/**
 * Sanitizes and validates a quant session record.
 * Guarantees that benchmark is strictly FALSE, preventing any benchmark contamination.
 */
export function sanitizeQuantSession(s) {
  if (!s || typeof s !== 'object') return null;

  const score = Number.isFinite(s.score) ? Math.max(0, Math.trunc(s.score)) : 0;
  const startedAt = typeof s.startedAt === 'string' && !Number.isNaN(Date.parse(s.startedAt))
    ? new Date(Date.parse(s.startedAt)).toISOString()
    : new Date().toISOString();
  const finishedAt = typeof s.finishedAt === 'string' && !Number.isNaN(Date.parse(s.finishedAt))
    ? new Date(Date.parse(s.finishedAt)).toISOString()
    : null;
  const elapsedMs = Number.isFinite(s.elapsedMs) && s.elapsedMs >= 0 ? s.elapsedMs : 0;
  const events = Array.isArray(s.events) ? s.events : [];

  return {
    id: typeof s.id === 'string' && s.id ? s.id : `quant-session-${Date.now()}`,
    mode: 'quant',
    namespace: QUANT_NAMESPACE,
    benchmark: false, // Invariant: quant sessions are NEVER benchmarks
    startedAt,
    finishedAt,
    elapsedMs,
    score,
    category: typeof s.category === 'string' ? s.category : 'general',
    events,
    quantMetrics: s.quantMetrics && typeof s.quantMetrics === 'object' ? s.quantMetrics : null,
  };
}

/**
 * Summarizes quant training performance across sessions.
 * Completely distinct from Zetamac 120s benchmark analytics.
 */
export function summarizeQuantProgress(sessions = []) {
  const quantRuns = sessions.filter(isQuantSession);

  if (quantRuns.length === 0) {
    return {
      totalRuns: 0,
      totalProblems: 0,
      accuracy: 0,
      categories: {},
      historical80in8: { bestNetScore: null, totalRuns: 0 },
      marketMaking: { totalPnl: 0, totalRounds: 0 },
      hasData: false,
    };
  }

  let totalProblems = 0;
  let totalCorrect = 0;
  const categories = {};
  let bestHistoricalNet = null;
  let histRunsCount = 0;
  let mmTotalPnl = 0;
  let mmRoundsCount = 0;

  for (const s of quantRuns) {
    const cat = s.category || 'general';
    if (!categories[cat]) {
      categories[cat] = { runs: 0, problems: 0, correct: 0, accuracy: 0 };
    }
    categories[cat].runs++;

    const events = Array.isArray(s.events) ? s.events : [];
    for (const e of events) {
      totalProblems++;
      categories[cat].problems++;
      if (e.correct) {
        totalCorrect++;
        categories[cat].correct++;
      }
    }

    if (s.rules?.id === 'historical-80-in-8' || s.category === 'historical-80-in-8') {
      histRunsCount++;
      const net = s.quantMetrics?.netScore ?? s.score;
      if (bestHistoricalNet === null || net > bestHistoricalNet) {
        bestHistoricalNet = net;
      }
    }

    if (s.quantMetrics?.marketMaking) {
      mmRoundsCount += s.quantMetrics.marketMaking.totalRounds || 0;
      mmTotalPnl += s.quantMetrics.marketMaking.totalPnl || 0;
    }
  }

  for (const k of Object.keys(categories)) {
    const c = categories[k];
    c.accuracy = c.problems > 0 ? Number(((c.correct / c.problems) * 100).toFixed(1)) : 0;
  }

  const overallAccuracy = totalProblems > 0 ? Number(((totalCorrect / totalProblems) * 100).toFixed(1)) : 0;

  return {
    totalRuns: quantRuns.length,
    totalProblems,
    accuracy: overallAccuracy,
    categories,
    historical80in8: {
      bestNetScore: bestHistoricalNet,
      totalRuns: histRunsCount,
    },
    marketMaking: {
      totalPnl: Number(mmTotalPnl.toFixed(2)),
      totalRounds: mmRoundsCount,
    },
    hasData: true,
  };
}

/**
 * Gate Verification: Asserts that a quant session cannot penetrate standard benchmark series
 * or influence benchmark consistency, ladder progression, or community rankings.
 * Returns true if isolation is preserved, or throws/returns false if contaminated.
 */
export function assertQuantIsolation(session) {
  if (!session || typeof session !== 'object') return true;

  // If it's a quant session, verify it can never be considered a benchmark
  if (isQuantSession(session)) {
    if (session.benchmark === true) {
      throw new Error('Isolation violation: Quant session has benchmark=true');
    }
    if (session.mode !== 'quant') {
      throw new Error(`Isolation violation: Quant session has mode="${session.mode}" instead of "quant"`);
    }
    if (session.rules && session.rules.id === BENCHMARK_RULES.id) {
      throw new Error('Isolation violation: Quant session cannot use benchmark rules ID');
    }
  }
  return true;
}
