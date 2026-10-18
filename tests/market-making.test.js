import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarketScenario,
  validateMarketQuote,
  simulateMarketRound,
  aggregateMarketPerformance,
  MM_SCENARIOS,
} from '../packages/quant/src/market-making.js';

test('createMarketScenario produces valid scenarios', () => {
  for (const seed of ['seed1', 'seed2', 'seed3']) {
    const sc = createMarketScenario(seed);
    assert.ok(sc.contractName);
    assert.ok(sc.fairValue > 0);
    assert.ok(sc.maxSpread > 0);
    assert.ok(sc.settlementValue >= sc.minPossible);
    assert.ok(sc.settlementValue <= sc.maxPossible);
  }
});

test('validateMarketQuote checks bid, ask, and spread constraints', () => {
  const scenario = { maxSpread: 2.0 };

  // Valid quote
  const v1 = validateMarketQuote(6.0, 7.5, scenario);
  assert.ok(v1.valid);
  assert.equal(v1.spread, 1.5);

  // Ask <= Bid
  const v2 = validateMarketQuote(7.0, 7.0, scenario);
  assert.ok(!v2.valid);

  const v3 = validateMarketQuote(8.0, 7.0, scenario);
  assert.ok(!v3.valid);

  // Spread exceeds maxSpread
  const v4 = validateMarketQuote(5.0, 7.5, scenario); // spread 2.5 > 2.0
  assert.ok(!v4.valid);

  // Non-positive or non-finite
  assert.ok(!validateMarketQuote(-1, 2, scenario).valid);
  assert.ok(!validateMarketQuote('abc', 2, scenario).valid);
});

test('simulateMarketRound deterministically evaluates trades and settlement PnL', () => {
  const scenario = {
    roundId: 'test-round',
    contractName: 'Test Contract',
    fairValue: 7.0,
    settlementValue: 8.0,
    maxSpread: 2.0,
  };

  // Quote tightly around fair value: bid 6.5, ask 7.5
  const result = simulateMarketRound(scenario, 6.5, 7.5, 'flow-seed-1');
  assert.equal(result.roundId, 'test-round');
  assert.equal(result.bid, 6.5);
  assert.equal(result.ask, 7.5);
  assert.equal(result.spread, 1.0);
  assert.ok(Number.isFinite(result.totalPnl));
  assert.equal(result.netPosition, result.contractsBought - result.contractsSold);
});

test('aggregateMarketPerformance summarizes across rounds', () => {
  const rounds = [
    { totalPnl: 3.5, contractsBought: 2, contractsSold: 1, capturedEdge: 1.0 },
    { totalPnl: -1.0, contractsBought: 1, contractsSold: 1, capturedEdge: 1.0 },
    { totalPnl: 2.5, contractsBought: 0, contractsSold: 2, capturedEdge: 0 },
  ];

  const agg = aggregateMarketPerformance(rounds);
  assert.equal(agg.totalRounds, 3);
  assert.equal(agg.totalPnl, 5.0);
  assert.equal(agg.totalVolume, 7);
  assert.equal(agg.winRate, 66.7);
});
