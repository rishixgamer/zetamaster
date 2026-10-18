import { createRng, intBetween } from './rng.js';

/**
 * Hardware & typing latency calibration (F40, M4).
 *
 * Provides an independent number-copying interface to isolate hardware/keyboard
 * input overhead from mental calculation time.
 *
 * Limitation disclosure: Copy-typing speed measures keyboard and motor execution;
 * it is not equivalent to solving an arithmetic problem then typing the answer.
 */

/** Input baseline used only for descriptive comparison; never presented as exact thinking time. */
export function estimateInputBaseline(trials) {
  const values = trials.filter(x => Number.isFinite(x.ms) && x.ms >= 0).map(x => x.ms).sort((a, b) => a - b);
  if (!values.length) return null;
  return {
    sampleSize: values.length,
    medianMs: values[Math.floor((values.length - 1) / 2)],
    limitation: 'Copy typing is not equivalent to solving then typing.',
  };
}

/**
 * Generate a deterministic bank of number-copying trials for input calibration.
 * Prompts span typical arithmetic answer profiles (1 to 4 digits).
 */
export function generateCopyTrials(seed, count = 10) {
  const rng = createRng(seed);
  const trials = [];

  for (let i = 0; i < count; i++) {
    // Generate numbers distributed across lengths 1 to 4 digits
    // 2 and 3 digits are most frequent in 120s Zetamac benchmarks
    const roll = rng();
    let num;
    if (roll < 0.15) {
      num = intBetween(rng, 2, 9); // 1-digit
    } else if (roll < 0.65) {
      num = intBetween(rng, 10, 99); // 2-digit (most common)
    } else if (roll < 0.90) {
      num = intBetween(rng, 100, 999); // 3-digit
    } else {
      num = intBetween(rng, 1000, 9999); // 4-digit
    }

    const str = String(num);
    trials.push({
      id: `copy-${i + 1}`,
      prompt: str,
      expected: str,
      digits: str.length,
    });
  }

  return trials;
}

/**
 * Evaluate a single number-copy trial.
 */
export function evaluateCopyTrial(trial, typedInput, elapsedMs) {
  if (!trial) return null;
  const typed = String(typedInput ?? '').trim();
  const ms = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0;
  const correct = typed === trial.expected;

  return {
    trialId: trial.id,
    prompt: trial.prompt,
    expected: trial.expected,
    typed,
    correct,
    ms,
    digits: trial.digits,
  };
}

/**
 * Compute aggregate keyboard input diagnostics from completed trials.
 */
export function computeHardwareDiagnostics(trialResults = []) {
  const valid = trialResults.filter(t => t && Number.isFinite(t.ms) && t.ms >= 0);
  if (!valid.length) return null;

  const times = valid.map(t => t.ms).sort((a, b) => a - b);
  const correctTimes = valid.filter(t => t.correct === true).map(t => t.ms).sort((a, b) => a - b);
  const sampleSize = valid.length;
  const correctCount = valid.filter(t => t.correct === true).length;
  const accuracy = Math.round((correctCount / sampleSize) * 100) / 100;

  const medianMs = correctTimes.length
    ? correctTimes[Math.floor((correctTimes.length - 1) / 2)]
    : times[Math.floor((times.length - 1) / 2)];

  const p10Ms = times[Math.floor((times.length - 1) * 0.1)];
  const p90Ms = times[Math.floor((times.length - 1) * 0.9)];

  // Per-character entry rate (ms per digit)
  const perChar = valid
    .filter(t => t.correct && t.digits > 0)
    .map(t => t.ms / t.digits)
    .sort((a, b) => a - b);
  const msPerDigit = perChar.length ? perChar[Math.floor((perChar.length - 1) / 2)] : null;

  return {
    sampleSize,
    correctCount,
    accuracy,
    medianMs,
    p10Ms,
    p90Ms,
    msPerDigit: msPerDigit !== null ? Math.round(msPerDigit) : null,
    estimatedInputOverheadMs: medianMs,
    limitation: 'Copy-typing baseline measures hardware entry latency; it does not measure mental calculation time.',
  };
}
