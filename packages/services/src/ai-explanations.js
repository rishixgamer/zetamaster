import { verifyCoachExplanation } from '../../curriculum/src/coach.js';

/**
 * AI-explanation service boundary (F29, M3 close-out). The contract, the consent state machine,
 * and the deterministic verification gate — with the transport deliberately left uninstalled:
 *
 * - **No network in this build.** The app ships with zero remote service dependencies; the coach
 *   never calls `fetch`, stores no API keys, and `requestCoachExplanation` accepts only prose the
 *   user themselves pasted from any tool they chose. Any real provider wiring is future work that
 *   must come with an explicit privacy review, its own consent step, and a data-minimal prompt
 *   (problem operands only — never scores, latency or telemetry).
 * - **Explicit opt-in.** Consent is `false` by default, flips only through an affirmative user
 *   action in the UI, is stored device-locally (`zetamaster-ai-coach-consent-v1`), and can be
 *   revoked at any moment. OFF means every request throws `consent-required`.
 * - **Deterministic verification is the gate, not the model.** `verifyCoachExplanation`
 *   (packages/curriculum/src/coach.js) recomputes every arithmetic claim against the checked
 *   lesson plan; text that fails any claim is never returned for display.
 * - **No grading, ever.** The module's only inputs are prose and a verified plan; it has no access
 *   to session results, scores, telemetry or the rehearsal's answer inputs, and nothing it
 *   returns affects scoring, correctness marking, or review records.
 */
export const CONSENT_KEY = 'zetamaster-ai-coach-consent-v1';

export class CoachUnavailableError extends Error {
  constructor(reason, note) {
    super(note ?? reason);
    this.name = 'CoachUnavailableError';
    this.reason = reason;
  }
}

const consentOn = consent => Boolean(consent) && consent.enabled === true && typeof consent.updatedAt === 'string';

/** Read consent from a localStorage-like store; absent or malformed reads as explicitly OFF. */
export function readCoachConsent(store = null) {
  try {
    const raw = store?.getItem?.(CONSENT_KEY) ?? null;
    const parsed = raw === null ? null : JSON.parse(raw);
    return consentOn(parsed)
      ? { enabled: true, updatedAt: parsed.updatedAt, transport: 'off' }
      : { enabled: false, updatedAt: null, transport: 'off' };
  } catch {
    return { enabled: false, updatedAt: null, transport: 'off' };
  }
}

/**
 * Flip consent. `enabled` must be an explicit boolean — no implicit truthiness — and `now` must be
 * a valid ISO string so the consent record is reproducible in tests. No-op values (same as current
 * state) return the current record without rewriting it.
 */
export function setCoachConsent(store, enabled, now) {
  if (typeof enabled !== 'boolean') throw new RangeError('setCoachConsent needs an explicit boolean');
  if (typeof now !== 'string' || Number.isNaN(Date.parse(now))) throw new RangeError('setCoachConsent needs a valid ISO timestamp');
  const previous = readCoachConsent(store);
  if (previous.enabled === enabled && previous.updatedAt !== null) return previous;
  const state = { enabled, updatedAt: now, transport: 'off' };
  store.setItem(CONSENT_KEY, JSON.stringify(state));
  return state;
}

/**
 * Run pasted explanation prose through the gate. Shape: `{ text }` plus the checked `plan` (from
 * `planForLesson`) to verify against; `consent` comes from `readCoachConsent` at the call site.
 *
 * Returns `{ verified: true, text, claims }` or `{ verified: false, reason, note }` — it NEVER
 * returns unverified prose labeled for display. Throws (never silently degrades) when:
 * - consent is OFF — `consent-required`;
 * - the payload tries to reach a remote provider (`provider` / `endpoint` / `apiKey` fields
 *   present) — `transport-not-installed`; this build has no network path for the coach, by design.
 */
export function requestCoachExplanation(payload, plan, { consent } = {}) {
  if (!consentOn(consent)) {
    throw new CoachUnavailableError('consent-required', 'The AI math coach is opt-in and currently off; enable it in the Academy to verify an explanation.');
  }
  if (payload && (payload.provider !== undefined || payload.endpoint !== undefined || payload.apiKey !== undefined)) {
    throw new CoachUnavailableError('transport-not-installed', 'This build has no network transport for the coach: explanations are verified locally, from pasted prose only.');
  }
  const text = typeof payload?.text === 'string' ? payload.text : null;
  const checks = verifyCoachExplanation(text, plan);
  return checks.ok
    ? { verified: true, text, claims: checks.claims }
    : { verified: false, reason: checks.reason, note: checks.note, text };
}

/**
 * The pure gate future transports must funnel through: a provider integration calls exactly this
 * function and returns only its result, so a model can never ship arithmetic the plan contradicts.
 */
export { verifyCoachExplanation };
