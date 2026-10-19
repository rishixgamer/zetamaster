/**
 * Sequence history replay viewer (F04, M1 close-out). Presentation module like `quant-ui.js`:
 * all data comes from `packages/analytics/src/sequence.js` (pure), the run itself stays in the
 * caller's `startGame`. Two surfaces:
 *
 * - a list of recent locally saved sessions, each openable step by step;
 * - the sequence viewer: question-by-question rows (operands, answer, latency, entry telemetry and
 *   the bounded wrong-attempt history), navigable with buttons or arrow keys (← → Home End), plus
 *   a practice replay launch that feeds the whole recorded sequence — rebuilt from source operands
 *   by the game — back through the ordinary replay path.
 *
 * Practice-only by construction: `startGame` builds a `mode: 'replay'` run from the payload, which
 * cannot validate as the benchmark; nothing the viewer does writes history or reviews.
 */
import { sequenceRows, sequenceSummary, sequencePlayback } from '../../../packages/analytics/src/sequence.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = value => Number.isFinite(value) ? (Number.isInteger(value) && value < 100000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`) : '—';

export const REPLAY_NOTE = 'Replaying a sequence is always practice: an ordinary replay-mode run with a fresh timer and fresh scoring, never a benchmark, and it writes no review records.';

const viewerState = { sessionId: null, cursor: 0 };

/** Pure-state helpers, exported for tests: open, move (clamped), close. */
export function openSequenceViewer(sessionId) {
  viewerState.sessionId = typeof sessionId === 'string' ? sessionId : null;
  viewerState.cursor = 0;
}
export function moveSequenceCursor(delta, size) {
  if (viewerState.sessionId === null || !Number.isSafeInteger(size) || size <= 0) { viewerState.cursor = 0; return 0; }
  viewerState.cursor = Math.max(0, Math.min(size - 1, viewerState.cursor + delta));
  return viewerState.cursor;
}
export function setSequenceCursor(index, size) {
  viewerState.cursor = Number.isSafeInteger(index) && size > 0 ? Math.max(0, Math.min(size - 1, index)) : 0;
  return viewerState.cursor;
}

function sessionListRow(session) {
  const when = session.startedAt ? new Date(session.startedAt).toLocaleString() : 'unknown time';
  const questions = Array.isArray(session.events) ? session.events.length : 0;
  return `<div class="review-row"><span class="review-label">${esc(when)} · ${esc(session.mode ?? 'unknown')}${session.benchmark ? ' · verified benchmark' : ' · practice'}</span><span class="review-meta">${esc(session.score ?? '—')} solved · ${esc(questions)} questions${session.seed && session.seed !== '—' ? ` · seed ${esc(session.seed)}` : ''}</span><button type="button" class="secondary-btn" data-replay-open="${esc(session.id)}">View sequence <span aria-hidden="true">→</span></button></div>`;
}

function rowDetail(row) {
  const parts = [];
  if (Number.isFinite(row.responseMs)) parts.push(fmt(row.responseMs));
  if (Number.isFinite(row.firstInputMs)) parts.push(`first key ${fmt(row.firstInputMs)} (proxy)`);
  if (Number.isFinite(row.corrections) && row.corrections > 0) parts.push(`${row.corrections} correction${row.corrections === 1 ? '' : 's'}`);
  if (Number.isFinite(row.wrongSubmissions) && row.wrongSubmissions > 0) parts.push(`${row.wrongSubmissions} Enter on a wrong field`);
  if (Array.isArray(row.wrongAttempts) && row.wrongAttempts.length) parts.push(`wrong values: ${row.wrongAttempts.map(a => esc(a.value)).join(', ')}`);
  else if (row.wrongAttempts === null) parts.push('no wrong-attempt history recorded (engine-1 record)');
  if (row.tags?.length) parts.push(esc(row.tags.join(', ')));
  return parts.join(' · ');
}

function viewerHtml(session) {
  const summary = sequenceSummary(session);
  const rows = sequenceRows(session);
  const cursor = Math.max(0, Math.min(viewerState.cursor, Math.max(0, rows.length - 1)));
  const body = rows.length
    ? `<div class="seq-list" tabindex="0" role="list" aria-label="Recorded question sequence, arrow keys to move">${rows.map((row, i) => `
      <div class="seq-row${i === cursor ? ' is-current' : ''}" role="listitem"${i === cursor ? ' aria-current="true"' : ''}>
        <span class="seq-idx">${row.index}</span>
        <span class="seq-label">${esc(row.label)}${row.answer !== null ? ` = ${row.answer}` : ''}</span>
        <span class="seq-status">${row.unanswered ? 'final · unanswered' : row.correct ? 'solved' : 'not solved'}</span>
        <span class="seq-meta">${rowDetail(row)}</span>
      </div>`).join('')}</div>`
    : `<div class="empty">No recorded questions in this run${summary.endedEarly ? ' — it ended early' : ''}.</div>`;
  const playback = sequencePlayback(session);
  return `<div class="section-header"><div><div class="eyebrow">SEQUENCE VIEWER · PRACTICE REPLAY</div><h2 class="section-title" id="replay-title">Step through this run</h2></div><button type="button" class="secondary-btn" data-replay-close>← All sessions</button></div>
    <p class="secondary">${esc(new Date(summary.startedAt ?? Date.now()).toLocaleString())} · ${esc(summary.mode)}${summary.benchmark ? ' · verified benchmark' : ' · practice'} · score ${esc(summary.score ?? '—')}${summary.endedEarly ? ' · ended early' : ''} · ${summary.questions} question${summary.questions === 1 ? '' : 's'}${summary.seed && summary.seed !== '—' ? ` · seed ${esc(summary.seed)}` : ''}</p>
    ${body}
    <div class="subline">
      <button type="button" class="secondary-btn" data-seq-first ${rows.length ? '' : 'disabled'}>First</button>
      <button type="button" class="secondary-btn" data-seq-prev ${rows.length ? '' : 'disabled'}>← Previous</button>
      <button type="button" class="secondary-btn" data-seq-next ${rows.length ? '' : 'disabled'}>Next →</button>
      <button type="button" class="secondary-btn" data-seq-last ${rows.length ? '' : 'disabled'}>Last</button>
      <button type="button" class="primary-btn" data-replay-launch ${playback.length ? '' : 'disabled'}>Replay the whole sequence · 120 s practice <span aria-hidden="true">↗</span></button>
    </div>
    <p class="small muted">${esc(REPLAY_NOTE)} The replay rebuilds every problem from its recorded source operands, loops the sequence until the 120 seconds end, and never counts as a benchmark. ${esc(summary.note)}</p>`;
}

export function renderReplayUI({ root, sessions = [], onReplay = () => {} }) {
  if (!root) return;
  if (viewerState.sessionId !== null) {
    const session = sessions.find(s => s?.id === viewerState.sessionId);
    if (!session) openSequenceViewer(null); // deleted or never existed: fall back to the list
    else {
      root.innerHTML = `<div class="panel replay-panel">${viewerHtml(session)}</div>`;
      // Re-highlight the current row after cursor moves without re-rendering the whole list.
      const list = root.querySelector('.seq-list');
      const paint = () => root.querySelectorAll('.seq-row').forEach((el, i) => {
        el.classList.toggle('is-current', i === viewerState.cursor);
        if (i === viewerState.cursor) el.setAttribute('aria-current', 'true');
        else el.removeAttribute('aria-current');
      });
      root.querySelector('[data-seq-first]')?.addEventListener('click', () => { setSequenceCursor(0, sequenceRows(session).length); paint(); });
      root.querySelector('[data-seq-prev]')?.addEventListener('click', () => { moveSequenceCursor(-1, sequenceRows(session).length); paint(); });
      root.querySelector('[data-seq-next]')?.addEventListener('click', () => { moveSequenceCursor(1, sequenceRows(session).length); paint(); });
      root.querySelector('[data-seq-last]')?.addEventListener('click', () => { setSequenceCursor(sequenceRows(session).length - 1, sequenceRows(session).length); paint(); });
      root.querySelector('[data-replay-close]')?.addEventListener('click', () => { openSequenceViewer(null); renderReplayUI({ root, sessions, onReplay }); });
      root.querySelector('[data-replay-launch]')?.addEventListener('click', () => {
        const items = sequencePlayback(session);
        if (items.length) onReplay(items);
      });
      const seqList = root.querySelector('.seq-list');
      seqList?.addEventListener('keydown', e => {
        const size = sequenceRows(session).length;
        const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (step !== undefined) { e.preventDefault(); moveSequenceCursor(step, size); paint(); }
        else if (e.key === 'Home') { e.preventDefault(); setSequenceCursor(0, size); paint(); }
        else if (e.key === 'End') { e.preventDefault(); setSequenceCursor(size - 1, size); paint(); }
      });
      return;
    }
  }
  const list = sessions.length ? sessions.slice(0, 8).map(sessionListRow).join('') : '';
  root.innerHTML = `<div class="section-header"><div><div class="eyebrow">HISTORY REPLAY · F04</div><h2 class="section-title" id="replay-title">Sequence history</h2></div><span class="tag">LOCAL ONLY</span></div>
    ${sessions.length ? `<p class="secondary">Open a saved run to step through its question sequence — operands, answer, timing and the recorded entry behaviour — then replay the whole sequence as a fresh practice run.</p><div class="review-list">${list}</div>`
      : `<div class="empty">No saved sessions yet. Every run you finish history records here.</div>`}
    <p class="small muted">Sessions live on this device only. ${esc(REPLAY_NOTE)}</p>`;
  root.querySelectorAll('[data-replay-open]').forEach(btn => btn.addEventListener('click', () => {
    openSequenceViewer(btn.dataset.replayOpen);
    renderReplayUI({ root, sessions, onReplay });
  }));
}
