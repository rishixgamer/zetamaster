import { AUTOMATICITY_MS } from '../../analytics/src/skill-model.js';
import { SKILL_MIN_SAMPLES, skillCellFromId } from './skills.js';

/**
 * Drill-completion review semantics for the persisted spaced repetition (F19, M2 slice 2).
 * docs/SKILLS.md documents this contract in full; the essentials:
 *
 * A *completed* pattern-drill run on one skill cell records exactly one review record when it has
 * enough evidence, and nothing otherwise. "Fast and correct" measures both halves: the run's usable
 * solves must pass the automatization speed rule AND at least half of them must carry no recorded
 * wrong attempt (a complete wrong value typed, or Enter pressed on a wrong field). Wrong attempts
 * are persisted per question (engine zm-engine-3 `wrongAttempts`); records from before engine 3 have
 * no such history but do carry the counters, so engine-2 events are judged from those counters and
 * still-older engine-1 events count as accuracy-unknown, which leans clean — absence of the field is
 * never treated as evidence of errors.
 *
 * `SKILL_REVIEW_FAST_MS` is F20's `AUTOMATICITY_MS` (imported, one constant, no drift). The minimum
 * run length mirrors `SKILL_MIN_SAMPLES` (the heatmap/rollup gate): both are the smallest sample a
 * "typical" claim should rest on.
 */
export const SKILL_REVIEW_FAST_MS = AUTOMATICITY_MS;
export const SKILL_REVIEW_MIN_SOLVES = SKILL_MIN_SAMPLES;

/** Nearest-rank 50th percentile: the smallest value v with at least half the values ≤ v (odd n:
 * the middle value). Returns null for an empty list. Chosen over an interpolated median so the
 * decision IS the share statement: "at least half the solves finished at or under the line". */
export function nearestRankMedian(values) {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.ceil(xs.length / 2) - 1];
}

/**
 * Did this solved event carry a recorded wrong attempt — a complete wrong value typed or Enter
 * pressed on a wrong field? Reads the bounded engine-3 history AND the correction counters, so
 * pre-engine-3 events (no `wrongAttempts` list) are still judged from `wrongSubmissions` /
 * `fullWrongAnswers`. Self-corrected slips and revisions (`wrongPrefixes`/`corrections` without a
 * complete wrong value or submission) do NOT count — they are not wrong answers, matching the
 * error typology where only the 'calculation' type types a wrong answer first.
 */
export function eventHadWrongAttempt(e) {
  if (!e || typeof e !== 'object') return false;
  if (Array.isArray(e.wrongAttempts) && e.wrongAttempts.length > 0) return true;
  return (e.wrongSubmissions ?? 0) > 0 || (e.fullWrongAnswers ?? 0) > 0;
}

/**
 * Which finished drill runs may write a spaced-repetition review record (F19), and why not — one pure
 * authority so the UI and tests agree. Returns `{ ok: true, cellId, label }` for the only kind of
 * run that records (a complete, cell-scoped pattern drill), or `{ ok: false, reason }`:
 * - `not-drill` — not a drill run (benchmark, practice, replay);
 * - `ended-early` — interrupted runs record nothing (a cut-short review is not evidence);
 * - `probe` — transfer probes (F32) are measurements, never ladder evidence;
 * - `flash` — automaticity drills (F31) end questions at the automaticity line, so their solved
 *   set is pre-filtered to fast answers and would inflate the streak ladder trivially.
 */
export function drillReviewEligible(result) {
  const drill = result?.drill;
  if (!drill || typeof drill !== 'object' || typeof drill.cell !== 'string') return { ok: false, reason: 'not-drill' };
  if (result.endedEarly === true) return { ok: false, reason: 'ended-early', cellId: drill.cell, label: drill.label ?? null };
  if (drill.stage === 'probe') return { ok: false, reason: 'probe', cellId: drill.cell, label: drill.label ?? null };
  if (drill.stage === 'flash') return { ok: false, reason: 'flash', cellId: drill.cell, label: drill.label ?? null };
  return { ok: true, cellId: drill.cell, label: drill.label ?? null };
}

/**
 * Decide whether a finished drill run records a review, and its outcome. Pure; no clock input needed
 * (the caller passes the run's own finishedAt as the review's `now`).
 *
 * `events` are the run's solved events **already filtered to the drilled cell** by the caller
 * (`skillOf(event)?.id === drillCellId`); filtering stays with the caller so this function has
 * explicit inputs. Non-finite or negative `responseMs` entries are ignored — both rules below
 * (speed and accuracy) are share statements over the same usable solves.
 *
 * Returns:
 * - `null` — record nothing: the run was ended early (interrupted review) or has fewer than
 *   `minSolves` in-cell solves (not enough evidence to say anything about motion);
 * - otherwise `{ wasFastAndCorrect, solveCount, medianMs, fastMs, cleanCount, cleanShare,
 *   wrongAttemptSolves }` where success requires BOTH:
 *   1. the nearest-rank median of the usable solves ≤ `fastMs` (speed — pinned edge by edge), AND
 *   2. at least half of the usable solves carry no recorded wrong attempt (`eventHadWrongAttempt`)
 *      — `cleanShare ≥ 0.5`; exactly half passes, mirroring the speed rule's shape.
 */
export function drillReviewOutcome(events, { endedEarly = false, fastMs = SKILL_REVIEW_FAST_MS, minSolves = SKILL_REVIEW_MIN_SOLVES } = {}) {
  if (endedEarly) return null;
  const solves = (Array.isArray(events) ? events : [])
    .filter(e => e && typeof e === 'object' && Number.isFinite(e.responseMs) && e.responseMs >= 0);
  if (solves.length < minSolves) return null;
  const medianMs = nearestRankMedian(solves.map(e => e.responseMs));
  const cleanCount = solves.filter(e => !eventHadWrongAttempt(e)).length;
  const cleanShare = cleanCount / solves.length;
  return {
    wasFastAndCorrect: medianMs <= fastMs && cleanShare >= 0.5,
    solveCount: solves.length,
    medianMs,
    fastMs,
    cleanCount,
    cleanShare,
    wrongAttemptSolves: solves.length - cleanCount,
  };
}

const OP_ORDER = ['add', 'sub', 'mul', 'div'];
const cellOrder = cell => OP_ORDER.indexOf(cell.op) * 1e6 + cell.row * 1e3 + cell.col;

/**
 * Split stored review records into the prompts the queue shows. Pure; `nowMs` is explicit so tests
 * are fixed-clock (production callers pass `Date.now()`).
 *
 * Returns `{ all, due, upcoming, skipped, total }`:
 * - `due` (nextReviewAt <= now), sorted by op add→sub→mul→div, then row, then col — the same
 *   deterministic order as `skillRollups`;
 * - `upcoming` (nextReviewAt in (now, now + upcomingDays]), sorted by next review time, ties by the
 *   same cell order;
 * - `skipped` counts records hidden because their id does not name a cell of the current taxonomy
 *   (e.g. written under a future/older tax) or their nextReviewAt is unparseable — never crashed on,
 *   never reinterpreted;
 * - `total` is records.length for the empty-state message.
 * Each item is `{ id, label, rowRange, colRange, nextReviewAt, record }` ready for the UI.
 */
export function reviewQueue(records, nowMs, { upcomingDays = 7 } = {}) {
  const windowMs = upcomingDays * 86400000;
  const all = [], due = [], upcoming = [];
  let skipped = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const cell = skillCellFromId(record?.id);
    const nextMs = Date.parse(record?.nextReviewAt ?? '');
    if (!cell || !Number.isFinite(nextMs)) { skipped++; continue; }
    const item = { id: cell.id, op: cell.op, row: cell.row, col: cell.col, label: cell.label, rowRange: cell.rowRange, colRange: cell.colRange, nextMs, nextReviewAt: record.nextReviewAt, record };
    all.push(item);
    if (nextMs <= nowMs) due.push(item);
    else if (nextMs <= nowMs + windowMs) upcoming.push(item);
  }
  due.sort((a, b) => cellOrder(a) - cellOrder(b));
  upcoming.sort((a, b) => a.nextMs - b.nextMs || cellOrder(a) - cellOrder(b));
  return { all, due, upcoming, skipped, total: Array.isArray(records) ? records.length : 0 };
}
