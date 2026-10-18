import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyBenchmarkSession,
  createSessionEvidence,
  MIN_HUMAN_RESPONSE_MS,
} from '../packages/services/src/anti-cheat.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { createGenerator } from '../packages/core/src/generator.js';

function createLegitSession(seed = 'test-legit-seed', score = 40) {
  const gen = createGenerator(BENCHMARK_RULES, seed);
  const events = [];

  for (let i = 0; i < score; i++) {
    const q = gen();
    // Natural human latency: 2000ms +/- varied latency
    const responseMs = 1500 + ((i * 137) % 1800);
    events.push({
      op: q.op,
      left: q.left,
      right: q.right,
      answer: q.answer,
      correct: true,
      responseMs,
    });
  }

  return {
    mode: 'benchmark',
    benchmark: true,
    elapsedMs: 120000,
    startedAt: '2026-10-18T10:00:00Z',
    seed,
    score,
    events,
  };
}

test('genuine simulated benchmark session passes anti-cheat verification', () => {
  const session = createLegitSession('fair-play-seed', 35);
  const res = verifyBenchmarkSession(session);
  assert.equal(res.verified, true);
  assert.equal(res.violations.length, 0);
  assert.equal(res.details.score, 35);
  assert.ok(res.details.meanLatencyMs > 1000);
  assert.ok(res.details.stdDevMs > 10);
});

test('rejects non-benchmark and custom practice sessions', () => {
  const custom = { ...createLegitSession(), mode: 'custom', benchmark: false };
  const res = verifyBenchmarkSession(custom);
  assert.equal(res.verified, false);
  assert.ok(res.violations.includes('NOT_A_BENCHMARK'));
});

test('rejects truncated or aborted sessions (< 120s)', () => {
  const aborted = { ...createLegitSession(), elapsedMs: 60000 };
  const res = verifyBenchmarkSession(aborted);
  assert.equal(res.verified, false);
  assert.ok(res.violations.includes('INCOMPLETE_DURATION'));
});

test('detects tampered question sequence deviating from PRNG seed replay', () => {
  const session = createLegitSession('replay-test-seed', 20);
  // Forge question at index 5
  session.events[5].left = 999;
  const res = verifyBenchmarkSession(session);
  assert.equal(res.verified, false);
  assert.ok(res.violations.some(v => v.includes('QUESTION_REPLAY_MISMATCH')));
});

test('detects superhuman reaction latency (< 100ms)', () => {
  const session = createLegitSession('speed-seed', 20);
  session.events[3].responseMs = 45; // 45ms is superhuman
  const res = verifyBenchmarkSession(session);
  assert.equal(res.verified, false);
  assert.ok(res.violations.includes('SUPERHUMAN_LATENCY_DETECTED'));
});

test('detects bot cadence with unnatural zero variance', () => {
  const session = createLegitSession('bot-seed', 30);
  // Robotic script answering exactly every 1200ms
  for (const ev of session.events) {
    ev.responseMs = 1200;
  }
  const res = verifyBenchmarkSession(session);
  assert.equal(res.verified, false);
  assert.ok(res.violations.includes('BOT_CADENCE_DETECTED'));
});

test('creates deterministic session evidence hash', () => {
  const session = createLegitSession('hash-seed', 25);
  const hash1 = createSessionEvidence(session);
  const hash2 = createSessionEvidence(session);
  assert.equal(hash1, hash2);
  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 8);
});
