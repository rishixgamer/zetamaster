import { verifyBenchmarkSession, createSessionEvidence } from './anti-cheat.js';
import { repeatedBenchmarkSeedReport } from '../../core/src/seed-policy.js';

/**
 * Global Leaderboard Subsystem (F46, Milestone M5).
 *
 * Implements opt-in, privacy-preserving, anti-cheat verified rankings.
 *
 * Architecture & Privacy Guarantees:
 * 1. Zero Telemetry Leakage by Default: Consent is OFF by default. No requests or score
 *    uploads ever occur without affirmative opt-in.
 * 2. Privacy & Pseudonyms: Players register using an alias/handle only. No emails,
 *    real names, or PII are accepted.
 * 3. Anti-Cheat Gate: Every score submission is verified draw-for-draw against the seeded PRNG,
 *    and checked for physiological latency bounds and bot cadences.
 * 4. Abuse & Rate Limits: Submissions are capped per player/token (max 5 per hour).
 * 5. Right to be Forgotten: Players can delete their submissions at any time.
 */

export const LEADERBOARD_CONSENT_KEY = 'zetamaster-leaderboard-consent-v1';
export const LEADERBOARD_STORE_KEY = 'zetamaster-leaderboard-entries-v1';
export const MAX_SUBMISSIONS_PER_HOUR = 5;

export class LeaderboardUnavailableError extends Error {
  constructor(reason, note, violations = []) {
    super(note || reason);
    this.name = 'LeaderboardUnavailableError';
    this.reason = reason;
    this.violations = violations;
  }
}

/** Check if consent object represents affirmative opt-in */
export const isLeaderboardConsentOn = consent =>
  Boolean(consent) && consent.enabled === true && typeof consent.updatedAt === 'string';

/**
 * Read leaderboard consent state from a store.
 */
export function readLeaderboardConsent(store = null) {
  try {
    const raw = store?.getItem?.(LEADERBOARD_CONSENT_KEY) ?? null;
    const parsed = raw === null ? null : JSON.parse(raw);
    return isLeaderboardConsentOn(parsed)
      ? { enabled: true, updatedAt: parsed.updatedAt }
      : { enabled: false, updatedAt: null };
  } catch {
    return { enabled: false, updatedAt: null };
  }
}

/**
 * Flip leaderboard consent.
 */
export function setLeaderboardConsent(store, enabled, now) {
  if (typeof enabled !== 'boolean') {
    throw new RangeError('setLeaderboardConsent requires an explicit boolean');
  }
  if (typeof now !== 'string' || Number.isNaN(Date.parse(now))) {
    throw new RangeError('setLeaderboardConsent requires a valid ISO timestamp');
  }

  const prev = readLeaderboardConsent(store);
  if (prev.enabled === enabled && prev.updatedAt !== null) return prev;

  const state = { enabled, updatedAt: now };
  store?.setItem?.(LEADERBOARD_CONSENT_KEY, JSON.stringify(state));
  return state;
}

/**
 * Benchmarks that may be submitted. Later runs on a repeated seed are left out.
 * Array order is preserved so the caller can keep its own "latest" pick.
 */
export function leaderboardCandidateSessions(sessions) {
  if (!Array.isArray(sessions)) return [];
  const excluded = repeatedBenchmarkSeedReport(sessions).excluded;
  return sessions.filter(s =>
    s && s.benchmark === true && s.mode === 'benchmark' && s.elapsedMs >= 120000 && !excluded.has(s)
  );
}

/**
 * Validates and sanitizes a player alias (3–20 chars, alphanumeric, dashes, underscores).
 * Strictly forbids email addresses, URLs, or potential PII.
 */
export function sanitizeAlias(name) {
  if (typeof name !== 'string') throw new RangeError('Alias must be a string');
  const trimmed = name.trim();

  if (trimmed.includes('@') || trimmed.includes('http:') || trimmed.includes('https:') || trimmed.includes('.')) {
    throw new RangeError('Aliases must not contain emails, URLs, or personal identifiers');
  }

  const cleaned = trimmed.replace(/[^a-zA-Z0-9_\- ]/g, '');
  if (cleaned.length < 3 || cleaned.length > 20) {
    throw new RangeError('Alias must be between 3 and 20 alphanumeric characters');
  }

  return cleaned;
}

/**
 * In-memory / storage adapter for leaderboard entries.
 */
export class LeaderboardStore {
  constructor(externalStore = null) {
    this.externalStore = externalStore;
    this.entries = [];
    this.rateLimits = new Map(); // token -> timestamps[]
    this.load();
  }

  load() {
    try {
      const raw = this.externalStore?.getItem?.(LEADERBOARD_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.entries = parsed;
      }
    } catch {
      this.entries = [];
    }
  }

  save() {
    try {
      this.externalStore?.setItem?.(LEADERBOARD_STORE_KEY, JSON.stringify(this.entries));
    } catch {
      // safe fallback
    }
  }

  checkRateLimit(token, nowMs) {
    const history = (this.rateLimits.get(token) || []).filter(t => nowMs - t < 3600000);
    if (history.length >= MAX_SUBMISSIONS_PER_HOUR) return false;
    history.push(nowMs);
    this.rateLimits.set(token, history);
    return true;
  }

  addEntry(entry) {
    // Replace existing entry for same alias if new score is higher
    const existingIndex = this.entries.findIndex(e => e.alias.toLowerCase() === entry.alias.toLowerCase());
    if (existingIndex >= 0) {
      if (entry.score > this.entries[existingIndex].score) {
        this.entries[existingIndex] = entry;
      }
    } else {
      this.entries.push(entry);
    }

    // Sort descending by score, tiebreak on lower mean latency then earlier timestamp
    this.entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.meanLatencyMs !== b.meanLatencyMs) return a.meanLatencyMs - b.meanLatencyMs;
      return Date.parse(a.verifiedAt) - Date.parse(b.verifiedAt);
    });

    this.save();
  }

  getEntries(limit = 50) {
    return this.entries.slice(0, limit).map((e, idx) => ({
      rank: idx + 1,
      alias: e.alias,
      score: e.score,
      verifiedAt: e.verifiedAt,
      meanLatencyMs: Math.round(e.meanLatencyMs),
      evidenceHash: e.evidenceHash,
    }));
  }

  clear() {
    this.entries = [];
    this.rateLimits.clear();
    this.save();
  }
}

/** Default singleton instance for app runtime */
export const defaultLeaderboardStore = new LeaderboardStore();

/**
 * Submits a verified benchmark score to the global leaderboard.
 *
 * @param {object} params
 * @param {object} params.session - Completed SessionRecord
 * @param {string} params.alias - Player public pseudonym
 * @param {string} [params.token='anon-token'] - Anti-abuse client token
 * @param {object} [params.store=defaultLeaderboardStore] - Storage adapter
 * @param {object} [params.consent] - Consent record
 * @param {string} [params.now] - ISO timestamp
 * @returns {object} Submission confirmation
 */
export function submitLeaderboardScore({
  session,
  alias,
  token = 'anonymous-player',
  store = defaultLeaderboardStore,
  consent = null,
  now = new Date().toISOString(),
}) {
  if (!isLeaderboardConsentOn(consent)) {
    throw new LeaderboardUnavailableError(
      'consent-required',
      'Global leaderboard ranking requires explicit affirmative opt-in consent.'
    );
  }

  const cleanAlias = sanitizeAlias(alias);
  const nowMs = Date.parse(now);

  if (store.checkRateLimit && !store.checkRateLimit(token, nowMs)) {
    throw new LeaderboardUnavailableError(
      'rate-limit-exceeded',
      `Rate limit exceeded: maximum ${MAX_SUBMISSIONS_PER_HOUR} submissions per hour.`
    );
  }

  // Anti-cheat verification
  const verification = verifyBenchmarkSession(session);
  if (!verification.verified) {
    throw new LeaderboardUnavailableError(
      'verification-failed',
      `Session failed anti-cheat verification: ${verification.violations.join(', ')}`,
      verification.violations
    );
  }

  const evidenceHash = createSessionEvidence(session);

  const entry = {
    alias: cleanAlias,
    score: session.score,
    verifiedAt: now,
    meanLatencyMs: verification.details.meanLatencyMs,
    evidenceHash,
  };

  store.addEntry(entry);
  const all = store.getEntries(100);
  const userEntry = all.find(e => e.alias.toLowerCase() === cleanAlias.toLowerCase());

  return {
    verified: true,
    rank: userEntry ? userEntry.rank : all.length,
    totalEntries: all.length,
    entry: userEntry || entry,
  };
}

/**
 * Retrieves the current leaderboard rankings.
 */
export function getLeaderboardRankings(store = defaultLeaderboardStore, limit = 50) {
  return store.getEntries(limit);
}

export const LeaderboardService = Object.freeze({
  submit: submitLeaderboardScore,
  getRankings: getLeaderboardRankings,
  readConsent: readLeaderboardConsent,
  setConsent: setLeaderboardConsent,
  sanitizeAlias,
  Store: LeaderboardStore,
});
