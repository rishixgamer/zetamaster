import { median } from './stats.js';
import { classifyError } from './errors.js';

/** Legacy flat aggregation: one entry per exact operand pair. */
export function aggregateHeatmap(sessions) {
  const groups=new Map();
  for(const event of sessions.flatMap(s=>s.events??[])) {
    const key=`${event.op}:${event.sourceLeft}:${event.sourceRight}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(event.responseMs);
  }
  return [...groups].map(([key, xs])=>({key,count:xs.length,medianMs:median(xs)}));
}

/** Operand bands for the 2–100 ranges; the first band is 2–9 because 0–1 never occur in the default format. */
export const OPERAND_BANDS = Object.freeze([[2,9],[10,19],[20,29],[30,39],[40,49],[50,59],[60,69],[70,79],[80,89],[90,100]].map(Object.freeze));
export const TABLE_FACTORS = Object.freeze(Array.from({length:11},(_,i)=>i+2));
export const MIN_CELL_SAMPLES = 3;
export const STABLE_CELL_SAMPLES = 8;
const SHRINK_WEIGHT = 4;

/**
 * Grid layout per operation, always indexed by the *source* operands of the underlying problem:
 * - mul/div: rows = table factor (2–12; the divisor for division), cols = other factor band.
 * - add: rows = left addend band, cols = right addend band.
 * - sub: rows = subtrahend band, cols = answer band (sub is generated as (a+b) – a = b).
 */
export function heatmapLayout(op) {
  const band = ([lo,hi]) => ({ range:[lo,hi], label:`${lo}–${hi}` });
  const table = n => ({ range:[n,n], label:String(n) });
  if (op==='mul' || op==='div') return { op, rowAxis: op==='mul'?'Table factor':'Divisor', colAxis: op==='mul'?'Other factor':'Answer', rows:TABLE_FACTORS.map(table), cols:OPERAND_BANDS.map(band) };
  if (op==='add') return { op, rowAxis:'Left addend', colAxis:'Right addend', rows:OPERAND_BANDS.map(band), cols:OPERAND_BANDS.map(band) };
  if (op==='sub') return { op, rowAxis:'Subtracted number', colAxis:'Answer', rows:OPERAND_BANDS.map(band), cols:OPERAND_BANDS.map(band) };
  throw new RangeError('Unknown operation');
}

const indexIn = (axis, value) => axis.findIndex(({range:[lo,hi]}) => value>=lo && value<=hi);

/**
 * Distribution-free confidence interval for a median from order statistics (binomial, p = 0.5).
 * Returns null when n is too small for the requested coverage (n < 6 at 95%).
 */
export function medianCI(values, confidence = 0.95) {
  const xs = values.filter(Number.isFinite).sort((a,b)=>a-b), n = xs.length;
  if (!n) return null;
  const tail = (1-confidence)/2;
  let k = -1;
  if (n <= 1000) {
    let pmf = Math.pow(0.5, n), cdf = 0;
    for (let i = 0; i < n; i++) { cdf += pmf; if (cdf > tail) break; k = i; pmf *= (n-i)/(i+1); }
  } else k = Math.floor(n/2 - 1.959964*Math.sqrt(n)/2) - 1;
  if (k < 0) return null;
  return { low: xs[k], high: xs[n-1-k], confidence, n };
}

function evidenceFor(n) { return n===0?'none':n<MIN_CELL_SAMPLES?'insufficient':n<STABLE_CELL_SAMPLES?'emerging':'stable'; }

export const HEATMAP_SCOPES = Object.freeze({
  benchmark: s => s.benchmark === true,
  all: () => true,
});

/**
 * Build a weakness heatmap for one operation from solved events.
 * Cell `ratio` = shrunken cell median ÷ operation median (shrinkage toward the operation median with
 * weight 4 keeps sparse cells near 1). `ratio > 1` means slower than typical for that operation.
 */
export function buildHeatmap(sessions, op, { scope = 'benchmark' } = {}) {
  const layout = heatmapLayout(op);
  const include = HEATMAP_SCOPES[scope];
  if (!include) throw new RangeError('Unknown heatmap scope');
  const events = sessions.filter(include).flatMap(s => s.events ?? []).filter(e => e.op===op && e.correct && Number.isFinite(e.responseMs));
  const opMedianMs = median(events.map(e=>e.responseMs));
  const buckets = layout.rows.map(() => layout.cols.map(() => []));
  for (const e of events) {
    const r = indexIn(layout.rows, e.sourceLeft), c = indexIn(layout.cols, e.sourceRight);
    if (r >= 0 && c >= 0) buckets[r][c].push(e);
  }
  const cells = buckets.map((row, r) => row.map((xs, c) => {
    const times = xs.map(e=>e.responseMs);
    const medianMs = median(times);
    const smoothedMs = xs.length && opMedianMs !== null ? (xs.length*medianMs + SHRINK_WEIGHT*opMedianMs)/(xs.length+SHRINK_WEIGHT) : null;
    const flawed = xs.filter(e => classifyError(e) !== 'clean').length;
    return {
      row:r, col:c, key:`${op}:${r}:${c}`,
      label: `${layout.rows[r].label} ${{add:'+',sub:'–',mul:'×',div:'÷'}[op]} ${layout.cols[c].label}`,
      rowRange: layout.rows[r].range, colRange: layout.cols[c].range,
      count: xs.length, medianMs, ci: medianCI(times), smoothedMs,
      ratio: smoothedMs !== null && opMedianMs ? smoothedMs/opMedianMs : null,
      flawedShare: xs.length ? flawed/xs.length : null,
      evidence: evidenceFor(xs.length),
    };
  }));
  return { ...layout, scope, observations: events.length, opMedianMs, cells };
}

/** Slowest cells with at least `minSamples` observations, by shrunken ratio. */
export function slowestCells(heatmap, { limit = 3, minSamples = MIN_CELL_SAMPLES } = {}) {
  return heatmap.cells.flat().filter(c => c.count >= minSamples && c.ratio > 1).sort((a,b) => b.ratio-a.ratio).slice(0, limit);
}
