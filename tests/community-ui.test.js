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

test('F46 board copy is a personal list on this device', () => {
  const main = readFileSync(resolve(root, 'apps/web/src/main.js'), 'utf8');
  const html = readFileSync(resolve(root, 'apps/web/index.html'), 'utf8');
  const boardStart = main.indexOf('const entriesRows');
  const boardEnd = main.indexOf("$('#lb-clear-btn')");
  assert.ok(boardStart > 0 && boardEnd > boardStart, 'leaderboard markup and save handler should exist');
  const board = main.slice(boardStart, boardEnd);
  assert.match(board, /id="lb-consent-toggle"/);
  assert.match(board, /never leave this browser/);
  assert.doesNotMatch(board, /\bglobal\b/i);
  assert.doesNotMatch(board, /\bverified\b/i);
  assert.doesNotMatch(board, /↗/);
  assert.doesNotMatch(board, /opt in/i);
  const community = html.slice(html.indexOf('id="view-community"'), html.indexOf('id="view-quant"'));
  assert.doesNotMatch(community, /\bglobal\b/i);
  assert.doesNotMatch(community, /\bverified\b/i);
  assert.match(community, /never leave/);
});

test('the community board uses one localStorage store for read, save, and clear', () => {
  const main = readFileSync(resolve(root, 'apps/web/src/main.js'), 'utf8');
  assert.match(main, /const deviceLeaderboard = new LeaderboardStore\(localStorage\)/);
  assert.match(main, /deviceLeaderboard\.getEntries\(/);
  assert.match(main, /store: deviceLeaderboard/);
  assert.match(main, /deviceLeaderboard\.clear\(/);
  assert.doesNotMatch(main, /defaultLeaderboardStore/);
});

test('F46 spec lists the local board and the missing server', () => {
  const spec = JSON.parse(readFileSync(resolve(root, 'specs/features.json'), 'utf8'));
  const f46 = spec.features.find(item => item.id === 'F46');
  const text = f46.acceptance.join(' ');
  assert.equal(f46.status, 'partial');
  assert.match(text, /this browser/);
  assert.match(text, /client-side replay/);
  assert.match(text, /server/);
  assert.match(text, /accounts/);
  assert.match(text, /independent verification/);
});

test('threat model treats replay as client-side and duels.js as unreachable', () => {
  const doc = readFileSync(resolve(root, 'docs/COMMUNITY_THREAT_MODEL.md'), 'utf8');
  assert.match(doc, /same browser/);
  assert.match(doc, /trust boundary/);
  assert.match(doc, /server re-runs it/);
  assert.match(doc, /duels\.js/);
  assert.match(doc, /not imported by the app/);
  assert.doesNotMatch(doc, /global leaderboards \(F46\)/);
});

test('README what-works names the local community features', () => {
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  const works = readme.split('## What is not finished')[0];
  for (const id of ['F44', 'F45', 'F46', 'F47']) assert.match(works, new RegExp(id));
  assert.match(works, /this browser/);
  assert.match(works, /never leave the browser/);
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
