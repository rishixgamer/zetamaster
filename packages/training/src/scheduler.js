/** A deterministic spaced-practice scheduling primitive. Replace only after evaluation. */
export function scheduleReview({successes=0,failures=0,lastReviewedAt}, wasFastAndCorrect, now=new Date()) {
  const streak=wasFastAndCorrect?successes+1:0;
  const lapse=failures+(wasFastAndCorrect?0:1);
  const intervalDays=wasFastAndCorrect?Math.min(60, Math.pow(2,Math.min(6,streak-1))):1;
  const next=new Date(now.getTime()+intervalDays*86400000).toISOString();
  return {successes:streak,failures:lapse,lastReviewedAt:now.toISOString(),nextReviewAt:next,intervalDays};
}
