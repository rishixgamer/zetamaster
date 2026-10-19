import { benchmarkEquivalent, BENCHMARK_RULES, OPERATIONS } from '../../core/src/rulesets.js';
import { makeQuestion } from '../../core/src/generator.js';
import { MAX_WRONG_ATTEMPTS } from '../../core/src/session.js';
import { SKILL_TAXONOMY_VERSION, skillCellFromId } from '../../training/src/skills.js';
import { sanitizeProvenance } from '../../training/src/provenance.js';

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
  // Wrong-attempt history (engine 3): presence of the list is the accuracy-evidence signal, so the
  // field is kept only when the import actually carried an array — absent means "accuracy unknown"
  // (older records), never "no wrong attempts". Entries are whitelist-rebuilt, capped, and unusable
  // members (non-objects, non-finite/negative times, empty values) are dropped per entry, so one
  // forged member cannot invalidate the whole event.
  if (Array.isArray(e.wrongAttempts)) {
    const attempts = [];
    for (const w of e.wrongAttempts) {
      if (attempts.length >= MAX_WRONG_ATTEMPTS) break;
      if (!w || typeof w !== 'object') continue;
      const atMs = Number(w.atMs);
      if (!Number.isFinite(atMs) || atMs < 0) continue;
      const value = typeof w.value === 'string' ? w.value.trim().slice(0, 16) : '';
      if (!value) continue;
      attempts.push({ value, atMs: Math.round(atMs) });
    }
    out.wrongAttempts = attempts;
  }
  return out;
}

/**
 * Validate an imported skill-review record (F19). Returns null when unusable. The taxonomy version
 * must equal the current one and the skill id must name a real cell of the current taxonomy (e.g.
 * 'mul:5:4' must be an existing mul cell) — records written under a different taxonomy version are
 * dropped on import and counted by the importer. `nextReviewAt` is recomputed from
 * `lastReviewedAt + intervalDays`, never trusted, and a stored value that disagrees means the record
 * was forged or miswritten, so it is dropped; counters are validated, never clamped silently.
 */
export function sanitizeImportedSkillReview(s) {
  if (!s || typeof s !== 'object' || s.taxonomyVersion !== SKILL_TAXONOMY_VERSION) return null;
  if (typeof s.id !== 'string' || s.id !== s.skillId) return null;
  const parsed = parseSkillId(s.id);
  if (!parsed) return null;
  if (typeof s.lastReviewedAt !== 'string' || Number.isNaN(Date.parse(s.lastReviewedAt))) return null;
  const lastReviewedAt = new Date(Date.parse(s.lastReviewedAt)).toISOString();
  for (const n of [s.successes, s.failures]) if (!Number.isSafeInteger(n) || n < 0) return null;
  if (!Number.isFinite(s.intervalDays) || s.intervalDays < 0) return null;
  const nextReviewAt = new Date(Date.parse(lastReviewedAt) + s.intervalDays * 86400000).toISOString();
  if (typeof s.nextReviewAt !== 'string' || s.nextReviewAt !== nextReviewAt) return null;
  return {
    id: parsed.id, skillId: parsed.id, op: parsed.op, taxonomyVersion: SKILL_TAXONOMY_VERSION,
    successes: s.successes, failures: s.failures, intervalDays: s.intervalDays,
    lastReviewedAt, nextReviewAt,
  };
}

/** True only for ids of the form `${op}:${row}:${col}` that name a cell of the current taxonomy.
 * Delegates to `skillCellFromId`, so this grammar and the UI's id→cell lookup are one source of
 * truth and cannot drift. */
export function parseSkillId(id) {
  const cell = skillCellFromId(id);
  return cell === null ? null : { id: cell.id, op: cell.op, row: cell.row, col: cell.col };
}

const PLAN_STEP_ID_PATTERN = /^[a-z][a-z0-9-]{0,23}$/;
const MAX_PLAN_STEPS = 20;

/**
 * Validate an imported daily-plan completion record (F34). Plan records hold NO score data by
 * design — only what was done: the local-day key, the target budget, per-step minutes and completed
 * flags. Anything that would smuggle in score-like or schedule-like fields is dropped silently
 * (whitelist reconstruction). Returns null when unusable; `completedMinutes` is recomputed from the
 * steps, never trusted.
 */
export function sanitizeImportedDailyPlan(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return null;
  const dateUtc = new Date(`${s.date}T00:00:00.000Z`);
  if (Number.isNaN(dateUtc.getTime()) || dateUtc.toISOString().slice(0, 10) !== s.date) return null; // rejects impossible dates
  if (!Number.isSafeInteger(s.targetMinutes) || s.targetMinutes < 0 || s.targetMinutes > 600) return null;
  if (!Array.isArray(s.steps) || s.steps.length > MAX_PLAN_STEPS) return null;
  const steps = [];
  for (const step of s.steps) {
    if (!step || typeof step !== 'object' || step === null) return null;
    if (typeof step.id !== 'string' || !PLAN_STEP_ID_PATTERN.test(step.id)) return null;
    if (!Number.isSafeInteger(step.minutes) || step.minutes < 0 || step.minutes > 600) return null;
    if (typeof step.completed !== 'boolean') return null;
    if (step.completedAt !== null && (typeof step.completedAt !== 'string' || Number.isNaN(Date.parse(step.completedAt)))) return null;
    steps.push({
      id: step.id, minutes: step.minutes, completed: step.completed,
      ...(step.completed ? { completedAt: new Date(Date.parse(step.completedAt)).toISOString() } : { completedAt: null }),
    });
  }
  // Duplicate step ids would corrupt per-step reconciliation.
  if (new Set(steps.map(x => x.id)).size !== steps.length) return null;
  const completedMinutes = steps.reduce((a, x) => a + (x.completed ? x.minutes : 0), 0);
  return {
    id: s.date, date: s.date, targetMinutes: s.targetMinutes,
    steps, completedMinutes,
    updatedAt: typeof s.updatedAt === 'string' && !Number.isNaN(Date.parse(s.updatedAt)) ? new Date(Date.parse(s.updatedAt)).toISOString() : null,
  };
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
    // Run provenance (F20/F21): whitelist-validated duplicate of the launch context. Malformed
    // provenance is dropped, never repaired — a record with no attributes stays absent.
    ...(revalidatedProvenance(s) ? { provenance: revalidatedProvenance(s) } : {}),
  };
}

/** Single evaluation point so the same validated record is reused, not re-derived per key. */
function revalidatedProvenance(s) {
  return sanitizeProvenance(s?.provenance);
}
