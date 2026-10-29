import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyPastedExplanation, coachPlanForLesson } from '../apps/web/src/coach-ui.js';
import { CONSENT_KEY, readCoachConsent, requestCoachExplanation, CoachUnavailableError } from '../packages/services/src/ai-explanations.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const html = () => readFileSync(resolve(root, 'index.html'), 'utf8');
const main = () => readFileSync(resolve(root, 'apps/web/src/main.js'), 'utf8');

// Academy close-out wiring (F26–F29) and the F02/F04/F05 setup surface. DOM modules are trusted
// for structure here the way the app is assembled in the browser; the pure flows they wrap are
// tested directly below (coach verifier, entry settings in entry-settings.test.js, the duel
// machine in duel-ui.test.js, sequence analytics in sequence-replay.test.js).

test('setup panel exposes the F02 custom operand ranges and the F05 settings', () => {
  const page = html();
  for (const id of ['custom-ranges', 'add-left-min', 'add-left-max', 'add-right-min', 'add-right-max', 'mul-left-min', 'mul-left-max', 'mul-right-min', 'mul-right-max']) {
    assert.ok(page.includes(`id="${id}"`), `#${id} exists in the setup panel`);
  }
  for (const id of ['entry-settings', 'setting-keypad', 'setting-sound']) {
    assert.ok(page.includes(`id="${id}"`), `#${id} exists (keypad/sound toggles)`);
  }
  assert.ok(page.includes('id="keypad"'), 'on-screen keypad container in the game panel');
  // The inverse-generation semantics are stated where users set ranges, never hidden.
  assert.ok(page.includes('generated inversely'), 'sub/div derive from the addition/multiplication axes');
});

test('main.js wires the F02/F04/F05/F27/F29 modules and surfaces', () => {
  const src = main();
  for (const module of ['replay-ui.js', 'duel-ui.js', 'coach-ui.js', 'entry-settings.js', 'cues.js']) {
    assert.ok(src.includes(module), `main.js imports ${module}`);
  }
  for (const call of ['renderReplayUI(', 'renderDuelUI(', 'renderCoachUI(', 'renderKeypad(', 'syncKeypad(', 'prefillCustomRanges(', 'customRulesWithRanges(', 'soundCue(', 'feedAnswer(']) {
    assert.ok(src.includes(call), `${call} is part of the wiring`);
  }
  const page = html();
  assert.ok(page.includes('id="duel-panel"'), 'strategy duel panel lives in the Academy view');
  assert.ok(page.includes('id="coach-panel"'), 'AI coach verifier panel lives in the Academy view');
  assert.ok(page.includes('id="replay-root"') || src.includes('id="replay-root"'), 'sequence history root in analytics');
});

test('the stale F26 display-only note is gone: every Academy card rehearses', () => {
  assert.ok(!main().includes('not built yet (F26)'), 'division cards practice step by step now');
  assert.ok(main().includes('GUIDE_LESSON_IDS.includes(l.id)'), 'the plan guard still gates unknown cards');
});

test('coach verifier: consent is required, deterministic claims are the only success path', () => {
  const store = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; })();
  const plan = coachPlanForLesson('addition-round');
  assert.ok(plan, 'the canonical addition-round card has a checked plan');
  assert.equal(plan.result, 115, 'the plan reproduces the card answer deterministically');
  const good = 'Start from 118: 68 + 50 = 118 and then 118 − 3 = 115.';
  const consented = { enabled: true, updatedAt: '2026-10-19T00:00:00.000Z', transport: 'off' };
  const ok = verifyPastedExplanation({ consent: consented, text: good, lessonId: 'addition-round', plan });
  assert.equal(ok.verified, true);
  assert.ok(ok.claims.some(claim => claim.includes('68 + 50 = 118')), 'each claim is the recomputed statement');
  const wrong = '68 + 50 = 119.';
  const bad = verifyPastedExplanation({ consent: consented, text: wrong, lessonId: 'addition-round', plan });
  assert.equal(bad.verified, false);
  assert.match(bad.reason, /wrong-arithmetic/, 'one wrong number rejects the whole text');
  const invented = 'That saves 45 seconds per problem.';
  const unlisted = verifyPastedExplanation({ consent: consented, text: invented, lessonId: 'addition-round', plan });
  assert.equal(unlisted.verified, false);
  assert.match(unlisted.reason, /unlisted-number|unverifiable/, 'invented quantities never pass');
  // Consent OFF rejects before anything else, mirroring the module-level contract.
  assert.deepEqual(readCoachConsent(store), { enabled: false, updatedAt: null, transport: 'off' });
  const off = verifyPastedExplanation({ consent: readCoachConsent(store), text: good, lessonId: 'addition-round', plan });
  assert.equal(off.verified, false);
  assert.equal(off.reason, 'consent-required');
  // Transport fields are refused outright — this build has no network path, by design.
  assert.throws(
    () => requestCoachExplanation({ provider: 'x', text: good }, plan, { consent: consented }),
    error => error instanceof CoachUnavailableError && error.reason === 'transport-not-installed',
    'a payload reaching for a provider is refused before any verification',
  );
});

test('coach verifier: pasted prose is never graded input — the gate has no answer access', () => {
  const plan = coachPlanForLesson('divide-inverse');
  assert.ok(plan, 'division cards have plans too (F26 close-out)');
  assert.ok(plan.steps.every(s => Number.isSafeInteger(s.answer)));
  // The verification result object exposes no answer fields at all.
  const ok = verifyPastedExplanation({ consent: { enabled: true, updatedAt: '2026-10-19T00:00:00.000Z', transport: 'off' }, text: '672 ÷ 7: 7 × 100 = 700, 700 − 672 = 28, 28 ÷ 7 = 4, 100 − 4 = 96.', lessonId: 'divide-inverse', plan });
  assert.equal(ok.verified, true);
  assert.ok(!('correct' in ok) && !('score' in ok), 'no grading surface exists on the verifier output');
});

test('feature records: the polished features are marked implemented in the authoritative spec', () => {
  const spec = JSON.parse(readFileSync(resolve(root, 'specs/features.json'), 'utf8'));
  const forIds = ['F02', 'F04', 'F05', 'F10', 'F26', 'F27', 'F28', 'F29'];
  for (const id of forIds) {
    const row = spec.features.find(f => f.id === id);
    assert.ok(row, `${id} exists`);
    assert.equal(row.status, 'implemented', `${id} status reflects the shipped surface`);
    assert.ok(row.acceptance?.[0]?.length > 20, `${id} keeps a descriptive acceptance line`);
  }
});
