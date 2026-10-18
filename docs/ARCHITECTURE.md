# Architecture and Extension Points

## Dataflow

```text
Browser mode selection
    ↓
`core/rulesets` (standard immutability / custom validation)
    ↓
`core/generator` (seeded inverse addition/multiplication sampling)
    ↓
`core/session` (monotonic clock, event stream, score)
    ↓
`storage/db` (local saved sessions, skill-review records) ──→ optional future sync adapter
    ↓
`analytics` (stats, uncertainty, history, diagnosis)
    ↓
`training` (weakness selection, pattern drills, plans, review scheduling)
    ↓
`curriculum` (verified mathematical explanations)
    ↓
User practice / retest / progress
```

## Package contracts

### Core

`createGenerator(rules, seed, weights?) -> () => Question`; `makeQuestion(op,a,b,sequence) -> Question`.

`ArithmeticSession({rules,generator,clock,wallClock,mode,seed,captureTrace,drill})` offers `start()`, `recordInput(fieldText)` (tracks the previous value itself and accepts on `trim() === String(answer)`), `markWrongSubmission()`, `recordVisibility(hidden)`, `tick()`, `remainingMs()`, and `finish({endedEarly})`. Results carry `engineVersion` and `integrity`. The pure generator never accesses the DOM or stores results.

**Default mode invariant:** benchmark eligibility is checked against the immutable rule snapshot and full duration; early termination must be marked practice. Future additions must not use adaptive weighting for benchmark mode.

### Analytics

`sessionStats(session)`, `operationSummary(events)`, `diagnose(sessions)`, `benchmarkProgress(sessions)` consume immutable historical records. `buildHeatmap(sessions, op, {scope})` bins solved events by *source* operands (table factor × band for mul/div, band × band for add/sub) and returns per-cell counts, medians, shrunken ratios and `medianCI` intervals. `consistencySummary(sessions)` derives goal progress, rolling bands, a Theil–Sen trend and median CIs from standard benchmarks only ([CONSISTENCY.md](./CONSISTENCY.md)). `paceProfile(sessions)` and `tailProfile(sessions)` analyze operation-adjusted pace through the run and slow-question tails over standard benchmarks ([FATIGUE.md](./FATIGUE.md)). `relativeHistogram(sessions)` bins the same adjusted ratios into fixed log bins `[×0.5, 0.75, 1, 1.5, 2, 3, ∞)` (lower edge inclusive), reports exact counts and shares per bin, the ≥×2 tail share, and a Theil–Sen trend of the per-run tail share; it shares `slowCutoffLog` with `tailProfile` so the two slow definitions cannot diverge, and is gated below 30 observations. `entryQuality(sessions)` aggregates latency-stratified entry types over standard benchmarks ([ENTRY_QUALITY.md](./ENTRY_QUALITY.md)); it reuses `relativeEvents` (which accepts the same `scope` option) and Theil–Sen `trend`. `errorTypology(events)` classifies entry quality (definitions in [TELEMETRY.md](./TELEMETRY.md)). Diagnoses are descriptive; current smoothed estimates are *not* psychometric calibration or causal evidence of improvement.

### Training

`chooseAdaptive(sessions)` returns rules and operation weights, keeping its training mode separate. The versioned skill taxonomy (`packages/training/src/skills.js`, version frozen in `SKILL_TAXONOMY_VERSION`) maps every benchmark question to a stable skill cell that *reuses the heatmap banding* — ids equal the heatmap cell keys (`docs/SKILLS.md`), and `skillRollups` computes per-skill metrics by calling `buildHeatmap` so the two surfaces share one implementation. `patternDrill(cell, seconds)` (F17) derives a custom practice ruleset narrowed to one cell; `weakestSkillCell` is the planner's deterministic selection heuristic. `scheduleReview` and `skillReviewRecord` are pure primitives, **not integrated product features**; per-skill review records are persisted by `packages/storage`. Add versioned policy IDs when comparing future learning algorithms. Drill selections are descriptive; nothing here is calibrated evidence of improvement.

### Curriculum

Lesson `result` values must be checked by deterministic arithmetic code or a verified fixture. For interactive tutorials, connect selected `tags` to pattern generators and unseen holdout examples. LLM explanations must reference mathematically checked results, not be grading authorities.

### Quant namespace

Quant drills and historical trading interview formats **never** reuse `zetamac-default-v1` score IDs. Provide exact rational arithmetic or explicit tolerance specifications for decimals and estimates, and independent scoring.

### Storage

`listSessions`, `saveSession`, `deleteAllSessions`, `importSessions` use IndexedDB first and localStorage fallback. Imports go through `sanitizeImportedSession`, which rebuilds questions from source operands and recomputes `benchmark` from the mode, the rules snapshot, the duration and the score/event count. Per-skill review records (F19, `docs/SKILLS.md`) persist in the same database: the `zetamaster-v1` database is at schema version 2 (additive `skillReviews` store keyed by `id`), with a mirrored, 500-record-capped localStorage fallback key. `skillReviewRecord` (training) is the only scheduling authority; `sanitizeImportedSkillReview` re-derives `nextReviewAt` from `lastReviewedAt + intervalDays` and drops, with a count, records that carry a foreign taxonomy version, an unknown skill id, or a schedule that disagrees with that recomputation. The v2 JSON export bundle (`exportBundle`) wraps sessions *and* skill review records; `parseExportBundle` still accepts the legacy session array. Data is device-local. Future cloud sync must implement an interface rather than inserting fetch calls into the core engine, and require affirmative consent.

## Schema sketch

```js
{
  id: string,
  startedAt: ISO8601,
  finishedAt: ISO8601,
  mode: 'benchmark' | 'adaptive' | 'custom' | 'isolation' | 'sprint' | 'endurance' | 'replay',
  seed: string,
  rules: RulesSnapshot,
  benchmark: boolean,
  score: number,
  elapsedMs: number,
  events: [{
    id, sequence, op, sourceLeft, sourceRight, left, right, answer, tags,
    responseMs, firstInputMs, entryMs, corrections, wrongSubmissions,
    inputChanges, completedAtMs, correct
  }],
  finalUnanswered: Question | null
}
```

Per-skill review record (schema-v2 `skillReviews` store, keyed by `id`; full contract in [SKILLS.md](./SKILLS.md)):

```js
{ id: 'div:5:9', skillId: 'div:5:9', op: 'div', taxonomyVersion: 'skill-taxonomy-v1',
  successes: 2, failures: 0, intervalDays: 2, lastReviewedAt: ISO8601, nextReviewAt: ISO8601 }
```

Schema versioning, import validation, and migrations are required before remote sync or public releases.

## Future service boundaries

- `TrainingPolicy`: choose problem distributions, active learning and confidence thresholds without modifying benchmark generator.
- `SkillRepository`: persist spaced repetition state, review events and outcome experiments. The `skillReviews` store in schema v2 is the first instantiation of this boundary.
- `ContentRegistry`: lessons, tagged difficulty taxonomy, generative templates, exact checking.
- `ChallengeService`: URL-safe seeded challenge, privacy, abuse controls.
- `IdentityService` / `LeaderboardService`: *optional* auth and verified ranking, never required for solo training.
- `AIExplanationService`: optional provider-neutral interface; no telemetry egress without consent.
- `QuantRuleset`: independent generator, exact evaluator and scoring model.

## Implementation note

The dependency-free ES module starter is an intentional working baseline. A React/TypeScript migration would be useful if the UI grows, but make it an explicit ADR with continuous parity tests and an operational replacement; don't swap stacks merely to look modern.
