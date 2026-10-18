import test from 'node:test';
import assert from 'node:assert/strict';
import { gcd, lcm, Rational, parseRational, isRationalEquivalent } from '../packages/quant/src/rational.js';

test('gcd and lcm calculation', () => {
  assert.equal(gcd(12, 18), 6);
  assert.equal(gcd(-12, 18), 6);
  assert.equal(gcd(17, 19), 1);
  assert.equal(gcd(0, 5), 5);
  assert.equal(gcd(5, 0), 5);

  assert.equal(lcm(4, 6), 12);
  assert.equal(lcm(3, 5), 15);
  assert.equal(lcm(0, 5), 0);
});

test('Rational constructor normalizes sign and reduces to lowest terms', () => {
  const r1 = new Rational(6, 8);
  assert.equal(r1.num, 3);
  assert.equal(r1.den, 4);
  assert.equal(r1.toString(), '3/4');

  const r2 = new Rational(4, -6);
  assert.equal(r2.num, -2);
  assert.equal(r2.den, 3);
  assert.equal(r2.toString(), '-2/3');

  const r3 = new Rational(-10, -15);
  assert.equal(r3.num, 2);
  assert.equal(r3.den, 3);

  const r4 = new Rational(8, 2);
  assert.equal(r4.num, 4);
  assert.equal(r4.den, 1);
  assert.equal(r4.toString(), '4');

  assert.throws(() => new Rational(1, 0), RangeError);
  assert.throws(() => new Rational(1.5, 2), RangeError);
});

test('Rational exact arithmetic operations', () => {
  const a = new Rational(1, 3);
  const b = new Rational(1, 6);

  // Add: 1/3 + 1/6 = 2/6 + 1/6 = 3/6 = 1/2
  const sum = a.add(b);
  assert.equal(sum.toString(), '1/2');

  // Sub: 1/3 - 1/6 = 1/6
  const diff = a.sub(b);
  assert.equal(diff.toString(), '1/6');

  // Mul: 1/3 * 1/6 = 1/18
  const prod = a.mul(b);
  assert.equal(prod.toString(), '1/18');

  // Div: (1/3) / (1/6) = 2/1 = 2
  const quot = a.div(b);
  assert.equal(quot.toString(), '2');

  // Neg & Abs & Inv
  assert.equal(a.neg().toString(), '-1/3');
  assert.equal(new Rational(-3, 4).abs().toString(), '3/4');
  assert.equal(new Rational(2, 5).inv().toString(), '5/2');
  assert.throws(() => new Rational(0, 1).inv(), RangeError);
});

test('parseRational parses strings and numbers accurately', () => {
  assert.equal(parseRational('3/4').toString(), '3/4');
  assert.equal(parseRational(' -6/8 ').toString(), '-3/4');
  assert.equal(parseRational('1 1/2').toString(), '3/2');
  assert.equal(parseRational('-2 3/4').toString(), '-11/4');
  assert.equal(parseRational('0.75').toString(), '3/4');
  assert.equal(parseRational('0.125').toString(), '1/8');
  assert.equal(parseRational('5').toString(), '5');
  assert.equal(parseRational('-12').toString(), '-12');

  assert.equal(parseRational('invalid'), null);
  assert.equal(parseRational(''), null);
  assert.equal(parseRational('3/0'), null);
});

test('Rational conversions and representations', () => {
  const r = new Rational(7, 4);
  assert.equal(r.toString(), '7/4');
  assert.equal(r.toMixedString(), '1 3/4');
  assert.equal(r.toDecimalString(2), '1.75');
  assert.equal(r.toNumber(), 1.75);

  const rWhole = new Rational(8, 2);
  assert.equal(rWhole.toMixedString(), '4');
});

test('isRationalEquivalent compares user input with target', () => {
  const target = new Rational(3, 4);
  assert.ok(isRationalEquivalent('3/4', target));
  assert.ok(isRationalEquivalent('6/8', target));
  assert.ok(isRationalEquivalent('0.75', target));
  assert.ok(!isRationalEquivalent('2/3', target));
  assert.ok(!isRationalEquivalent('bad', target));
});
