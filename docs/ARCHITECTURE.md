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

`ArithmeticSession({rules,generator,clock,wallClock,mode,seed,seedSource,captureTrace,drill,provenance})` offers `start()`, `recordInput(fieldText)` (tracks the previous value itself and accepts on `trim() === String(answer)`), `markWrongSubmission()`, `recordVisibility(hidden)`, `tick()`, `remainingMs()`, and `finish({endedEarly})`. `seedSource` is `random`, `user` or `preset`; a benchmark requires `random` (or the field omitted, for sessions built before it existed). Results carry `engineVersion` (engine `zm-engine-3` adds a per-question, bounded `wrongAttempts` value history — Enter submissions and complete wrong values typed — behind the unchanged counters; answer acceptance is unchanged), `integrity`, `drill` (cell drills) and `provenance` (F20/F21 launch context — a dumb passthrough the storage and training layers sanitize; never part of scoring or validity). The pure generator never accesses the DOM or stores results.

**Default mode invariant:** benchmark eligibility is checked against the immutable rule snapshot and full duration; early termination must be marked practice. Future additions must not use adaptive weighting for benchmark mode.

### Analytics

`sessionStats(session)`, `operationSummary(events)`, `diagnose(sessions)`, `benchmarkProgress(sessions)` consume immutable historical records. `buildHeatmap(sessions, op, {scope})` bins solved events by *source* operands (table factor × band for mul/div, band × band for add/sub) and returns per-cell counts, medians, shrunken ratios and `medianCI` intervals. `consistencySummary(sessions)` derives goal progress, rolling bands, a Theil–Sen trend and median CIs from standard benchmarks only ([CONSISTENCY.md](./CONSISTENCY.md)). `paceProfile(sessions)` and `tailProfile(sessions)` analyze operation-adjusted pace through the run and slow-question tails over standard benchmarks ([FATIGUE.md](./FATIGUE.md)). `relativeHistogram(sessions)` bins the same adjusted ratios into fixed log bins `[×0.5, 0.75, 1, 1.5, 2, 3, ∞)` (lower edge inclusive), reports exact counts and shares per bin, the ≥×2 tail share, and a Theil–Sen trend of the per-run tail share; it shares `slowCutoffLog` with `tailProfile` so the two slow definitions cannot diverge, and is gated below 30 observations. `entryQuality(sessions)` aggregates latency-stratified entry types over standard benchmarks ([ENTRY_QUALITY.md](./ENTRY_QUALITY.md)); it reuses `relativeEvents` (which accepts the same `scope` option) and Theil–Sen `trend`. `errorTypology(events)` classifies entry quality (definitions in [TELEMETRY.md](./TELEMETRY.md)). Diagnoses are descriptive; current smoothed estimates are *not* psychometric calibration or causal evidence of improvement.

Sequence history (F04, `packages/analytics/src/sequence.js`): `sequenceRows(session)` lists every recorded event in recorded order — never re-sorted, never re-scored — with the recorded telemetry (corrections, the bounded wrong-attempt history, the `finalUnanswered` problem flagged as unanswered and never counted as a solve); engine-1-era events without a wrong-attempt history read as accuracy-unknown (`null`), never fabricated-clean. `sequenceSummary` keeps the mode/seed/score/benchmark flag exact and labels a benchmark session's replay as practice; `sequencePlayback` returns lossless `{op, sourceLeft, sourceRight}` items so a replayed run rebuilds every displayed problem through the engine's own `makeQuestion`. Malformed or empty records degrade to empty analyses, never a throw.

### Training

`chooseAdaptive(sessions)` returns rules and operation weights, keeping its training mode separate. The versioned skill taxonomy (`packages/training/src/skills.js`, version frozen in `SKILL_TAXONOMY_VERSION`) maps every benchmark question to a stable skill cell that *reuses the heatmap banding* — ids equal the heatmap cell keys (`docs/SKILLS.md`), and `skillRollups` computes per-skill metrics by calling `buildHeatmap` so the two surfaces share one implementation. `skillCellFromId` rebuilds a cell from any stored id against the current taxonomy. `patternDrill(cell, seconds)` (F17) derives a custom practice ruleset narrowed to one cell; the heatmap cell detail and the due-review queue launch it (`startGame({drill})`, mode `drill`), and `weakestSkillCell` is the planner's deterministic selection heuristic. `drillRangesForTier` and `drillTierForRecord` (F18, M2 slice 3) give that drill three difficulty tiers — Narrow (lower half of each band) after a lapsed review, Full by default, Stretch (the cell plus exactly one adjacent band) after four consecutive fast runs — chosen across runs from the F19 review record's streak, never mid-run, and always bounded by the benchmark operand space (`docs/SKILLS.md`); tier-1/2 problems stay inside the drilled cell and a stretch interleaves exactly its two neighboring cells. `packages/training/src/reviews.js` is the drill-end review semantics: `drillReviewOutcome(events, {endedEarly})` returns `null` (no record — interrupted or under-`SKILL_REVIEW_MIN_SOLVES` runs) or `{wasFastAndCorrect, solveCount, medianMs, fastMs, cleanCount, cleanShare, wrongAttemptSolves}` where success needs the nearest-rank median of the run's in-cell solves at or under `SKILL_REVIEW_FAST_MS` (the F20 `AUTOMATICITY_MS` constant, imported — one definition of "automatic recall") **and** at least half of those solves free of recorded wrong attempts (engine-3 `wrongAttempts`, falling back to `wrongSubmissions`/`fullWrongAnswers`; engine-1-era events without either lean clean — absence is never guilt) and `drillReviewEligible` decides which *runs* may write records at all (probes and flash drills never do). The daily plan (`dailyPlan` in `planner.js`, F34) regenerates on every refresh from three deterministic pieces: an exact-minutes budget split (`daylog.planSteps`, largest-remainder weights 1/2/1.25/1/1, gauntlet-rotate pushes targeted to 3.2 and method-work raises lesson to 1.6), a plateau intervention branch (`plateau.plateauBranch`, F22 — `gauntlet-rotate` / `method-work` / `consistency-rest`, attached to the rationale with its evidence and named as a hypothesis to test), and the weakest gated pattern note (F17 hook). What persists is only completion (one record per local day, `daylog.planRecordFrom`, schema-v3 `dailyPlans` store). `skillCoverage` (`plateau.js`) meters reach of the 420-cell taxonomy — how many cells the history touches and how many carry stable evidence, per operation — and scopes like all progress surfaces. `impact.js` (F20/F21 substrate) adds the transparent score-impact heuristic with its formula stated per row, degenerate-input guards, a hard cap, a same-data calibration of the pace→points basis on realized benchmark runs (`calibrateImpactModel`), and `validateImpactCategoryStep`, which recomputes every op/cell candidate row (median → reference → excess → share → estDelta) from the raw benchmark events through an independent `buildHeatmap` pass and reports per-claim mismatches — the category decomposition is arithmetic-validated end-to-end (exact fixture values pinned in tests), while the training-gain *meaning* of the estimates remains an estimate. `recommendations.js` (F38) fuses due reviews, weakest gated cells, the plateau branch and the top impact row into one deterministic, evidence-quoted list wired to the drill launch path. `policies.js` is the feature-flagged comparison surface: three named concentration policies scored by summed impact, seeded A/B placement (`assignStrategyTrial`), allow-listed flag override — and, when a trial is joined, `comparePolicies` takes its emphasized policy from the trial's current window (flag → trial window → seeded assignment; a holdout window nulls the emphasis). `provenance.js` (F20/F21) closes the recording gap that previously made outcome calibration impossible: practice runs launched from `recommendations`, `review-queue`, `heatmap`, `gauntlet` (drills, probes and the finish-with-standard-benchmark hand-off) or `academy` lesson hand-offs carry a bounded `provenance` record (`{surface, policyId, cellId, stage}` — the Train panel tags drills with the policy it emphasized), whitelist-sanitized at the storage/import edge and re-tagged on "play again"; `treatmentOutcomes` pairs consecutive valid benchmarks with attributed treatment runs (predictions recomputed on the pre-treatment history prefix) as an observational diagnostic ledger — metadata only, never touching scoring, timing or benchmark eligibility, and never a causal or efficacy claim on its own. The randomized arm layer that turns that pairing into an experiment is the opt-in crossover trial (`trial-window.js` — pure enrollment/window math, the seeded slot cycle and the tamper-checked localStorage contract; `trial.js` — `trialOutcomes` attribute runs only where provenance names the policy the trial emphasized at the run's own start, holdout/other-surface/pre-enrollment runs counting as context, and `summarizeTrialOutcomes` reporting per-policy Wilson intervals plus an exact permutation p past the ≥4-windows-per-policy gate); trial membership lives under `zetamaster-policy-trial` and exposes no new scoring surface — leaving the trial reverts to the seeded assignment. The F20 probabilistic mastery estimate (`analytics/src/skill-model.js`: `masteryPosterior`, a Jeffreys Beta(0.5+passes, 0.5+misses) posterior with exact Beta-CDF credible intervals over correct solves at or under the shared `AUTOMATICITY_MS` line) rides every heatmap cell and is described in the cell detail panel with its explicit non-calibration note. The UI records one review per *completed* pattern drill via `recordSkillReview`; `scheduleReview` and `skillReviewRecord` remain the pure primitives behind that call. (M2 slice 4:) `automaticityDrill` (F31) adds a latency-bound flash run — engine-enforced `questionBudgetMs` (`maybeExpireQuestion`, `missedEvents` in results) plus the `varyStimulus` generator guard, so no fact repeats back to back. The weakness gauntlet (`packages/training/src/gauntlet.js`, F32, [GAUNTLET.md](GAUNTLET.md)) is the M2 train/holdout protocol as pure data: `gauntletPlan` selects the gated weakest cells (`weakestSkillCells`, practice-aware scope, daily quota), a `train` stage builds tier-aware pattern drills with random seeds, a `probe` stage builds `transferProbe` rulesets whose generator is wrapped in `varyStimulus` and whose seed is day-scoped and never the training seed, and every launch stays a practice ruleset (`gauntletLaunch`, `gauntletGenerator`). Whether the protocol transfers is F21/F22. Speed-interval sets (F30, `packages/training/src/sets.js`) compose short work bouts as independent 'sprint' practice sessions with manually continued recovery pauses, a monotonic informational rest meter and an evidence line quoted from the measured `halfShift` split; the recovery hypothesis itself is untested and the set is not persisted. Drill and review choices are descriptive scheduling heuristics; nothing here is calibrated evidence of improvement, and review outcomes measure speed and recorded wrong attempts (engine-3 `wrongAttempts`; pre-3 records are judged from the counters, and engine-1-era events without either lean clean — absence is never guilt).

### Curriculum

Lesson `result` values must be checked by deterministic arithmetic code or a verified fixture. For interactive tutorials, connect selected `tags` to pattern generators and unseen holdout examples. LLM explanations must reference mathematically checked results, not be grading authorities.

Interactive lesson rehearsal (M3 slice 1, `packages/curriculum/src/guides.js` primacy): every guided step's expected value is computed by plain deterministic arithmetic in `guides.js` — no field infers, grades or relaxes an answer; the module is pinned by `tests/guides.test.js` to reproduce each card's curated example string for step (`68 + 50 = 118`) exactly, plus independent recomputation per technique. `planForLesson(lessonId, a, b)` returns null (never a wrong plan) for out-of-domain operands, non-integers, unknown ids and operation mismatches — division lessons included since F26, each with its own hand-chosen domain. the three fixed-factor multiplication domains (×9/×5/×11) require the exact factor so swapped operands are rejected, not mis-planned. `askPlan(plan, mode)` carries the three untimed Academy modes — guided (ask every step), partial (reveal all but the last, ask the composition), independent (ask the final directly) — and `checkGuideAnswer` reuses the engine's `matchesAnswer` so lesson answering cannot drift from the game's answer rule. Transfer rehearsal (`drawTransfer`/`transferPlan`) draws seeded unseen operand pairs inside hand-chosen per-technique domains (pedagogical, not benchmark distributions — no parity claims); the seed is displayed with the drawn problem for reproducibility. The practice hand-off `guideDrillTarget` maps a practiced problem to its F09/F17 taxonomy cell using the generator's source-operand order per operation (subtraction: subtrahend/difference; multiplication: table factor first) so a hand-off pattern drill drills the pattern actually practiced; the double-and-halve card is deliberately rehearsal-only (its fixed 25 anchor never occurs in the benchmark operand space, so no cell exists) and the UI hides the drill button with an honest note. Guides run untimed and unscored — they never write sessions, reviews or benchmark metrics, and no claim is made that lessons raise benchmark scores (F21/F22 measures transfer separately). Division rehearsal (F26) is built: all three division cards rehearse in the Academy on the same plan machinery, out-of-domain operands show an honest message instead of a wrong plan.

Strategy training (F27, `packages/curriculum/src/strategies.js`): `STRATEGY_DUELS` defines curated technique pairs with a shared-domain sampler (`draw` + `shared` predicates — the sampler must only draw problems both techniques can plan, and never papers over a miss), `drawDuels(op, seed, pairs)` returns the seeded fixture (arm order alternates by seed; the seed is shown for reproducibility), `duelPlan(one problem × one technique)` and `duelTally` (per-arm first-try counts plus the per-problem head-to-head). It is a tiny-n walkthrough by design; the UI states that n is too small for any significance claim. Operations whose cards do not overlap state exactly why (`WHY_NO_DUEL`).

Deterministic coach verification (F29, `packages/curriculum/src/coach.js` + `packages/services/src/ai-explanations.js`): `coachBrief` renders a card's checked content; `requestCoachExplanation` recomputes every arithmetic claim in pasted prose against the plan and rejects wrong, invented or unverifiable text with the exact reason — the verifier output exposes no answer/score fields. Consent is an explicit device-local opt-in (OFF by default), and this build has no network transport: payloads carrying provider/endpoint/apiKey fields are refused with `CoachUnavailableError('transport-not-installed')`.

### Web presentation (apps/web/src)

Presentation modules follow one pattern: `renderXUI({root, ...})` owns one surface, module-local viewer state holds nothing user-critical, and every testable behavior is exported as a pure helper. `entry-settings.js` (F02/F05) reads and writes the two device-local records (`zetamaster-entry-settings-v1` keypad/sound toggles, `zetamaster-custom-ranges-v1` last-used operand ranges) always through a caller-supplied store: absent, malformed or unreadable storage reads OFF / null, and range validation mirrors the engine bounds (1–10000) with errors that name the offending field, never a guess. `cues.js` (F05) schedules exactly its spec's WebAudio parameters, only when the consent toggle is enabled, and turns every playback failure into silence. `replay-ui.js` (F04) renders the sequence viewer over the analytics module and hands `startGame({replay: items})` the lossless source-operand items; `duel-ui.js` (F27) runs the duel-walk state machine over `strategies.js`; `coach-ui.js` (F29) gates consent and renders verification outcomes without ever displaying a grade. All practice surfaces launch sessions with explicit mode provenance so nothing can masquerade as a benchmark (see Storage).

### Quant namespace

Quant drills and historical trading interview formats **never** reuse `zetamac-default-v1` score IDs. Provide exact rational arithmetic or explicit tolerance specifications for decimals and estimates, and independent scoring.

- **Exact rational arithmetic** (`packages/quant/src/rational.js`, `packages/quant/src/fractions.js`): `Rational` class with BigInt GCD reduction, exact addition/subtraction/multiplication/division, parsing of mixed fractions and repeating decimals, and equivalence checking.
- **Probability & combinatorics** (`packages/quant/src/probability.js`): Factorials, permutations ($nPr$), combinations ($nCr$), dice sum distributions, coin flip binomial probabilities, card draws, and expected value (EV) problem generators.
- **Finance & percentages** (`packages/quant/src/finance.js`): Basis points (bps), markup vs. margin calculations, simple interest, and Rule of 72 doubling times.
- **Estimation training** (`packages/quant/src/estimation.js`): Verified range bounds, percentage error tolerance checks, and step-by-step arithmetic justifications.
- **Running arithmetic** (`packages/quant/src/running.js`): Stateful multi-step arithmetic chains with deterministic intermediate and final answer validation.
- **Historical 80-in-8 mode** (`packages/quant/src/historical.js`): Recreates historical 80-question 8-minute quant assessments with net scoring (+1 correct, -1 incorrect).
- **Market-making simulator** (`packages/quant/src/market-making.js`): EV quote validation with spread constraints, Poisson counterparty flow simulation, PnL settlement, and edge tracking.
- **Scoring isolation** (`packages/quant/src/scoring.js`): Quant sessions use namespace `quant-practice` with `benchmark: false` and `benchmarkEquivalent: false`. Storage sanitization strictly prevents quant sessions from entering benchmark progression, rankings, consistency medians, or streaks.

### Storage

`listSessions`, `saveSession`, `deleteAllSessions`, `importSessions` use IndexedDB first and localStorage fallback. Imports go through `sanitizeImportedSession`, which rebuilds questions from source operands and recomputes `benchmark` from the mode, the rules snapshot, the duration and the score/event count; the engine-3 wrong-attempt history (`wrongAttempts`) is whitelist-rebuilt per entry (capped at `MAX_WRONG_ATTEMPTS`, trimmed values, unusable members dropped) and an absent field imports as absent — accuracy unknown, never normalized. Optional launch provenance (F20/F21) survives round-trips only after revalidation by `sanitizeProvenance`; malformed records are dropped whole. Per-skill review records (F19, `docs/SKILLS.md`) and daily-plan completion records (F34, `docs/SKILLS.md`) persist in the same database: the `zetamaster-v1` database is at schema version 3 (additive `skillReviews` and `dailyPlans` stores keyed by `id`), each with a mirrored, record-capped localStorage fallback key (`zetamaster-skill-reviews-v1`, `zetamaster-daily-plans-v1`). `skillReviewRecord` (training) is the only scheduling authority; `sanitizeImportedSkillReview` re-derives `nextReviewAt` from `lastReviewedAt + intervalDays` and drops, with a count, records that carry a foreign taxonomy version, an unknown skill id, or a schedule that disagrees with that recomputation. `sanitizeImportedDailyPlan` whitelist-reconstructs plan records — which carry no score data by design — recomputing `completedMinutes` from the validated steps. The v3 JSON export bundle (`exportBundle`) wraps sessions, skill review records and daily plans; `parseExportBundle` still accepts the v2 bundle (without `dailyPlans`) and the legacy session array. Data is device-local. Future cloud sync must implement an interface rather than inserting fetch calls into the core engine, and require affirmative consent.

## Schema sketch

```js
{
  id: string,
  startedAt: ISO8601,
  finishedAt: ISO8601,
  mode: 'benchmark' | 'adaptive' | 'custom' | 'isolation' | 'sprint' | 'endurance' | 'replay' | 'drill',
  seed: string,
  rules: RulesSnapshot,
  benchmark: boolean,
  score: number,
  elapsedMs: number,
  events: [{
    id, sequence, op, sourceLeft, sourceRight, left, right, answer, tags,
    responseMs, firstInputMs, entryMs, corrections, wrongSubmissions, wrongAttempts,
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

Daily-plan completion record (schema-v3 `dailyPlans` store, keyed by the local-day `id`; full
contract in [SKILLS.md](./SKILLS.md)):

```js
{ id: '2026-10-18', date: '2026-10-18', targetMinutes: 15,
  steps: [{ id: 'warmup', minutes: 3, completed: true, completedAt: ISO8601 }, …],
  completedMinutes: 5, updatedAt: ISO8601 } // no score fields, by design
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
