/**
 * Difficulty classification (F10). Multiple tags may apply. The original tags below are frozen
 * behavior — extending the taxonomy must only ever ADD tags, never rename or recondition the
 * existing ones, because every stored historical event carries the tag set from its own engine.
 * The extensions cover harder benchmark shapes and the larger operand spaces reachable through
 * F02 custom ranges (e.g. three-digit operands), stated plainly so diagnosis can group them.
 */
/** The divisors 2–12 that cannot be factored into smaller table steps further. */
const PRIME_DIVISORS = new Set([2, 3, 5, 7, 11]);
/** Schoolbook digit-carry count for a displayed addition, exact integer arithmetic. */
export function columnarCarries(sumLeft, sumRight) {
  let x = sumLeft, y = sumRight, carry = 0, carries = 0;
  while (x > 0 || y > 0 || carry > 0) {
    const digits = (x % 10) + (y % 10) + carry;
    if (digits >= 10) { carries++; carry = 1; } else carry = 0;
    x = Math.floor(x / 10); y = Math.floor(y / 10);
  }
  return carries;
}
export function classifyQuestion(q) {
  const tags = [q.op];
  if (q.op === 'add' || q.op === 'sub') {
    const a = q.sourceLeft ?? q.left;
    const b = q.sourceRight ?? q.right;
    if (a % 10 + b % 10 >= 10) tags.push('carry-or-borrow');
    if (a % 10 === 0 || b % 10 === 0) tags.push('round-tens');
    if (Math.max(a, b) >= 50) tags.push('larger-addends');
    // F10 harder shapes. Source operands note: subtraction stores (subtrahend, difference), so
    // the operand-scale tag reads the generation operands of both inverse operations alike.
    if (Math.max(a, b) >= 100) tags.push('three-digit-operands');
    // The multi-carry composition only describes the displayed addition; the displayed inverse
    // subtraction is not a carded column sum, so it never receives the tag.
    if (q.op === 'add' && columnarCarries(q.left, q.right) >= 2) tags.push('double-column-carry');
  } else {
    const small = q.sourceLeft ?? q.left;
    const large = q.sourceRight ?? q.right;
    tags.push(`table-${small}`);
    if (small === 9 || small === 11 || small === 12) tags.push('shortcut-friendly');
    if (large >= 50) tags.push('two-digit-decomposition');
    if (large % 10 === 0 || large % 5 === 0) tags.push('friendly-ending');
    if (q.op === 'mul') {
      // Both displayed factors with two digits or more (benchmark: 10–12 × 10–99).
      if (q.left >= 10 && q.right >= 10) tags.push('two-by-two');
      if (q.answer >= 1000) tags.push('product-1000-plus');
    } else {
      // Division: `small` is the divisor, `large` the quotient (display shows d·t ÷ d).
      if (large >= 10) tags.push('multi-digit-quotient');
      if (PRIME_DIVISORS.has(small)) tags.push('prime-divisor');
      else tags.push('composite-divisor');
    }
  }
  return tags;
}
