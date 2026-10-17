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
