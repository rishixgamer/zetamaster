import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { makeQuestion } from '../packages/core/src/generator.js';
import { resolveLaunchSeed, repeatedBenchmarkSeedReport } from '../packages/core/src/seed-policy.js';
import { sanitizeImportedSession, flagRepeatedBenchmarkSeeds } from '../packages/storage/src/sanitize.js';
import { importSessions, listSessions } from '../packages/storage/src/db.js';
import { benchmarkSeries, consistencySummary } from '../packages/analytics/src/consistency.js';
import { benchmarkProgress } from '../packages/analytics/src/progress.js';
import { selectPersonalBestBenchmark } from '../packages/analytics/src/ghost.js';
import { evaluateBenchmarkRank } from '../packages/community/src/ranks.js';
import { evaluateAchievements } from '../packages/community/src/achievements.js';
import { leaderboardCandidateSessions } from '../packages/services/src/leaderboard.js';

const root = resolve(new URL('..', import.meta.url).pathname);

function run({ score, seed, at, benchmark = true, events = [{ correct: true }] }) {
  return { benchmark, mode: 'benchmark', score, seed, startedAt: at, elapsedMs: 120000, events };
}

test('a benchmark launch ignores the seed field and a gauntlet probe seed', () => {
  const launch = resolveLaunchSeed({
    mode: 'benchmark', fieldSeed: 'abc', presetSeed: 'day-probe-seed', randomSeed: '11111111-1111-4111-8111-111111111111',
  });
  assert.deepEqual(launch, {
    seed: '11111111-1111-4111-8111-111111111111', seedSource: 'random', clearField: true,
  });
  assert.throws(() => resolveLaunchSeed({ mode: 'benchmark', fieldSeed: 'abc', randomSeed: '  ' }), RangeError);
});

test('a preset seed is not copied into the field, and a typed seed stays practice', () => {
  assert.deepEqual(
    resolveLaunchSeed({ mode: 'drill', fieldSeed: 'typed', presetSeed: 'day-probe-seed', randomSeed: 'uuid-1' }),
    { seed: 'day-probe-seed', seedSource: 'preset', clearField: false },
  );
  assert.deepEqual(
    resolveLaunchSeed({ mode: 'custom', fieldSeed: ' abc ', presetSeed: null, randomSeed: 'uuid-1' }),
    { seed: 'abc', seedSource: 'user', clearField: false },
  );
  assert.deepEqual(
    resolveLaunchSeed({ mode: 'custom', fieldSeed: '   ', presetSeed: '', randomSeed: 'uuid-1' }),
    { seed: 'uuid-1', seedSource: 'random', clearField: false },
  );
});

test('the train page uses the launch policy and does not write a preset seed into the field', () => {
  const main = readFileSync(resolve(root, 'apps/web/src/main.js'), 'utf8');
  assert.match(main, /resolveLaunchSeed\(/);
  assert.match(main, /seedSource:launchSeed\.seedSource/);
  assert.match(main, /result\.seedSource==='preset'/);
  assert.doesNotMatch(main, /\$\('#seed'\)\.value\s*=\s*preset/);
});

test('later runs on a repeated seed drop out of score metrics; the stored flag stays', () => {
  const early = run({ score: 40, seed: 'abc', at: '2026-01-01T00:00:00.000Z' });
  const late = run({ score: 90, seed: 'abc', at: '2026-01-02T00:00:00.000Z' });
  const other = run({ score: 70, seed: 'other', at: '2026-01-03T00:00:00.000Z' });
  const practice = { ...run({ score: 99, seed: 'abc', at: '2026-01-04T00:00:00.000Z' }), benchmark: false };
  const sessions = [late, practice, other, early];
  const report = repeatedBenchmarkSeedReport(sessions);
  assert.equal(report.excludedCount, 1);
  assert.equal(report.excluded.has(late), true);
  assert.equal(report.excluded.has(early), false);
  assert.deepEqual(benchmarkSeries(sessions).map(s => s.score), [40, 70]);
  assert.equal(benchmarkProgress(sessions).count, 2);
  assert.equal(benchmarkProgress(sessions).personalBest, 70);
  assert.equal(selectPersonalBestBenchmark(sessions).score, 70);
  const flagged = flagRepeatedBenchmarkSeeds(sessions);
  assert.equal(flagged[0].benchmark, true);
  assert.equal(flagged[0].seedReuseExcluded, true);
  assert.equal(flagged[3], early);
  assert.equal(late.benchmark, true);
  assert.equal('seedReuseExcluded' in late, false);
});

test('the same startedAt keeps the earlier input, and a reversed list still keeps the earliest day', () => {
  const a = run({ score: 10, seed: 'abc', at: '2026-01-01T00:00:00.000Z' });
  const b = run({ score: 20, seed: 'abc', at: '2026-01-01T00:00:00.000Z' });
  assert.equal(repeatedBenchmarkSeedReport([a, b]).excluded.has(b), true);
  assert.equal(repeatedBenchmarkSeedReport([b, a]).excluded.has(a), true);
  const early = run({ score: 10, seed: 'abc', at: '2026-01-01T00:00:00.000Z' });
  const later = run({ score: 80, seed: 'abc', at: '2026-02-01T00:00:00.000Z' });
  assert.equal(repeatedBenchmarkSeedReport([later, early]).excluded.has(later), true);
  assert.equal(repeatedBenchmarkSeedReport([later, early]).excluded.has(early), false);
});

test('blank seeds are not repeats, and ten copies of one seed cannot meet the 8-of-10 goal', () => {
  const blanks = [
    run({ score: 40, seed: '', at: '2026-01-01T00:00:00.000Z' }),
    run({ score: 50, seed: '   ', at: '2026-01-02T00:00:00.000Z' }),
    run({ score: 60, seed: undefined, at: '2026-01-03T00:00:00.000Z' }),
  ];
  assert.equal(repeatedBenchmarkSeedReport(blanks).excludedCount, 0);
  assert.equal(benchmarkProgress(blanks).count, 3);
  const copies = Array.from({ length: 10 }, (_, i) => run({
    score: 70, seed: 'abc', at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
  }));
  assert.equal(consistencySummary(copies).series.length, 1);
  assert.equal(consistencySummary(copies).goal.met, false);
  assert.equal(benchmarkProgress(copies).mastery70, false);
  const unique = copies.map((s, i) => ({ ...s, seed: `seed-${i}` }));
  assert.equal(consistencySummary(unique).goal.met, true);
  assert.equal(benchmarkProgress(unique).personalBest, 70);
});

test('a later higher score on the same seed still unlocks pace achievements and not rank', () => {
  const sessions = [
    run({ score: 20, seed: 'abc', at: '2026-01-01T00:00:00.000Z' }),
    run({ score: 80, seed: 'abc', at: '2026-01-02T00:00:00.000Z' }),
  ];
  const unlocked = evaluateAchievements(sessions).unlocked.map(a => a.id);
  assert.ok(unlocked.includes('pace_30'));
  assert.ok(unlocked.includes('pace_80'));
  assert.equal(benchmarkSeries(sessions).map(s => s.score).join(','), '20');
  assert.equal(evaluateBenchmarkRank(sessions).verifiedCount, 1);
  assert.equal(evaluateBenchmarkRank(sessions).calibrated, false);
  const copies = Array.from({ length: 10 }, (_, i) => run({
    score: 70, seed: 'same', at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
  }));
  assert.ok(evaluateAchievements(copies).unlocked.some(a => a.id === 'sustained_mastery'));
  assert.equal(consistencySummary(copies).goal.met, false);
  assert.equal(evaluateBenchmarkRank(copies).verifiedCount, 1);
});

test('rank and leaderboard submission ignore later runs on a repeated seed', () => {
  const copies = [1, 2, 3, 4, 5].map(day => run({
    score: 40, seed: 'same', at: `2026-02-0${day}T00:00:00.000Z`,
  }));
  assert.equal(evaluateBenchmarkRank(copies).calibrated, false);
  assert.equal(evaluateBenchmarkRank(copies).verifiedCount, 1);
  const newestFirst = [...copies].reverse();
  const candidates = leaderboardCandidateSessions(newestFirst);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].startedAt, '2026-02-01T00:00:00.000Z');
});

function finishedBenchmark({ seed = 'abc', seedSource = null, startedAt = '2026-03-01T00:00:00.000Z' } = {}) {
  let t = 0;
  const session = new ArithmeticSession({
    rules: BENCHMARK_RULES, clock: () => t, wallClock: () => startedAt,
    generator: () => makeQuestion('add', 2, 3, 1), mode: 'benchmark', seed,
    ...(seedSource ? { seedSource } : {}),
  });
  session.start();
  t = 120000;
  return session.finish();
}

test('import keeps a legacy benchmark, rejects a chosen seed, and flags duplicates in the batch', () => {
  const legacy = sanitizeImportedSession(finishedBenchmark());
  assert.equal(legacy.benchmark, true);
  assert.equal('seedSource' in legacy, false);
  const chosen = sanitizeImportedSession({ ...finishedBenchmark({ seedSource: 'random' }), seedSource: 'user', benchmark: true });
  assert.equal(chosen.benchmark, false);
  assert.equal(chosen.seedSource, 'user');
  const preset = sanitizeImportedSession({ ...finishedBenchmark({ seedSource: 'random' }), seedSource: 'preset', benchmark: true });
  assert.equal(preset.benchmark, false);
  assert.equal(preset.seedSource, 'preset');
  const random = sanitizeImportedSession(finishedBenchmark({ seedSource: 'random' }));
  assert.equal(random.benchmark, true);
  assert.equal(random.seedSource, 'random');
  const garbage = sanitizeImportedSession({ ...finishedBenchmark(), seedSource: 'chosen', benchmark: true });
  assert.equal(garbage.benchmark, false);
  assert.equal('seedSource' in garbage, false);
  const first = sanitizeImportedSession(finishedBenchmark({ startedAt: '2026-05-01T00:00:00.000Z' }));
  const second = sanitizeImportedSession(finishedBenchmark({ startedAt: '2026-05-02T00:00:00.000Z' }));
  const flagged = flagRepeatedBenchmarkSeeds([first, second]);
  assert.equal(flagged[0].benchmark, true);
  assert.equal(flagged[1].benchmark, true);
  assert.equal(flagged[1].seedReuseExcluded, true);
  assert.equal(benchmarkSeries(flagged).length, 1);
  assert.equal(benchmarkSeries(flagged)[0].at, '2026-05-01T00:00:00.000Z');
});

test('a duplicate imported later is excluded from scores without rewriting the stored benchmark flag', async () => {
  const data = {};
  globalThis.localStorage = {
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: key => { delete data[key]; },
  };
  try {
    const first = finishedBenchmark({ startedAt: '2026-04-01T00:00:00.000Z' });
    const second = finishedBenchmark({ startedAt: '2026-04-02T00:00:00.000Z' });
    assert.equal(await importSessions([first, second]), 2);
    const stored = await listSessions();
    assert.equal(stored.length, 2);
    assert.equal(stored.every(s => s.benchmark === true), true);
    assert.equal(stored.filter(s => s.seedReuseExcluded === true).length, 1);
    assert.equal(benchmarkProgress(stored).count, 1);
    assert.equal(benchmarkProgress(stored).personalBest, first.score);
    const alone = finishedBenchmark({ seed: 'other-seed', startedAt: '2026-04-03T00:00:00.000Z' });
    assert.equal(await importSessions([finishedBenchmark({ startedAt: '2026-04-04T00:00:00.000Z' })]), 1);
    const after = await listSessions();
    assert.equal(after.filter(s => s.seedReuseExcluded === true).length, 1, 'a one-session import does not flag itself');
    assert.equal(repeatedBenchmarkSeedReport(after).excludedCount, 2);
    assert.equal(benchmarkProgress(after).count, 1);
    assert.equal(benchmarkProgress([...after, alone]).count, 2);
  } finally {
    delete globalThis.localStorage;
  }
});
