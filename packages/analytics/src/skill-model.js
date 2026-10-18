/** Automatization line shared across F20 mastery and F19 reviews: a recall taking at most this long
 * counts as "fast". One constant, two consumers, so the definitions cannot drift apart. */
export const AUTOMATICITY_MS = 2000;
/** Explicit timed-mastery proxy; intentionally not claimed to be a calibrated probability. */
export function masteryProxy(events, tag, thresholdMs=AUTOMATICITY_MS, priorWeight=8) {
  const xs=events.filter(e=>e.tags?.includes(tag));
  const passing=xs.filter(e=>e.correct&&e.responseMs<=thresholdMs).length;
  return { tag, samples:xs.length, estimate:(passing+priorWeight*.5)/(xs.length+priorWeight), model:'beta-binomial-smoothing-proxy', calibrated:false };
}
