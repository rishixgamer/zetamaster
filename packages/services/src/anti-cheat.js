import { BENCHMARK_RULES, benchmarkEquivalent } from '../../core/src/rulesets.js';
import { createGenerator } from '../../core/src/generator.js';
import { mean } from '../../analytics/src/stats.js';

/**
 * Client-side session replay check (Milestone M5).
 *
 * Re-simulates a benchmark in this browser and compares events draw-for-draw.
 * A pass means the recorded run matches its seed. It is not an independent
 * check. That starts only when a server re-runs the same check, which this
 * build does not do. A person who can edit this file can bypass it.
 *
 * What the check looks for:
 * 1. Recorded events must match the seeded problem sequence.
 * 2. Reported score must match the count of correct answers in that replay.
 * 3. Physiological bounds: latencies under 100 ms, or a cadence with almost no
 *    variation, fail the check inside this browser.
 */

export const MIN_HUMAN_RESPONSE_MS = 100; // Human cognitive-motor floor
export const MAX_SOLVE_RATE_PER_SEC = 2.5; // Max 300 solves in 120s
export const MIN_BOT_DETECTION_EVENTS = 10;
export const MIN_HUMAN_LATENCY_STDDEV_MS = 8; // Milliseconds of natural human variance

export class VerificationError extends Error {
  constructor(violations, message) {
    super(message || `Session failed anti-cheat verification: ${violations.join(', ')}`);
    this.name = 'VerificationError';
    this.violations = violations;
  }
}

/**
 * Computes standard deviation of numbers.
 */
function standardDeviation(xs) {
  if (xs.length < 2) return 0;
  const avg = mean(xs);
  const variance = xs.reduce((sum, x) => sum + Math.pow(x - avg, 2), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Verifies a benchmark session for integrity, correctness, deterministic replay,
 * and physiological human limits.
 *
 * @param {object} session - SessionRecord object
 * @param {object} [options]
 * @returns {{ verified: boolean, violations: string[], details: object }}
 */
export function verifyBenchmarkSession(session, {
  minResponseMs = MIN_HUMAN_RESPONSE_MS,
  maxSolveRate = MAX_SOLVE_RATE_PER_SEC,
  minStdDevMs = MIN_HUMAN_LATENCY_STDDEV_MS,
} = {}) {
  const violations = [];

  if (!session || typeof session !== 'object') {
    return { verified: false, violations: ['MISSING_SESSION_PAYLOAD'], details: null };
  }

  // 1. Eligibility & Benchmark Isolation
  if (session.benchmark !== true || session.mode !== 'benchmark') {
    violations.push('NOT_A_BENCHMARK');
  }
  // A typed or preset seed is practice, even if a forged record claims benchmark.
  if (session.seedSource === 'user' || session.seedSource === 'preset') {
    violations.push('CHOSEN_SEED');
  }

  if (typeof session.elapsedMs !== 'number' || session.elapsedMs < 120000) {
    violations.push('INCOMPLETE_DURATION');
  }

  const seed = typeof session.seed === 'string' ? session.seed : null;
  if (!seed) {
    violations.push('MISSING_SEED');
  }

  const events = Array.isArray(session.events) ? session.events : [];
  const reportedScore = Number.isInteger(session.score) ? session.score : 0;

  // 2. Score and event count alignment
  const correctEvents = events.filter(e => e && e.correct);
  if (correctEvents.length !== reportedScore) {
    violations.push('SCORE_MISMATCH');
  }

  // 3. Rate of solve check
  const durationSec = (session.elapsedMs || 120000) / 1000;
  if (reportedScore / durationSec > maxSolveRate) {
    violations.push('SUPERHUMAN_SOLVE_RATE');
  }

  // 4. Deterministic Re-simulation draw-for-draw
  if (seed && violations.length === 0) {
    try {
      const generator = createGenerator(BENCHMARK_RULES, seed);
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const simulated = generator();

        // Check operand and answer integrity
        if (
          ev.op !== simulated.op ||
          ev.left !== simulated.left ||
          ev.right !== simulated.right ||
          ev.answer !== simulated.answer
        ) {
          violations.push(`QUESTION_REPLAY_MISMATCH_AT_INDEX_${i}`);
          break;
        }
      }
    } catch (err) {
      violations.push(`GENERATOR_REPLAY_FAILED: ${err.message}`);
    }
  }

  // 5. Latency and Bot Cadence Analysis
  const latencies = events
    .map(e => e.responseMs)
    .filter(Number.isFinite);

  let minLatencyMs = Infinity;
  let maxLatencyMs = 0;
  let superhumanCount = 0;

  for (const lat of latencies) {
    if (lat < minResponseMs) superhumanCount++;
    if (lat < minLatencyMs) minLatencyMs = lat;
    if (lat > maxLatencyMs) maxLatencyMs = lat;
  }

  if (superhumanCount > 0) {
    violations.push('SUPERHUMAN_LATENCY_DETECTED');
  }

  const stdDev = latencies.length >= MIN_BOT_DETECTION_EVENTS ? standardDeviation(latencies) : null;
  if (stdDev !== null && stdDev < minStdDevMs) {
    violations.push('BOT_CADENCE_DETECTED');
  }

  // 6. Cumulative elapsed time bounds
  const totalResponseMs = latencies.reduce((a, b) => a + b, 0);
  if (totalResponseMs > session.elapsedMs + 2000) {
    violations.push('TIME_OVERFLOW');
  }

  const details = {
    score: reportedScore,
    eventCount: events.length,
    solveCount: correctEvents.length,
    meanLatencyMs: mean(latencies) || 0,
    minLatencyMs: Number.isFinite(minLatencyMs) ? minLatencyMs : 0,
    maxLatencyMs,
    stdDevMs: stdDev,
    isSuperhuman: superhumanCount > 0,
    isBotCadence: stdDev !== null && stdDev < minStdDevMs,
  };

  return {
    verified: violations.length === 0,
    violations,
    details,
  };
}

/**
 * Generates deterministic proof digest of a verified session.
 */
export function createSessionEvidence(session, secret = 'zm-default-salt') {
  const seed = session.seed || '';
  const score = session.score || 0;
  const elapsedMs = session.elapsedMs || 0;
  const startedAt = session.startedAt || '';
  const eventFingerprint = (session.events || [])
    .map(e => `${e.op}:${e.left},${e.right}=${e.answer}@${e.responseMs}`)
    .join('|');

  const payload = `${secret}:${seed}:${score}:${elapsedMs}:${startedAt}:${eventFingerprint}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
