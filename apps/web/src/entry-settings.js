/**
 * Persisted entry & session-setup preferences (F02/F05 core, M1 close-out). Pure module: no DOM,
 * no storage calls of its own — every function takes the store (localStorage) it must use, so the
 * behavior is testable and cannot silently mutate anything at import time.
 *
 * Two device-local records:
 * - `zetamaster-entry-settings-v1` — the F05 toggles {keypad, sound}, both defaulting OFF. The
 *   on-screen keypad feeds the same answer field and the same session `recordInput` path, so it
 *   changes no telemetry, no timing and no answer rule; the sound cue is cosmetic and produced
 *   after a question is already scored (see apps/web/src/cues.js).
 * - `zetamaster-custom-ranges-v1` — the last-used F02 custom operand ranges, prefilled back into
 *   the setup form. Practice-only by construction: `customRules` output can never validate as the
 *   benchmark, and the benchmark ruleset is not touched.
 *
 * Range validation mirrors `core/rulesets.js` (operands 1–10000, min ≤ max, safe integers).
 */

import { BENCHMARK_RULES } from '../../../packages/core/src/rulesets.js';

export const ENTRY_SETTINGS_KEY = 'zetamaster-entry-settings-v1';
export const CUSTOM_RANGES_KEY = 'zetamaster-custom-ranges-v1';

// Fallbacks are plain copies, so callers cannot mutate the frozen benchmark default ranges.
export const DEFAULT_ADDITION_RANGES = Object.freeze({ left: [...BENCHMARK_RULES.addition.left], right: [...BENCHMARK_RULES.addition.right] });
export const DEFAULT_MULTIPLICATION_RANGES = Object.freeze({ left: [...BENCHMARK_RULES.multiplication.left], right: [...BENCHMARK_RULES.multiplication.right] });

export const DEFAULT_ENTRY_SETTINGS = Object.freeze({ keypad: false, sound: false });

const bool = v => v === true;

/** Read the F05 toggles; absent, malformed or unreadable storage reads as the OFF defaults. */
export function readEntrySettings(store) {
  try {
    const raw = store?.getItem?.(ENTRY_SETTINGS_KEY) ?? null;
    if (raw === null) return { ...DEFAULT_ENTRY_SETTINGS };
    const parsed = JSON.parse(raw);
    return { keypad: bool(parsed?.keypad), sound: bool(parsed?.sound) };
  } catch {
    return { ...DEFAULT_ENTRY_SETTINGS };
  }
}

/** Write the toggles; non-boolean values normalize to OFF. Returns the stored state. */
export function writeEntrySettings(store, settings) {
  const state = { keypad: bool(settings?.keypad), sound: bool(settings?.sound) };
  try { store?.setItem?.(ENTRY_SETTINGS_KEY, JSON.stringify(state)); } catch { /* storage may be unavailable; settings stay session-local */ }
  return state;
}

/** Validated min/max pair `[lo, hi]`, or null when not usable; mirrors validateRules bounds. */
export function sanitizeRangePair(pair) {
  if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isSafeInteger)) return null;
  const [lo, hi] = pair;
  if (lo < 1 || hi > 10000 || lo > hi) return null;
  return [lo, hi];
}

/**
 * One operand-axis range from a setup form. Both fields blank → the benchmark default for that
 * axis; both filled → a validated pair; exactly one filled → a clear, named error (never a guess).
 */
export function buildOperandRange(loText, hiText, fallbackPair, label) {
  const defaulted = () => [...fallbackPair];
  const lo = String(loText ?? '').trim();
  const hi = String(hiText ?? '').trim();
  if (!lo && !hi) return defaulted();
  if (!lo || !hi) throw new RangeError(`${label}: enter both a minimum and a maximum, or leave both blank for the default ${fallbackPair[0]}–${fallbackPair[1]}.`);
  const loN = Number(lo), hiN = Number(hi);
  if (!Number.isSafeInteger(loN) || !Number.isSafeInteger(hiN)) throw new RangeError(`${label}: operand bounds must be whole numbers.`);
  const pair = sanitizeRangePair([loN, hiN]);
  if (!pair) throw new RangeError(`${label}: bounds must be within 1–10000 with min ≤ max.`);
  return pair;
}

/** Fallback map for the four setup axes, keyed to the labels used in the UI. */
const FALLBACKS = {
  'Addition: first addend': DEFAULT_ADDITION_RANGES.left,
  'Addition: second addend': DEFAULT_ADDITION_RANGES.right,
  'Multiplication: first factor (also the division divisor)': DEFAULT_MULTIPLICATION_RANGES.left,
  'Multiplication: second factor (also the division quotient)': DEFAULT_MULTIPLICATION_RANGES.right,
};

/**
 * The four setup-axis ranges from raw field texts. Throws `RangeError` naming the offending
 * field — `startGame` already surfaces `error.message` to the player.
 */
export function customRangesFromFields(fields) {
  const f = fields ?? {};
  return {
    addition: {
      left: buildOperandRange(f.addLeftLo, f.addLeftHi, FALLBACKS['Addition: first addend'], 'Addition: first addend'),
      right: buildOperandRange(f.addRightLo, f.addRightHi, FALLBACKS['Addition: second addend'], 'Addition: second addend'),
    },
    multiplication: {
      left: buildOperandRange(f.mulLeftLo, f.mulLeftHi, FALLBACKS['Multiplication: first factor (also the division divisor)'], 'Multiplication: first factor (also the division divisor)'),
      right: buildOperandRange(f.mulRightLo, f.mulRightHi, FALLBACKS['Multiplication: second factor (also the division quotient)'], 'Multiplication: second factor (also the division quotient)'),
    },
  };
}

/** Read the persisted last-used custom ranges; absent or malformed reads as null (use defaults). */
export function readCustomRanges(store) {
  try {
    const raw = store?.getItem?.(CUSTOM_RANGES_KEY) ?? null;
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    const addition = { left: sanitizeRangePair(parsed?.addition?.left), right: sanitizeRangePair(parsed?.addition?.right) };
    const multiplication = { left: sanitizeRangePair(parsed?.multiplication?.left), right: sanitizeRangePair(parsed?.multiplication?.right) };
    if ([addition.left, addition.right, multiplication.left, multiplication.right].some(p => p === null)) return null;
    return { addition, multiplication };
  } catch {
    return null;
  }
}

/** Persist custom ranges for the next visit; storage failure falls back to session-local use. */
export function writeCustomRanges(store, ranges) {
  const addition = { left: sanitizeRangePair(ranges?.addition?.left), right: sanitizeRangePair(ranges?.addition?.right) };
  const multiplication = { left: sanitizeRangePair(ranges?.multiplication?.left), right: sanitizeRangePair(ranges?.multiplication?.right) };
  if ([addition.left, addition.right, multiplication.left, multiplication.right].some(p => p === null)) return null;
  try { store?.setItem?.(CUSTOM_RANGES_KEY, JSON.stringify({ addition, multiplication })); } catch { /* device-local only */ }
  return { addition, multiplication };
}
