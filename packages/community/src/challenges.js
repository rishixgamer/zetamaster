import { validateRules, customRules, BENCHMARK_RULES, OPERATIONS } from '../../core/src/rulesets.js';

/**
 * Challenge Sharing Subsystem (F47, Milestone M5).
 *
 * Implements URL-safe, deterministic encoding and decoding of arithmetic challenge
 * presets without PII or user identity.
 *
 * Explicit Invariants:
 * 1. Zero PII: Excludes user names, emails, timestamps, device info, scores, or identifiers.
 * 2. Deterministic: Same seed + rules produces byte-identical tokens.
 * 3. Corruption check: a 32-bit FNV-1a checksum catches accidental corruption. It does not stop a deliberate edit.
 * 4. Offline Replay: Any recipient can recreate the exact question sequence offline.
 */

export const CHALLENGE_TOKEN_PREFIX = 'zmch_';
export const CHALLENGE_CODEC_VERSION = 1;

export class ChallengeCodecError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ChallengeCodecError';
    this.code = code || 'INVALID_CHALLENGE';
  }
}

export class ChallengeTamperedError extends ChallengeCodecError {
  constructor(message = 'Challenge token checksum mismatch — catches accidental corruption and does not stop a deliberate edit') {
    super(message, 'TAMPERED');
    this.name = 'ChallengeTamperedError';
  }
}

export class InvalidChallengeError extends ChallengeCodecError {
  constructor(message) {
    super(message, 'INVALID_PAYLOAD');
    this.name = 'InvalidChallengeError';
  }
}

/**
 * Simple 32-bit FNV-1a hash for integrity checksum.
 */
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Base64URL encoding (RFC 4648 §5).
 */
function toBase64Url(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  const binary = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Base64URL decoding.
 */
function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const binary = atob(b64);
  return decodeURIComponent(
    Array.from(binary, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
}

// Disallowed PII or extraneous property keys
const DISALLOWED_KEYS = new Set([
  'user', 'username', 'email', 'userId', 'author', 'score', 'timestamp',
  'time', 'ip', 'token', 'profile', 'name', 'id', 'deviceId', 'telemetry',
]);

/**
 * Encodes a challenge configuration into a URL-safe token.
 *
 * @param {object} challenge
 * @param {string} challenge.seed - PRNG seed for reproducible problem stream
 * @param {number} [challenge.durationSeconds=120] - Session duration (5–3600)
 * @param {Array<string>} [challenge.enabled=['add','sub','mul','div']] - Operations
 * @param {object} [challenge.addition] - { left: [min, max], right: [min, max] }
 * @param {object} [challenge.multiplication] - { left: [min, max], right: [min, max] }
 * @param {number} [challenge.questionBudgetMs] - Optional per-question latency budget
 * @returns {string} Encoded challenge token (zmch_...)
 */
export function encodeChallenge(challenge) {
  if (!challenge || typeof challenge !== 'object') {
    throw new InvalidChallengeError('Challenge configuration must be an object');
  }

  // Check for disallowed PII fields
  for (const key of Object.keys(challenge)) {
    if (DISALLOWED_KEYS.has(key)) {
      throw new InvalidChallengeError(`PII or disallowed field '${key}' is forbidden in challenge sharing`);
    }
  }

  const seed = typeof challenge.seed === 'string' ? challenge.seed.trim() : '';
  if (!seed) {
    throw new InvalidChallengeError('A valid challenge seed string is required');
  }

  const durationSeconds = challenge.durationSeconds ?? 120;
  const enabled = challenge.enabled ?? [...OPERATIONS];
  const addition = challenge.addition ?? BENCHMARK_RULES.addition;
  const multiplication = challenge.multiplication ?? BENCHMARK_RULES.multiplication;
  const questionBudgetMs = challenge.questionBudgetMs;

  // Validate rules
  validateRules({
    durationSeconds,
    enabled,
    addition,
    multiplication,
    questionBudgetMs,
  });

  const compact = {
    v: CHALLENGE_CODEC_VERSION,
    s: seed,
    d: durationSeconds,
    op: enabled,
  };

  if (addition && (addition.left[0] !== 2 || addition.left[1] !== 100 || addition.right[0] !== 2 || addition.right[1] !== 100)) {
    compact.a = [addition.left, addition.right];
  }

  if (multiplication && (multiplication.left[0] !== 2 || multiplication.left[1] !== 12 || multiplication.right[0] !== 2 || multiplication.right[1] !== 100)) {
    compact.m = [multiplication.left, multiplication.right];
  }

  if (questionBudgetMs) {
    compact.b = questionBudgetMs;
  }

  const rawJson = JSON.stringify(compact);
  const checksum = fnv1a32(rawJson);
  const bundle = JSON.stringify([compact, checksum]);

  return CHALLENGE_TOKEN_PREFIX + toBase64Url(bundle);
}

/**
 * Decodes a challenge token back into a seed and validated ruleset.
 *
 * @param {string} token - The zmch_... token string
 * @returns {{ seed: string, rules: object, version: number }}
 */
export function decodeChallenge(token) {
  if (typeof token !== 'string' || !token.startsWith(CHALLENGE_TOKEN_PREFIX)) {
    throw new InvalidChallengeError('Invalid challenge token format: missing zmch_ prefix');
  }

  const rawB64 = token.slice(CHALLENGE_TOKEN_PREFIX.length);
  let parsed;
  try {
    parsed = JSON.parse(fromBase64Url(rawB64));
  } catch (err) {
    throw new InvalidChallengeError(`Malformed challenge token: ${err.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new InvalidChallengeError('Invalid challenge bundle structure');
  }

  const [compact, expectedChecksum] = parsed;
  const calculatedChecksum = fnv1a32(JSON.stringify(compact));
  if (calculatedChecksum !== expectedChecksum) {
    throw new ChallengeTamperedError();
  }

  if (!compact || typeof compact !== 'object' || typeof compact.s !== 'string' || !compact.s.length) {
    throw new InvalidChallengeError('Decoded challenge payload lacks a valid seed');
  }

  const addition = compact.a
    ? { left: compact.a[0], right: compact.a[1] }
    : BENCHMARK_RULES.addition;

  const multiplication = compact.m
    ? { left: compact.m[0], right: compact.m[1] }
    : BENCHMARK_RULES.multiplication;

  const rules = customRules({
    label: `Challenge: ${compact.s.slice(0, 8)}`,
    durationSeconds: compact.d ?? 120,
    enabled: compact.op ?? [...OPERATIONS],
    addition,
    multiplication,
    questionBudgetMs: compact.b,
  });

  return {
    seed: compact.s,
    rules,
    version: compact.v ?? 1,
  };
}

/**
 * Launch payload for a decoded challenge. Always practice (`mode: 'custom'`),
 * even when `rules` is byte-identical to the benchmark. The checksum does not
 * stop a deliberate edit, so a challenge run must not count as a benchmark.
 */
export function challengePreset({ seed, rules }) {
  return { seed, rules, mode: 'custom' };
}

/**
 * Builds a shareable challenge URL using hash fragment (clean, no server needed).
 */
export function buildChallengeUrl(baseUrl = '', challenge) {
  const token = encodeChallenge(challenge);
  const base = baseUrl.replace(/#.*$/, '');
  return `${base}#challenge=${token}`;
}

/**
 * Parses challenge configuration from a URL string or hash fragment.
 */
export function parseChallengeFromUrl(urlString) {
  if (!urlString) return null;
  try {
    let token = null;
    if (urlString.includes('#challenge=')) {
      token = urlString.split('#challenge=')[1]?.split('&')[0];
    } else if (urlString.includes('?c=')) {
      token = urlString.split('?c=')[1]?.split('&')[0];
    } else if (urlString.startsWith(CHALLENGE_TOKEN_PREFIX)) {
      token = urlString;
    }

    if (!token) return null;
    return decodeChallenge(token);
  } catch (err) {
    if (err instanceof ChallengeCodecError) throw err;
    throw new InvalidChallengeError(`Failed to parse challenge from URL: ${err.message}`);
  }
}

export const ChallengeCodec = Object.freeze({
  encode: encodeChallenge,
  decode: decodeChallenge,
  buildUrl: buildChallengeUrl,
  parseUrl: parseChallengeFromUrl,
  PREFIX: CHALLENGE_TOKEN_PREFIX,
  VERSION: CHALLENGE_CODEC_VERSION,
});
