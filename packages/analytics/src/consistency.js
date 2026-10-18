import { median, percentile, medianCI } from './stats.js';

/**
 * Consistency metrics over verified standard benchmarks only (F43/F15). Definitions: docs/CONSISTENCY.md.
 * Every function takes scores in chronological order and degrades to nulls when data is thin.
 */
export const GOAL = Object.freeze({ target: 70, need: 8, window: 10 });
export const MIN_BAND_RUNS = 3;
export const MIN_TREND_RUNS = 6;

/** Verified benchmark runs only, oldest first. Practice, drills, imports flagged non-benchmark never appear. */
export function benchmarkSeries(sessions) {
  return sessions.filter(s => s.benchmark === true && Number.isFinite(s.score))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((s, i) => ({ run: i + 1, at: s.startedAt, score: s.score }));
}

/** Trailing-window median and 10th/90th percentiles at each run; null until `minRuns` runs exist. */
export function rollingBands(scores, { window = GOAL.window, minRuns = MIN_BAND_RUNS } = {}) {
  return scores.map((score, i) => {
    const xs = scores.slice(Math.max(0, i - window + 1), i + 1);
    const ok = xs.length >= minRuns;
    return { index: i, score, n: xs.length, median: ok ? median(xs) : null, p10: ok ? percentile(xs, 0.1) : null, p90: ok ? percentile(xs, 0.9) : null };
  });
}

/**
 * Goal: at least `need` of the last `window` runs score >= `target`.
 * - kthBest: the `need`-th highest score in the window — the score that must reach the target.
 * - pointsShort: how far kthBest is below target (0 when it is at or above).
 * - runsToGoal: fewest additional runs that could meet the goal, i.e. assuming every future run scores
 *   >= target while the window slides; 0 when already met. A floor, not a forecast.
 */
export function goalStatus(scores, goal = GOAL) {
  const { target, need, window } = goal;
  const last = scores.slice(-window);
  const hits = last.filter(x => x >= target).length;
  const met = last.length === window && hits >= need;
  const sorted = [...last].sort((a, b) => b - a);
  const kthBest = sorted.length >= need ? sorted[need - 1] : null;
  let runsToGoal = 0;
  if (!met) {
    const sim = [...scores];
    while (runsToGoal < window) {
      sim.push(target); runsToGoal++;
      const w = sim.slice(-window);
      if (w.length === window && w.filter(x => x >= target).length >= need) break;
    }
  }
  return { ...goal, runs: scores.length, windowRuns: last.length, hits, met, kthBest, pointsShort: kthBest === null ? null : Math.max(0, target - kthBest), runsToGoal };
}

/**
 * Theil–Sen slope (points per run) over the last `lastN` runs with Sen's distribution-free CI
 * (Kendall-S normal approximation, ties ignored). Runs are not independent trials, so treat the
 * interval as descriptive. Null below `minRuns`.
 */
export function trend(scores, { lastN = 20, minRuns = MIN_TREND_RUNS, z = 1.959964 } = {}) {
  const xs = scores.slice(-lastN), n = xs.length;
  if (n < minRuns) return null;
  const slopes = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) slopes.push((xs[j] - xs[i]) / (j - i));
  slopes.sort((a, b) => a - b);
  const N = slopes.length;
  const c = z * Math.sqrt(n * (n - 1) * (2 * n + 5) / 18);
  // Ranks M1 = (N − C)/2 and M2 + 1 = (N + C)/2 + 1 (1-based), rounded outward, as 0-based indices.
  const lo = Math.max(0, Math.floor((N - c) / 2) - 1), hi = Math.min(N - 1, Math.ceil((N + c) / 2));
  return { slope: median(slopes), low: slopes[lo], high: slopes[hi], n, confidence: 0.95 };
}

/** Everything the consistency dashboard shows, from raw sessions. */
export function consistencySummary(sessions, goal = GOAL) {
  const series = benchmarkSeries(sessions);
  const scores = series.map(x => x.score);
  const recent = scores.slice(-goal.window);
  const bands = rollingBands(scores, { window: goal.window });
  return {
    series: series.map((x, i) => ({ ...x, ...bands[i] })),
    goal: goalStatus(scores, goal),
    recent: {
      n: recent.length, median: median(recent), ci: medianCI(recent),
      p10: recent.length >= MIN_BAND_RUNS ? percentile(recent, 0.1) : null,
      p90: recent.length >= MIN_BAND_RUNS ? percentile(recent, 0.9) : null,
    },
    personalBest: scores.length ? Math.max(...scores) : null,
    trend: trend(scores),
  };
}
