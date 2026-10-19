/** Automatization line shared across F20 mastery and F19 reviews: a recall taking at most this long
 * counts as "fast". One constant, two consumers, so the definitions cannot drift apart. */
export const AUTOMATICITY_MS = 2000;
/** Explicit timed-mastery proxy; intentionally not claimed to be a calibrated probability. */
export function masteryProxy(events, tag, thresholdMs=AUTOMATICITY_MS, priorWeight=8) {
  const xs=events.filter(e=>e.tags?.includes(tag));
  const passing=xs.filter(e=>e.correct&&e.responseMs<=thresholdMs).length;
  return { tag, samples:xs.length, estimate:(passing+priorWeight*.5)/(xs.length+priorWeight), model:'beta-binomial-smoothing-proxy', calibrated:false };
}

/* ---- Probabilistic mastery model (F20 close-out) ----
 *
 * masteryProxy above is a point smoothing proxy. masteryPosterior turns the same observables
 * (solved events that are correct *and* at or under the shared AUTOMATICITY_MS line) into a real
 * posterior over the underlying mastery probability, with a credibility interval it can show
 * even on thin samples. Prior: Jeffreys Beta(0.5, 0.5) — a reference distribution that leaks no
 * win/loss weighting into the point estimate. Posterior for `passes` of `n` observations:
 * Beta(0.5 + passes, 0.5 + n − passes); the point estimate is the posterior mean
 * (0.5 + passes) / (n + 1) and the interval is equal-tailed from the exact Beta CDF.
 *
 * Honesty: the interval says where the *recorded* fast-and-correct share plausibly sits. It is
 * never fitted or validated against realized benchmark outcomes, so `calibrated` stays false and
 * the note says so — the arithmetic is exact, no causal claim rides on it.
 */

/** ln Γ(z) via the Lanczos approximation (g = 7). Accurate to ~1e-15 for z > 0 in interface use. */
function logGamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const zz = z - 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (zz + i);
  const t = zz + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Continued fraction for the regularized incomplete beta (Lentz's method — Numerical Recipes). */
function betacf(a, b, x) {
  const MAXIT = 250, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b) — the Beta(a, b) CDF. */
function betaCdf(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/**
 * Quantile of Beta(a, b) by bisection on the CDF — monotone on (0, 1), deterministic, exact to the
 * 4-decimal display rounding long before the iteration cap. Exported so tests can pin it against
 * closed forms; the mastery model is its only production consumer.
 */
export function betaQuantile(q, a, b) {
  if (!(Number.isFinite(q) && q > 0 && q < 1)) throw new RangeError(`betaQuantile needs q in (0, 1), got ${q}`);
  if (!(Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0)) throw new RangeError(`betaQuantile needs a, b > 0, got ${a}, ${b}`);
  let lo = 0, hi = 1;
  for (let i = 0; i < 60 && hi - lo > 1e-11; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < q) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10000) / 10000;
}

const POSTERIOR_CONFIDENCES = Object.freeze([0.9, 0.95, 0.99]);

export const MASTERY_NOTE =
  'posterior over your recorded fast-and-correct share (solve correct AND at or under the 2 s automatization line) with a Jeffreys Beta(0.5, 0.5) prior; the interval says where the underlying share plausibly sits, it is not fitted or validated against realized benchmark outcomes';

/**
 * The probabilistic mastery estimate over counts: posterior Beta(0.5+passes, 0.5+misses).
 * Guards refuse non-integer counts or confidence reversals; zero observations fall back to the
 * prior itself (estimate 0.5 with the prior's interval), never a fabricated skill number.
 */
export function masteryPosterior(passes, observations, { confidence = 0.95 } = {}) {
  if (!(Number.isInteger(passes) && Number.isInteger(observations) && observations >= 0 && passes >= 0 && passes <= observations)) {
    throw new RangeError(`masteryPosterior needs integer counts 0 <= passes (${passes}) <= observations (${observations})`);
  }
  if (!POSTERIOR_CONFIDENCES.includes(confidence)) throw new RangeError(`masteryPosterior supports confidence 0.9 / 0.95 / 0.99, got ${confidence}`);
  const a = passes + 0.5, b = observations - passes + 0.5;
  const tail1 = (1 - confidence) / 2;
  return {
    samples: observations,
    passes,
    estimate: Math.round((a / (a + b)) * 10000) / 10000,
    ci: { low: betaQuantile(tail1, a, b), high: betaQuantile(1 - tail1, a, b), confidence },
    model: 'jeffreys-beta-posterior',
    calibrated: false,
    note: MASTERY_NOTE,
  };
}

/**
 * Probabilistic mastery over recorded events (F20). Same tag contract as masteryProxy: `events`
 * entries whose `tags` array includes `tag`; a solve masters the tag when it is correct and at or
 * under `thresholdMs` (default the one shared AUTOMATICITY_MS constant). The heatmap uses a
 * dependency-free shell around the same rule. Empty observations return the prior.
 */
export function masteryModel(events, tag, { thresholdMs = AUTOMATICITY_MS, confidence = 0.95 } = {}) {
  const xs = (Array.isArray(events) ? events : []).filter(e => e?.tags?.includes(tag));
  const passes = xs.filter(e => e.correct === true && Number.isFinite(e.responseMs) && e.responseMs <= thresholdMs).length;
  return { tag, ...masteryPosterior(passes, xs.length, { confidence }) };
}
