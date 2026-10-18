import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forecastProgress,
  MIN_FORECAST_RUNS,
} from '../packages/analytics/src/forecasting.js';

// Progress forecasting (F37, M4):
// Calibrated prediction intervals from longitudinal runs; abstain if inadequate data.

test('forecastProgress abstains when benchmark runs are below sample size gate', () => {
  // Empty history
  const emptyRes = forecastProgress([]);
  assert.equal(emptyRes.abstain, true);
  assert.equal(emptyRes.status, 'insufficient-data');
  assert.equal(emptyRes.benchmarkCount, 0);
  assert.equal(emptyRes.projection, null);

  // 5 benchmark runs (below MIN_FORECAST_RUNS=8)
  const fiveRuns = Array.from({ length: 5 }, (_, i) => ({
    mode: 'benchmark',
    benchmark: true,
    score: 30 + i * 2,
    startedAt: `2026-10-18T${String(10 + i).padStart(2, '0')}:00:00Z`,
  }));
  const partialRes = forecastProgress(fiveRuns);
  assert.equal(partialRes.abstain, true);
  assert.equal(partialRes.status, 'insufficient-data');
  assert.equal(partialRes.benchmarkCount, 5);
  assert.match(partialRes.reason, new RegExp(`at least ${MIN_FORECAST_RUNS}`));

  // Practice runs must not bypass the benchmark gate
  const practiceRuns = Array.from({ length: 15 }, (_, i) => ({
    mode: 'sprint',
    benchmark: false,
    score: 40 + i,
    startedAt: `2026-10-18T${String(10 + i).padStart(2, '0')}:00:00Z`,
  }));
  const practiceRes = forecastProgress(practiceRuns);
  assert.equal(practiceRes.abstain, true);
  assert.equal(practiceRes.benchmarkCount, 0);
});

test('forecastProgress computes calibrated projection and intervals when data clears gate', () => {
  // 10 benchmark runs with steady improvement: 30 to 48 (approx +2 points per run)
  const improvingRuns = [30, 32, 34, 36, 38, 40, 42, 44, 46, 48].map((score, i) => ({
    mode: 'benchmark',
    benchmark: true,
    score,
    startedAt: `2026-10-18T${String(10 + i).padStart(2, '0')}:00:00Z`,
  }));

  const res = forecastProgress(improvingRuns, { horizon: 5, confidence: 0.80 });
  assert.equal(res.abstain, false);
  assert.equal(res.status, 'calibrated-forecast');
  assert.equal(res.benchmarkCount, 10);
  assert.ok(res.slopePerRun > 1.5 && res.slopePerRun < 2.5);

  // Projected score should advance ~10 points over 5 runs (around 58)
  assert.ok(res.projectedScore > 48, `projected ${res.projectedScore} should exceed last score 48`);
  assert.ok(res.interval.lower <= res.projectedScore);
  assert.ok(res.interval.upper >= res.projectedScore);
  assert.ok(res.calibration.mae >= 0);
  assert.ok(res.limitation.length > 20);
});

test('forecastProgress handles stable/plateau trajectories with bounded intervals', () => {
  // 12 benchmark runs hovering around 50
  const plateauRuns = [50, 49, 51, 50, 52, 49, 50, 51, 50, 49, 51, 50].map((score, i) => ({
    mode: 'benchmark',
    benchmark: true,
    score,
    startedAt: `2026-10-18T${String(10 + i).padStart(2, '0')}:00:00Z`,
  }));

  const res = forecastProgress(plateauRuns, { horizon: 10 });
  assert.equal(res.abstain, false);
  assert.ok(Math.abs(res.slopePerRun) <= 0.5, 'slope should be near zero');
  assert.ok(res.projectedScore >= 45 && res.projectedScore <= 55);
  assert.ok(res.interval.lower >= 0 && res.interval.upper <= 150);
});
