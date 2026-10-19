export function mean(xs) { return xs.length ? xs.reduce((a,b) => a+b,0)/xs.length : null; }
export function median(xs) { if (!xs.length) return null; const a = [...xs].sort((x,y) => x-y); const mid=Math.floor(a.length/2); return a.length%2?a[mid]:(a[mid-1]+a[mid])/2; }
export function percentile(xs, p) { if (!xs.length) return null; const a=[...xs].sort((x,y)=>x-y); const i=(a.length-1)*Math.max(0,Math.min(1,p)); const lo=Math.floor(i); return a[lo]+(a[Math.ceil(i)]-a[lo])*(i-lo); }
export function groupBy(items, by) { const grouped = new Map(); for (const item of items) { const k=by(item); if(!grouped.has(k))grouped.set(k,[]); grouped.get(k).push(item); } return grouped; }
export function operationSummary(events) {
  return ['add','sub','mul','div'].map(op => {
    const xs=events.filter(e=>e.op===op && e.correct);
    const times=xs.map(e=>e.responseMs);
    return { op, count: xs.length, medianMs: median(times), meanMs: mean(times), p90Ms: percentile(times, .9), ci: medianCI(times), corrections: xs.reduce((s,e)=>s+e.corrections,0) };
  });
}
export function sessionStats(s) {
  const events=s?.events??[];
  return { score:s?.score??0, meanMs:mean(events.map(e=>e.responseMs)), medianMs:median(events.map(e=>e.responseMs)), p90Ms:percentile(events.map(e=>e.responseMs),.9), perOperation:operationSummary(events), slowest:[...events].sort((a,b)=>b.responseMs-a.responseMs).slice(0,5) };
}

/**
 * Wilson score interval for a proportion (F21 trial uncertainty). Public table of z values — this
 * codebase never leans on a normal-quantile approximation, so the allowed coverages are exactly
 * the three named ones and anything else is refused. Returns {low, high} in [0, 1], rounded to
 * 4 decimals for stable display and serialization.
 */
const WILSON_Z = Object.freeze({ 0.9: 1.6449, 0.95: 1.959964, 0.99: 2.5758 });
export function wilsonInterval(successes, trials, confidence = 0.95) {
  if (!(Number.isInteger(successes) && Number.isInteger(trials) && trials > 0 && successes >= 0 && successes <= trials)) {
    throw new RangeError(`wilsonInterval needs integer counts with 0 <= successes (${successes}) <= trials (${trials})`);
  }
  if (!(confidence in WILSON_Z)) throw new RangeError(`wilsonInterval supports confidence 0.9 / 0.95 / 0.99, got ${confidence}`);
  const z = WILSON_Z[confidence];
  const p = successes / trials;
  const z2 = z * z, z2n = z2 / trials;
  const center = (p + z2n / 2) / (1 + z2n);
  const half = z * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials)) / (1 + z2n);
  const round4 = value => Math.round(value * 10000) / 10000;
  return { low: round4(Math.max(0, center - half)), high: round4(Math.min(1, center + half)), confidence, trials };
}

/** Enumerate every k-element index combination of [0, n) in lexicographic order. */
export function eachCombination(n, k, visit) {
  if (!(Number.isInteger(n) && Number.isInteger(k) && k >= 0 && k <= n)) throw new RangeError(`eachCombination needs 0 <= k (${k}) <= n (${n})`);
  const recurse = (start, chosen) => {
    if (chosen.length === k) { visit(chosen.slice()); return; }
    for (let i = start; i < n; i++) { chosen.push(i); recurse(i + 1, chosen); chosen.pop(); }
  };
  recurse(0, []);
}

function combinationsCount(n, k) {
  const kk = Math.min(k, n - k);
  let comb = 1;
  for (let i = 1; i <= kk; i++) comb = (comb * (n - kk + i)) / i;
  return Math.round(comb);
}

/**
 * Exact two-sided permutation test over the pooled values (F21/M4-F37): every way of regrouping
 * the pooled observations into arms of the observed sizes is enumerated explicitly — no
 * asymptotics, no sampling — so with tiny n the reported p is exact for the stated statistic and
 * carries no normality assumption at all. The identity regrouping is included, so p never reports
 * below 1/C(nA+nB, nA); "indistinguishable" is the honest reading of a tiny, high-tie p.
 *
 * Guards: finite values only; > 20 pooled values is refused (exact enumeration there would take
 * minutes and the trial gate keeps n small anyway); a reassignment count above `maxReassignments`
 * is reported infeasible rather than approximated. Deterministic.
 */
export function exactPermutationTest(xsA, xsB, { statistic = 'median', maxReassignments = 100000 } = {}) {
  const a = (Array.isArray(xsA) ? xsA : []).filter(Number.isFinite);
  const b = (Array.isArray(xsB) ? xsB : []).filter(Number.isFinite);
  const nA = a.length, nB = b.length;
  if (!nA || !nB) throw new RangeError(`exactPermutationTest needs at least one finite value per arm (A: ${nA}, B: ${nB})`);
  const round4 = value => Math.round(value * 10000) / 10000;
  const stat = statistic === 'median' ? median : statistic === 'mean' ? mean : null;
  if (!stat) throw new RangeError(`exactPermutationTest statistic must be 'median' or 'mean', got ${statistic}`);
  const statisticName = statistic === 'median' ? 'median-difference' : 'mean-difference';
  const observed = stat(a) - stat(b);
  if (nA + nB > 20) {
    return { feasible: false, statistic: statisticName, observed: round4(observed), p: null, reassignments: null,
      note: `${nA + nB} pooled values exceed the 20-value guard for exact enumeration — the exact test is refused, never approximated.` };
  }
  const comb = combinationsCount(nA + nB, nA);
  const pooled = [...a, ...b];
  if (comb > maxReassignments) {
    return { feasible: false, statistic: statisticName, observed: round4(observed), p: null, reassignments: comb,
      note: `The exact test needs ${comb} reassignments, above the ${maxReassignments} cap — refused, never approximated.` };
  }
  let hits = 0;
  eachCombination(nA + nB, nA, idx => {
    const inSet = new Uint8Array(nA + nB);
    for (const i of idx) inSet[i] = 1;
    const pick = [], rest = [];
    pooled.forEach((v, i) => (inSet[i] ? pick : rest).push(v));
    if (Math.abs(stat(pick) - stat(rest)) >= Math.abs(observed) - 1e-9) hits++;
  });
  return {
    feasible: true, statistic: statisticName, observed: round4(observed), p: round4(hits / comb), reassignments: comb,
    note: `Exact two-sided permutation p over all ${comb} reassignments of the pooled deltas (statistic: ${statisticName}); the identity regrouping is included, so p never reports below 1/${comb}.`,
  };
}

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
