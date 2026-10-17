import { groupBy, median } from './stats.js';
/** Minimum observations and shrinkage prevent overconfident weakness labels. */
export function diagnose(sessions, { minSamples = 5 } = {}) {
  const events=sessions.flatMap(s=>s.events??[]).filter(e=>e.correct && Number.isFinite(e.responseMs));
  const overall=median(events.map(e=>e.responseMs))??3000;
  const candidates=[];
  for(const [kind, keyOf] of [['operation',e=>e.op], ['tag',e=>(e.tags??[]).filter(t=>t!==e.op)]]) {
    let groups;
    if(kind==='tag') {
      groups=new Map();
      for(const e of events) for(const tag of keyOf(e)) { if(!groups.has(tag))groups.set(tag,[]); groups.get(tag).push(e); }
    } else groups=groupBy(events,keyOf);
    for(const [key, xs] of groups) {
      const n=xs.length, raw=median(xs.map(e=>e.responseMs));
      const shrunk=(n*raw+8*overall)/(n+8);
      candidates.push({ kind,key,count:n,rawMedianMs:raw,smoothedMs:shrunk, excessMs:shrunk-overall, evidence:n>=minSamples?'emerging':'insufficient' });
    }
  }
  return { observations:events.length, globalMedianMs:overall, weaknesses:candidates.filter(x=>x.excessMs>0).sort((a,b)=>b.excessMs-a.excessMs), all:candidates };
}
