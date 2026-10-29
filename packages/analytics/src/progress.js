import { median, percentile } from './stats.js';
import { repeatedBenchmarkSeedReport } from '../../core/src/seed-policy.js';
export function benchmarkProgress(sessions) {
  const excluded=repeatedBenchmarkSeedReport(sessions).excluded;
  const benchmark=sessions.filter(s=>s.benchmark && s.score>=0 && !excluded.has(s)).sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt));
  const recent=benchmark.slice(-10).map(s=>s.score);
  return { count:benchmark.length, personalBest: benchmark.length?Math.max(...benchmark.map(s=>s.score)):null, recentMedian:median(recent), recentP10:percentile(recent,.1), mastery70:recent.length===10 && recent.filter(n=>n>=70).length>=8, trajectory:benchmark.map(s=>({ at:s.startedAt, score:s.score })) };
}
export function detectPlateau(sessions, minRuns=12) {
  const excluded=repeatedBenchmarkSeedReport(sessions).excluded;
  const values=sessions.filter(s=>s.benchmark && !excluded.has(s)).sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)).map(s=>s.score);
  if(values.length<minRuns)return { status:'insufficient-data', count:values.length };
  const half=Math.floor(values.length/2); const first=median(values.slice(-minRuns,-minRuns+half)); const second=median(values.slice(-half));
  return { status:second-first<=2?'possible-plateau':'improving', medianShift:second-first, count:values.length };
}
