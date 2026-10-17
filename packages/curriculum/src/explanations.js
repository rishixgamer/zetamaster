import { LESSONS } from './lessons.js';
/** Deterministic suggestion; LLM output must not be the source of arithmetic truth. */
export function suggestLesson(question) {
  return LESSONS.find(l=>l.tags.some(t=>question.tags?.includes(t))) ?? LESSONS.find(l=>l.operation===question.op) ?? null;
}
