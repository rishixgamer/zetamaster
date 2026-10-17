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
`storage/db` (local saved sessions) ────→ optional future sync adapter
    ↓
`analytics` (stats, uncertainty, history, diagnosis)
    ↓
`training` (weakness selection, plans, review scheduling)
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

`sessionStats(session)`, `operationSummary(events)`, `diagnose(sessions)`, `benchmarkProgress(sessions)` consume immutable historical records. `buildHeatmap(sessions, op, {scope})` bins solved events by *source* operands (table factor × band for mul/div, band × band for add/sub) and returns per-cell counts, medians, shrunken ratios and `medianCI` intervals. `errorTypology(events)` classifies entry quality (definitions in [TELEMETRY.md](./TELEMETRY.md)). Diagnoses are descriptive; current smoothed estimates are *not* psychometric calibration or causal evidence of improvement.

### Training

`chooseAdaptive(sessions)` returns rules and operation weights, keeping its training mode separate. `scheduleReview` and `candidatePriority` are primitives, **not integrated product features**. Add versioned policy IDs when comparing future learning algorithms.

### Curriculum

Lesson `result` values must be checked by deterministic arithmetic code or a verified fixture. For interactive tutorials, connect selected `tags` to pattern generators and unseen holdout examples. LLM explanations must reference mathematically checked results, not be grading authorities.

### Quant namespace

Quant drills and historical trading interview formats **never** reuse `zetamac-default-v1` score IDs. Provide exact rational arithmetic or explicit tolerance specifications for decimals and estimates, and independent scoring.

### Storage

`listSessions`, `saveSession`, `deleteAllSessions`, `importSessions` use IndexedDB first and localStorage fallback. Imports go through `sanitizeImportedSession`, which rebuilds questions from source operands and recomputes `benchmark` from the mode, the rules snapshot, the duration and the score/event count. Data is device-local. Future cloud sync must implement an interface rather than inserting fetch calls into the core engine, and require affirmative consent.

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

Schema versioning, import validation, and migrations are required before remote sync or public releases.

## Future service boundaries

- `TrainingPolicy`: choose problem distributions, active learning and confidence thresholds without modifying benchmark generator.
- `SkillRepository`: persist spaced repetition state, review events and outcome experiments.
- `ContentRegistry`: lessons, tagged difficulty taxonomy, generative templates, exact checking.
- `ChallengeService`: URL-safe seeded challenge, privacy, abuse controls.
- `IdentityService` / `LeaderboardService`: *optional* auth and verified ranking, never required for solo training.
- `AIExplanationService`: optional provider-neutral interface; no telemetry egress without consent.
- `QuantRuleset`: independent generator, exact evaluator and scoring model.

## Implementation note

The dependency-free ES module starter is an intentional working baseline. A React/TypeScript migration would be useful if the UI grows, but make it an explicit ADR with continuous parity tests and an operational replacement; don't swap stacks merely to look modern.
