/**
 * Step-by-step sequence view of one stored session (F04, M1 slice). Analytics consumes immutable
 * historical records, so this module is pure: it turns one session record into
 *
 * - `sequenceRows(session)` — one row per recorded question, in recorded order, carrying the
 *   solved question's operands, displayed problem text, exact answer, latency fields, entry
 *   telemetry and bounded wrong-attempt history, plus the final unanswered problem (flagged, and
 *   never a solve);
 * - `sequenceSummary(session)` — header metadata (mode, seed, score, benchmark flag, counts);
 * - `sequencePlayback(session)` — the lossless replay payload: `{op, sourceLeft, sourceRight}`
 *   items in original order (the game rebuilds every displayed problem and answer from the source
 *   operands, never from stored display text). The final unanswered problem rides along so a
 *   replay run gives it one more chance; the run is always practice, as `startGame` guarantees.
 *
 * Every function tolerates missing fields (engine-1 records have no `wrongAttempts`, some records
 * have no tags) and degrades to empty rows — never throws — because history is user data.
 */

const OP_GLYPH = Object.freeze({ add: '+', sub: '\u2013', mul: '\u00d7', div: '\u00f7' });

const finite = v => Number.isFinite(v);
const safe = v => Number.isSafeInteger(v);

function displayLabel(event) {
  const glyph = event.symbol ?? OP_GLYPH[event.op] ?? '?';
  const left = safe(event.left) ? event.left : '\u2014';
  const right = safe(event.right) ? event.right : '\u2014';
  return `${left} ${glyph} ${right}`;
}

function rowFromEvent(event, index) {
  const row = {
    index,
    sequence: safe(event.sequence) ? event.sequence : index,
    op: event.op ?? null,
    label: displayLabel(event),
    answer: safe(event.answer) ? event.answer : null,
    tags: Array.isArray(event.tags) ? [...event.tags] : [],
    correct: event.correct === true,
  };
  for (const key of ['responseMs', 'firstInputMs', 'entryMs', 'corrections', 'wrongSubmissions', 'fullWrongAnswers', 'inputChanges']) {
    row[key] = finite(event[key]) ? event[key] : null;
  }
  row.wrongAttempts = Array.isArray(event.wrongAttempts)
    ? event.wrongAttempts.filter(a => a && typeof a.value === 'string').map(a => ({ value: a.value, atMs: finite(a.atMs) ? a.atMs : null }))
    : null; // null = no history recorded (engine-1 era), never mis-read as "no wrong attempts"
  return row;
}

/** One row per recorded question, in recorded order, with the final unanswered problem last. */
export function sequenceRows(session) {
  if (!session || !Array.isArray(session.events)) return [];
  const rows = session.events.map((event, i) => rowFromEvent(event ?? {}, i + 1));
  const final = session.finalUnanswered;
  if (final && (final.op || finite(final.left))) {
    const row = rowFromEvent(final, rows.length + 1);
    row.correct = false;
    row.unanswered = true;
    rows.push(row);
  }
  return rows;
}

/** Header metadata for the viewer; every field degrades gracefully. */
export function sequenceSummary(session) {
  if (!session) return { mode: '—', seed: '—', score: null, questions: 0, benchmark: false, startedAt: null, note: 'No session record.' };
  const events = Array.isArray(session.events) ? session.events : [];
  return {
    mode: session.mode ?? 'unknown',
    seed: typeof session.seed === 'string' && session.seed ? session.seed : '—',
    score: safe(session.score) ? session.score : (session.score ?? null),
    questions: events.length + (session.finalUnanswered ? 1 : 0),
    benchmark: session.benchmark === true,
    startedAt: typeof session.startedAt === 'string' ? session.startedAt : null,
    endedEarly: session.endedEarly === true,
    note: session.benchmark === true
      ? 'Standard benchmark — the replay of it below is practice, never a new benchmark.'
      : 'Practice run — replaying it stays practice as well.',
  };
}

/** Lossless replay payload for the existing `startGame({replay})` practice path. */
export function sequencePlayback(session) {
  const items = [];
  const candidates = [...(session?.events ?? []), ...(session?.finalUnanswered ? [session.finalUnanswered] : [])];
  for (const event of candidates) {
    if (!event) continue;
    if (!['add', 'sub', 'mul', 'div'].includes(event.op)) continue;
    if (!safe(event.sourceLeft) || !safe(event.sourceRight)) continue;
    items.push({ op: event.op, sourceLeft: event.sourceLeft, sourceRight: event.sourceRight });
  }
  return items;
}
