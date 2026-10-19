import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHMARK_RULES } from '../packages/core/src/rulesets.js';
import { makeQuestion, createGenerator } from '../packages/core/src/generator.js';
import { classifyQuestion, columnarCarries } from '../packages/core/src/classify.js';

// Difficulty classification (F10, M1 close-out). The original tag set is frozen behavior: stored
// historical events carry the tag set of their own engine, so an extension may only ever ADD
// tags. These tests pin the old tags (full sets for shapes untouched by the extension), pin each
// new harder-shape tag with hand-computed expectations, and property-check the benchmark operand
// space plus the wider F02 custom-range space (three-digit operands, larger products).
//
// Source-operand order reminder: multiplication and division draw (table factor, other factor /
// quotient) — 7 × 48 is makeQuestion('mul', 7, 48), 288 ÷ 8 is makeQuestion('div', 8, 36).

test('pre-extension tag sets are byte-identical where the extension adds nothing', () => {
  assert.deepEqual(classifyQuestion(makeQuestion('add', 47, 28)), ['add', 'carry-or-borrow']);
  assert.deepEqual(classifyQuestion(makeQuestion('add', 30, 11)), ['add', 'round-tens']);
  assert.deepEqual(classifyQuestion(makeQuestion('add', 68, 47)), ['add', 'carry-or-borrow', 'larger-addends', 'double-column-carry']);
  assert.deepEqual(classifyQuestion(makeQuestion('sub', 47, 29)), ['sub', 'carry-or-borrow']);
  assert.deepEqual(classifyQuestion(makeQuestion('sub', 55, 29)), ['sub', 'carry-or-borrow', 'larger-addends']);
  assert.deepEqual(classifyQuestion(makeQuestion('mul', 7, 96)), ['mul', 'table-7', 'two-digit-decomposition']);
  assert.deepEqual(classifyQuestion(makeQuestion('mul', 7, 48)), ['mul', 'table-7']);
  assert.deepEqual(classifyQuestion(makeQuestion('mul', 9, 78)), ['mul', 'table-9', 'shortcut-friendly', 'two-digit-decomposition']);
});

test('columnar carry counting is exact schoolbook arithmetic', () => {
  assert.equal(columnarCarries(47, 28), 1);  // units carry only: 47 + 28 = 75
  assert.equal(columnarCarries(68, 47), 2);  // units and tens carry: 68 + 47 = 115
  assert.equal(columnarCarries(2, 3), 0);
  assert.equal(columnarCarries(5, 5), 1);    // 10
  assert.equal(columnarCarries(100, 950), 1); // 100 + 950 = 1050: one hundreds carry
  assert.equal(columnarCarries(999, 1), 3);  // 999 + 1 = 1000: a carry in every column
});

test('F10 added tags land on the defined harder shapes', () => {
  // Double column carry: only the displayed addition carries it, never inverse subtraction.
  assert.ok(makeQuestion('add', 68, 47).tags.includes('double-column-carry'));
  assert.ok(!makeQuestion('sub', 47, 29).tags.includes('double-column-carry'),
    'displayed subtraction is not a carded column sum');
  // Three-digit source operands: the benchmark edge (100 + x) and F02 custom ranges alike.
  assert.ok(makeQuestion('add', 100, 7).tags.includes('three-digit-operands'));
  assert.ok(!makeQuestion('add', 68, 47).tags.includes('three-digit-operands'));
  // Multiplication: two-by-two needs both displayed factors ≥ 10; product-1000-plus needs answer ≥ 1000.
  assert.ok(makeQuestion('mul', 11, 43).tags.includes('two-by-two'));
  assert.ok(!makeQuestion('mul', 7, 48).tags.includes('two-by-two'));
  assert.ok(makeQuestion('mul', 12, 100).tags.includes('product-1000-plus'));
  assert.ok(!makeQuestion('mul', 10, 99).tags.includes('product-1000-plus'), '10 × 99 = 990 stays inside three digits');
  // Division: prime divisors form no factor chain, composite divisors do; quotient digit count.
  assert.ok(makeQuestion('div', 7, 96).tags.includes('prime-divisor'));
  assert.ok(makeQuestion('div', 7, 96).tags.includes('multi-digit-quotient'), 'quotient 96 is two digits');
  assert.ok(!makeQuestion('div', 7, 9).tags.includes('multi-digit-quotient'), 'single-digit quotient is not the multi-digit shape');
  assert.ok(makeQuestion('div', 8, 36).tags.includes('composite-divisor'));
  assert.ok(!makeQuestion('div', 8, 36).tags.includes('prime-divisor'));
  // Full composed set for a rich division shape, pinned for order stability.
  assert.deepEqual(classifyQuestion(makeQuestion('div', 9, 66)),
    ['div', 'table-9', 'shortcut-friendly', 'two-digit-decomposition', 'multi-digit-quotient', 'composite-divisor']);
});

test('property: every benchmark draw carries the operation tag plus unique stable string tags, deriving from operands alone', () => {
  const gen = createGenerator(BENCHMARK_RULES, 'tag-property-seed');
  for (let i = 0; i < 5000; i++) {
    const q = gen();
    assert.ok(q.tags[0] === q.op);
    assert.ok(q.tags.every(t => typeof t === 'string' && t.length > 0));
    assert.equal(new Set(q.tags).size, q.tags.length, `no duplicate tags: ${q.tags.join(',')}`);
    assert.deepEqual(q, makeQuestion(q.op, q.sourceLeft, q.sourceRight, q.sequence), 'tags derive only from operands');
  }
});

test('property: custom-range shapes classify without error and flag operand scale', () => {
  // F02 allows custom operand axes up to 10000; classification must survive the whole space.
  for (const op of ['add', 'sub', 'mul', 'div']) {
    const q = makeQuestion(op, 9999, 9999);
    assert.ok(Array.isArray(q.tags) && q.tags[0] === op);
    assert.ok(Number.isSafeInteger(q.answer), 'safe-integer guard still prevents overflow shapes');
  }
  assert.ok(makeQuestion('add', 1000, 999).tags.includes('three-digit-operands'));
  assert.ok(makeQuestion('div', 10, 99).tags.includes('multi-digit-quotient'));
});
