/** Input baseline used only for descriptive comparison; never presented as exact thinking time. */
export function estimateInputBaseline(trials) {
  const values = trials.filter(x => Number.isFinite(x.ms) && x.ms >= 0).map(x => x.ms).sort((a,b) => a-b);
  if (!values.length) return null;
  return { sampleSize: values.length, medianMs: values[Math.floor((values.length - 1) / 2)], limitation: 'Copy typing is not equivalent to solving then typing.' };
}
