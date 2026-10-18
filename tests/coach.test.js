import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyCoachExplanation, coachBrief,
} from '../packages/curriculum/src/coach.js';
import {
  CONSENT_KEY, readCoachConsent, setCoachConsent, requestCoachExplanation, CoachUnavailableError,
} from '../packages/services/src/ai-explanations.js';
import { planForLesson } from '../packages/curriculum/src/guides.js';
import { LESSONS } from '../packages/curriculum/src/lessons.js';

// Optional AI math coach (F29): explanations may come from anywhere, but they are shown only after
// a deterministic verifier recomputes every arithmetic claim — and the verifier never grades.

const memoryStore = () => {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
};
const planOf = id => planForLesson(id, ...cardOperands(id));
function cardOperands(id) {
  const lesson = LESSONS.find(l => l.id === id);
  const [a, , b] = lesson.example.split(' ');
  return [Number(a), Number(b)];
}

test('card steps joined as prose verify exactly, and claims are counted', () => {
  for (const lesson of LESSONS.slice(0, 4)) {
    const text = `${lesson.steps.join('; ')}. You can ${lesson.title.toLowerCase()} like this.`;
    const result = verifyCoachExplanation(text, planOf(lesson.id));
    assert.equal(result.ok, true, `${lesson.id}: ${result.reason ?? ''}`);
    assert.ok(result.claims.length >= lesson.steps.length, `${lesson.id} claims every step`);
  }
});

test('the reversed card-line form verifies ("28 = 7 ÷ 4" shape was re-authored, forward forms remain)', () => {
  const text = '7 × 100 = 700, so 700 − 672 = 28 and 28 ÷ 7 = 4; then 100 − 4 = 96.';
  const result = verifyCoachExplanation(text, planOf('divide-inverse'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.claims, ['7 × 100 = 700', '700 − 672 = 28', '28 ÷ 7 = 4', '100 − 4 = 96']);
});

test('one wrong number rejects the whole text', () => {
  const result = verifyCoachExplanation('68 + 50 = 118, and 118 − 3 = 116.', planOf('addition-round'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /wrong-arithmetic: 118 − 3 = 116/);
});

test('reversed-form arithmetic errors are caught too', () => {
  const result = verifyCoachExplanation('700 − 672 = 28, and 28 = 7 × 5.', planOf('divide-inverse'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /wrong-arithmetic: 7 × 5 = 28/);
});

test('invented quantities are rejected even without an equation', () => {
  const result = verifyCoachExplanation('This technique saves about 45 seconds per run.', planOf('addition-round'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /unlisted-number: 45/);
});

test('texts with no checkable arithmetic are unverifiable, not endorsed', () => {
  for (const text of ['Just do it in your head quickly.', '']) {
    assert.equal(verifyCoachExplanation(text, planOf('addition-round')).ok, false);
  }
  assert.match(verifyCoachExplanation('Just do it in your head quickly.', planOf('addition-round')).reason, /unverifiable/);
  assert.equal(verifyCoachExplanation(null, planOf('addition-round')).reason, 'non-string');
  assert.equal(verifyCoachExplanation('68 + 50 = 118.', null).reason, 'no-plan');
});

test('plain leftover equalities must also hold ("50 = 118" leavings are skipped, fresh ones checked)', () => {
  // Fresh plain equality: wrong → rejected; right → fine.
  assert.equal(verifyCoachExplanation('The subtraction never revisits 50 = 118.', planOf('addition-round')).ok, false);
  const good = verifyCoachExplanation('An anchor worth remembering: 28 = 28.', planOf('divide-inverse'));
  assert.equal(good.ok, true);
});

test('the coach brief is the deterministic card content, never invented', () => {
  const brief = coachBrief('addition-round', planOf('addition-round'));
  const lesson = LESSONS.find(l => l.id === 'addition-round');
  assert.deepEqual(brief.steps, lesson.steps);
  assert.equal(brief.title, lesson.title);
  assert.equal(brief.result, lesson.result);
  assert.equal(coachBrief('no-such-lesson'), null);
});

test('consent defaults to off and only an explicit boolean flips it', () => {
  const store = memoryStore();
  assert.deepEqual(readCoachConsent(store), { enabled: false, updatedAt: null, transport: 'off' });
  assert.deepEqual(readCoachConsent(null), { enabled: false, updatedAt: null, transport: 'off' });
  assert.throws(() => setCoachConsent(store, 'yes', '2026-10-18T00:00:00Z'), /explicit boolean/);
  const on = setCoachConsent(store, true, '2026-10-18T10:00:00.000Z');
  assert.equal(on.enabled, true);
  assert.deepEqual(readCoachConsent(store), { enabled: true, updatedAt: '2026-10-18T10:00:00.000Z', transport: 'off' });
  setCoachConsent(store, false, '2026-10-18T11:00:00.000Z');
  assert.equal(readCoachConsent(store).enabled, false);
  // Malformed stored state reads as off, never as on.
  store.setItem(CONSENT_KEY, '{"enabled":"yes"}');
  assert.equal(readCoachConsent(store).enabled, false);
});

test('requests are gated: no consent throws, no transport path exists, unverified never ships', () => {
  const plan = planOf('addition-round');
  const good = { text: '68 + 50 = 118.' };
  assert.throws(() => requestCoachExplanation(good, plan, { consent: null }), error => error instanceof CoachUnavailableError && error.reason === 'consent-required');
  const consent = { enabled: true, updatedAt: '2026-10-18T10:00:00.000Z', transport: 'off' };
  // Any attempt to name a provider is refused — there is no network transport in this build.
  for (const payload of [{ text: 'x', provider: 'openai' }, { text: 'x', endpoint: 'http://x' }, { text: 'x', apiKey: 'k' }]) {
    assert.throws(() => requestCoachExplanation(payload, plan, { consent }), error => error instanceof CoachUnavailableError && error.reason === 'transport-not-installed');
  }
  const ok = requestCoachExplanation(good, plan, { consent });
  assert.deepEqual(ok, { verified: true, text: good.text, claims: ['68 + 50 = 118'] });
  const bad = requestCoachExplanation({ text: '68 + 50 = 119.' }, plan, { consent });
  assert.equal(bad.verified, false);
  assert.match(bad.reason, /wrong-arithmetic/);
});
