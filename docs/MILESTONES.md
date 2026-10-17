# Milestones for Coding-Agent Execution

Every stage should finish with working, demonstrable software and updated tests. Start with **fidelity and measurement**. Do not implement all 55 features in one agent prompt.

## M0 — Runnable baseline (included)

Current code: seeded generator, inverse questions, immutable benchmark config, live game, practice presets, local histories, analytics, lesson cards, basic operation-adaptive weighting, export/import and test harness.

**Gate:** `npm run check`, manual browser run, save/reload history, practice/benchmark segregation. Original-site generator parity is still an audit item.

## M1 — Correctness / measurement credibility

**F01, F03, F07, F09–F15, F39, F41, F43.**

1. Source/empirical parity audit for original generation distribution; document all uncertainty before claiming equivalence.
2. Add full input state-machine tests (correct prefix, backspace, double submission, tab backgrounding, early finish).
3. Build interactive heatmap UI with keyboard navigation, sample counts, median latencies, and drill buttons.
4. Add question-position fatigue analysis, error typology, uncertainty visualization and benchmark consistency chart.
5. Add end-to-end browser test runner only if it runs reproducibly on CI and local machines.

**Gate:** Zero benchmark contamination bugs in regression suite; output can be explained from telemetry.

## M2 — Adaptive training v1

**F16–F22, F30–F32, F34, F38.**

1. Versioned skill and fact taxonomy, per-pattern history, confidence thresholds and scheduler persistence.
2. Targeted drills by pattern (not just operation), automatically adjusting difficulty and mix.
3. Train/holdout split: drill a weakness, test unseen examples from that family and then a standard mixed benchmark.
4. Daily scheduler with explicit practice budget; progress and coverage metrics; plateau intervention branches.
5. Transparent estimated score-impact heuristic; feature flag controlled policy comparison.

**Gate:** Demonstrate, with tests, that weak skills appear more often in selected drills *but never in benchmarks*.

## M3 — Arithmetic Academy

**F23–F29, F31, F35.**

1. Add multiple human-checked techniques per arithmetic class, tags and problem templates.
2. Interactive guided, partial and independent problems with deterministic solution checking.
3. Strategy-recognition quizzes, transfer to unseen numbers and timed automaticity sets.
4. Skill progression (foundation, fluency, speed, optimization, mastery).
5. Optional LLM explanation interface behind explicit consent; deterministic evaluator remains source of truth.

**Gate:** Each lesson has an explanation test, a novel-problem test and an adaptive schedule integration test.

## M4 — Performance laboratory

**F33, F36–F42.**

1. Optional typing-only hardware calibration and keyboard input diagnostics.
2. Full response-time distribution, tail/variance, fatigue, and intervention tracking.
3. Balanced A/B strategy tests with seeded assignment and clear uncertainty.
4. Longitudinal progress forecasting with minimum sample sizes and cross-validation.
5. Ghost racing, optional and non-distracting, with no effect on benchmark timing.

**Gate:** Evaluation protocol prevents spurious precision and misleading causal claims.

## M5 — Community, optional services

**F44–F48.**

1. Local achievements and rank progression based on verified completed tests.
2. Reproducible challenge URLs without PII.
3. Opt-in server API, authentication, privacy controls, anti-cheat and abuse mitigations.
4. Verified leaderboard and duels only after threat model and consent UX.
5. Maintain robust no-account offline path.

**Gate:** App remains usable offline without authentication and never uploads personal telemetry by default.

## M6 — Separate quant training academy

**F49–F55.**

1. Exact fractional and decimal arithmetic, percentage/basis points, EV and estimation.
2. Stateful running arithmetic and custom format-specific scoring.
3. Clearly labeled **historical** 80-in-8-style sets with distinct time/rules namespace.
4. Market-making expected-value simulator with deterministic payoff checking.
5. Distinct analytics and progress metrics; no blended 'Zetamac score'.

**Gate:** Quant-only score data cannot enter benchmark/goal progress even with malformed import.

## Success evaluation (cross-cutting)

- **Primary:** change in rolling median standardized score, time spent practicing, and target attainment defined as ≥70 on 8/10 runs.
- **Secondary:** percentiles by operation and tagged problem families, transfer on unseen problems, response accuracy, user retention without compulsive mechanics.
- **Research:** Randomized equal-time adaptive-training vs mixed-practice comparison, with preregistered success metrics and no outcome-driven rule changes.

## Agent checkpoints

For each PR include: feature IDs; precise acceptance criteria; code and tests; browser smoke; benchmark/score isolation review; docs update; no false claims about score gains; manual QA steps.
