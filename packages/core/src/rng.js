/** Reproducible pseudo-random generator for replay/testing; not cryptographic. */
export function seedFromString(value) {
  let h = 2166136261;
  for (const char of String(value)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function createRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : seedFromString(seed);
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function intBetween(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }
export function sample(rng, xs) { return xs[Math.floor(rng() * xs.length)]; }
