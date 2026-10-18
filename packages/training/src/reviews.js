import { AUTOMATICITY_MS } from '../../analytics/src/skill-model.js';
import { SKILL_MIN_SAMPLES, skillCellFromId } from './skills.js';

/**
 * Drill-completion review semantics for the persisted spaced repetition (F19, M2 slice 2).
 * docs/SKILLS.md documents this contract in full; the essentials:
 *
 * A *completed* pattern-drill run on one skill cell records exactly one review record when it has
 * enough evidence, and nothing otherwise. "Fast and correct" is deliberately narrow: the engine does
 * not persist wrong attempts (F07 follow-up), so correctness inside a drill cannot be measured from
 * stored events — only the solves are. The review therefore measures recall speed against the
 * automatization line, and the outcome is honest about that limitation in the UI copy.
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
 * explicit inputs. Non-finite or negative `responseMs` entries are ignored.
 *
 * Returns:
 * - `null` — record nothing: the run was ended early (interrupted review) or has fewer than
 *   `minSolves` in-cell solves (not enough evidence to say anything about motion);
 * - otherwise `{ wasFastAndCorrect, solveCount, medianMs, fastMs }`, where success means at least
 *   half of the in-cell solves finished at or under `fastMs` (equivalently: nearest-rank median
 *   ≤ fastMs, pinned edge by edge in tests/reviews.test.js).
 */
export function drillReviewOutcome(events, { endedEarly = false, fastMs = SKILL_REVIEW_FAST_MS, minSolves = SKILL_REVIEW_MIN_SOLVES } = {}) {
  if (endedEarly) return null;
  const solves = (Array.isArray(events) ? events : [])
    .map(e => (e && typeof e === 'object' ? e.responseMs : null))
    .filter(ms => Number.isFinite(ms) && ms >= 0);
  if (solves.length < minSolves) return null;
  const medianMs = nearestRankMedian(solves);
  return { wasFastAndCorrect: medianMs <= fastMs, solveCount: solves.length, medianMs, fastMs };
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
