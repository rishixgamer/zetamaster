# Weakness gauntlet: train, probe unseen, benchmark (F31/F32, M2 slice 4)

All definitions below are deterministic and seed-explicit. This document covers the train/holdout
protocol required by `docs/MILESTONES.md` (M2 item 3) and the two drill surfaces it uses:
latency-bound automaticity drills (F31) and the weakness gauntlet with independent transfer probes
(F32). Everything inherits the standing sample-size caveat: medians and pass rates from small
samples are noisy, and **nothing in this slice claims that any drill raises benchmark scores** —
the estimated-impact and transfer-evaluation machinery is F21/F22 and is deliberately separate.

## The protocol in one view

```text
select gated weakest cells (max 2/day)
    ↓
train: one tier-aware 60 s pattern drill per cell (F17/F18 ladder; random seed)
    ↓
probe: one 60 s transfer probe per cell — same operand family, fresh day-scoped seed
    ↓
verify: one standard 120 s benchmark — untouched rules, untouched score namespace
```

Three namespaces stay separate by construction: **training** (drills, practice-scope), the
**probe** (practice-scope, measurement run), and the **benchmark** (standard rules only). The two
practice surfaces never write each other's evidence: probes and flash drills record no spaced
repetition reviews (`drillReviewEligible` in `packages/training/src/reviews.js` is the one authority
and is pinned by tests), and all gauntlet rulesets fail `benchmarkEquivalent`.

## Why the probe is "independent" and what that means

A probe samples problems from **exactly the same operand family** as the trained cell (its heatmap
bands, verified cell-mapping by tests), but through a freshly seeded RNG stream:

- The stream is derived deterministically as `gauntlet-probe:<UTC-day>:<cellId>`
  (`transferProbeSeed`), so a probe is reproducible on its day (relaunching "Play again" replays
  the *same measurement*, which a test should be able to do) and is different on any later day.
- Training drills always use a random per-run seed, so the training and probe streams can never
  coincide, and training itself never becomes rote recall of a fixed sequence.
- "Unseen" therefore means *held out from the RNG stream, same family* — not "a fact the user has
  never typed before". Small families physically repeat: a table factor × one band is ten
  problems, and a 60-second run will revisit them. The honest guarantee is **no adjacent
  repeats** (next section), not global novelty. The probe's own explanation string states this.

## Stimulus variety and the latency cap (F31)

`varyStimulus(generator)` (`packages/core/src/generator.js`) redraws whenever the next draw would
repeat the immediately previous fact (same operation and both source operands), bounded at 16
redraws; on a degenerate single-fact range it emits the repeat as-is rather than hang. Same seed →
same sequence; every emitted question is valid and stays in the ruleset ranges — pinned property
by property in `tests/question-budget.test.js`.

Automaticity drills (`automaticityDrill`, `packages/training/src/drills.js`) add two behaviors:

1. **Latency-bound:** the session carries an optional `questionBudgetMs` (validated 100–60 000 ms,
   default `AUTOMATICITY_MS = 2000`, the one shared "automatic recall" constant across F19/F20/F31).
   A question that is not answered in time is **missed**: recorded in the run's `missedEvents`
   (with the budget itself as `responseMs`, never a solve, never a point) and replaced. Enforcement
   lives in the engine (`maybeExpireQuestion`, called from `tick()` and at the top of
   `recordInput()`), so the budget holds no matter whether the timer loop or a keystroke arrives
   first; a keystroke typed against the expired problem is dropped, not applied to the next one.
2. **No rote sequence recall:** the seeded draw is wrapped in `varyStimulus`, so the same fact
   never appears twice in a row and a repeat cannot be answered from short-term memory.

Flash runs never write review records: their solved set is pre-filtered to answers under the
automaticity line, so they would inflate the F19 streak ladder trivially. The ladder keeps its
own full-pattern evidence.

## The M2 gate, as tests

`tests/gauntlet.test.js` has a test named for the milestone gate ("weak skills are the ONLY cells
gauntlet stages touch, and nothing here is a benchmark") which demonstrates, on synthetic seeded
history, that:

- selection only returns cells that clear the sample gate with shrunken ratio > 1, weakest first,
  ties by the rollup order, capped by the daily quota (`cellsLimit`, default 2);
- fast cells and sub-gate cells are never selected;
- every train/probe launch builds a practice ruleset (`benchmarkEquivalent` false, single
  operation), and the benchmark ruleset hash is byte-identical before and after;
- every drawn probe problem maps to exactly the probed cell (`skillCellFor` equality over 300
  seeded draws per cell); and
- an end-to-end probe run through a live `ArithmeticSession` finishes `benchmark: false`, stores
  its probe seed on the result, and is review-ineligible.

The earlier slice-1 test ("drills over-represent the weak skill; benchmark generation and scoring
stay byte-identical") still pins the cross-run weighting direction; this slice adds the
per-family holdout property on top.

## Engine changes and their blast radius

- `session.js`: optional `questionBudgetMs` (practice-only rulesets), `maybeExpireQuestion()`,
  `consumeExpiry()`, and `missedEvents`/`missedCount` on results. The benchmark ruleset carries no
  budget, so standard-mode behavior is unchanged (asserted by the unchanged parity and
  input-state suites).
- `rulesets.js`: `questionBudgetMs` validates only when present; a forged benchmark import with
  the extra field fails the byte-equality check like any other snapshot mutation.
- `drills.js`: `DRILL_GLYPH` exported (single source for labels), `automaticityDrill` added.
- `reviews.js`: `drillReviewEligible` gates which runs may write review records.
- Import discipline: `missedEvents` are not part of imported sessions (practice diagnostics, not
  analytic backbones); probes/drills persist their `drill` payload as before, reconstructed from
  source operands like every other event.

## What this slice does not claim

- No efficacy claim: the gauntlet is a protocol, not a proven intervention. Whether drill →
  probe → benchmark sequences produce measurable gains is F21/F22 ('compare predicted versus
  observed training gains'), which will need paired designs and much larger samples than a day.
- The tier ladder inside the gauntlet is the F18 speed heuristic, unchanged.
- Probe intervals and pass rates are not calibrated; one probe run describes one 60 s window.
- UTC day boundaries: a user near midnight gets a fresh probe seed; that is a documented choice,
  not user-local date handling (all scheduling times remain ISO/UTC internally).
