/**
 * Market-Making Expected-Value Simulator (F55).
 * Quote bid-ask spreads around uncertain payouts, manage inventory, and capture spread.
 * Deterministic settlement and payoff checking with independent skill metrics.
 */
import { createRng, intBetween, sample } from '../../core/src/rng.js';

export const MM_SCENARIOS = Object.freeze([
  'sum-two-dice',
  'sum-three-dice',
  'high-die',
  'card-deck-value',
  'coin-flip-stock',
]);

/**
 * Creates a market-making scenario with known payoff structure.
 */
export function createMarketScenario(seed = 'market-making-round') {
  const rng = createRng(seed);
  const type = sample(rng, MM_SCENARIOS);
  const roundId = `mm-${seed}`;

  switch (type) {
    case 'sum-two-dice': {
      // 2d6: Fair value = 7.00. Range [2, 12]
      const die1 = intBetween(rng, 1, 6);
      const die2 = intBetween(rng, 1, 6);
      const settlementValue = die1 + die2;
      return {
        roundId,
        type: 'sum-two-dice',
        contractName: 'Sum of Two 6-Sided Dice ($)',
        description: 'Settles at the exact sum of rolling two fair 6-sided dice.',
        fairValue: 7.0,
        minPossible: 2,
        maxPossible: 12,
        maxSpread: 2.0,
        settlementValue,
        secretOutcomes: [die1, die2],
      };
    }
    case 'sum-three-dice': {
      // 3d6: Fair value = 10.50. Range [3, 18]
      const d1 = intBetween(rng, 1, 6);
      const d2 = intBetween(rng, 1, 6);
      const d3 = intBetween(rng, 1, 6);
      const settlementValue = d1 + d2 + d3;
      return {
        roundId,
        type: 'sum-three-dice',
        contractName: 'Sum of Three 6-Sided Dice ($)',
        description: 'Settles at the exact sum of rolling three fair 6-sided dice.',
        fairValue: 10.5,
        minPossible: 3,
        maxPossible: 18,
        maxSpread: 3.0,
        settlementValue,
        secretOutcomes: [d1, d2, d3],
      };
    }
    case 'high-die': {
      // Roll 2 dice, take the highest: EV = 4.472
      const d1 = intBetween(rng, 1, 6);
      const d2 = intBetween(rng, 1, 6);
      const settlementValue = Math.max(d1, d2);
      return {
        roundId,
        type: 'high-die',
        contractName: 'Highest of Two Dice ($)',
        description: 'Settles at the maximum value between two fair 6-sided dice.',
        fairValue: 4.47,
        minPossible: 1,
        maxPossible: 6,
        maxSpread: 1.5,
        settlementValue,
        secretOutcomes: [d1, d2],
      };
    }
    case 'card-deck-value': {
      // Number card = face value (2-10). Jack/Queen/King = $10. Ace = $11.
      // Expected value ≈ 7.15
      const cardVals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11];
      const drawn = sample(rng, cardVals);
      return {
        roundId,
        type: 'card-deck-value',
        contractName: 'Blackjack Card Settlement ($)',
        description: 'Draws one card from a standard deck. Number cards = face value, Face = $10, Ace = $11.',
        fairValue: 7.15,
        minPossible: 2,
        maxPossible: 11,
        maxSpread: 2.0,
        settlementValue: drawn,
        secretOutcomes: [drawn],
      };
    }
    case 'coin-flip-stock':
    default: {
      // 5 coin flips: $10 base + $5 per Head. EV = 10 + 2.5 * 5 = $22.50
      let heads = 0;
      for (let i = 0; i < 5; i++) if (rng() < 0.5) heads++;
      const settlementValue = 10 + heads * 5;
      return {
        roundId,
        type: 'coin-flip-stock',
        contractName: 'Binary Drift Contract ($)',
        description: 'Base $10 + $5 for each Head across 5 fair coin flips.',
        fairValue: 22.5,
        minPossible: 10,
        maxPossible: 35,
        maxSpread: 4.0,
        settlementValue,
        secretOutcomes: [heads],
      };
    }
  }
}

/**
 * Validates a candidate's bid-ask quote.
 */
export function validateMarketQuote(bid, ask, scenario) {
  const b = Number(bid);
  const a = Number(ask);

  if (!Number.isFinite(b) || !Number.isFinite(a)) {
    return { valid: false, reason: 'Bid and Ask must be finite numbers.' };
  }
  if (b <= 0 || a <= 0) {
    return { valid: false, reason: 'Prices must be strictly positive.' };
  }
  if (b >= a) {
    return { valid: false, reason: `Bid ($${b}) must be strictly less than Ask ($${a}).` };
  }
  const spread = Number((a - b).toFixed(2));
  if (spread > scenario.maxSpread) {
    return { valid: false, reason: `Spread ($${spread}) exceeds maximum allowed spread ($${scenario.maxSpread}).` };
  }

  return { valid: true, bid: b, ask: a, spread };
}

/**
 * Simulates market order flow against the user's quotes and evaluates settlement PnL.
 */
export function simulateMarketRound(scenario, bid, ask, flowSeed = 'market-flow') {
  const quoteCheck = validateMarketQuote(bid, ask, scenario);
  if (!quoteCheck.valid) {
    throw new RangeError(quoteCheck.reason);
  }

  const rng = createRng(flowSeed);
  const { fairValue, settlementValue } = scenario;
  const spread = ask - bid;

  // Simulate counterparty flow (buyers and sellers with slightly noisy valuations)
  let contractsBought = 0; // counterparty sells to our bid -> we buy
  let contractsSold = 0; // counterparty buys from our ask -> we sell

  // Check 3 potential market orders
  for (let i = 0; i < 3; i++) {
    const noise = (rng() - 0.5) * spread * 1.5;
    const buyerWillingness = fairValue + (rng() * spread * 0.8) + noise;
    const sellerWillingness = fairValue - (rng() * spread * 0.8) + noise;

    // If buyer willing to pay >= our ask price, they buy from us
    if (buyerWillingness >= ask) {
      contractsSold++;
    }
    // If seller willing to accept <= our bid price, they sell to us
    if (sellerWillingness <= bid) {
      contractsBought++;
    }
  }

  const netPosition = contractsBought - contractsSold;
  // Cash flow: received from sales - paid for purchases
  const cashFlow = contractsSold * ask - contractsBought * bid;
  // Settlement value of remaining position
  const settlementPnl = netPosition * settlementValue;
  const totalPnl = Number((cashFlow + settlementPnl).toFixed(2));

  // Theoretical edge captured = trades * half-spread (if priced around fair value)
  const midpoint = (bid + ask) / 2;
  const mispricing = Math.abs(midpoint - fairValue);
  const capturedEdge = Number((Math.min(contractsBought, contractsSold) * spread).toFixed(2));

  return {
    roundId: scenario.roundId,
    scenarioName: scenario.contractName,
    fairValue,
    settlementValue,
    bid,
    ask,
    spread,
    midpoint,
    mispricing,
    contractsBought,
    contractsSold,
    netPosition,
    cashFlow: Number(cashFlow.toFixed(2)),
    settlementPnl: Number(settlementPnl.toFixed(2)),
    totalPnl,
    capturedEdge,
    profitable: totalPnl > 0,
    summary: `Round complete: Settlement = $${settlementValue}. Trades: Bought ${contractsBought} @ $${bid}, Sold ${contractsSold} @ $${ask}. Final PnL = ${totalPnl >= 0 ? '+' : ''}$${totalPnl}.`,
  };
}

/**
 * Aggregates market-making performance metrics across rounds.
 */
export function aggregateMarketPerformance(rounds = []) {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    return {
      totalRounds: 0,
      totalPnl: 0,
      winRate: 0,
      avgPnlPerRound: 0,
      totalVolume: 0,
      capturedEdge: 0,
    };
  }

  const totalRounds = rounds.length;
  const totalPnl = Number(rounds.reduce((acc, r) => acc + (r.totalPnl || 0), 0).toFixed(2));
  const wins = rounds.filter(r => (r.totalPnl || 0) > 0).length;
  const winRate = Number(((wins / totalRounds) * 100).toFixed(1));
  const avgPnlPerRound = Number((totalPnl / totalRounds).toFixed(2));
  const totalVolume = rounds.reduce((acc, r) => acc + (r.contractsBought || 0) + (r.contractsSold || 0), 0);
  const capturedEdge = Number(rounds.reduce((acc, r) => acc + (r.capturedEdge || 0), 0).toFixed(2));

  return {
    totalRounds,
    totalPnl,
    winRate,
    avgPnlPerRound,
    totalVolume,
    capturedEdge,
  };
}
