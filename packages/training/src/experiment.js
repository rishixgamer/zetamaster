import { createRng, intBetween } from '../../core/src/rng.js';
import { median } from '../../analytics/src/stats.js';

/**
 * Arithmetic strategy experiments (F42, M4).
 *
 * Implements seeded balanced A/B item generation and empirical outcome testing
 * for comparing mental arithmetic algorithms on matched problem domains.
 *
 * Non-causal disclosure: Trials measure performance under experimental conditions;
 * small-sample differences do not prove universal cognitive superiority.
 */

export const MIN_TRIALS_PER_ARM = 3;

/** Balanced, seeded A/B assignment. */
export function assignStrategyTrial(participantSeed, index) {
  let h = 0;
  for (const ch of String(participantSeed)) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return ((Math.abs(h) + index) % 2 === 0) ? 'A' : 'B';
}

/**
 * Generate balanced problem items for an A/B strategy comparison.
 * Counterbalances item arm assignment across problems to eliminate block-order bias.
 */
export function createBalancedExperiment({
  name = 'strategy-ab-trial',
  strategyA = 'round-and-compensate',
  strategyB = 'left-to-right',
  op = 'add',
  seed = 'experiment-seed',
  itemCount = 12,
} = {}) {
  const count = Math.max(4, itemCount % 2 === 0 ? itemCount : itemCount + 1);
  const rng = createRng(seed);
  const items = [];

  for (let i = 0; i < count; i++) {
    // Generate operands appropriate for two-digit arithmetic
    let a = intBetween(rng, 12, 98);
    let b = intBetween(rng, 12, 98);
    if (a % 10 === 0) a += 1;
    if (b % 10 === 0) b += 1;

    let expectedAnswer;
    let glyph = '+';
    if (op === 'add') {
      expectedAnswer = a + b;
      glyph = '+';
    } else if (op === 'sub') {
      if (a < b) { const tmp = a; a = b; b = tmp; }
      expectedAnswer = a - b;
      glyph = '−';
    } else if (op === 'mul') {
      a = intBetween(rng, 3, 12);
      b = intBetween(rng, 12, 99);
      expectedAnswer = a * b;
      glyph = '×';
    } else {
      b = intBetween(rng, 2, 12);
      const q = intBetween(rng, 2, 50);
      a = b * q;
      expectedAnswer = q;
      glyph = '÷';
    }

    // Counterbalanced alternating assignment (ABBA pattern)
    const arm = (i % 4 === 0 || i % 4 === 3) ? 'A' : 'B';
    const strategy = arm === 'A' ? strategyA : strategyB;

    items.push({
      itemIndex: i,
      arm,
      strategy,
      problem: {
        a,
        b,
        op,
        text: `${a} ${glyph} ${b}`,
        expectedAnswer,
      },
    });
  }

  return {
    name,
    seed,
    op,
    strategyA,
    strategyB,
    itemCount: items.length,
    armACount: items.filter(it => it.arm === 'A').length,
    armBCount: items.filter(it => it.arm === 'B').length,
    items,
  };
}

/**
 * Analyze completed A/B strategy experiment trials.
 * Evaluates latency and accuracy outcomes with sample-size safeguards.
 */
export function analyzeExperimentOutcomes(trials = [], { minTrialsPerArm = MIN_TRIALS_PER_ARM } = {}) {
  const trialsA = trials.filter(t => t && t.arm === 'A' && Number.isFinite(t.responseMs) && t.responseMs >= 0);
  const trialsB = trials.filter(t => t && t.arm === 'B' && Number.isFinite(t.responseMs) && t.responseMs >= 0);

  if (trialsA.length < minTrialsPerArm || trialsB.length < minTrialsPerArm) {
    return {
      status: 'insufficient-data',
      reason: `At least ${minTrialsPerArm} valid trials per arm required (found A: ${trialsA.length}, B: ${trialsB.length}).`,
      minTrialsPerArm,
      counts: { armA: trialsA.length, armB: trialsB.length },
      limitation: 'Outcome analysis abstains when trial counts are below the statistical gate.',
    };
  }

  const countA = trialsA.length;
  const countB = trialsB.length;
  const correctA = trialsA.filter(t => t.correct === true).length;
  const correctB = trialsB.filter(t => t.correct === true).length;
  const accuracyA = Math.round((correctA / countA) * 100) / 100;
  const accuracyB = Math.round((correctB / countB) * 100) / 100;

  const correctTimesA = trialsA.filter(t => t.correct === true).map(t => t.responseMs);
  const correctTimesB = trialsB.filter(t => t.correct === true).map(t => t.responseMs);

  const timesA = correctTimesA.length ? correctTimesA : trialsA.map(t => t.responseMs);
  const timesB = correctTimesB.length ? correctTimesB : trialsB.map(t => t.responseMs);

  const medianMsA = median(timesA);
  const medianMsB = median(timesB);

  const latencyDiffMs = Math.round((medianMsB - medianMsA) * 10) / 10;
  const accuracyDiff = Math.round((accuracyB - accuracyA) * 100) / 100;

  const fasterArm = latencyDiffMs < -50 ? 'B' : (latencyDiffMs > 50 ? 'A' : 'equivalent');
  const moreAccurateArm = accuracyDiff > 0.05 ? 'B' : (accuracyDiff < -0.05 ? 'A' : 'equivalent');

  let effectSummary;
  if (fasterArm === 'A' && moreAccurateArm === 'A') {
    effectSummary = 'Arm A showed both faster response times and higher accuracy in this trial.';
  } else if (fasterArm === 'B' && moreAccurateArm === 'B') {
    effectSummary = 'Arm B showed both faster response times and higher accuracy in this trial.';
  } else if (fasterArm !== 'equivalent') {
    effectSummary = `Arm ${fasterArm} was faster by ${Math.abs(latencyDiffMs)} ms; accuracy difference was ${accuracyDiff >= 0 ? '+' : ''}${Math.round(accuracyDiff * 100)}%.`;
  } else {
    effectSummary = 'Both strategy arms demonstrated comparable speed and accuracy on the tested items.';
  }

  return {
    status: 'analyzed',
    sampleSizes: { armA: countA, armB: countB },
    accuracy: { armA: accuracyA, armB: accuracyB, diff: accuracyDiff },
    medianResponseMs: { armA: medianMsA, armB: medianMsB, latencyDiffMs },
    fasterArm,
    moreAccurateArm,
    effectSummary,
    limitation: 'Experimental outcome measures performance on rehearsed trial items; does not establish universal superiority across all operand ranges.',
  };
}
