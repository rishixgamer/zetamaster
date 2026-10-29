import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { evaluateBenchmarkRank, evaluatePracticeActivity } from '../packages/community/src/ranks.js';
import { evaluateAchievements } from '../packages/community/src/achievements.js';
import { encodeChallenge, decodeChallenge, buildChallengeUrl, parseChallengeFromUrl } from '../packages/community/src/challenges.js';
import { verifyBenchmarkSession } from '../packages/services/src/anti-cheat.js';
import { submitLeaderboardScore, getLeaderboardRankings, LeaderboardStore } from '../packages/services/src/leaderboard.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { createGenerator } from '../packages/core/src/generator.js';

const root = resolve(new URL('..', import.meta.url).pathname);

test('index.html contains all M5 community UI containers and modals', () => {
  const html = readFileSync(resolve(root, 'apps/web/index.html'), 'utf8');

  // Navigation tab
  assert.ok(html.includes('data-view="community"'), 'Community tab in header nav');

  // Community view section
  assert.ok(html.includes('id="view-community"'), 'view-community container');
  assert.ok(html.includes('id="community-root"'), 'community-root container');

  // Challenge modal
  assert.ok(html.includes('id="challenge-modal"'), 'challenge-modal dialog');
  assert.ok(html.includes('id="challenge-modal-close"'), 'challenge-modal-close button');
  assert.ok(html.includes('id="challenge-modal-body"'), 'challenge-modal-body container');
});

test('main.js wires M5 community modules and event handlers', () => {
  const main = readFileSync(resolve(root, 'apps/web/src/main.js'), 'utf8');

  // Imports verified
  assert.ok(main.includes('packages/community/src/ranks.js'), 'imports ranks.js');
  assert.ok(main.includes('packages/community/src/achievements.js'), 'imports achievements.js');
  assert.ok(main.includes('packages/community/src/challenges.js'), 'imports challenges.js');
  assert.ok(main.includes('packages/services/src/anti-cheat.js'), 'imports anti-cheat.js');
  assert.ok(main.includes('packages/services/src/leaderboard.js'), 'imports leaderboard.js');

  // Function calls & handlers
  assert.ok(main.includes('renderCommunity()'), 'renderCommunity function defined');
  assert.ok(main.includes('openChallengeModal('), 'openChallengeModal function defined');
  assert.ok(main.includes('checkUrlChallenge()'), 'checkUrlChallenge function defined');
  assert.ok(main.includes('challenge-modal-close'), 'challenge modal close bound');
});

test('complete M5 community flow: rank, achievements, challenge URL, and verified submission', () => {
  const seed = 'flow-test-seed-1';
  const gen = createGenerator(BENCHMARK_RULES, seed);
  const events = [];

  for (let i = 0; i < 45; i++) {
    const q = gen();
    events.push({
      op: q.op,
      left: q.left,
      right: q.right,
      answer: q.answer,
      correct: true,
      responseMs: 1600 + ((i * 123) % 1000),
    });
  }

  const session = {
    mode: 'benchmark',
    benchmark: true,
    elapsedMs: 120000,
    startedAt: '2026-10-18T12:00:00Z',
    seed,
    score: 45,
    events,
  };

  // 1. Anti-cheat verified
  const check = verifyBenchmarkSession(session);
  assert.equal(check.verified, true);

  // 2. Rank evaluation with 5 benchmarks. Each run needs its own seed: a repeated seed
  // counts once, which is the benchmark-integrity rule, not five scores from one sequence.
  const benchmarkRuns = Array.from({ length: 5 }, (_, idx) => ({
    ...session,
    seed: `${seed}-${idx}`,
    startedAt: new Date(Date.UTC(2026, 9, 10 + idx)).toISOString(),
  }));
  const rankEval = evaluateBenchmarkRank(benchmarkRuns);
  assert.equal(rankEval.calibrated, true);
  assert.equal(rankEval.rank.id, 'practitioner'); // 45 is practitioner (40–49)

  // 3. Achievements evaluation
  const achEval = evaluateAchievements(benchmarkRuns);
  assert.ok(achEval.totalUnlocked > 0);
  assert.ok(achEval.unlocked.some(a => a.id === 'first_benchmark'));
  assert.ok(achEval.unlocked.some(a => a.id === 'pace_30'));

  // 4. Challenge URL generation & parsing
  const challengeUrl = buildChallengeUrl('https://example.com/app/', {
    seed: 'custom-flow-seed',
    durationSeconds: 60,
  });
  const decodedChallenge = parseChallengeFromUrl(challengeUrl);
  assert.equal(decodedChallenge.seed, 'custom-flow-seed');
  assert.equal(decodedChallenge.rules.durationSeconds, 60);

  // 5. Leaderboard submission
  const store = new LeaderboardStore();
  const consent = { enabled: true, updatedAt: '2026-10-18T10:00:00Z' };
  const subResult = submitLeaderboardScore({
    session,
    alias: 'Calculon_45',
    store,
    consent,
  });
  assert.equal(subResult.verified, true);
  assert.equal(subResult.rank, 1);
  assert.equal(subResult.entry.score, 45);

  const rankings = getLeaderboardRankings(store);
  assert.equal(rankings[0].alias, 'Calculon_45');
});
