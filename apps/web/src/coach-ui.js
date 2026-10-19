/**
 * AI math-coach verifier UI (F29, M3 close-out). Presentation module for the deterministic gate in
 * `packages/curriculum/src/coach.js` and the consent state machine in
 * `packages/services/src/ai-explanations.js`. What this panel is:
 *
 * - an explicit opt-in/consent toggle (OFF by default, device-local, revocable at any time);
 * - the checked local brief for one Academy card — the human-written card content plus the plan's
 *   own step statements, all recomputed by deterministic code in the packages;
 * - a verifier for *pasted prose*: any explanation produced by any external tool the user chose.
 *   The prose is untrusted narrative. `requestCoachExplanation` recomputes every arithmetic claim
 *   against the checked plan and shows the verified claims, or states exactly why the text was
 *   rejected — rejected text is never rendered as endorsed content.
 *
 * What this panel never does: grade answers, touch the session engine, or send anything anywhere.
 * This build has no network transport and stores no keys — `requestCoachExplanation` refuses
 * payloads that carry provider/endpoint/apiKey fields, and consent OFF throws before anything else.
 */
import { LESSONS } from '../../../packages/curriculum/src/lessons.js';
import { planForLesson } from '../../../packages/curriculum/src/guides.js';
import { coachBrief } from '../../../packages/curriculum/src/coach.js';
import { readCoachConsent, setCoachConsent, requestCoachExplanation, CoachUnavailableError } from '../../../packages/services/src/ai-explanations.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const EXAMPLE_MATCH = /^(\d+) ([+−×÷]) (\d+)$/;

/** The checked plan behind a card's canonical example (same parse rule as the Academy cards). */
export function coachPlanForLesson(lessonId) {
  const lesson = LESSONS.find(l => l.id === lessonId);
  if (!lesson) return null;
  const match = EXAMPLE_MATCH.exec(lesson.example);
  return match ? planForLesson(lessonId, Number(match[1]), Number(match[3])) : null;
}

/** Module-level viewer state: selected card and the last verification outcome. */
let coachView = { lessonId: LESSONS[0]?.id ?? null, outcome: null };

/**
 * Pure verification step, exported for tests: takes consent + text + lessonId, returns a plain
 * outcome `{verified, claims?, reason?, note?, errorTitle?}` — no DOM, no timer, no grading.
 */
export function verifyPastedExplanation({ consent, text, lessonId, plan }) {
  if (!plan) return { verified: false, errorTitle: 'No checked plan', note: 'This card has no deterministic step plan to verify against.' };
  try {
    const result = requestCoachExplanation({ text }, plan, { consent });
    return { verified: result.verified, claims: result.claims ?? [], reason: result.reason, note: result.note, text };
  } catch (error) {
    if (error instanceof CoachUnavailableError) return { verified: false, reason: error.reason, note: error.message, errorTitle: 'Coach unavailable' };
    return { verified: false, reason: 'unexpected', note: String(error?.message ?? error), errorTitle: 'Unexpected failure' };
  }
}

function briefHtml(brief, plan) {
  const planSteps = plan
    ? `<ol>${plan.steps.map(s => `<li>${esc(s.prompt)} = <strong>${esc(s.answer)}</strong></li>`).join('')}</ol>`
    : '<p class="empty">No step plan for this card (division and some domain edges stay display-only in the plan layer).</p>';
  return `<div class="coach-brief">
    <h3 class="subhead">Checked local brief — the source of truth</h3>
    <div class="academy-problem">${esc(brief.problem)}</div>
    <ol>${brief.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>
    <p class="secondary">Answer: <strong>${esc(brief.result)}</strong></p>
    ${planSteps}
    <p class="small muted">${esc(brief.note)}</p>
  </div>`;
}

function outcomeHtml(outcome) {
  if (!outcome) return '';
  if (outcome.verified) {
    const claims = (outcome.claims ?? []).map(claim => `<li>${esc(claim)}</li>`).join('');
    return `<div class="coach-verdict coach-verified"><strong>✓ Verified against the plan.</strong> Every arithmetic claim recomputed exactly:
      <ul>${claims}</ul></div>`;
  }
  return `<div class="coach-verdict coach-rejected"><strong>✗ Not accepted — ${esc(outcome.errorTitle ?? 'verification failed')}</strong> (${esc(outcome.reason ?? 'unknown')}): ${esc(outcome.note ?? '')} The text was not shown as verified content, and nothing was saved or sent.</div>`;
}

export function renderCoachUI({ root, store = globalThis.localStorage ?? null } = {}) {
  if (!root) return;
  const consent = readCoachConsent(store);
  const lessonId = LESSONS.some(l => l.id === coachView.lessonId) ? coachView.lessonId : (LESSONS[0]?.id ?? null);
  const plan = lessonId ? coachPlanForLesson(lessonId) : null;
  const brief = lessonId ? coachBrief(lessonId, plan) : null;
  const options = LESSONS.map(l => `<option value="${esc(l.id)}"${l.id === lessonId ? ' selected' : ''}>${esc(l.title)} · ${esc(l.example)}</option>`).join('');
  const lastOutcome = coachView.lessonId === lessonId ? coachView.outcome : null;
  root.innerHTML = `<div class="section-header"><div><div class="eyebrow">AI MATH COACH · VERIFY FIRST, SHOW SECOND</div><h2 class="section-title">Explanation verifier</h2></div><span class="tag">${consent.enabled ? 'OPTED IN' : 'OFF — NOTHING SENT'}</span></div>
  <label class="consent-toggle-row coach-consent">
    <input type="checkbox" id="coach-consent"${consent.enabled ? ' checked' : ''}>
    <span><strong>Enable the pasted-explanation verifier</strong> (off by default, revocable anytime)</span>
  </label>
  <p class="small muted" style="margin-top:6px">This build makes no network calls for the coach and stores no keys: the only input is prose you paste from any tool you chose. Verification is deterministic arithmetic — every equation recomputed against the checked plan; invented numbers, wrong arithmetic and unverifiable prose are rejected before display. The verifier never grades answers and cannot affect scores. Transport: ${esc(consent.transport)}${consent.updatedAt ? ` · last change ${esc(new Date(consent.updatedAt).toLocaleString())}` : ''}.</p>
  ${brief ? briefHtml(brief, plan) : '<div class="empty">No Academy card found.</div>'}
  <label class="field"><span>CARD</span><select id="coach-lesson">${options}</select></label>
  <label class="field"><span>PASTE THE EXPLANATION TO VERIFY</span><textarea id="coach-text" rows="4" placeholder="e.g. 68 + 50 = 118, then 118 − 3 = 115"></textarea></textarea></label>
  <div class="subline-inline"><button type="button" class="primary-btn" id="coach-verify" ${consent.enabled ? '' : 'title="Enable the verifier first — it is opt-in."'}>Verify against the plan ↗</button></div>
  ${outcomeHtml(lastOutcome)}
  <p class="small muted">Rejected prose is echoed nowhere as endorsed content and never gradable input: the rehearsal's answer checks stay in the Academy step flow and the game engine, which this panel cannot touch. Any real provider wiring is future work requiring an explicit privacy review (data-minimal prompt: problem operands only — never scores, latency or telemetry).</p>`;
  bindCoach(root, store);
}

function bindCoach(root, store) {
  root.querySelector('#coach-consent')?.addEventListener('change', e => {
    try {
      setCoachConsent(store, e.target.checked === true, new Date().toISOString());
    } catch { /* restoring the (boolean-required) state machine; bad input can't happen from a checkbox */ }
    coachView = { ...coachView, outcome: null };
    renderCoachUI({ root, store });
  });
  root.querySelector('#coach-lesson')?.addEventListener('change', e => {
    coachView = { lessonId: e.target.value, outcome: null };
    renderCoachUI({ root, store });
  });
  root.querySelector('#coach-verify')?.addEventListener('click', () => {
    const consent = readCoachConsent(store);
    const lessonId = coachView.lessonId;
    const plan = coachPlanForLesson(lessonId);
    const text = root.querySelector('#coach-text')?.value ?? '';
    coachView = { ...coachView, outcome: verifyPastedExplanation({ consent, text, lessonId, plan }) };
    renderCoachUI({ root, store });
  });
}
