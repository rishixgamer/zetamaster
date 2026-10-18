import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readLeaderboardConsent,
  setLeaderboardConsent,
  submitLeaderboardScore,
  getLeaderboardRankings,
  sanitizeAlias,
  LeaderboardStore,
  LeaderboardUnavailableError,
} from '../packages/services/src/leaderboard.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { createGenerator } from '../packages/core/src/generator.js';

function makeMockStorage() {
  const map = new Map();
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
}

function createLegitSession(seed = 'leaderboard-seed-1', score = 42) {
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
      responseMs: 1400 + ((i * 123) % 1500),
    });
  }
  return {
    mode: 'benchmark',
    benchmark: true,
    elapsedMs: 120000,
    startedAt: '2026-10-18T12:00:00Z',
    seed,
    score,
    events,
  };
}

test('consent is off by default and requires explicit opt-in timestamp', () => {
  const store = makeMockStorage();
  const consent1 = readLeaderboardConsent(store);
  assert.equal(consent1.enabled, false);

  assert.throws(() => setLeaderboardConsent(store, 'yes', '2026-10-18T10:00:00Z'));
  assert.throws(() => setLeaderboardConsent(store, true, 'invalid-date'));

  const consent2 = setLeaderboardConsent(store, true, '2026-10-18T10:00:00Z');
  assert.equal(consent2.enabled, true);
  assert.equal(readLeaderboardConsent(store).enabled, true);
});

test('sanitizeAlias enforces privacy and rejects PII or contact info', () => {
  assert.equal(sanitizeAlias('SpeedCalc_99'), 'SpeedCalc_99');
  assert.equal(sanitizeAlias('  MathWizard  '), 'MathWizard');

  // Rejects emails
  assert.throws(() => sanitizeAlias('alice@example.com'), RangeError);
  // Rejects URLs
  assert.throws(() => sanitizeAlias('https://mybot.com'), RangeError);
  // Rejects short / long
  assert.throws(() => sanitizeAlias('a'), RangeError);
  assert.throws(() => sanitizeAlias('a'.repeat(30)), RangeError);
});

test('submitting score requires active consent', () => {
  const store = new LeaderboardStore();
  const session = createLegitSession();

  assert.throws(
    () => submitLeaderboardScore({ session, alias: 'AliceMath', store, consent: { enabled: false } }),
    LeaderboardUnavailableError
  );
});

test('submits verified scores and maintains sorted rankings', () => {
  const store = new LeaderboardStore();
  const consent = { enabled: true, updatedAt: '2026-10-18T10:00:00Z' };

  const s1 = createLegitSession('seed-p1', 40);
  const s2 = createLegitSession('seed-p2', 55);
  const s3 = createLegitSession('seed-p3', 48);

  const res1 = submitLeaderboardScore({ session: s1, alias: 'Player_One', store, consent });
  assert.equal(res1.verified, true);
  assert.equal(res1.rank, 1);

  const res2 = submitLeaderboardScore({ session: s2, alias: 'Player_Two', store, consent });
  assert.equal(res2.verified, true);
  assert.equal(res2.rank, 1); // 55 is top

  const res3 = submitLeaderboardScore({ session: s3, alias: 'Player_Three', store, consent });
  assert.equal(res3.rank, 2); // 48 is second

  const rankings = getLeaderboardRankings(store);
  assert.equal(rankings.length, 3);
  assert.equal(rankings[0].alias, 'Player_Two');
  assert.equal(rankings[0].score, 55);
  assert.equal(rankings[1].alias, 'Player_Three');
  assert.equal(rankings[1].score, 48);
  assert.equal(rankings[2].alias, 'Player_One');
  assert.equal(rankings[2].score, 40);
});

test('rejects cheated sessions during submission', () => {
  const store = new LeaderboardStore();
  const consent = { enabled: true, updatedAt: '2026-10-18T10:00:00Z' };
  const fakeSession = { ...createLegitSession(), score: 999 }; // impossible score

  assert.throws(
    () => submitLeaderboardScore({ session: fakeSession, alias: 'Cheater', store, consent }),
    LeaderboardUnavailableError
  );
});

test('enforces rate limits on score submission', () => {
  const store = new LeaderboardStore();
  const consent = { enabled: true, updatedAt: '2026-10-18T10:00:00Z' };
  const session = createLegitSession();

  // First 5 submissions pass
  for (let i = 0; i < 5; i++) {
    submitLeaderboardScore({
      session,
      alias: `Player_${i}`,
      token: 'client-token-1',
      store,
      consent,
      now: new Date(Date.UTC(2026, 9, 18, 12, i)).toISOString(),
    });
  }

  // 6th within the hour fails
  assert.throws(
    () => submitLeaderboardScore({
      session,
      alias: 'Player_Overflow',
      token: 'client-token-1',
      store,
      consent,
      now: new Date(Date.UTC(2026, 9, 18, 12, 10)).toISOString(),
    }),
    LeaderboardUnavailableError
  );
});
