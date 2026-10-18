import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeChallenge,
  decodeChallenge,
  buildChallengeUrl,
  parseChallengeFromUrl,
  ChallengeTamperedError,
  InvalidChallengeError,
} from '../packages/community/src/challenges.js';
import { createGenerator } from '../packages/core/src/generator.js';

test('encodes and decodes challenge configuration deterministically', () => {
  const original = {
    seed: 'zetamaster-community-challenge-seed-42',
    durationSeconds: 90,
    enabled: ['add', 'mul'],
    addition: { left: [10, 50], right: [10, 50] },
    multiplication: { left: [3, 9], right: [10, 50] },
    questionBudgetMs: 2500,
  };

  const token1 = encodeChallenge(original);
  const token2 = encodeChallenge(original);
  assert.equal(token1, token2, 'Deterministic encoding produces identical tokens');
  assert.ok(token1.startsWith('zmch_'));

  const decoded = decodeChallenge(token1);
  assert.equal(decoded.seed, original.seed);
  assert.equal(decoded.rules.durationSeconds, original.durationSeconds);
  assert.deepEqual(decoded.rules.enabled, original.enabled);
  assert.deepEqual(decoded.rules.addition, original.addition);
  assert.deepEqual(decoded.rules.multiplication, original.multiplication);
  assert.equal(decoded.rules.questionBudgetMs, original.questionBudgetMs);
});

test('challenge generators produce identical problem sequences from decoded seed', () => {
  const config = {
    seed: 'shared-duel-test-123',
    durationSeconds: 120,
    enabled: ['add', 'sub', 'mul', 'div'],
  };

  const token = encodeChallenge(config);
  const decoded = decodeChallenge(token);

  const genA = createGenerator(decoded.rules, config.seed);
  const genB = createGenerator(decoded.rules, decoded.seed);

  for (let i = 0; i < 25; i++) {
    const qA = genA();
    const qB = genB();
    assert.deepEqual(qA, qB, `Question index ${i} matches exactly draw-for-draw`);
  }
});

test('strictly forbids PII and personal metadata in challenge encoding', () => {
  assert.throws(
    () => encodeChallenge({ seed: 's1', user: 'alice@example.com' }),
    InvalidChallengeError
  );
  assert.throws(
    () => encodeChallenge({ seed: 's1', username: 'alice' }),
    InvalidChallengeError
  );
  assert.throws(
    () => encodeChallenge({ seed: 's1', score: 85 }),
    InvalidChallengeError
  );
  assert.throws(
    () => encodeChallenge({ seed: 's1', timestamp: Date.now() }),
    InvalidChallengeError
  );
});

test('detects tampered tokens with invalid checksum', () => {
  // Construct a bundle where payload was altered without updating checksum
  const alteredPayload = [{ v: 1, s: 'tampered-seed', d: 120, op: ['add'] }, 'wrong-checksum-1234'];
  const b64 = Buffer.from(JSON.stringify(alteredPayload)).toString('base64url');
  const tamperedToken = 'zmch_' + b64;
  assert.throws(() => decodeChallenge(tamperedToken), ChallengeTamperedError);
});

test('URL builder and parser handle hash fragments and query params', () => {
  const challenge = { seed: 'url-test-seed', durationSeconds: 120 };
  const url = buildChallengeUrl('https://example.com/app/', challenge);
  assert.ok(url.includes('#challenge=zmch_'));

  const parsed = parseChallengeFromUrl(url);
  assert.ok(parsed);
  assert.equal(parsed.seed, 'url-test-seed');

  // Query parameter support
  const queryUrl = 'https://example.com/?c=' + encodeChallenge(challenge);
  const parsedQuery = parseChallengeFromUrl(queryUrl);
  assert.equal(parsedQuery.seed, 'url-test-seed');

  // Empty or invalid URL returns null safely
  assert.equal(parseChallengeFromUrl('https://example.com/app/'), null);
});
