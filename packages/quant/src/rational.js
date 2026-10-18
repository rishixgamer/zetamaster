/**
 * Exact Rational Arithmetic (F49).
 * Preserves exact fractional values without floating point drift.
 * Never contaminates standard arithmetic benchmark scores.
 */

/** Greatest common divisor via Euclidean algorithm. */
export function gcd(a, b) {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/** Least common multiple. */
export function lcm(a, b) {
  if (a === 0 || b === 0) return 0;
  return Math.abs(Math.trunc(a * b)) / gcd(a, b);
}

/**
 * Exact Rational number class.
 * Normalized such that denominator > 0 and gcd(num, den) === 1.
 */
export class Rational {
  constructor(num, den = 1) {
    if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
      throw new RangeError('Rational numerator and denominator must be safe integers');
    }
    if (den === 0) {
      throw new RangeError('Rational denominator cannot be zero');
    }
    let n = num;
    let d = den;
    if (d < 0) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.num = n / g;
    this.den = d / g;
    Object.freeze(this);
  }

  /**
   * Parse a rational from number, string ("3/4", "1 1/2", "-5/8", "0.25", "7"), or Rational.
   */
  static from(val) {
    if (val instanceof Rational) return val;
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) throw new RangeError('Cannot construct Rational from non-finite number');
      if (Number.isSafeInteger(val)) return new Rational(val, 1);
      // Decimal conversion: e.g. 0.125 -> 125/1000 -> 1/8
      const s = val.toString();
      const dot = s.indexOf('.');
      if (dot === -1) return new Rational(Math.trunc(val), 1);
      const decPlaces = s.length - dot - 1;
      const factor = 10 ** Math.min(decPlaces, 8);
      return new Rational(Math.round(val * factor), factor);
    }
    if (typeof val === 'string') {
      const parsed = parseRational(val);
      if (!parsed) throw new RangeError(`Cannot parse rational from: "${val}"`);
      return parsed;
    }
    throw new TypeError('Expected number, string, or Rational instance');
  }

  add(other) {
    const o = Rational.from(other);
    const n = this.num * o.den + o.num * this.den;
    const d = this.den * o.den;
    return new Rational(n, d);
  }

  sub(other) {
    const o = Rational.from(other);
    const n = this.num * o.den - o.num * this.den;
    const d = this.den * o.den;
    return new Rational(n, d);
  }

  mul(other) {
    const o = Rational.from(other);
    return new Rational(this.num * o.num, this.den * o.den);
  }

  div(other) {
    const o = Rational.from(other);
    if (o.num === 0) throw new RangeError('Division by zero rational');
    return new Rational(this.num * o.den, this.den * o.num);
  }

  inv() {
    if (this.num === 0) throw new RangeError('Cannot invert zero rational');
    return new Rational(this.den, this.num);
  }

  abs() {
    return new Rational(Math.abs(this.num), this.den);
  }

  neg() {
    return new Rational(-this.num, this.den);
  }

  equals(other) {
    try {
      const o = Rational.from(other);
      return this.num === o.num && this.den === o.den;
    } catch {
      return false;
    }
  }

  compare(other) {
    const o = Rational.from(other);
    const diff = this.num * o.den - o.num * this.den;
    return diff < 0 ? -1 : diff > 0 ? 1 : 0;
  }

  toNumber() {
    return this.num / this.den;
  }

  toString() {
    return this.den === 1 ? `${this.num}` : `${this.num}/${this.den}`;
  }

  toMixedString() {
    if (this.den === 1) return `${this.num}`;
    const whole = Math.trunc(this.num / this.den);
    const rem = Math.abs(this.num % this.den);
    if (whole === 0) return `${this.num}/${this.den}`;
    return rem === 0 ? `${whole}` : `${whole} ${rem}/${this.den}`;
  }

  toDecimalString(maxDecimals = 4) {
    const val = this.num / this.den;
    const rounded = Number(val.toFixed(maxDecimals));
    return `${rounded}`;
  }
}

/**
 * Parses user input strings into a Rational.
 * Supports:
 * - "a/b" (e.g. "3/4", "-7/8", "6/8")
 * - "w a/b" mixed fractions (e.g. "1 1/2", "-2 3/4")
 * - decimals (e.g. "0.75", "-1.5")
 * - integers (e.g. "4", "-10")
 */
export function parseRational(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (!s) return null;

  // Mixed fraction: e.g. "1 1/2" or "-2 3/4"
  const mixedMatch = /^([+-]?\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixedMatch) {
    const whole = Number(mixedMatch[1]);
    const num = Number(mixedMatch[2]);
    const den = Number(mixedMatch[3]);
    if (den === 0 || !Number.isSafeInteger(whole) || !Number.isSafeInteger(num) || !Number.isSafeInteger(den)) return null;
    const sign = whole < 0 ? -1 : 1;
    const totalNum = sign * (Math.abs(whole) * den + num);
    try {
      return new Rational(totalNum, den);
    } catch {
      return null;
    }
  }

  // Simple fraction: "a/b" or "-a/b"
  const fracMatch = /^([+-]?\d+)\/([+-]?\d+)$/.exec(s);
  if (fracMatch) {
    const num = Number(fracMatch[1]);
    const den = Number(fracMatch[2]);
    if (den === 0 || !Number.isSafeInteger(num) || !Number.isSafeInteger(den)) return null;
    try {
      return new Rational(num, den);
    } catch {
      return null;
    }
  }

  // Integer or decimal
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) {
    const numVal = Number(s);
    if (!Number.isFinite(numVal)) return null;
    try {
      return Rational.from(numVal);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Checks whether user input matches an expected rational answer.
 * Accepts exact fraction, unreduced equivalent fraction, or decimal within epsilon.
 */
export function isRationalEquivalent(userInput, expectedRational, epsilon = 1e-6) {
  const parsed = parseRational(userInput);
  if (!parsed) return false;
  const target = Rational.from(expectedRational);
  if (parsed.equals(target)) return true;
  return Math.abs(parsed.toNumber() - target.toNumber()) < epsilon;
}
