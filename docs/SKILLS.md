# Skill taxonomy, pattern rollups and spaced repetition with adaptive drill difficulty (F17/F18/F19)

All definitions below are deterministic and seed-free. Every public metric here inherits a
sample-size caveat: medians from fewer than 6 observations get no confidence interval, and nothing
in this document is a calibrated psychometric measurement or evidence that drills improve scores
(transfer evaluation is F21/F22, not this slice).

## Taxonomy version

`SKILL_TAXONOMY_VERSION = 'skill-taxonomy-v1'` (frozen; `packages/training/src/skills.js`).

A **skill cell** is one cell of the F09 weakness heatmap grid. The taxonomy deliberately *reuses*
`heatmapLayout` banding instead of factoring a parallel banding module, so skill cells and heatmap
cells cannot drift apart:

- id string = the heatmap cell `key`: `${op}:${row}:${col}`, e.g. `mul:5:4` ("7 × 40–49");
- labels and operand ranges come from the same axis objects;
- per-skill metrics are computed by `buildHeatmap` itself.

**v1 geometry** (identical to the heatmaps in docs/FEATURE_MATRIX.md F09):

| op | rows | cols |
|---|---|---|
| add | left addend band | right addend band |
| sub | subtracted number band | answer band |
| mul | table factor (2–12, `sourceLeft`) | other factor band (`sourceRight`) |
| div | divisor (2–12, `sourceLeft`) | answer band (`sourceRight`) |

Operand bands are 2–9, 10–19, … 90–100. Mappings use the **source operands** of the underlying
problem (never the composite display operands). For division the source operands are the divisor
and the quotient, verified against played sessions and pinned by `tests/skills.test.js`: an event
`a*b ÷ a = b` stores `sourceLeft = a` (2–12) and `sourceRight = b` (2–100), matching `makeQuestion`
in `packages/core/src/generator.js`. For subtraction, `sourceLeft` is the subtrahend and
`sourceRight` the answer. `skillCellFor` returns `null` for anything outside this space (factor 13,
operand 101, unknown op): out-of-taxonomy data is skipped, never crashed on, and never reinterpreted.

Changing the banding later requires: a new `SKILL_TAXONOMY_VERSION`, a decision for each stored
review record (migrate ids or drop), regeneration of the drill label mapping, and updates to this
document and `tests/skills.test.js`. Probability deep links to heatmap cells stay valid because the
id format *is* the heatmap key; a v2 that re-spaced bands would break stale `#heatmap/…/r/c` links
for cells whose meaning moved — record that decision when it is made. (`drill.cell` in existing
sessions also uses the same ids, so slice 2 can look up any historical drill's cell.)

## Per-skill rollups

`skillRollups(sessions, { scope = 'benchmark' })` returns `{ taxonomyVersion, scope,
opObservations, skills }`, where `skills` lists every cell with at least one observation, sorted
deterministically by op (add, sub, mul, div), then row, then col. Per cell (all definitions are the
heatmap's own, via `buildHeatmap`):

| field | definition | caveat |
|---|---|---|
| `count` | solved observations in the cell | exact |
| `medianMs` | raw median solve time | no CI below 6 observations |
| `ci` | distribution-free 95% median interval | null below 6 |
| `smoothedMs` | cell median shrunk toward the operation median, weight 4 | biased toward the median when count is small |
| `ratio` | smoothed cell median ÷ operation median | >1 = slower; needs ≥ `MIN_CELL_SAMPLES` to be reported |
| `flawedShare` | share with any slip/revision/calculation entry pattern | classification from docs/TELEMETRY.md |
| `evidence` | `insufficient` < 3, `emerging` < 8, `stable` ≥ 8 (`MIN_CELL_SAMPLES`, `STABLE_CELL_SAMPLES`) | descriptive |

**Namespaces never blend.** Scope mirrors the heatmap and entry-quality panels: `benchmark` uses only
verified standard runs; `all` adds practice/drill sessions for training-time decisions. A drill run
can never change a benchmark-scoped summary, and scope names outside the two known values throw.
Events keep their tags (`.tags`, built by `packages/core/src/classify.js`), so tag-based weaknesses
continue to flow through `diagnose()`; v1 skill cells are operand-space-only and that is a
deliberate tax-v1 boundary, not a claim that tags are skills.

`weakestSkillCell(sessions, { scope='all', minSamples })` picks the largest `ratio > 1` above the
sample gate; ties resolve to the deterministic sort order above. It is a planning heuristic:
descriptive, moderately smoothed, and not a model of what will help.

## Pattern drills (F17)

`patternDrill(cell, seconds = 60)` in `packages/training/src/drills.js` extends `cellDrill`:

- returns a **custom practice ruleset** (`id: 'pattern-drill'`) with `enabled = [op]` and the
  addition/multiplication ranges narrowed to the cell — so every generated problem satisfies
  `skillOf(question).id === cell.id`;
- `label` is `Pattern drill · <label>` and `explanation` is an honest string that must not claim
  score gains;
- `benchmarkEquivalent` stays false even for a full-range cell (id/label difference); the benchmark
  ruleset is immutable and untouched;
- accepts any `{op,rowRange,colRange,label?}` (a `skillCellFor` result or a `skillRollups` record),
  so it also works for hand-built ranges; invalid input throws `RangeError`.

The daily plan (`dailyPlan`) appends the weakest pattern to its rationale **only when a cell clears
the sample gate**; with no skill history it degrades to the plain operation-level rationale. Drill
launch points (M2 slice 2): the heatmap cell detail ("Drill … · 60s practice") and the due-review queue
on the Train tab both call `patternDrill` through the session launcher; the drill runs as mode
`drill`, stores `drill: {op, cell, label}` on its result (`cell` = the skill id), and is saved as
practice so it can never upgrade to a benchmark.

## Persisted spaced repetition (F19)

Scheduling primitive `packages/training/src/scheduler.js`:

- `scheduleReview(state, wasFastAndCorrect, now)` — unchanged pure primitive; successes over failures
  ladder intervals `1, 2, 4, 8, 16, 32, 60` days (success streak cap 6), any lapse resets to 1 day.
- `skillReviewRecord(skillId, existing, wasFastAndCorrect, now)` — composes it into the storage
  record; tests must pass an explicit `now` (Date or ISO string): **no `Date.now()`-only math is
  testable, and the default parameter is for production convenience only**.

Record shape (all times are stored ISO strings; timezone math never touches local parsing):

```js
{
  id: 'div:5:9',              // skillId; IndexedDB keyPath
  skillId: 'div:5:9',
  op: 'div',
  taxonomyVersion: 'skill-taxonomy-v1',
  successes: 0,               // current success streak
  failures: 0,                // lifetime lapse count
  intervalDays: 1,            // current spacing (derived again on import)
  lastReviewedAt: '2026-10-17T12:00:00.000Z',
  nextReviewAt: '2026-10-24T12:00:00.000Z' // lastReviewedAt + intervalDays
}
```

Storage (`packages/storage/src/db.js`): IndexedDB `zetamaster-v1` is now schema **version 2** —
`onupgradeneeded` adds a `skillReviews` object store (keyPath `id`) additively; existing `sessions`
data is untouched, so v1 users upgrade in place. The localStorage fallback keeps a mirror under
`zetamaster-skill-reviews-v1`, capped like sessions at the 500 most recent writes. `listSkillReviews`
/ `saveSkillReview` (replace-by-id) / `recordSkillReview(skillId, outcome, now)` / `importSkillReviews`
follow the same layout as the session functions. The taxonomy has only 420 cells, so the cap cannot
be exceeded through taxonomy-valid records; `recordSkillReview` composes the pure scheduling
primitive with the record already stored for that id.

Import discipline matches session imports: `sanitizeImportedSkillReview` drops (but counts) records
whose taxonomy version is not current, whose id is not a real current-taxonomy cell, whose counters
are negative/non-integers, or whose stored `nextReviewAt` disagrees with
`lastReviewedAt + intervalDays` (recomputed, never trusted). `parseSkillId` is the id grammar — it
delegates to `skillCellFromId` (training) so the storage grammar and the UI's id→cell lookup are one
source of truth. Exports: `exportBundle(sessions, skillReviews)` produces
`{ schema: 'zetamaster-export-v2', exportedAt, sessions, skillReviews }`; `parseExportBundle` still
accepts the legacy bare array. Exports remain user-initiated only.

## When a review is recorded and what it means (slice 2)

`packages/training/src/reviews.js` owns the semantics; `apps/web/src/main.js` applies it after every
finished run and the UI shows the outcome in the drill result panel.

- **What records:** exactly one review per *completed* pattern drill (`mode: 'drill'`), evaluated on
  the run's own `finishedAt` (explicit clock; never a hidden `Date.now()`). Practice sessions of
  other modes and benchmarks never record reviews. **Interrupted drills (ended early) record
  nothing** — a review that was cut short is not evidence of a mastered pattern.
- **Minimum evidence:** the run needs ≥ `SKILL_REVIEW_MIN_SOLVES = 3` solved problems whose
  `skillOf(event).id` equals the drilled cell id (the event filter is the caller's job, so the
  function has explicit inputs). Below that, no record — the results panel says so.
- **Success rule ("wasFastAndCorrect"):** the run's usable solve times (`responseMs` finite and
  ≥ 0; unusable entries are ignored, not counted) pass when **at least half finish at or under
  `SKILL_REVIEW_FAST_MS = 2000 ms`** — equivalently, the *nearest-rank* median ≤ 2000 (the smallest
  value with at least half the observations at or below it). The same 2000 ms automatization line is
  F20 `masteryProxy`'s per-event threshold, exported from `packages/analytics/src/skill-model.js` as
  `AUTOMATICITY_MS` and imported here, so the two features cannot drift. The nearest-rank choice is
  pinned by tests: at exactly half-solves-inside, the run passes; an interpolated median would
  sometimes disagree, and the reported `medianMs` is the same nearest-rank value.
- **Outcomes:** success (`wasFastAndCorrect = true`) grows the streak and multiplies the interval
  (1 → 2 → 4 … 60 d, lapse at a streak cap); anything slower records a lapse (streak reset,
  interval back to 1 day). Both outcomes are records; only absence of evidence records nothing.
- **Sample-size caveat:** the review decision rests on one run's solves (≥ 3 observations); a run
  can pass on a lucky tail or lapse on a busy morning. The record is averaged *across* runs only
  through the streak counters, never through a flattened median-of-medians.

### Review queue (Train tab)

`reviewQueue(records, nowMs, { upcomingDays = 7 })` (pure) splits stored records into:

| item | definition |
|---|---|
| `due` | `nextReviewAt ≤ nowMs`; sorted op add→sub→mul→div, then row, then col (the `skillRollups` order) |
| `upcoming` | `nextReviewAt in (nowMs, nowMs + upcomingDays]`; sorted by next review time, ties by cell order |
| `skipped` | records whose id does not name a current-taxonomy cell, or whose `nextReviewAt` is unparseable — hidden and counted, never reinterpreted |

Due rows launch a `patternDrill` for their cell; practicing early records that run's outcome and
reschedules from today (the scheduler only ever sees one `now`). A row shows the tier its next drill
will run at (`drillTierForRecord(record)`, below). The panel shows streaks, lapse counts and the
current interval per record, plus an honest empty state: records exist only after drill runs or
imports, so a fresh profile sees no fabricated homework.

## Adaptive drill difficulty and mix (F18, slice 3)

Pattern drills run at one of three tiers inside their single skill cell
(`DRILL_TIERS`, `packages/training/src/drills.js`):

| tier | name | operand ranges |
|---|---|---|
| 1 | Narrow | each band trimmed to its lower half — `[lo, lo + ⌊(hi−lo)/2⌋]`; smaller operands are the easier entry point, and single-value bands (a table factor's `[7, 7]`) stay single |
| 2 | Full | exactly the cell's bands — the pre-F18 behavior and the default |
| 3 | Stretch | full cell plus exactly **one** adjacent band along one axis (row axis first, then column), interleaving two neighboring patterns |

Tier selection (`drillTierForRecord`) is cross-run and driven only by the F19 record's success
streak — the same counters that drive the interval ladder:

| record state | next tier |
|---|---|
| no record, or a non-integer / negative streak (no usable evidence) | 2 · Full |
| streak 0 — the last review lapsed | 1 · Narrow |
| streak 1–3 — fresh consecutive fast runs | 2 · Full |
| streak ≥ 4 — four consecutive fast runs | 3 · Stretch |

Guarantees, pinned property by property in `tests/drill-tiers.test.js`:

- Tier 1 and 2 problems map to **exactly the drilled cell**: `skillOf(question).id === cell.id` for
  every seeded draw.
- A stretch touches exactly the bands the cell touched plus their upper neighbor — for every
  taxonomy cell that means precisely *the cell and one adjacent cell*, both of which actually occur
  in generated draws. Widened union ranges stay contiguous because layout bands partition each axis.
- Stretches point to **larger operands** and never leave the benchmark operand space: when both
  axes of a cell already end at their axis' top band the ladder caps (exactly `add:9:9`, `sub:9:9`,
  `mul:10:9`, `div:10:9`) and tier 3 equals tier 2 — the widest cell has no harder partner inside
  the benchmark's own maximum. Tier-1 ranges are always subsets of the cell's bands.
- Every tier stays practice-only: `id: 'pattern-drill'`, `benchmarkEquivalent` false, and the
  benchmark ruleset untouched (the byte-identity gate in tests/skills.test.js still applies).

The never-mid-run rule is deliberate: a run's generated pool must be fixed at launch for the
per-run speed review (above) to be interpretable, so the tier applies between runs via the stored
record — the UI shows the tier in the review queue, on the drill's ruleset label, and in the
result-panel line naming the next drill's difficulty.

## Daily plan: persisted completion, exact-minute budget and plateau branches (F34/F22, slice 5)

The plan itself is regenerated from history on every refresh so it can react to new evidence;
what persists is only what you did. One completion record per **local day** lives in the
`dailyPlans` IndexedDB store (schema v3, see `docs/ARCHITECTURE.md`), keyed `'YYYY-MM-DD'`:

```js
{ id: '2026-10-18', date: '2026-10-18', targetMinutes: 15,
  steps: [{ id: 'warmup', minutes: 3, completed: true, completedAt: ISO8601 }, …],
  completedMinutes: 5, // recomputed from the steps, never trusted on import
  updatedAt: ISO8601 }
```

Records carry **no score fields by design** — import sanitization
(`sanitizeImportedDailyPlan`) whitelist-reconstructs each record, recomputes
`completedMinutes` from the steps, rejects impossible dates/ids/minutes, and imports of a
v3 bundle round-trip them. `dayLogKey` formats keys with a pinned `en-CA` locale (local
calendar day — a UTC key would roll over mid-evening for users west of UTC).

- **Exact-minute budget** (`allocateBudget`, largest-remainder method): the five steps
  `warmup → targeted → lesson → sprint → reflect` split the target* minutes summing
  **exactly** to the target, weighted 1 / 2 / 1.25 / 1 / 1 by default — a transparent
  weighting, not a fitted optimizer. The gauntlet branch pushes targeted to 3.2 and
  method-work raises lesson to 1.6; ties resolve to step order.
- **Leftover semantics**: floors plus biggest-remainder distribution; `allocateBudget(0)`
  is all zeros, and non-integer or zero total weights throw rather than invent shares.
- **Plateau branches** (F22, `packages/training/src/plateau.js`): the conservative
  `detectPlateau` signal (possible-plateau over a pinned 12-run split) selects between
  three pre-named branches, deterministically from record evidence — `gauntlet-rotate`
  when a stable weak skill-cell pattern exists (≥ 8 solves, shrunken ratio > 1),
  `method-work` when a diagnosed slow operation/tag shows method headroom (≥ 5 solves)
  but no reliable cell, `consistency-rest` when nothing diagnosable stands out. The
  branch rides the plan as `{ name, why, actions }` with the evidence in `why` — the
  UI labels it "a hypothesis to test, not a proven treatment".
- **Coverage** (F38 surface, `skillCoverage`): of the 420-cell taxonomy
  (10×10 add/sub + 11×10 mul/div), how many cells any history touches at all (≥ 1 solve)
  and how many carry stable evidence (≥ 8 solves), split per operation. The Train tab
  shows `patterns observed N of 420 · stable evidence M`. Scope-safe: 'benchmark' reads
  only verified standard runs, practice counts only via scope 'all'.
- **Recommendations** (F38): the plan rationale references the exact evidence names —
  slowest gated pattern with ratio and solve count, the intervention branch's `why`, and
  the coverage line — and the Train tab's progress line renders each branch's `actions`
  as concrete next steps (`next: weakness gauntlet → transfer probe → standard
  benchmark`), so the recommendation names what to do rather than a vague "practice
  more"; recommendation surfaces degrade gracefully with no data.

## Estimated score impact, recommendations and policy comparison (F20/F21/F38, slice 6)

`packages/training/src/impact.js` states its whole model in one formula: a standard benchmark
awards one point per correct answer in `budgetMs`, and your recorded pace (`meanResponseMs`
over the last verified runs) predicts `budgetMs / meanResponseMs` points per run. A category
running `excessMs` slower than its reference, at `share` of observed solves, would add

`estDelta = budgetMs / (meanResponseMs − share × excessMs) − budgetMs / meanResponseMs`

points per run if closed. Inputs are guarded (null on degenerate histories, `share` capped at
0.9, results capped at +30, impossible paces refused), and every row states its share, both
medians and the estimate, so the arithmetic is reproducible from the row alone.

- **Calibration, honestly scoped** (`calibrateImpactModel`): per verified benchmark run it
  compares the predicted `budgetMs / meanResponse` against the run's own correct-answer count,
  reporting absolute-mean error and the ≤10% hit share, gated at ≥ 6 runs with per-run minimum
  solves. Deliberately same-data: it validates the pace→points arithmetic, not the future. The
  category step (`share × excess`) remains **unvalidated** — measuring it needs recorded
  treatment history (M4 experiments, F37).
- **Merged recommendations** (`buildRecommendations`, F38): one deterministic list fusing the
  existing evidence surfaces — due spaced reviews first, then weakest sample-gated cells, then
  the plateau branch (a protocol item), then a top estimated-payoff row, and a coverage "build
  evidence first" item only when the list is otherwise empty. Each item quotes its numbers
  (ratio, solve count, due dates) and carries launch data wired to the drill launch path.
- **Policy comparison, flagged** (`comparePolicies`/`projectPolicy` in
  `packages/training/src/policies.js`): three named concentration policies (operation-adaptive
  mix, cell gauntlet rotation, automaticity ladder), each scored by its candidates' summed
  `estDelta`; emphasis is placement only — a seeded balanced A/B (`assignStrategyTrial`) or an
  allow-listed feature flag, with the note saying plainly that **no outcome tracking exists yet**
  and nothing can claim one policy is better. Device seed is stable per browser.

## What this slice does not claim

- No evidence yet that pattern drills improve benchmark scores; that measurement (train/holdout and
  predicted-vs-observed transfer) is F21/F22.
- The F18 tier ladder is a heuristic on speed evidence only: "narrow after a lapse" and "stretch
  after four fast runs" assume smaller operands are an easier entry point and larger neighbors are
  harder, which is plausible, not measured; no in-run difficulty adaptation, no calibrated mastery
  model, and no claim that stretched problems accelerate anything.
- Cross-operation pattern mixing does not exist: the generator draws from one rectangle per
  operation family, so v1 "mix" is interleaving one cell with its adjacent band only. A generator
  extension (and its own parity audit) would precede any multi-operation pattern drill.
  exact-minutes weighting toward the selected branch, largest-remainder split; branches are
  hypotheses from record evidence, not measured treatments (F21/F22 evaluate them).
- The coverage meter describes *reach* (how much of the 420-cell taxonomy the history has touched),
  not ability or mastery; a high share is not an achievement metric and stable evidence ≠ skill.
- Score-impact estimates are arithmetic on your own recorded medians: they say what closing a gap
  would be worth *if* freed seconds converted to correct answers, which is an assumption, not a
  measurement; the category step has no calibration and the policy comparison has no outcome
  tracking, so no ranking of training strategies is supportable yet (F20/F21 remain partial).
- Review outcomes measure **speed only**. The engine does not persist wrong attempts (the F07
  correction-semantics follow-up), so "fast *and* correct" reduces, in practice, to the speed rule
  above; lapses are "recall was not automatic", not "answers were wrong".
- The 1–60 day interval ladder is a fixed heuristic, not a validated forgetting model, and the queue
  is a prompt, not a measured intervention.
- Rollup medians are observations, not calibrated ability estimates.
