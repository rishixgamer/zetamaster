/** Explicit timed-mastery proxy; intentionally not claimed to be a calibrated probability. */
export function masteryProxy(events, tag, thresholdMs=2000, priorWeight=8) {
  const xs=events.filter(e=>e.tags?.includes(tag));
  const passing=xs.filter(e=>e.correct&&e.responseMs<=thresholdMs).length;
  return { tag, samples:xs.length, estimate:(passing+priorWeight*.5)/(xs.length+priorWeight), model:'beta-binomial-smoothing-proxy', calibrated:false };
}
