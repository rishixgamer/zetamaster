/**
 * Personal-best ghost racing (F33, M4).
 *
 * Extracts cumulative pace visualization from a stored benchmark run.
 * Pure analytics primitive: compares live/replay cumulative progress against
 * a reference benchmark run without altering benchmark generation or timing.
 */

export const DEFAULT_BENCHMARK_DURATION_MS = 120000;

/**
 * Build a cumulative pace trajectory from a benchmark session's events.
 * Returns null if the session is not a valid benchmark with events.
 */
export function buildGhostTrajectory(session) {
  if (!session || session.benchmark !== true || !Array.isArray(session.events)) {
    return null;
  }

  const durationMs = Number.isFinite(session.elapsedMs) && session.elapsedMs > 0
    ? session.elapsedMs
    : DEFAULT_BENCHMARK_DURATION_MS;

  const checkpoints = [{ elapsedMs: 0, score: 0 }];
  let runningElapsedMs = 0;
  let runningScore = 0;

  for (const event of session.events) {
    const responseMs = Number.isFinite(event.responseMs) && event.responseMs >= 0 ? event.responseMs : 0;
    runningElapsedMs += responseMs;
    if (event.correct === true) {
      runningScore += 1;
      checkpoints.push({
        elapsedMs: Math.min(runningElapsedMs, durationMs),
        score: runningScore,
      });
    }
  }

  // Ensure an endpoint exists at durationMs
  if (checkpoints[checkpoints.length - 1].elapsedMs < durationMs) {
    checkpoints.push({
      elapsedMs: durationMs,
      score: runningScore,
    });
  }

  return {
    sessionId: session.id ?? null,
    startedAt: session.startedAt ?? null,
    durationMs,
    finalScore: runningScore,
    checkpoints,
  };
}

/**
 * Look up the ghost's cumulative score at any timestamp `elapsedMs`.
 * Step-function interpolation: returns how many correct solves the ghost had
 * achieved by elapsedMs.
 */
export function ghostScoreAt(trajectory, elapsedMs) {
  if (!trajectory || !Array.isArray(trajectory.checkpoints) || trajectory.checkpoints.length === 0) {
    return 0;
  }
  const t = Math.max(0, Math.min(Number(elapsedMs) || 0, trajectory.durationMs));

  // Find the highest checkpoint with elapsedMs <= t
  let low = 0;
  let high = trajectory.checkpoints.length - 1;
  let best = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (trajectory.checkpoints[mid].elapsedMs <= t) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return trajectory.checkpoints[best].score;
}

/**
 * Compare current pace against ghost trajectory at `elapsedMs`.
 */
export function compareGhostPace(currentScore, elapsedMs, trajectory) {
  if (!trajectory) return null;

  const validScore = Math.max(0, Number.isFinite(currentScore) ? currentScore : 0);
  const validElapsed = Math.max(0, Math.min(Number.isFinite(elapsedMs) ? elapsedMs : 0, trajectory.durationMs));
  const ghostScore = ghostScoreAt(trajectory, validElapsed);
  const delta = validScore - ghostScore;

  const status = delta > 0 ? 'ahead' : delta < 0 ? 'behind' : 'tied';
  const projectedFinal = validElapsed > 0
    ? Math.round((validScore / validElapsed) * trajectory.durationMs)
    : 0;

  return {
    currentScore: validScore,
    ghostScore,
    delta,
    status,
    elapsedMs: validElapsed,
    projectedFinal,
    ghostFinal: trajectory.finalScore,
  };
}

/**
 * Select reference personal-best benchmark session from history.
 */
export function selectPersonalBestBenchmark(sessions = []) {
  const eligible = sessions.filter(s =>
    s && s.benchmark === true && Number.isFinite(s.score) && Array.isArray(s.events) && s.events.length > 0
  );
  if (!eligible.length) return null;

  return eligible.reduce((best, s) => {
    if (!best) return s;
    if (s.score > best.score) return s;
    if (s.score === best.score) {
      // Tie breaker: more recent
      return Date.parse(s.startedAt ?? 0) >= Date.parse(best.startedAt ?? 0) ? s : best;
    }
    return best;
  }, null);
}
