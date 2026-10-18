# Skill taxonomy, pattern rollups and spaced repetition (F17/F19)

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
reschedules from today (the scheduler only ever sees one `now`). The panel shows streaks, lapse
counts and the current interval per record, plus an honest empty state: records exist only after
drill runs or imports, so a fresh profile sees no fabricated homework.

## What this slice does not claim

- No evidence yet that pattern drills improve benchmark scores; that measurement (train/holdout and
  predicted-vs-observed transfer) is F21/F22.
- Review outcomes measure **speed only**. The engine does not persist wrong attempts (the F07
  correction-semantics follow-up), so "fast *and* correct" reduces, in practice, to the speed rule
  above; lapses are "recall was not automatic", not "answers were wrong".
- The 1–60 day interval ladder is a fixed heuristic, not a validated forgetting model, and the queue
  is a prompt, not a measured intervention.
- Rollup medians are observations, not calibrated ability estimates.
