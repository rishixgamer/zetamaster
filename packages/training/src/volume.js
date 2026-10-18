import { median } from '../../analytics/src/stats.js';

/**
 * Adaptive training volume (F36, M4).
 *
 * Monitors signs of cognitive slowdown and session fatigue across daily training.
 * Fundamental rule: recommendations NEVER force continued practice.
 * Rest days and early stops are explicitly supported and free of shame.
 */

export const DEFAULT_DAILY_BUDGET_MINUTES = 15;
export const MAX_SAFE_DAILY_MINUTES = 30;
export const FATIGUE_SLOWDOWN_THRESHOLD = 1.20; // 20% latency increase marks fatigue

/**
 * Filter sessions that occurred today (within `lookbackHours` of `now`).
 */
function getRecentSessions(sessions, nowMs, lookbackHours = 24) {
  const windowMs = lookbackHours * 3600 * 1000;
  return sessions.filter(s => {
    const started = Date.parse(s.startedAt ?? '');
    return Number.isFinite(started) && (nowMs - started) >= 0 && (nowMs - started) <= windowMs;
  }).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/**
 * Extract median response time from a session's events.
 */
function sessionMedianLatency(session) {
  if (!Array.isArray(session.events) || !session.events.length) return null;
  const valid = session.events
    .map(e => e.responseMs)
    .filter(ms => Number.isFinite(ms) && ms > 0);
  return valid.length ? median(valid) : null;
}

/**
 * Analyze volume load and fatigue signals from recent sessions.
 */
export function analyzeTrainingVolume(sessions = [], { now = Date.now(), lookbackHours = 24 } = {}) {
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  const recent = getRecentSessions(sessions, nowMs, lookbackHours);

  let totalElapsedMs = 0;
  let correctCount = 0;
  let eventCount = 0;
  const sessionLatencies = [];

  for (const s of recent) {
    const elapsed = Number.isFinite(s.elapsedMs) && s.elapsedMs > 0 ? s.elapsedMs : 0;
    totalElapsedMs += elapsed;
    const lat = sessionMedianLatency(s);
    if (lat !== null) sessionLatencies.push(lat);

    if (Array.isArray(s.events)) {
      eventCount += s.events.length;
      correctCount += s.events.filter(e => e.correct === true).length;
    }
  }

  const todayMinutes = Math.round((totalElapsedMs / 60000) * 10) / 10;
  const sessionCount = recent.length;

  // Detect slowdown between early sessions and late sessions today
  let slowdownDetected = false;
  let fatigueRatio = 1.0;

  if (sessionLatencies.length >= 2) {
    const half = Math.floor(sessionLatencies.length / 2);
    const earlyMedian = median(sessionLatencies.slice(0, half || 1));
    const lateMedian = median(sessionLatencies.slice(-Math.max(1, half)));
    if (earlyMedian > 0) {
      fatigueRatio = Math.round((lateMedian / earlyMedian) * 100) / 100;
      if (fatigueRatio >= FATIGUE_SLOWDOWN_THRESHOLD) {
        slowdownDetected = true;
      }
    }
  }

  const accuracy = eventCount > 0 ? Math.round((correctCount / eventCount) * 100) / 100 : null;

  return {
    todayMinutes,
    sessionCount,
    fatigueRatio,
    slowdownDetected,
    accuracy,
    recentCount: recent.length,
  };
}

/**
 * Determine recommended training volume based on observed fatigue and daily activity.
 * Always respects the principle: recommendations never force continued practice.
 */
export function recommendVolume(
  analysis,
  { targetDailyMinutes = DEFAULT_DAILY_BUDGET_MINUTES, maxSafeMinutes = MAX_SAFE_DAILY_MINUTES } = {},
) {
  const todayMinutes = analysis?.todayMinutes ?? 0;
  const slowdown = analysis?.slowdownDetected ?? false;
  const ratio = analysis?.fatigueRatio ?? 1.0;

  let action = 'standard-practice';
  let recommendedMinutes = Math.max(0, targetDailyMinutes - todayMinutes);
  let reason = 'Normal performance signals. Standard 15-minute daily routine recommended.';

  if (slowdown || ratio >= FATIGUE_SLOWDOWN_THRESHOLD) {
    action = 'rest-recommended';
    recommendedMinutes = 0;
    reason = `Signs of cognitive slowdown observed (${Math.round((ratio - 1) * 100)}% latency increase). Taking a break or stopping for today consolidates learning without reinforcing fatigue errors.`;
  } else if (todayMinutes >= maxSafeMinutes) {
    action = 'daily-cap-reached';
    recommendedMinutes = 0;
    reason = `Daily practice cap of ${maxSafeMinutes} minutes reached. More practice today yields diminishing returns. Rest is recommended.`;
  } else if (todayMinutes >= targetDailyMinutes) {
    action = 'target-achieved';
    recommendedMinutes = 0;
    reason = `Daily target of ${targetDailyMinutes} minutes completed! Any additional practice is strictly optional.`;
  }

  return {
    action,
    recommendedMinutes,
    todayMinutes,
    fatigueDetected: slowdown,
    fatigueRatio: ratio,
    reason,
    neverForce: true,
    isOptional: true,
    restDayAllowed: true,
    restNote: 'Rest days and early finishes are productive, valid training choices. Volume recommendations never require continued practice.',
  };
}
