import { relativeEvents, MIN_OP_SAMPLES } from './fatigue.js';
import { classifyError, ERROR_TYPES } from './errors.js';
import { median, medianCI } from './stats.js';
import { trend } from './consistency.js';

const OPS = ['add', 'sub', 'mul', 'div'];

/** Per-operation×type cells with fewer solves than this show "low n" instead of a relative time. */
export const MIN_TYPE_SAMPLES = 3;
/** Clean solves per operation needed before that operation's types can be costed (pace's gate). */
export const MIN_CLEAN_SAMPLES = MIN_OP_SAMPLES;

const ratioCI = logs => { const ci = medianCI(logs); return ci ? { low: Math.exp(ci.low), high: Math.exp(ci.high) } : null; };
const blankRuns = n => Object.fromEntries([...ERROR_TYPES, '_total'].map(k => [k, new Map(Array.from({ length: n }, (_, i) => [i, 0]))]));

/**
 * Median response time of *clean* solves per operation — the cost reference so a slow operation
 * does not make its errors look more expensive than they are. Null below MIN_CLEAN_SAMPLES.
 */
export function cleanMediansByOp(events) {
  return Object.fromEntries(OPS.map(op => {
    const xs = events.filter(e => e.op === op && e.correct && classifyError(e) === 'clean').map(e => e.responseMs);
    return [op, xs.length >= MIN_CLEAN_SAMPLES ? median(xs) : null];
  }));
}

/**
 * Latency-stratified entry-quality analysis across runs (F11) from raw sessions. Default scope is
 * verified standard benchmarks only (practice and drills have other durations and no stakes);
 * scope:'all' adds them for exploration. Operation adjustment reuses relativeEvents(). Per type:
 * `ratio` = median solve time ÷ that operation's clean-entry median (falls back to the all-solve
 * operation median when the op lacks clean samples, flagged `baseline:'op'`); `lostMs` = seconds
 * lost per run, the median across runs of Σ(responseMs − that op's clean median) over the type's
 * questions. `trend` is a Theil–Sen slope of the calculation share per run. Definitions and caveats:
 * docs/ENTRY_QUALITY.md.
 */
export function entryQuality(sessions, { scope = 'benchmark' } = {}) {
  const { events, runs } = relativeEvents(sessions, { scope });
  const typed = events.map(x => ({ ...x, type: classifyError(x.e) }));
  const clean = cleanMediansByOp(typed.map(x => x.e));
  const perRunLost = blankRuns(runs);
  const perRunCount = new Map(Array.from({ length: runs }, (_, i) => [i, { solved: 0, calculation: 0 }]));
  for (const x of typed) {
    if (Number.isFinite(clean[x.op])) {
      const lost = x.responseMs - clean[x.op];
      perRunLost[x.type].set(x.run, perRunLost[x.type].get(x.run) + lost);
      if (x.type !== 'clean') perRunLost._total.set(x.run, perRunLost._total.get(x.run) + lost);
    }
    perRunCount.get(x.run).solved++;
    if (x.type === 'calculation') perRunCount.get(x.run).calculation++;
  }
  const total = typed.length;
  const counts = Object.fromEntries(ERROR_TYPES.map(type => [type, typed.filter(x => x.type === type).length]));
  const costs = ERROR_TYPES.map(type => {
    const xs = typed.filter(x => x.type === type);
    const rel = xs.filter(x => Number.isFinite(clean[x.op])).map(x => x.responseMs / clean[x.op]);
    const base = rel.length ? rel : xs.map(x => x.ratio);
    const logs = base.map(Math.log);
    const first = xs.filter(x => Number.isFinite(x.e.firstInputMs));
    return {
      type, count: xs.length, costed: rel.length,
      baseline: rel.length || !xs.length ? 'clean' : 'op',
      ratio: xs.length ? Math.exp(median(logs)) : null,
      ci: ratioCI(logs),
      lostMs: median([...perRunLost[type].values()]),
      lostCI: medianCI([...perRunLost[type].values()]),
      splitN: first.length,
      firstMs: median(first.map(x => x.e.firstInputMs)),
      entryMs: median(xs.filter(x => Number.isFinite(x.e.entryMs)).map(x => x.e.entryMs)),
    };
  });
  const overallMedianMs = median(typed.map(x => x.responseMs));
  const lostTotal = total ? median([...perRunLost._total.values()]) : null;
  return {
    scope, runs, observations: total,
    rates: ERROR_TYPES.map(type => ({ type, count: counts[type], share: total ? counts[type] / total : null })),
    costs, clean,
    byOp: OPS.map(op => {
      const xsOp = typed.filter(x => x.op === op);
      return { op, n: xsOp.length, types: ERROR_TYPES.map(type => {
        const xs = xsOp.filter(x => x.type === type);
        return { type, n: xs.length, medianMs: median(xs.map(x => x.responseMs)), ratio: xs.length >= MIN_TYPE_SAMPLES ? Math.exp(median(xs.map(x => Math.log(x.ratio)))) : null };
      }) };
    }),
    lostTotal, lostTotalCI: medianCI([...perRunLost._total.values()]),
    overallMedianMs, questionsPerRun: lostTotal === null || !overallMedianMs ? null : lostTotal / overallMedianMs,
    perRun: [...perRunCount].map(([run, r]) => ({ run: run + 1, solved: r.solved, calculation: r.calculation, lostMs: perRunLost._total.get(run) })),
    calcTrend: trend([...perRunCount.values()].map(r => r.solved ? r.calculation / r.solved : 0)),
    baselineMixed: costs.some(c => c.baseline === 'op'),
    engine1Events: events.filter(x => x.e.wrongPrefixes === undefined).length,
  };
}
