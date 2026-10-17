import { benchmarkEquivalent } from './rulesets.js';
/** Session is a framework-agnostic state machine. UI owns timers and focus. */
export class ArithmeticSession {
  constructor({ rules, generator, clock = () => performance.now(), wallClock = () => new Date().toISOString(), mode = 'benchmark', seed = '' }) {
    this.rules = rules;
    this.generator = generator;
    this.clock = clock;
    this.wallClock = wallClock;
    this.mode = mode;
    this.seed = seed;
    this.state = 'ready';
    this.events = [];
    this.score = 0;
    this.current = null;
    this.startedAt = null;
    this.questionShownAt = null;
    this.firstInputAt = null;
    this.inputChanges = 0;
    this.corrections = 0;
    this.wrongSubmissions = 0;
    this.pausedAt = null;
  }
  start() {
    if (this.state !== 'ready') throw new Error('Session already started');
    this.state = 'active'; this.startedAt = this.clock(); this.startedIso = this.wallClock(); this.advance(); return this.current;
  }
  advance() { this.current = this.generator(); this.questionShownAt = this.clock(); this.firstInputAt = null; this.inputChanges = 0; this.corrections = 0; this.wrongSubmissions = 0; }
  remainingMs() { if (this.state === 'ready') return this.rules.durationSeconds * 1000; if (this.state === 'finished') return 0; return Math.max(0, this.rules.durationSeconds * 1000 - (this.clock() - this.startedAt)); }
  recordInput(value, previousValue = '') {
    if (this.state !== 'active') return false;
    if (this.remainingMs() <= 0) { this.finish(); return false; }
    if (this.firstInputAt === null && value.length) this.firstInputAt = this.clock();
    if (value.length < previousValue.length) this.corrections++;
    this.inputChanges++;
    if (/^\d+$/.test(value) && Number(value) === this.current.answer) {
      const now = this.clock();
      this.events.push({ ...this.current, responseMs: now - this.questionShownAt, firstInputMs: this.firstInputAt === null ? null : this.firstInputAt - this.questionShownAt, entryMs: this.firstInputAt === null ? null : now - this.firstInputAt, corrections: this.corrections, wrongSubmissions: this.wrongSubmissions, inputChanges: this.inputChanges, completedAtMs: now - this.startedAt, correct: true });
      this.score++;
      if (this.remainingMs() <= 0) this.finish(); else this.advance();
      return true;
    }
    return false;
  }
  markWrongSubmission() { if (this.state === 'active') this.wrongSubmissions++; }
  /** Unanswered problem is recorded separately, not counted as incorrect answer. */
  finish() {
    if (this.state === 'finished' || this.state === 'ready') return this.summary();
    const elapsedMs = Math.min(this.clock() - this.startedAt, this.rules.durationSeconds * 1000);
    const finalUnanswered = this.current ? { ...this.current, elapsedMs: this.clock() - this.questionShownAt, corrections: this.corrections, wrongSubmissions: this.wrongSubmissions } : null;
    this.state = 'finished'; this.finishedIso = this.wallClock();
    this.result = { id: `${this.startedIso}-${this.seed}`, startedAt: this.startedIso, finishedAt: this.finishedIso, mode: this.mode, seed: this.seed, rules: this.rules, benchmark: this.mode === 'benchmark' && benchmarkEquivalent(this.rules) && elapsedMs >= this.rules.durationSeconds * 1000, score: this.score, elapsedMs, events: this.events, finalUnanswered };
    return this.result;
  }
  summary() { return this.result ?? null; }
}
