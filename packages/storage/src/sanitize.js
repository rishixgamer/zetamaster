import { benchmarkEquivalent, BENCHMARK_RULES, OPERATIONS } from '../../core/src/rulesets.js';
import { makeQuestion } from '../../core/src/generator.js';

const NUMERIC_FIELDS = ['responseMs', 'firstInputMs', 'entryMs', 'corrections', 'wrongSubmissions', 'wrongPrefixes', 'fullWrongAnswers', 'inputChanges', 'completedAtMs', 'shownAtMs'];
const MAX_EVENTS = 5000;
const safeText = (x, max = 80) => (typeof x === 'string' ? x.slice(0, max) : '');

/** Rebuild a question from its source operands so displayed text and answers are always recomputed, never trusted. */
function sanitizeEvent(e) {
  if (!e || typeof e !== 'object' || !OPERATIONS.includes(e.op)) return null;
  let q;
  try { q = makeQuestion(e.op, Number(e.sourceLeft), Number(e.sourceRight), Number.isSafeInteger(e.sequence) ? e.sequence : 0); } catch { return null; }
  if (q.sourceLeft > 10000 || q.sourceRight > 10000) return null;
  const out = { ...q, correct: e.correct === true, pasted: e.pasted === true };
  for (const k of NUMERIC_FIELDS) if (e[k] === null || Number.isFinite(e[k])) out[k] = e[k] ?? null;
  if (!Number.isFinite(out.responseMs) || out.responseMs < 0) return null;
  return out;
}

/**
 * Validate an imported session. Returns null when unusable. Benchmark status is recomputed from the
 * rules snapshot, mode and duration — an imported `benchmark: true` flag is never trusted on its own.
 */
export function sanitizeImportedSession(s) {
  if (!s || typeof s !== 'object' || !Number.isFinite(s.score) || !Array.isArray(s.events) || typeof s.startedAt !== 'string' || Number.isNaN(Date.parse(s.startedAt))) return null;
  if (s.events.length > MAX_EVENTS) return null;
  const events = s.events.map(sanitizeEvent).filter(Boolean);
  const rules = s.rules && typeof s.rules === 'object' ? s.rules : null;
  const mode = safeText(s.mode, 24) || 'custom';
  const elapsedMs = Number.isFinite(s.elapsedMs) ? s.elapsedMs : 0;
  const isBenchmarkRules = rules !== null && benchmarkEquivalent(rules);
  const benchmark = s.benchmark === true && mode === 'benchmark' && isBenchmarkRules && elapsedMs >= BENCHMARK_RULES.durationSeconds * 1000 && s.endedEarly !== true
    && Math.trunc(s.score) === events.filter(e => e.correct).length;
  return {
    id: safeText(s.id, 120) || s.startedAt,
    startedAt: new Date(Date.parse(s.startedAt)).toISOString(),
    finishedAt: typeof s.finishedAt === 'string' && !Number.isNaN(Date.parse(s.finishedAt)) ? new Date(Date.parse(s.finishedAt)).toISOString() : null,
    mode, seed: safeText(s.seed, 80), rules: isBenchmarkRules ? BENCHMARK_RULES : rules,
    engineVersion: safeText(s.engineVersion, 24) || 'zm-engine-1',
    endedEarly: s.endedEarly === true, benchmark, imported: true,
    score: Math.max(0, Math.trunc(s.score)), elapsedMs, events,
    finalUnanswered: null,
    ...(s.drill && typeof s.drill === 'object' ? { drill: { cell: safeText(s.drill.cell, 40), op: OPERATIONS.includes(s.drill.op) ? s.drill.op : null } } : {}),
  };
}
