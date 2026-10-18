import { median } from './stats.js';
import { benchmarkSeries } from './consistency.js';

/**
 * Longitudinal progress forecasting with calibrated prediction intervals (F37, M4).
 *
 * Implements sample-gated progress projections based on verified benchmark runs.
 * Explicitly abstains when history is below the minimum sample threshold (8 runs)
 * to prevent spurious precision and misleading predictions.
 */

export const MIN_FORECAST_RUNS = 8;
export const DEFAULT_FORECAST_HORIZON = 10;
export const MAX_FORECAST_HORIZON = 30;

/**
 * Compute pairwise Theil-Sen median slope (points per run) across scores.
 */
function theilSenSlope(scores) {
  const n = scores.length;
  if (n < 2) return 0;
  const slopes = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      slopes.push((scores[j] - scores[i]) / (j - i));
    }
  }
  return slopes.length ? median(slopes) : 0;
}

/**
 * Held-out rolling origin cross-validation to estimate empirical prediction error (MAE).
 */
function crossValidatePredictionError(scores) {
  const n = scores.length;
  if (n < 4) return 3.0; // fallback default uncertainty
  const startIdx = Math.max(3, Math.floor(n / 2));
  const errors = [];

  for (let i = startIdx; i < n; i++) {
    const train = scores.slice(0, i);
    const slope = theilSenSlope(train);
    const intercept = median(train.map((y, idx) => y - slope * idx));
    const predicted = intercept + slope * i;
    errors.push(Math.abs(scores[i] - predicted));
  }

  return errors.length ? median(errors) : 3.0;
}

/**
 * Forecast longitudinal progress across future benchmark runs.
 * Returns calibrated prediction intervals or an explicit abstention when data is insufficient.
 */
export function forecastProgress(
  sessions = [],
  { horizon = DEFAULT_FORECAST_HORIZON, confidence = 0.80 } = {},
) {
  const series = benchmarkSeries(sessions);
  const scores = series.map(s => s.score);
  const n = scores.length;

  if (n < MIN_FORECAST_RUNS) {
    return {
      status: 'insufficient-data',
      abstain: true,
      reason: `Calibrated forecasting requires at least ${MIN_FORECAST_RUNS} standard benchmark runs to prevent spurious precision (found ${n}).`,
      benchmarkCount: n,
      minRunsNeeded: MIN_FORECAST_RUNS,
      currentMedian: n > 0 ? median(scores) : null,
      projection: null,
      limitation: 'Projections abstain without sufficient longitudinal history.',
    };
  }

  const boundedHorizon = Math.max(1, Math.min(horizon, MAX_FORECAST_HORIZON));
  const slope = theilSenSlope(scores);
  const intercept = median(scores.map((y, idx) => y - slope * idx));
  const lastScore = scores[n - 1];
  const currentMedian = median(scores.slice(-Math.min(n, 10)));

  // Forward projection
  const targetRunIndex = (n - 1) + boundedHorizon;
  const rawProjected = intercept + slope * targetRunIndex;
  // Floor at 0, cap at 150 points for realistic benchmark range
  const projectedScore = Math.max(0, Math.min(150, Math.round(rawProjected)));

  // Empirical prediction interval derived from cross-validation
  const cvMae = crossValidatePredictionError(scores);
  // Multiplier for requested confidence level (1.28 for 80%, 1.96 for 95%)
  const zFactor = confidence >= 0.90 ? 1.96 : 1.28;
  const horizonGrowth = Math.sqrt(1 + boundedHorizon / n);
  const margin = Math.max(2, Math.round(zFactor * cvMae * horizonGrowth));

  const lowerBound = Math.max(0, projectedScore - margin);
  const upperBound = Math.min(150, projectedScore + margin);

  return {
    status: 'calibrated-forecast',
    abstain: false,
    benchmarkCount: n,
    currentMedian,
    lastScore,
    slopePerRun: Math.round(slope * 100) / 100,
    horizonRuns: boundedHorizon,
    projectedScore,
    interval: {
      lower: lowerBound,
      upper: upperBound,
      margin,
      confidenceLevel: confidence,
    },
    calibration: {
      mae: Math.round(cvMae * 100) / 100,
      crossValidatedRuns: Math.floor(n / 2),
    },
    limitation: 'Descriptive longitudinal extrapolation assumes consistent training conditions; not a causal or guaranteed promise.',
  };
}
