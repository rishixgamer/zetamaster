import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  encodeChallenge,
  decodeChallenge,
  buildChallengeUrl,
  parseChallengeFromUrl,
  challengePreset,
  ChallengeTamperedError,
  InvalidChallengeError,
} from '../packages/community/src/challenges.js';
import { createGenerator, makeQuestion } from '../packages/core/src/generator.js';
import { BENCHMARK_RULES, benchmarkEquivalent } from '../packages/core/src/rulesets.js';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { resolveLaunchSeed } from '../packages/core/src/seed-policy.js';

const root = resolve(new URL('..', import.meta.url).pathname);

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

test('a decoded challenge launches as custom practice even when its rules match the benchmark', () => {
  const decoded = decodeChallenge(encodeChallenge({
    seed: 'benchmark-shaped-challenge',
    durationSeconds: BENCHMARK_RULES.durationSeconds,
    enabled: [...BENCHMARK_RULES.enabled],
    addition: JSON.parse(JSON.stringify(BENCHMARK_RULES.addition)),
    multiplication: JSON.parse(JSON.stringify(BENCHMARK_RULES.multiplication)),
  }));
  // An edited link can carry the benchmark snapshot. The checksum does not stop that edit.
  const hostile = { seed: decoded.seed, rules: JSON.parse(JSON.stringify(BENCHMARK_RULES)) };
  assert.equal(JSON.stringify(hostile.rules), JSON.stringify(BENCHMARK_RULES));
  assert.equal(benchmarkEquivalent(hostile.rules), true);

  const preset = challengePreset(hostile);
  assert.equal(preset.mode, 'custom');
  assert.equal(preset.seed, 'benchmark-shaped-challenge');
  assert.equal(JSON.stringify(preset.rules), JSON.stringify(BENCHMARK_RULES));

  const launch = resolveLaunchSeed({
    mode: preset.mode,
    fieldSeed: 'typed-over',
    presetSeed: preset.seed,
    randomSeed: '11111111-1111-4111-8111-111111111111',
  });
  assert.deepEqual(launch, {
    seed: 'benchmark-shaped-challenge',
    seedSource: 'preset',
    clearField: false,
  });

  let t = 0;
  const session = new ArithmeticSession({
    rules: preset.rules,
    clock: () => t,
    wallClock: () => '2026-01-01T00:00:00.000Z',
    generator: () => makeQuestion('add', 2, 3, 1),
    mode: preset.mode,
    seed: launch.seed,
    seedSource: launch.seedSource,
  });
  session.start();
  t += 120000;
  const result = session.finish();
  assert.equal(result.mode, 'custom');
  assert.equal(result.benchmark, false);
  assert.equal(result.elapsedMs, 120000);
  assert.equal(benchmarkEquivalent(result.rules), true);

  const main = readFileSync(resolve(root, 'apps/web/src/main.js'), 'utf8');
  const accept = main.slice(main.indexOf('function openChallengeModal'), main.indexOf('function checkUrlChallenge'));
  assert.match(accept, /challengePreset\(/);
  assert.doesNotMatch(accept, /mode:\s*'benchmark'/);
});

test('checksum copy says it catches accidental corruption and does not stop a deliberate edit', () => {
  const challenges = readFileSync(resolve(root, 'packages/community/src/challenges.js'), 'utf8');
  const comment = challenges.slice(0, challenges.indexOf('export const CHALLENGE_TOKEN_PREFIX'));
  assert.match(comment, /accidental corruption/);
  assert.match(comment, /does not stop a deliberate edit/);

  const err = new ChallengeTamperedError();
  assert.equal(err.name, 'ChallengeTamperedError');
  assert.equal(err.code, 'TAMPERED');
  assert.match(err.message, /accidental corruption/);
  assert.match(err.message, /does not stop a deliberate edit/);

  const main = readFileSync(resolve(root, 'apps/web/src/main.js'), 'utf8');
  const blurb = main.slice(main.indexOf('HEAD-TO-HEAD CHALLENGES'), main.indexOf('id="ch-generate-btn"'));
  assert.match(blurb, /accidental corruption/);
  assert.match(blurb, /does not stop a deliberate edit/);
  assert.doesNotMatch(blurb, /tamper-proof/);

  const threat = readFileSync(resolve(root, 'docs/COMMUNITY_THREAT_MODEL.md'), 'utf8');
  const sharing = threat.slice(threat.indexOf('### B. Zero PII in Challenge Sharing'), threat.indexOf('### C. Pseudonymous'));
  assert.match(sharing, /accidental corruption/);
  assert.match(sharing, /does not stop a deliberate edit/);
  assert.match(sharing, /always launch as practice/);
  assert.match(sharing, /mode: 'custom'/);
  assert.match(sharing, /byte-identical to `BENCHMARK_RULES`/);
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
