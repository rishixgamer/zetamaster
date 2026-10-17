/** The benchmark is immutable. Never alter these defaults without verification. */
export const BENCHMARK_RULES = Object.freeze({
  id: 'zetamac-default-v1',
  label: 'Standard 120s',
  durationSeconds: 120,
  enabled: ['add', 'sub', 'mul', 'div'],
  addition: { left: [2, 100], right: [2, 100] },
  multiplication: { left: [2, 12], right: [2, 100] },
  skipAllowed: false,
  pauseAllowed: false,
  feedback: false,
});
export const OPERATIONS = Object.freeze(['add', 'sub', 'mul', 'div']);
export function validateRules(candidate) {
  const r = structuredClone(candidate);
  if (!Number.isInteger(r.durationSeconds) || r.durationSeconds < 5 || r.durationSeconds > 3600) throw new RangeError('Duration must be 5–3600 seconds');
  if (!Array.isArray(r.enabled) || !r.enabled.length || r.enabled.some(x => !OPERATIONS.includes(x))) throw new RangeError('Select at least one valid operation');
  for (const pair of [r.addition?.left, r.addition?.right, r.multiplication?.left, r.multiplication?.right]) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isSafeInteger) || pair[0] < 1 || pair[1] > 10000 || pair[0] > pair[1]) throw new RangeError('Invalid operand range');
  }
  return r;
}
export function customRules({ enabled = [...OPERATIONS], durationSeconds = 120, addition = BENCHMARK_RULES.addition, multiplication = BENCHMARK_RULES.multiplication, ...rest } = {}) {
  return validateRules({ id: 'custom', label: 'Custom practice', enabled, durationSeconds, addition, multiplication, skipAllowed: true, pauseAllowed: true, feedback: true, ...rest });
}
export function benchmarkEquivalent(r) {
  return r.id === BENCHMARK_RULES.id && JSON.stringify(r) === JSON.stringify(BENCHMARK_RULES);
}
