/**
 * Benchmark seed policy (ZM-01).
 *
 * A standard benchmark draws a fresh seed. A seed the person typed, or a seed copied from a
 * preset (a gauntlet probe, a challenge), is practice: the same 120 s sequence must not count
 * again. Sessions saved before `seedSource` existed have no source field; they keep their stored
 * benchmark flag. Score metrics then drop the 2nd and later benchmark runs on one non-empty seed.
 * A blank seed is not a repeat — unseeded legacy runs stay independent. This module does not
 * rewrite stored records.
 */

/** How a launch picks its seed. Benchmark mode ignores the field and any preset seed. */
export function resolveLaunchSeed({ mode, fieldSeed = '', presetSeed = null, randomSeed } = {}) {
  if (typeof randomSeed !== 'string' || !randomSeed.trim()) {
    throw new RangeError('resolveLaunchSeed needs a fresh random seed');
  }
  const fresh = randomSeed.trim();
  if (mode === 'benchmark') return { seed: fresh, seedSource: 'random', clearField: true };
  if (typeof presetSeed === 'string' && presetSeed.trim()) {
    return { seed: presetSeed, seedSource: 'preset', clearField: false };
  }
  const typed = typeof fieldSeed === 'string' ? fieldSeed.trim() : '';
  if (typed) return { seed: typed, seedSource: 'user', clearField: false };
  return { seed: fresh, seedSource: 'random', clearField: false };
}

/**
 * Later benchmark runs on a non-empty seed.
 * The earliest `startedAt` stays eligible; ties keep the earlier input index.
 * Returns object identity in `excluded` — recompute on the array you are filtering.
 */
export function repeatedBenchmarkSeedReport(sessions) {
  const excluded = new Set();
  if (!Array.isArray(sessions)) return { excludedCount: 0, excluded };
  const groups = new Map();
  sessions.forEach((session, index) => {
    if (!session || session.benchmark !== true) return;
    const seed = typeof session.seed === 'string' ? session.seed.trim() : '';
    if (!seed) return;
    const group = groups.get(seed);
    if (group) group.push({ session, index });
    else groups.set(seed, [{ session, index }]);
  });
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const ta = Date.parse(a.session.startedAt);
      const tb = Date.parse(b.session.startedAt);
      const na = Number.isNaN(ta) ? Infinity : ta;
      const nb = Number.isNaN(tb) ? Infinity : tb;
      if (na !== nb) return na - nb;
      return a.index - b.index;
    });
    for (let i = 1; i < group.length; i++) excluded.add(group[i].session);
  }
  return { excludedCount: excluded.size, excluded };
}
