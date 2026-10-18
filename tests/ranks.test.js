import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUNITY_RANKS,
  MIN_VERIFIED_BENCHMARKS,
  getRankForScore,
  evaluateBenchmarkRank,
  evaluatePracticeActivity,
  filterVerifiedBenchmarks,
} from '../packages/community/src/ranks.js';

const makeBenchmark = (score, day = 1) => ({
  score,
  benchmark: true,
  mode: 'benchmark',
  elapsedMs: 120000,
  startedAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
  events: [],
});

const makePractice = (score, mode = 'custom', day = 1) => ({
  score,
  benchmark: false,
  mode,
  elapsedMs: 60000,
  startedAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
  events: [],
});

test('community ranks define 8 distinct milestone tiers', () => {
  assert.equal(COMMUNITY_RANKS.length, 8);
  const ids = COMMUNITY_RANKS.map(r => r.id);
  assert.deepEqual(ids, [
    'unranked',
    'novice',
    'apprentice',
    'practitioner',
    'adept',
    'expert',
    'master',
    'grandmaster',
  ]);

  for (const rank of COMMUNITY_RANKS) {
    assert.ok(rank.title.length > 0);
    assert.ok(rank.description.length > 0);
    assert.ok(rank.badge.length > 0);
  }
});

test('getRankForScore correctly classifies scores into tiers', () => {
  assert.equal(getRankForScore(NaN).id, 'unranked');
  assert.equal(getRankForScore(null).id, 'unranked');
  assert.equal(getRankForScore(25).id, 'novice');
  assert.equal(getRankForScore(30).id, 'apprentice');
  assert.equal(getRankForScore(39).id, 'apprentice');
  assert.equal(getRankForScore(40).id, 'practitioner');
  assert.equal(getRankForScore(49).id, 'practitioner');
  assert.equal(getRankForScore(50).id, 'adept');
  assert.equal(getRankForScore(59).id, 'adept');
  assert.equal(getRankForScore(60).id, 'expert');
  assert.equal(getRankForScore(69).id, 'expert');
  assert.equal(getRankForScore(70).id, 'master');
  assert.equal(getRankForScore(79).id, 'master');
  assert.equal(getRankForScore(80).id, 'grandmaster');
  assert.equal(getRankForScore(105).id, 'grandmaster');
});

test('insufficient benchmarks (< 5) returns unranked with required remaining runs', () => {
  const sessions = [
    makeBenchmark(45, 1),
    makeBenchmark(48, 2),
    makeBenchmark(52, 3),
  ];
  const evalResult = evaluateBenchmarkRank(sessions);
  assert.equal(evalResult.calibrated, false);
  assert.equal(evalResult.rank.id, 'unranked');
  assert.equal(evalResult.verifiedCount, 3);
  assert.equal(evalResult.minRequired, 5);
  assert.equal(evalResult.runsNeeded, 2);
  assert.equal(evalResult.sustainedScore, null);
});

test('sustained rank is evaluated from rolling median of trailing benchmarks', () => {
  const sessions = [
    makeBenchmark(40, 1),
    makeBenchmark(42, 2),
    makeBenchmark(44, 3),
    makeBenchmark(46, 4),
    makeBenchmark(48, 5),
  ];
  const res = evaluateBenchmarkRank(sessions);
  assert.equal(res.calibrated, true);
  assert.equal(res.verifiedCount, 5);
  assert.equal(res.sustainedScore, 44);
  assert.equal(res.rank.id, 'practitioner');
  assert.equal(res.nextRank.id, 'adept');
  assert.equal(res.pointsToNext, 6); // 50 - 44
  assert.ok(res.stability);
});

test('practice sessions are strictly isolated and never contaminate rank', () => {
  const sessions = [
    makeBenchmark(72, 1),
    makeBenchmark(74, 2),
    makeBenchmark(70, 3),
    makeBenchmark(76, 4),
    makeBenchmark(78, 5),
    // Practice scores, even huge or zero, must NOT affect benchmark rank
    makePractice(150, 'sprint', 6),
    makePractice(10, 'drill', 7),
    makePractice(200, 'custom', 8),
  ];

  const benchmarkOnly = filterVerifiedBenchmarks(sessions);
  assert.equal(benchmarkOnly.length, 5);

  const res = evaluateBenchmarkRank(sessions);
  assert.equal(res.verifiedCount, 5);
  assert.equal(res.sustainedScore, 74);
  assert.equal(res.rank.id, 'master');

  const practice = evaluatePracticeActivity(sessions);
  assert.equal(practice.sessionsCount, 3);
  assert.equal(practice.totalSolves, 360);
});
