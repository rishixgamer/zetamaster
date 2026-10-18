import { SKILL_TAXONOMY_VERSION } from './skills.js';

/** A deterministic spaced-practice scheduling primitive. Replace only after evaluation. */
export function scheduleReview({successes=0,failures=0,lastReviewedAt}, wasFastAndCorrect, now=new Date()) {
  const streak=wasFastAndCorrect?successes+1:0;
  const lapse=failures+(wasFastAndCorrect?0:1);
  const intervalDays=wasFastAndCorrect?Math.min(60, Math.pow(2,Math.min(6,streak-1))):1;
  const next=new Date(now.getTime()+intervalDays*86400000).toISOString();
  return {successes:streak,failures:lapse,lastReviewedAt:now.toISOString(),nextReviewAt:next,intervalDays};
}

/**
 * Pure builder for one persisted per-skill review record (F19, docs/SKILLS.md). Composes the raw
 * `scheduleReview` primitive into the storage record shape (`id` = skill cell id, e.g. 'mul:5:4';
 * `taxonomyVersion` pins the skill-id interpretation). Callers MUST pass an explicit, deterministic
 * `now` in tests — the default `new Date()` is for production convenience only and is never
 * deterministic. `existing` is the previously stored record (or null/undefined for a first review);
 * nothing else about the record is trusted or carried over.
 */
export function skillReviewRecord(skillId, existing, wasFastAndCorrect, now = new Date()) {
  if (typeof skillId !== 'string' || !skillId.length || skillId.length > 40) throw new RangeError('skillId must be a short stable string');
  const at = now instanceof Date ? now : new Date(now);
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new RangeError('now must be a valid Date');
  const prev = existing && typeof existing === 'object' ? existing : {};
  const next = scheduleReview(
    { successes: prev.successes ?? 0, failures: prev.failures ?? 0, lastReviewedAt: prev.lastReviewedAt },
    wasFastAndCorrect, at,
  );
  const prefixOp = skillId.split(':')[0];
  return {
    id: skillId, skillId, op: prefixOp, taxonomyVersion: SKILL_TAXONOMY_VERSION,
    successes: next.successes, failures: next.failures,
    lastReviewedAt: next.lastReviewedAt, nextReviewAt: next.nextReviewAt, intervalDays: next.intervalDays,
  };
}
