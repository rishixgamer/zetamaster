import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTRY_SETTINGS_KEY, CUSTOM_RANGES_KEY, DEFAULT_ENTRY_SETTINGS,
  readEntrySettings, writeEntrySettings, sanitizeRangePair, buildOperandRange,
  customRangesFromFields, readCustomRanges, writeCustomRanges,
} from '../apps/web/src/entry-settings.js';
import { customRules, BENCHMARK_RULES, benchmarkEquivalent } from '../packages/core/src/rulesets.js';
import { createGenerator } from '../packages/core/src/generator.js';

// Entry settings & custom operand ranges (F02/F05, M1 close-out). Pure module tests: the store is
// a stub, nothing touches a real browser. Every simplification must stay conservative — absence
// or garbage reads as OFF / null, never as an enabled toggle or a fabricated range.

function makeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
}

test('entry settings default OFF and sanitize malformed records conservatively', () => {
  assert.deepEqual(readEntrySettings(makeStore()), DEFAULT_ENTRY_SETTINGS);
  assert.deepEqual(readEntrySettings(makeStore()), { keypad: false, sound: false });
  assert.deepEqual(readEntrySettings(makeStore({ [ENTRY_SETTINGS_KEY]: 'not json' })), { keypad: false, sound: false });
  assert.deepEqual(readEntrySettings(makeStore({ [ENTRY_SETTINGS_KEY]: '{"keypad":"yes","sound":2}' })), { keypad: false, sound: false });
  // Absent store (null) reads the same OFF defaults instead of throwing.
  assert.deepEqual(readEntrySettings(null), { keypad: false, sound: false });
});

test('entry settings round-trip and normalize non-boolean input to OFF', () => {
  const store = makeStore();
  assert.deepEqual(writeEntrySettings(store, { keypad: true, sound: 5 }), { keypad: true, sound: false });
  assert.deepEqual(readEntrySettings(store), { keypad: true, sound: false });
  assert.deepEqual(writeEntrySettings(store, { keypad: 'x' }), { keypad: false, sound: false });
  assert.deepEqual(readEntrySettings(store), { keypad: false, sound: false });
});

test('range pair validation mirrors the engine bounds (1–10000, min ≤ max, integers)', () => {
  assert.deepEqual(sanitizeRangePair([2, 100]), [2, 100]);
  assert.equal(sanitizeRangePair([0, 100]), null, 'zero is below the engine floor');
  assert.equal(sanitizeRangePair([5, 10001]), null, '10000 is the engine ceiling');
  assert.equal(sanitizeRangePair([7, 3]), null, 'min>max rejected');
  assert.equal(sanitizeRangePair([2.5, 8]), null);
  assert.equal(sanitizeRangePair('12'), null);
  assert.deepEqual(sanitizeRangePair([1, 10000]), [1, 10000]);
});

test('buildOperandRange: blanks default, single blank is an error, garbage is an error', () => {
  assert.deepEqual(buildOperandRange('', '', [2, 12], 'Mul'), [2, 12]);
  assert.throws(() => buildOperandRange('5', '', [2, 12], 'Mul: first factor'), /Mul: first factor: enter both/);
  assert.throws(() => buildOperandRange('abc', '9', [2, 12], 'Mul'), /whole numbers/);
  assert.throws(() => buildOperandRange('1', '20000', [2, 12], 'Mul'), /1–10000/);
  assert.deepEqual(buildOperandRange('3', '9', [2, 12], 'Mul'), [3, 9]);
});

test('customRangesFromFields reproduces the standard ranges when everything is blank', () => {
  const ranges = customRangesFromFields({});
  assert.deepEqual(ranges.addition, { left: [2, 100], right: [2, 100] });
  assert.deepEqual(ranges.multiplication, { left: [2, 12], right: [2, 100] });
});

test('custom ranges persist device-locally; malformed or partial records read as null', () => {
  const store = makeStore();
  // A half-filled pair is a by-design error naming the axis (never a guess)…
  assert.throws(
    () => customRangesFromFields({ mulRightLo: '50' }),
    /Multiplication: second factor \(also the division quotient\): enter both a minimum and a maximum/,
  );
  // …so persistence uses a fully-specified fixture.
  const ranges = customRangesFromFields({ addLeftLo: '10', addLeftHi: '999', mulRightLo: '50', mulRightHi: '100' });
  writeCustomRanges(store, ranges);
  assert.deepEqual(readCustomRanges(store), {
    addition: { left: [10, 999], right: [2, 100] },
    multiplication: { left: [2, 12], right: [50, 100] },
  });
  assert.deepEqual(readCustomRanges(makeStore({ [CUSTOM_RANGES_KEY]: '{oops' })), null);
  assert.deepEqual(readCustomRanges(null), null);
  assert.equal(writeCustomRanges(store, { addition: { left: [0, 5], right: [2, 100] }, multiplication: { left: [2, 12], right: [2, 100] } }), null);
});

test('integration: custom-range rules stay practice-only and the generator honors the axes', () => {
  const ranges = customRangesFromFields({ addLeftLo: '40', addLeftHi: '99', mulRightLo: '20', mulRightHi: '60' });
  const rules = customRules({ durationSeconds: 60, enabled: ['add', 'div'], addition: ranges.addition, multiplication: ranges.multiplication });
  assert.equal(benchmarkEquivalent(rules), false, 'custom configurations can never validate as the benchmark');
  assert.deepEqual(rules.id, 'custom');
  const gen = createGenerator(rules, 'range-integration-seed');
  for (let i = 0; i < 2000; i++) {
    const q = gen();
    if (q.op === 'add') {
      assert.ok(q.sourceLeft >= 40 && q.sourceLeft <= 99 && q.sourceRight >= 2 && q.sourceRight <= 100);
    } else {
      // Division draws (divisor, quotient) from the multiplication axes: divisor 2–12, quotient 20–60.
      assert.ok(q.sourceLeft >= 2 && q.sourceLeft <= 12 && q.sourceRight >= 20 && q.sourceRight <= 60);
      assert.equal(q.sourceLeft * q.sourceRight, q.left);
    }
  }
  // The immutability of the benchmark snapshot is untouched by any of the above.
  assert.deepEqual(BENCHMARK_RULES.enabled, ['add', 'sub', 'mul', 'div']);
  assert.deepEqual(BENCHMARK_RULES.addition.left, [2, 100]);
});
