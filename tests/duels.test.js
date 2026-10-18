import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DuelMatchManager,
  readDuelConsent,
  setDuelConsent,
  DuelError,
} from '../packages/services/src/duels.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { createGenerator } from '../packages/core/src/generator.js';

function createLegitSession(seed = 'duel-shared-seed', score = 40, baseLatency = 1500) {
  const gen = createGenerator(BENCHMARK_RULES, seed);
  const events = [];
  for (let i = 0; i < score; i++) {
    const q = gen();
    events.push({
      op: q.op,
      left: q.left,
      right: q.right,
      answer: q.answer,
      correct: true,
      responseMs: baseLatency + ((i * 101) % 500),
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

test('duel requires explicit consent to create or join', () => {
  const manager = new DuelMatchManager();
  assert.throws(
    () => manager.createDuel({ seed: 's1', creatorAlias: 'Alice', consent: { enabled: false } }),
    DuelError
  );
});

test('duel lifecycle: create, join, submit results, resolve winner', () => {
  const manager = new DuelMatchManager();
  const consent = { enabled: true, updatedAt: '2026-10-18T10:00:00Z' };
  const sharedSeed = 'duel-match-seed-99';

  const duel = manager.createDuel({ seed: sharedSeed, creatorAlias: 'Alice', consent });
  assert.equal(duel.status, 'waiting');
  assert.equal(duel.players.player1.alias, 'Alice');

  // Alice cannot play against herself
  assert.throws(
    () => manager.joinDuel({ duelId: duel.id, challengerAlias: 'Alice', consent }),
    DuelError
  );

  // Bob joins
  const activeDuel = manager.joinDuel({ duelId: duel.id, challengerAlias: 'Bob', consent });
  assert.equal(activeDuel.status, 'active');
  assert.equal(activeDuel.players.player2.alias, 'Bob');

  // Alice plays and scores 45
  const sAlice = createLegitSession(sharedSeed, 45, 1400);
  manager.submitResult({ duelId: duel.id, playerAlias: 'Alice', session: sAlice });
  assert.equal(duel.players.player1.submitted, true);
  assert.equal(duel.status, 'active'); // still waiting on Bob

  // Bob plays and scores 48
  const sBob = createLegitSession(sharedSeed, 48, 1300);
  const finished = manager.submitResult({ duelId: duel.id, playerAlias: 'Bob', session: sBob });
  assert.equal(finished.status, 'completed');
  assert.equal(finished.winner, 'Bob');
});

test('duel resolves ties based on lower latency', () => {
  const manager = new DuelMatchManager();
  const consent = { enabled: true, updatedAt: '2026-10-18T10:00:00Z' };
  const sharedSeed = 'duel-tie-seed';

  const duel = manager.createDuel({ seed: sharedSeed, creatorAlias: 'FastPlayer', consent });
  manager.joinDuel({ duelId: duel.id, challengerAlias: 'SlowPlayer', consent });

  // Both score 40, but FastPlayer has 1100ms baseLatency vs SlowPlayer 1900ms
  const sFast = createLegitSession(sharedSeed, 40, 1100);
  const sSlow = createLegitSession(sharedSeed, 40, 1900);

  manager.submitResult({ duelId: duel.id, playerAlias: 'FastPlayer', session: sFast });
  const finished = manager.submitResult({ duelId: duel.id, playerAlias: 'SlowPlayer', session: sSlow });

  assert.equal(finished.status, 'completed');
  assert.equal(finished.winner, 'FastPlayer');
});
