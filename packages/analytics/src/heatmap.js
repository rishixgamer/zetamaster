import { median } from './stats.js';
export function aggregateHeatmap(sessions) {
  const groups=new Map();
  for(const event of sessions.flatMap(s=>s.events??[])) {
    const key=`${event.op}:${event.sourceLeft}:${event.sourceRight}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(event.responseMs);
  }
  return [...groups].map(([key, xs])=>({key,count:xs.length,medianMs:median(xs)}));
}
