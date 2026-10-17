import { benchmarkEquivalent } from './rulesets.js';

/** Bump when answer acceptance or telemetry semantics change; stored on every result. */
export const ENGINE_VERSION = 'zm-engine-2';
/** Per-question cap on stored input snapshots; keeps records small and bounded. */
export const MAX_TRACE = 48;

/** Original Zetamac rule (audited 2026-10-17): trimmed field text equals the answer's decimal string. */
export function matchesAnswer(value, answer) { return String(value).trim() === String(answer); }
/** True while the field could still become the answer by typing more characters. */
export function isAnswerPrefix(value, answer) { return String(answer).startsWith(String(value).trim()); }

/**
 * Framework-agnostic session state machine (ready → active → finished). UI owns timers and focus.
 *
 * Per-question telemetry (see docs/TELEMETRY.md):
 * - corrections: input events that shortened the field (backspace/delete).
 * - wrongPrefixes: transitions from a still-possible prefix into text that cannot become the answer.
 * - fullWrongAnswers: times the field held a wrong value at least as long as the answer.
 * - wrongSubmissions: Enter pressed on a non-matching field (no game effect, as in the original).
 * - pasted: a single input event added more than one character.
 * - firstInputMs: time to first keystroke — a proxy, not exact thinking time.
 */
export class ArithmeticSession {
  constructor({ rules, generator, clock = () => performance.now(), wallClock = () => new Date().toISOString(), mode = 'benchmark', seed = '', captureTrace = true, drill = null }) {
    this.rules = rules;
    this.generator = generator;
    this.clock = clock;
    this.wallClock = wallClock;
    this.mode = mode;
    this.seed = seed;
    this.captureTrace = captureTrace;
    this.drill = drill;
    this.state = 'ready';
    this.events = [];
    this.score = 0;
    this.current = null;
    this.startedAt = null;
    this.integrity = { hiddenCount: 0, hiddenMs: 0, pasteEvents: 0 };
    this.hiddenSince = null;
    this.resetQuestionState();
  }
  resetQuestionState() {
    this.questionShownAt = null; this.firstInputAt = null; this.lastValue = '';
    this.inputChanges = 0; this.corrections = 0; this.wrongSubmissions = 0;
    this.wrongPrefixes = 0; this.fullWrongAnswers = 0; this.pasted = false; this.trace = [];
  }
  start() {
    if (this.state !== 'ready') throw new Error('Session already started');
    this.state = 'active'; this.startedAt = this.clock(); this.startedIso = this.wallClock(); this.advance(); return this.current;
  }
  advance() { this.resetQuestionState(); this.current = this.generator(); this.questionShownAt = this.clock(); }
  remainingMs() { if (this.state === 'ready') return this.rules.durationSeconds * 1000; if (this.state === 'finished') return 0; return Math.max(0, this.rules.durationSeconds * 1000 - (this.clock() - this.startedAt)); }
  /** Call from the UI timer; finishes the session once the deadline has passed. */
  tick() { if (this.state === 'active' && this.remainingMs() <= 0) this.finish(); return this.remainingMs(); }
  /**
   * Feed the full current field text after every input event. Returns true when it solved the problem.
   * `previousValue` is accepted for backward compatibility; the session tracks the prior value itself.
   */
  recordInput(value, previousValue) {
    if (this.state !== 'active') return false;
    if (this.remainingMs() <= 0) { this.finish(); return false; }
    value = String(value ?? '');
    const prior = this.lastValue;
    if (value === prior) return false;
    const now = this.clock();
    const answer = this.current.answer;
    if (this.firstInputAt === null && value.length) this.firstInputAt = now;
    if (value.length < prior.length) this.corrections++;
    if (value.length - prior.length > 1) { this.pasted = true; this.integrity.pasteEvents++; }
    const wrong = value.trim().length > 0 && !isAnswerPrefix(value, answer);
    if (wrong && (prior.trim().length === 0 || isAnswerPrefix(prior, answer))) this.wrongPrefixes++;
    if (wrong && value.trim().length >= String(answer).length && value.length > prior.length) this.fullWrongAnswers++;
    this.inputChanges++;
    this.lastValue = value;
    if (this.captureTrace && this.trace.length < MAX_TRACE) this.trace.push([Math.round(now - this.questionShownAt), value.slice(0, 16)]);
    if (!matchesAnswer(value, answer)) return false;
    this.events.push({ ...this.current, ...this.questionTelemetry(now), completedAtMs: now - this.startedAt, correct: true });
    this.score++;
    this.advance();
    return true;
  }
  questionTelemetry(now) {
    return {
      responseMs: now - this.questionShownAt,
      firstInputMs: this.firstInputAt === null ? null : this.firstInputAt - this.questionShownAt,
      entryMs: this.firstInputAt === null ? null : now - this.firstInputAt,
      corrections: this.corrections, wrongSubmissions: this.wrongSubmissions, wrongPrefixes: this.wrongPrefixes,
      fullWrongAnswers: this.fullWrongAnswers, pasted: this.pasted, inputChanges: this.inputChanges,
      shownAtMs: this.questionShownAt - this.startedAt,
      ...(this.captureTrace ? { trace: this.trace } : {}),
    };
  }
  /** Enter has no effect in the original game; it is recorded only when the field holds a non-answer. */
  markWrongSubmission() { if (this.state === 'active' && this.lastValue.trim().length) this.wrongSubmissions++; }
  /** Page visibility does not pause the clock (matches original). Hidden time is recorded for transparency. */
  recordVisibility(hidden) {
    if (this.state !== 'active') return;
    if (hidden && this.hiddenSince === null) { this.hiddenSince = this.clock(); this.integrity.hiddenCount++; }
    else if (!hidden && this.hiddenSince !== null) { this.integrity.hiddenMs += this.clock() - this.hiddenSince; this.hiddenSince = null; }
  }
  /** Unanswered problem is recorded separately, not counted as an incorrect answer. */
  finish({ endedEarly = false } = {}) {
    if (this.state === 'finished' || this.state === 'ready') return this.summary();
    const now = this.clock();
    const durationMs = this.rules.durationSeconds * 1000;
    const deadline = this.startedAt + durationMs;
    if (this.hiddenSince !== null) { this.integrity.hiddenMs += Math.min(now, deadline) - this.hiddenSince; this.hiddenSince = null; }
    const elapsedMs = Math.min(now - this.startedAt, durationMs);
    const finalUnanswered = this.current ? { ...this.current, ...this.questionTelemetry(Math.min(now, deadline)), elapsedMs: Math.min(now, deadline) - this.questionShownAt } : null;
    const fullDuration = elapsedMs >= durationMs && !endedEarly;
    this.state = 'finished'; this.finishedIso = this.wallClock();
    this.result = {
      id: `${this.startedIso}-${this.seed}`, startedAt: this.startedIso, finishedAt: this.finishedIso, mode: this.mode, seed: this.seed,
      rules: this.rules, engineVersion: ENGINE_VERSION, endedEarly: !fullDuration,
      benchmark: this.mode === 'benchmark' && benchmarkEquivalent(this.rules) && fullDuration,
      score: this.score, elapsedMs, events: this.events, finalUnanswered, integrity: { ...this.integrity },
      ...(this.drill ? { drill: this.drill } : {}),
    };
    return this.result;
  }
  summary() { return this.result ?? null; }
}
