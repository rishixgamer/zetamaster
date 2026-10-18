import { verifyBenchmarkSession } from './anti-cheat.js';
import { sanitizeAlias } from './leaderboard.js';

/**
 * Head-to-Head Duel Service (Milestone M5).
 *
 * Implements deterministic arithmetic duels between two players on matched seeds
 * with anti-cheat verification and explicit consent.
 *
 * Design Invariants:
 * 1. Matched Problem Sequence: Both players receive the exact same PRNG seed.
 * 2. Deterministic Verification: Both submissions must pass anti-cheat replay before
 *    the duel outcome is confirmed.
 * 3. Tie-breaking & Disconnect Rules: Ties broken by lower mean latency.
 *    Unsubmitted runs after timeout are forfeited.
 * 4. Opt-In Only: Strict consent required prior to joining duels.
 */

export const DUEL_CONSENT_KEY = 'zetamaster-duel-consent-v1';
export const DUEL_TIMEOUT_GRACE_MS = 30000; // 30s grace period after session duration

export class DuelError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.name = 'DuelError';
    this.reason = reason;
  }
}

export function readDuelConsent(store = null) {
  try {
    const raw = store?.getItem?.(DUEL_CONSENT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.enabled === true && typeof parsed.updatedAt === 'string'
      ? { enabled: true, updatedAt: parsed.updatedAt }
      : { enabled: false, updatedAt: null };
  } catch {
    return { enabled: false, updatedAt: null };
  }
}

export function setDuelConsent(store, enabled, now) {
  if (typeof enabled !== 'boolean') throw new RangeError('setDuelConsent requires boolean');
  if (typeof now !== 'string' || Number.isNaN(Date.parse(now))) {
    throw new RangeError('setDuelConsent requires valid ISO timestamp');
  }
  const state = { enabled, updatedAt: now };
  store?.setItem?.(DUEL_CONSENT_KEY, JSON.stringify(state));
  return state;
}

export class DuelMatchManager {
  constructor() {
    this.duels = new Map();
  }

  createDuel({ seed, creatorAlias, durationSeconds = 120, consent, now = new Date().toISOString() }) {
    if (!consent || !consent.enabled) {
      throw new DuelError('consent-required', 'Duels require explicit opt-in consent.');
    }
    const cleanAlias = sanitizeAlias(creatorAlias);
    const duelId = `zmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const duel = {
      id: duelId,
      seed: seed || `duel-seed-${Date.now()}`,
      durationSeconds,
      createdAt: now,
      status: 'waiting', // waiting, active, completed, forfeited
      players: {
        player1: { alias: cleanAlias, submitted: false, score: null, latencyMs: null, verified: false },
        player2: null,
      },
      winner: null,
      tie: false,
    };

    this.duels.set(duelId, duel);
    return duel;
  }

  joinDuel({ duelId, challengerAlias, consent, now = new Date().toISOString() }) {
    if (!consent || !consent.enabled) {
      throw new DuelError('consent-required', 'Duels require explicit opt-in consent.');
    }
    const duel = this.duels.get(duelId);
    if (!duel) throw new DuelError('not-found', 'Duel not found');
    if (duel.status !== 'waiting') throw new DuelError('invalid-state', 'Duel already active or completed');

    const cleanAlias = sanitizeAlias(challengerAlias);
    if (cleanAlias.toLowerCase() === duel.players.player1.alias.toLowerCase()) {
      throw new DuelError('self-play-forbidden', 'Cannot duel against yourself');
    }

    duel.players.player2 = {
      alias: cleanAlias,
      submitted: false,
      score: null,
      latencyMs: null,
      verified: false,
    };
    duel.status = 'active';
    duel.startedAt = now;

    return duel;
  }

  submitResult({ duelId, playerAlias, session }) {
    const duel = this.duels.get(duelId);
    if (!duel) throw new DuelError('not-found', 'Duel not found');
    if (duel.status !== 'active') throw new DuelError('invalid-state', 'Duel is not currently active');

    const cleanAlias = sanitizeAlias(playerAlias).toLowerCase();
    const isP1 = duel.players.player1.alias.toLowerCase() === cleanAlias;
    const isP2 = duel.players.player2 && duel.players.player2.alias.toLowerCase() === cleanAlias;

    if (!isP1 && !isP2) throw new DuelError('not-participant', 'Player is not in this duel');
    const target = isP1 ? duel.players.player1 : duel.players.player2;

    if (target.submitted) throw new DuelError('already-submitted', 'Result already recorded for this player');

    // Run anti-cheat verification on session
    const check = verifyBenchmarkSession(session);
    if (!check.verified) {
      throw new DuelError('verification-failed', `Duel session failed verification: ${check.violations.join(', ')}`);
    }

    target.submitted = true;
    target.score = session.score;
    target.latencyMs = check.details.meanLatencyMs;
    target.verified = true;

    // If both players have submitted, determine winner
    if (duel.players.player1.submitted && duel.players.player2.submitted) {
      const p1 = duel.players.player1;
      const p2 = duel.players.player2;

      duel.status = 'completed';
      if (p1.score > p2.score) {
        duel.winner = p1.alias;
      } else if (p2.score > p1.score) {
        duel.winner = p2.alias;
      } else {
        // Tiebreak on lower average response time
        if (p1.latencyMs < p2.latencyMs) {
          duel.winner = p1.alias;
        } else if (p2.latencyMs < p1.latencyMs) {
          duel.winner = p2.alias;
        } else {
          duel.tie = true;
          duel.winner = null;
        }
      }
    }

    return duel;
  }

  getDuel(duelId) {
    return this.duels.get(duelId) || null;
  }
}

export const defaultDuelManager = new DuelMatchManager();

export const DuelService = Object.freeze({
  readConsent: readDuelConsent,
  setConsent: setDuelConsent,
  create: (opts) => defaultDuelManager.createDuel(opts),
  join: (opts) => defaultDuelManager.joinDuel(opts),
  submit: (opts) => defaultDuelManager.submitResult(opts),
  get: (id) => defaultDuelManager.getDuel(id),
  Manager: DuelMatchManager,
});
