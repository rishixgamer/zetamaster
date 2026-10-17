import { median, percentile, medianCI } from './stats.js';

/**
 * Within-run pace (F13) and slow-tail (F41) analysis over verified standard benchmarks only.
 * Every solve time is divided by the player's median for that operation ("relative time"), so a run
 * that happened to draw more multiplication late does not look like fatigue. Definitions: docs/FATIGUE.md.
 */
export const MIN_OP_SAMPLES = 5;
export const MIN_PACE_RUNS = 3;
const OPS = ['add', 'sub', 'mul', 'div'];

/** When the question appeared, relative to run start. Engine-1 events lack shownAtMs but can derive it. */
export function shownAt(e) {
  if (Number.isFinite(e.shownAtMs)) return e.shownAtMs;
  if (Number.isFinite(e.completedAtMs) && Number.isFinite(e.responseMs)) return e.completedAtMs - e.responseMs;
  return null;
}

/** Solved events from standard runs with an operation-relative time. Ops with too few samples are skipped. */
export function relativeEvents(sessions) {
  // Chronological, so `run` numbers match the consistency chart.
  const runs = sessions.filter(s => s.benchmark === true).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const all = runs.flatMap((s, run) => (s.events ?? []).filter(e => e.correct && Number.isFinite(e.responseMs) && e.responseMs > 0 && shownAt(e) !== null).map(e => ({ e, run, durationMs: (s.rules?.durationSeconds ?? 120) * 1000 })));
  const opMedian = Object.fromEntries(OPS.map(op => { const xs = all.filter(x => x.e.op === op).map(x => x.e.responseMs); return [op, xs.length >= MIN_OP_SAMPLES ? median(xs) : null]; }));
  const events = all.filter(x => opMedian[x.e.op] !== null).map(({ e, run, durationMs }) => ({
    run, op: e.op, label: `${e.left} ${e.symbol} ${e.right}`, responseMs: e.responseMs, shownAtMs: shownAt(e), durationMs,
    opMedianMs: opMedian[e.op], ratio: e.responseMs / opMedian[e.op],
  }));
  return { events, opMedian, runs: runs.length };
}

const ratioCI = logs => { const ci = medianCI(logs); return ci ? { low: Math.exp(ci.low), high: Math.exp(ci.high) } : null; };

/**
 * Pace across the run. `segments` splits the run duration into equal windows by when each question was
 * shown. `halfShift` is the median over runs of (second-half median ratio ÷ first-half median ratio):
 * a paired, within-run comparison, so slow or fast days cancel out. Values > 1 mean slower late in runs.
 */
export function paceProfile(sessions, { segments = 4, minRuns = MIN_PACE_RUNS } = {}) {
  const { events, runs } = relativeEvents(sessions);
  const seg = Array.from({ length: segments }, (_, i) => ({ index: i, fromFrac: i / segments, toFrac: (i + 1) / segments, logs: [], raw: [] }));
  for (const x of events) {
    const i = Math.min(segments - 1, Math.max(0, Math.floor(x.shownAtMs / x.durationMs * segments)));
    seg[i].logs.push(Math.log(x.ratio)); seg[i].raw.push(x.responseMs);
  }
  const perRun = new Map();
  for (const x of events) {
    if (!perRun.has(x.run)) perRun.set(x.run, { early: [], late: [] });
    perRun.get(x.run)[x.shownAtMs < x.durationMs / 2 ? 'early' : 'late'].push(Math.log(x.ratio));
  }
  const shifts = [...perRun.values()].filter(r => r.early.length >= 3 && r.late.length >= 3).map(r => median(r.late) - median(r.early));
  return {
    runs, observations: events.length,
    segments: seg.map(s => ({ index: s.index, fromFrac: s.fromFrac, toFrac: s.toFrac, n: s.logs.length, ratio: s.logs.length ? Math.exp(median(s.logs)) : null, ci: ratioCI(s.logs), rawMedianMs: median(s.raw) })),
    halfShift: shifts.length >= minRuns ? { runs: shifts.length, ratio: Math.exp(median(shifts)), ci: ratioCI(shifts) } : { runs: shifts.length, ratio: null, ci: null },
  };
}

/**
 * Slow tail. A question is "slow" when its relative time exceeds a robust cutoff: the larger of 2× the
 * typical time and median + 3·(1.4826·MAD) on the log scale. Excess = time beyond the operation median.
 * `questionsPerRun` converts the median excess per run into solves at the overall median pace: a rough,
 * descriptive upper bound on points at stake, not a promise.
 */
export function tailProfile(sessions, { worst = 5 } = {}) {
  const { events, runs, opMedian } = relativeEvents(sessions);
  if (!events.length) return { runs, observations: 0, cutoffRatio: null, slowShare: null, excessPerRun: null, questionsPerRun: null, byOp: [], worst: [] };
  const logs = events.map(x => Math.log(x.ratio));
  const m = median(logs), mad = median(logs.map(v => Math.abs(v - m)));
  const cutoffLog = Math.max(Math.log(2), m + 3 * 1.4826 * mad);
  const slow = events.filter(x => Math.log(x.ratio) > cutoffLog).map(x => ({ ...x, excessMs: x.responseMs - x.opMedianMs }));
  const perRun = new Map(Array.from({ length: runs }, (_, i) => [i, 0]));
  for (const x of slow) perRun.set(x.run, perRun.get(x.run) + x.excessMs);
  const excess = [...perRun.values()];
  const overallMedian = median(events.map(x => x.responseMs));
  const excessPerRun = median(excess);
  return {
    runs, observations: events.length, cutoffRatio: Math.exp(cutoffLog),
    slowShare: slow.length / events.length,
    excessPerRun, excessCI: medianCI(excess),
    questionsPerRun: excessPerRun === null || !overallMedian ? null : excessPerRun / overallMedian,
    byOp: OPS.filter(op => opMedian[op] !== null).map(op => {
      const xs = events.filter(x => x.op === op).map(x => x.responseMs);
      const p50 = percentile(xs, 0.5), p90 = percentile(xs, 0.9);
      return { op, n: xs.length, p50, p90, tailRatio: p90 / p50, slow: slow.filter(x => x.op === op).length };
    }),
    worst: slow.sort((a, b) => b.excessMs - a.excessMs).slice(0, worst).map(({ label, op, responseMs, opMedianMs, excessMs, ratio, run }) => ({ label, op, responseMs, opMedianMs, excessMs, ratio, run: run + 1 })),
  };
}
