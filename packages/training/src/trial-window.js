import { assignStrategyTrial } from './experiment.js';

/**
 * Pure enrollment/window math for the randomized crossover policy trial (F21/M4-F37).
 *
 * Deliberately dependency-light (only experiment.js): policies.js consumes trialSlot directly for
 * its emphasis precedence, and the outcomes ledger lives in trial.js on top of these functions —
 * keeping provenance.js/policies.js out of this module keeps the import graph acyclic.
 *
 * Design summary:
 * - One device, two policies alternating through the cycle: slot 0 and slot 1 of every cycle are
 *   treatment windows enacting the randomized first/second policy, slot 2 is a holdout window
 *   where nothing is emphasized (the unemphasized contrast stays measurable).
 * - Randomization: which policy fills the first treatment slot is the balanced seeded assignment
 *   (`assignStrategyTrial` — same parity rule used everywhere else in the app), so enrollment
 *   order is reversed across devices; within a device the two policies alternate every cycle.
 * - The trial id recomputes the whole payload, so a stored record whose seed, dates or policies
 *   were tampered with fails parseStoredTrial instead of silently relocating its windows.
 */

export const TRIAL_PROTOCOL_VERSION = 'policy-trial-v1';
/** One emphasis window is this many calendar days (UTC-day aligned). */
export const TRIAL_WINDOW_DAYS = 3;
/** Windows per cycle: two treatment windows, then one holdout window. */
export const TRIAL_CYCLE_WINDOWS = 3;
/** Attributed windows per policy required before ANY between-policy number is reported (outcomes side). */
export const TRIAL_MIN_PAIRS_PER_ARM = 4;
const DAY_MS = 86400000;

function hash(text) {
  let h = 5381;
  for (const ch of String(text)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Trial shape check for any consumer that receives a trial object (upper modules revalidate). */
export function isTrial(trial) {
  return Boolean(
    trial && typeof trial === 'object' && trial.version === TRIAL_PROTOCOL_VERSION
    && typeof trial.id === 'string' && typeof trial.seed === 'string' && trial.seed.trim()
    && typeof trial.startedAt === 'string' && !Number.isNaN(Date.parse(trial.startedAt))
    && typeof trial.policyIdA === 'string' && typeof trial.policyIdB === 'string' && trial.policyIdA !== trial.policyIdB
    && ['op-adaptive', 'cell-gauntlet', 'automaticity'].includes(trial.policyIdA)
    && ['op-adaptive', 'cell-gauntlet', 'automaticity'].includes(trial.policyIdB));
}

/**
 * Enroll a trial deterministically from the caller's seed. The trial id hashes the whole payload,
 * so parseStoredTrial can reject any tampered record. Throw paths: empty seed, unparseable
 * startedAt, unknown or identical policies.
 */
export function createPolicyTrial({ seed, startedAt, policyIdA = 'op-adaptive', policyIdB = 'cell-gauntlet' } = {}) {
  if (typeof seed !== 'string' || !seed.trim()) throw new RangeError('createPolicyTrial needs a non-empty device seed');
  const started = Date.parse(typeof startedAt === 'string' ? startedAt : '');
  if (Number.isNaN(started)) throw new RangeError('createPolicyTrial needs an ISO startedAt date');
  const known = ['op-adaptive', 'cell-gauntlet', 'automaticity'];
  if (!known.includes(policyIdA) || !known.includes(policyIdB) || policyIdA === policyIdB) {
    throw new RangeError(`createPolicyTrial needs two distinct known policies (${known.join(', ')}), got ${policyIdA} / ${policyIdB}`);
  }
  const trimmedSeed = seed.trim();
  const id = `${TRIAL_PROTOCOL_VERSION}:${hash(`${trimmedSeed}|${startedAt}|${policyIdA}|${policyIdB}`)}`;
  return Object.freeze({ version: TRIAL_PROTOCOL_VERSION, id, seed: trimmedSeed, startedAt, policyIdA, policyIdB });
}

function startOfUtcDay(ms) { return Math.floor(ms / DAY_MS) * DAY_MS; }

/**
 * Which slot of the trial a moment falls in. Windows are UTC-day-aligned chunks of
 * TRIAL_WINDOW_DAYS counted from the *day* the trial started (a trial joined mid-day becomes
 * active from that day's 00:00Z boundary — stated here, never re-derived elsewhere). Cycle
 * layout: windowIndex % TRIAL_CYCLE_WINDOWS === 2 is the holdout; slots 0 and 1 enact the
 * randomized first/second policy. `arm` is ordering context only (A = randomized first policy).
 */
export function trialSlot(trial, atMs = Date.now()) {
  if (!isTrial(trial)) throw new RangeError('trialSlot needs a valid trial object (createPolicyTrial)');
  const at = typeof atMs === 'string' ? Date.parse(atMs) : atMs;
  if (!(Number.isFinite(at) && at >= 0)) throw new RangeError(`trialSlot needs a valid atMs (ISO date or epoch ms), got ${atMs}`);
  const startedMs = Date.parse(trial.startedAt);
  const dayNumber = Math.floor((startOfUtcDay(at) - startOfUtcDay(startedMs)) / DAY_MS);
  if (dayNumber < 0) throw new RangeError('trialSlot on a date before the trial enrolled — no slot exists');
  const windowIndex = Math.floor(dayNumber / TRIAL_WINDOW_DAYS);
  const slotInCycle = windowIndex % TRIAL_CYCLE_WINDOWS;
  const phase = slotInCycle === TRIAL_CYCLE_WINDOWS - 1 ? 'holdout' : 'treatment';
  const firstIsA = assignStrategyTrial(trial.seed, 0) === 'A';
  const first = firstIsA ? trial.policyIdA : trial.policyIdB;
  const second = firstIsA ? trial.policyIdB : trial.policyIdA;
  const startsAt = new Date(startOfUtcDay(startedMs) + windowIndex * TRIAL_WINDOW_DAYS * DAY_MS).toISOString();
  const endsAt = new Date(startOfUtcDay(startedMs) + (windowIndex + 1) * TRIAL_WINDOW_DAYS * DAY_MS).toISOString();
  return {
    windowIndex,
    dayNumber,
    cycleIndex: Math.floor(windowIndex / TRIAL_CYCLE_WINDOWS) + 1,
    phase,  // 'treatment' or 'holdout'
    order: firstIsA ? 'A-first' : 'B-first',
    policyId: phase === 'treatment' ? (slotInCycle === 0 ? first : second) : null,
    firstPolicyId: first,
    secondPolicyId: second,
    startsAt,
    endsAt,
  };
}

/** The next holdout window at or after `atMs` (walks forward until the cycle's holdout slot). */
export function nextHoldout(trial, atMs = Date.now()) {
  let cursor = trialSlot(trial, atMs);
  for (let step = 0; step < TRIAL_CYCLE_WINDOWS; step++) {
    if (cursor.phase === 'holdout') return { windowIndex: cursor.windowIndex, startsAt: cursor.startsAt, endsAt: cursor.endsAt };
    cursor = trialSlot(trial, cursor.endsAt); // a window's end instant already opens the next one
  }
  return { windowIndex: cursor.windowIndex, startsAt: cursor.startsAt, endsAt: cursor.endsAt };
}

/** JSON form for localStorage; parseStoredTrial is its only trusted reader. */
export function serializeTrial(trial) {
  if (!isTrial(trial)) throw new RangeError('serializeTrial needs a valid trial object (createPolicyTrial)');
  return JSON.stringify({ version: trial.version, id: trial.id, seed: trial.seed, startedAt: trial.startedAt, policyIdA: trial.policyIdA, policyIdB: trial.policyIdB });
}

/**
 * Whitelist-rebuild a stored trial: malformed JSON, missing fields, unknown policies, or a
 * recomputed id that disagrees with the stored one all return null. Returns the trial or null.
 */
export function parseStoredTrial(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let blob;
  try { blob = JSON.parse(raw); } catch { return null; }
  if (!blob || typeof blob !== 'object') return null;
  let trial;
  try {
    trial = createPolicyTrial({ seed: blob.seed, startedAt: blob.startedAt, policyIdA: blob.policyIdA, policyIdB: blob.policyIdB });
  } catch { return null; }
  return trial.id === blob.id ? trial : null;
}
