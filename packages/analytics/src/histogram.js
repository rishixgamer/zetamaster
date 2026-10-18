import { relativeEvents, slowCutoffLog } from './fatigue.js';
import { trend } from './consistency.js';

/**
 * Histogram of the operation-adjusted relative-time distribution across standard benchmarks (F41).
 * Bins are fixed on the log scale, so counts are a deterministic, seed-free function of the analyzed
 * solves: bin k holds ratios r with edges[k-1] <= r < edges[k] (lower edge inclusive), underflow
 * [0, 0.5), overflow (3, ∞). The ×2 edge answers "how often is a solve at ≥ twice your typical time".
 * fatigue.js answers a related question with a robust *cutoff*, which is ≥ ln 2 by construction, so
 * the ≥×2 share can only match the slow share when that cutoff sits exactly on ×2 and no ratio lies
 * exactly on the edge; the fields below let the panel cross-check and say so. Definitions and edge
 * table: docs/FATIGUE.md.
 */
export const HIST_EDGES = Object.freeze([0.5, 0.75, 1, 1.5, 2, 3]);
/** First edge that marks the tail bins used for the over-twice-typical count. */
export const TAIL_EDGE = 2;
/** The histogram section is gated below this many adjusted solves. */
export const MIN_HIST_OBS = 30;
/** Tail-share trend (first vs last runs) reuses consistency's Theil–Sen trend from this many runs. */
export const MOVEMENT_RUNS = 6;

/** Bin tables: [lo, hi) with null standing for the open ends. Index 0 is the underflow bin. */
const BINS = [[null, HIST_EDGES[0]], ...HIST_EDGES.map((e, i) => [e, HIST_EDGES[i + 1] ?? null])];
const TAIL_BIN = HIST_EDGES.indexOf(TAIL_EDGE) + 1;
const binLabel = (lo, hi) => lo === null ? '<×0.5' : hi === null ? `≥×${lo}` : `×${lo}–${hi}`;

/**
 * Bin the adjusted distribution pooled over all analyzed standard runs. Default scope is verified
 * standard benchmarks only (scope:'all' adds practice for exploration). Also returns the per-run
 * ≥×2 shares and their trend, which reuses consistency's Theil–Sen trend (null below MOVEMENT_RUNS),
 * so movement across runs is measured with the same rule as the other panels.
 */
export function relativeHistogram(sessions, { scope = 'benchmark', minObs = MIN_HIST_OBS } = {}) {
  const { events, runs } = relativeEvents(sessions, { scope });
  const n = events.length;
  const bins = BINS.map(([lo, hi]) => ({ lo, hi, label: binLabel(lo, hi), count: 0 }));
  const perRun = Array.from({ length: runs }, () => ({ solves: 0, tail: 0 }));
  let tailCount = 0, engine1 = 0;
  for (const x of events) {
    let k = 0;
    for (let i = 0; i < HIST_EDGES.length; i++, k++) if (x.ratio < HIST_EDGES[i]) break;
    bins[k].count++;
    engine1 += x.e.shownAtMs === undefined ? 1 : 0;
    perRun[x.run].solves++;
    if (k >= TAIL_BIN) { perRun[x.run].tail++; tailCount++; }
  }
  const shares = perRun.map(r => (r.solves ? r.tail / r.solves : 0));
  const logs = events.map(x => Math.log(x.ratio));
  const cutoffLog = n ? slowCutoffLog(logs) : null;
  return {
    runs, observations: n, minObs, edges: [...HIST_EDGES],
    bins: bins.map((b, i) => ({ ...b, share: n ? b.count / n : null, tail: i >= TAIL_BIN })),
    tailShare: n ? tailCount / n : null,
    slowShare: n ? events.filter(x => Math.log(x.ratio) > cutoffLog).length / n : null,
    cutoffRatio: n ? Math.exp(cutoffLog) : null,
    cutoffLog,
    cutoffOnEdge: n ? Math.abs(cutoffLog - Math.log(TAIL_EDGE)) < 1e-12 : false,
    engine1,
    perRunTail: perRun.map((r, i) => ({ run: i + 1, solves: r.solves, tailShare: r.solves ? r.tail / r.solves : 0 })),
    tailTrend: trend(shares, { minRuns: MOVEMENT_RUNS }),
    insufficient: n < minObs,
  };
}
