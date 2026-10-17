/** Multiple tags may apply. Extend taxonomy without changing arithmetic rules. */
export function classifyQuestion(q) {
  const tags = [q.op];
  if (q.op === 'add' || q.op === 'sub') {
    const a = q.sourceLeft ?? q.left;
    const b = q.sourceRight ?? q.right;
    if (a % 10 + b % 10 >= 10) tags.push('carry-or-borrow');
    if (a % 10 === 0 || b % 10 === 0) tags.push('round-tens');
    if (Math.max(a, b) >= 50) tags.push('larger-addends');
  } else {
    const small = q.sourceLeft ?? q.left;
    const large = q.sourceRight ?? q.right;
    tags.push(`table-${small}`);
    if (small === 9 || small === 11 || small === 12) tags.push('shortcut-friendly');
    if (large >= 50) tags.push('two-digit-decomposition');
    if (large % 10 === 0 || large % 5 === 0) tags.push('friendly-ending');
  }
  return tags;
}
