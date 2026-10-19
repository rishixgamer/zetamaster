/**
 * Strategy duel practice UI (F27, M3 close-out). Presentation module for
 * `packages/curriculum/src/strategies.js`, which owns all the math and honesty notes: a duel is
 * two Academy technique cards whose operand domains overlap, a seeded fixture of shared-domain
 * problems, and per-side guided walks over the identical problems. The tally is the strategies
 * module's `duelTally` — matched-problem first-try counts only, never a significance test.
 *
 * The walk comes from `guides.planForLesson` per arm, and every check uses the game's
 * `checkGuideAnswer` (engine `matchesAnswer`), so answering cannot drift from the practice rule.
 * Nothing here is timed, scored, or persisted: duels teach comparison, they do not measure it,
 * and no review record or practice run is written.
 */
import { duelOps, duelFor, WHY_NO_DUEL, drawDuels, duelPlan, duelRecommendation, duelTally, DUEL_NOTE } from '../../../packages/curriculum/src/strategies.js';
import { LESSONS } from '../../../packages/curriculum/src/lessons.js';
import { checkGuideAnswer } from '../../../packages/curriculum/src/guides.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const OP_NAMES = { add: 'Addition', sub: 'Subtraction', mul: 'Multiplication', div: 'Division' };
const NO_DUEL = { usable: false, op: null };

/**
 * Pure duel state machine, exported for tests. `freshDuelState` builds progress over one seeded
 * fixture; `duelPlanFor` hands out the current arm's checked plan; `duelFeedAnswer` feeds one raw
 * answer text to the current step and returns the next state plus a plain
 * `{correct, stepDone, armDone, duelDone}` result — no DOM, no timers, nothing persisted.
 */
export function freshDuelState(op, seed) {
  const duel = duelFor(op);
  const fixture = duel ? drawDuels(op, seed, { pairs: 3 }) : null;
  if (!duel || !fixture) return { usable: false, op, seed };
  const [armA, armB] = fixture.order;
  return {
    usable: true, op, seed,
    fixture,                       // { op, seed, order, problems }
    arm: 0,                        // index into fixture.order
    problem: 0,                    // index into fixture.problems
    step: 0,                       // index into the current arm plan's steps
    firstTry: true,                // no wrong entry yet on this arm/problem
    message: '',
    tally: { [armA]: [], [armB]: [] },
    done: false,
  };
}

export function duelPlanFor(state) {
  if (!state?.usable || state.done) return null;
  const problem = state.fixture.problems[state.problem];
  const technique = state.fixture.order[state.arm];
  return duelPlan(state.op, problem, technique);
}

export function duelFeedAnswer(state, raw) {
  if (!state?.usable || state.done) return { state, correct: false, stepDone: false, armDone: false, duelDone: true };
  const plan = duelPlanFor(state);
  if (!plan) return { state: { ...state, done: true, message: 'No checked plan for this problem — the fixture is unusable.' }, correct: false, stepDone: false, armDone: false, duelDone: true };
  const step = plan.steps[state.step];
  if (!checkGuideAnswer(raw, step.answer)) {
    // A wrong entry never blocks the walk (teaching aid, not a gate) — it only costs first-try.
    return { state: { ...state, firstTry: false, message: 'Not this one — recompute and re-enter.' }, correct: false, stepDone: false, armDone: false, duelDone: false };
  }
  const last = state.step === plan.steps.length - 1;
  if (!last) return { state: { ...state, step: state.step + 1, message: '' }, correct: true, stepDone: true, armDone: false, duelDone: false };
  // Arm complete over this problem: record first-try exactly once, then advance to the next arm
  // (or problem). Tally arrays stay aligned with the fixture's problem order.
  const technique = state.fixture.order[state.arm];
  const tally = { ...state.tally, [technique]: [...(state.tally[technique] ?? []), { correct: state.firstTry }] };
  const nextArm = state.arm + 1;
  if (nextArm < state.fixture.order.length) {
    return { state: { ...state, tally, arm: nextArm, step: 0, firstTry: true, message: '' }, correct: true, stepDone: true, armDone: true, duelDone: false };
  }
  const nextProblem = state.problem + 1;
  const duelDone = nextProblem >= state.fixture.problems.length;
  return {
    state: { ...state, tally, arm: 0, step: 0, problem: nextProblem, firstTry: true, message: '', done: duelDone },
    correct: true, stepDone: true, armDone: true, duelDone,
  };
}

function duelStepRow(step, index, state) {
  if (index < state.step) return `<div class="academy-step"><span class="prompt">${esc(step.prompt)}</span><span class="reveal">= ${esc(step.answer)}</span></div>`;
  if (index === state.step) return `<div class="academy-step"><span class="prompt">${esc(step.prompt)}</span><input id="duel-answer" type="text" inputmode="numeric" autocomplete="off" maxlength="24" placeholder="?" aria-label="answer for ${esc(step.prompt)}"><button type="button" class="secondary-btn" data-duel-check>Check</button></div>`;
  return `<div class="academy-step"><span class="prompt">${esc(step.prompt)}</span><span class="reveal-muted">= ?</span></div>`;
}

function tallyHtml(state) {
  const { order, problems } = state.fixture;
  const [armA, armB] = order;
  const name = id => LESSONS.find(l => l.id === id)?.title ?? id;
  const tally = duelTally(state.tally[armA], state.tally[armB]);
  const rows = problems.map((problem, i) => {
    const rec = duelRecommendation(state.op, problem);
    const cell = ok => ok === true ? '✓ first try' : '—';
    return `<tr><td>${esc(problem.text)}</td><td>${cell(tally.per[i]?.correctA)}</td><td>${cell(tally.per[i]?.correctB)}</td><td>${rec ? esc(rec.why) : '—'}</td></tr>`;
  }).join('');
  return `<div class="duel-tally">
    <p class="secondary">${esc(name(armA))}: ${tally.correctA} of ${tally.compared} first-try · ${esc(name(armB))}: ${tally.correctB} of ${tally.compared} first-try · both first try ${tally.both} · neither ${tally.neither}.</p>
    <table class="mini-table"><thead><tr><th scope="col">Problem</th><th scope="col">${esc(name(armA))}</th><th scope="col">${esc(name(armB))}</th><th scope="col">Card default for this shape (hand-written, not a model)</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small muted">${esc(tally.note)} ${esc(DUEL_NOTE)}</p>
  </div>`;
}

/** Walk HTML for one duel state; pure apart from the esc() escaping of plain data strings. */
export function duelWalkHtml(state) {
  if (!state?.usable) return '';
  const duel = duelFor(state.op);
  if (!duel) return `<div class="empty">${esc(WHY_NO_DUEL[state.op] ?? 'No overlapping curated pair.')}</div>`;
  if (state.done) return `<h3 class="subhead">Duel complete</h3>${tallyHtml(state)}`;
  const problem = state.fixture.problems[state.problem];
  const plan = duelPlanFor(state);
  const technique = state.fixture.order[state.arm];
  const lesson = LESSONS.find(l => l.id === technique);
  if (!plan) return `<div class="empty">No checked plan for this problem — the fixture is unusable.</div>`;
  return `<h3 class="subhead">Problem ${state.problem + 1} of ${state.fixture.problems.length} · side ${state.arm + 1} of 2 · ${esc(lesson?.title ?? technique)}</h3>
    <div class="academy-problem duel-problem">${esc(problem.text)}<code>seed ${esc(state.seed)}</code></div>
    <p class="academy-note">Shared domain: ${esc(duel.sharedNote)} — both sides walk their own plan over the same numbers.</p>
    <div class="academy">${plan.steps.map((step, i) => duelStepRow(step, i, state)).join('')}
      <div class="academy-step" id="duel-message" aria-live="polite">${esc(state.message)}</div>
    </div>
    <p class="academy-note">First try counts: one wrong entry marks this side's attempt for the problem, but the walk continues — the point is comparing the two methods, not scoring you.</p>`;
}

function duelChips(state) {
  const ops = duelOps();
  return ['add', 'sub', 'mul', 'div'].map(op => {
    const available = ops.includes(op);
    const title = available ? 'Compare these two techniques' : (WHY_NO_DUEL[op] ?? 'No overlapping curated pair.');
    const selected = state?.usable && state.op === op ? ' selected' : '';
    return `<button type="button" class="chip${selected}" data-duel-op="${op}"${available ? '' : ` disabled title="${esc(title)}"`}>${esc(OP_NAMES[op])}${available ? '' : ' · no duel'}</button>`;
  }).join('');
}

/** Module-level duel state: one duel at a time, like the Academy rehearsals above it. */
let currentDuel = NO_DUEL;

export function renderDuelUI({ root }) {
  if (!root) return;
  const duel = currentDuel.usable ? duelFor(currentDuel.op) : null;
  const intro = duel
    ? `<p class="secondary">${esc(duel.label)} — ${esc(duel.sharedNote)}. Walk each side over ${currentDuel.fixture.problems.length} seeded problems; each finished duel lists the hand-written per-problem default next to the tally.</p>`
    : `<p class="secondary">Pick two overlapping Academy techniques and solve the same seeded problems twice — once with each method\'s step plan — to see where each one fits.</p>`;
  const walk = currentDuel.usable ? duelWalkHtml(currentDuel) : '';
  root.innerHTML = `<div class="section-header"><div><div class="eyebrow">STRATEGY SELECTION · COMPARE TWO METHODS ON THE SAME NUMBERS</div><h2 class="section-title">Strategy duel</h2></div><span class="tag">UNSCORED</span></div>
    ${intro}
    <div class="lesson-filters">${duelChips(currentDuel)}</div>
    ${walk}
    <div class="subline"><button type="button" class="secondary-btn" id="duel-new-fixture">${currentDuel.usable && !currentDuel.done ? 'Restart with a new fixture' : 'Draw a seeded fixture'} <span aria-hidden="true">↗</span></button></div>
    <p class="small muted">Duels exist only where two curated techniques genuinely overlap (${esc(duelOps().join(', '))}); the other operations state why instead of faking a pair. Both sides solve the identical problems one after the other — the second pass benefits from rehearsal, so the tally is a teaching aid, not an experiment. Untimed, unscored, never saved.</p>`;
  bindDuel(root);
}

function startDuel(op) {
  return freshDuelState(op, crypto.randomUUID());
}

function bindDuel(root) {
  root.querySelectorAll('[data-duel-op]').forEach(btn => btn.addEventListener('click', () => {
    const op = btn.dataset.duelOp;
    currentDuel = (currentDuel.usable && currentDuel.op === op) ? NO_DUEL : startDuel(op);
    renderDuelUI({ root });
  }));
  root.querySelector('#duel-new-fixture')?.addEventListener('click', () => {
    currentDuel = currentDuel.op ? startDuel(currentDuel.op) : NO_DUEL;
    renderDuelUI({ root });
  });
  const feed = () => {
    const raw = root.querySelector('#duel-answer')?.value ?? '';
    const { state, duelDone } = duelFeedAnswer(currentDuel, raw);
    currentDuel = state;
    renderDuelUI({ root });
    if (!duelDone) root.querySelector('#duel-answer')?.focus();
  };
  root.querySelectorAll('[data-duel-check]').forEach(btn => btn.addEventListener('click', feed));
  root.querySelectorAll('#duel-answer').forEach(input => input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    feed();
  }));
}
