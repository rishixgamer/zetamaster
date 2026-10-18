import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeImportedSession } from '../packages/storage/src/sanitize.js';
import { benchmarkSeries, consistencySummary } from '../packages/analytics/src/consistency.js';
import { evaluateProgression } from '../packages/training/src/progression.js';
import { evaluateBenchmarkRank } from '../packages/community/src/ranks.js';
import {
  isQuantSession,
  sanitizeQuantSession,
  summarizeQuantProgress,
  assertQuantIsolation,
  QUANT_NAMESPACE,
} from '../packages/quant/src/scoring.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';

test('Gate: quant session is never a benchmark, even if import attempts to forge it', () => {
  const forged = {
    startedAt: '2026-10-18T12:00:00.000Z',
    finishedAt: '2026-10-18T12:02:00.000Z',
    mode: 'quant',
    score: 85,
    benchmark: true, // Forged benchmark flag!
    elapsedMs: 120000,
    rules: { ...BENCHMARK_RULES },
    events: Array.from({ length: 85 }, (_, i) => ({
      op: 'add',
      sourceLeft: 10,
      sourceRight: 10,
      sequence: i + 1,
      correct: true,
      responseMs: 1000,
    })),
  };

  const sanitized = sanitizeImportedSession(forged);
  assert.ok(sanitized);
  assert.equal(sanitized.mode, 'quant');
  // Must be forced to false!
  assert.equal(sanitized.benchmark, false);
});

test('Gate: historical-80-in-8 session import can never become a benchmark', () => {
  const forged80 = {
    startedAt: '2026-10-18T12:00:00.000Z',
    mode: 'benchmark', // Forged benchmark mode!
    score: 75,
    benchmark: true,
    elapsedMs: 480000,
    rules: { id: 'historical-80-in-8', durationSeconds: 480 },
    events: [],
  };

  const sanitized = sanitizeImportedSession(forged80);
  assert.ok(sanitized);
  // Not equivalent to BENCHMARK_RULES, so benchmark is false
  assert.equal(sanitized.benchmark, false);
});

test('Gate: quant sessions do not enter benchmark series or consistency metrics', () => {
  const realBenchmark = {
    startedAt: '2026-10-18T10:00:00.000Z',
    mode: 'benchmark',
    benchmark: true,
    score: 65,
    events: [],
  };

  const quantRun = {
    startedAt: '2026-10-18T11:00:00.000Z',
    mode: 'quant',
    benchmark: false,
    score: 95, // High score should NOT pollute
    events: [],
  };

  const sessions = [realBenchmark, quantRun];
  const series = benchmarkSeries(sessions);
  assert.equal(series.length, 1);
  assert.equal(series[0].score, 65);

  const summary = consistencySummary(sessions);
  assert.equal(summary.personalBest, 65);
});

test('Gate: progression ladder ignores quant sessions', () => {
  const quantRuns = Array.from({ length: 15 }, (_, i) => ({
    startedAt: new Date(Date.now() - (15 - i) * 3600000).toISOString(),
    mode: 'quant',
    benchmark: false,
    score: 99,
    events: [],
  }));

  const progression = evaluateProgression(quantRuns);
  // With 0 benchmarks, status is establishing-baseline
  assert.equal(progression.status, 'establishing-baseline');
  assert.equal(progression.benchmarkCount, 0);
});

test('Gate: community ranks ignore quant sessions', () => {
  const quantRuns = Array.from({ length: 10 }, (_, i) => ({
    startedAt: new Date(Date.now() - (10 - i) * 3600000).toISOString(),
    mode: 'quant',
    benchmark: false,
    score: 95,
    events: [],
  }));

  const result = evaluateBenchmarkRank(quantRuns);
  assert.equal(result.calibrated, false);
  assert.equal(result.rank.id, 'unranked');
  assert.equal(result.verifiedCount, 0);
});

test('Quant scoring & analytics summarizes progress independently', () => {
  const s1 = sanitizeQuantSession({
    startedAt: '2026-10-18T10:00:00.000Z',
    category: 'fraction',
    score: 8,
    events: [
      { correct: true },
      { correct: true },
      { correct: false },
    ],
  });

  const s2 = sanitizeQuantSession({
    startedAt: '2026-10-18T11:00:00.000Z',
    category: 'historical-80-in-8',
    score: 45,
    rules: { id: 'historical-80-in-8' },
    quantMetrics: { netScore: 45 },
    events: [
      { correct: true },
      { correct: true },
    ],
  });

  assert.ok(isQuantSession(s1));
  assert.ok(isQuantSession(s2));
  assert.equal(s1.benchmark, false);
  assert.equal(s2.benchmark, false);
  assert.doesNotThrow(() => assertQuantIsolation(s1));
  assert.doesNotThrow(() => assertQuantIsolation(s2));

  const progress = summarizeQuantProgress([s1, s2]);
  assert.equal(progress.totalRuns, 2);
  assert.equal(progress.totalProblems, 5);
  assert.equal(progress.categories.fraction.runs, 1);
  assert.equal(progress.historical80in8.bestNetScore, 45);
});
