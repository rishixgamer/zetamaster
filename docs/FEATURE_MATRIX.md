# Complete Feature Matrix (F01–F55)

The 55 entries below correspond to every numbered product feature in the brainstorm. `implemented` means a basic feature is usable—not that it has passed a competitive training effectiveness study. `partial` identifies working building blocks and clearly missing capabilities. `planned` is specification only.

| ID | Feature | Status | Module | Minimum acceptance criterion |
|---|---|---|---|---|
| F01 | Default arithmetic simulator | implemented | `core` | 120s preset and inverse operations; parity audited against original client 2026-10-17 (docs/PARITY_AUDIT.md, tests/parity.test.js); remaining deviations: strict timer cutoff and PRNG |
| F02 | Custom training mode | partial | `web/core` | Operation and duration selection works; extend exposed operand ranges and feedback settings |
| F03 | Standardized benchmark mode | implemented | `core/web` | Immutable default rules; practice and early termination never count as standard |
| F04 | Seeded tests and replay | partial | `core/web` | Deterministic generator and slow-question replay; add sequence history replays |
| F05 | Input optimization | partial | `web` | Auto-answer and keyboard focus work; add configurable keypad and sound |
| F06 | Offline-first PWA | implemented | `web/storage` | App caches core assets; sessions stored locally and training runs offline after installation |
| F07 | Per-question telemetry | implemented | `core` | Record operands timing changes and corrections; explicitly label first-key proxy; wrong-prefix, full-wrong-answer, paste and visibility telemetry defined in docs/TELEMETRY.md |
| F08 | Operation-specific analysis | implemented | `analytics/web` | Counts and median times for all four operations |
| F09 | Arithmetic heatmaps | implemented | `analytics/web` | Accessible interactive heatmap grid per operation with keyboard navigation, sample counts, median latencies, CI, benchmark-only scope, deep links and cell drills |
| F10 | Difficulty classification | partial | `core` | Multiple classification tags; validate taxonomy and extend harder patterns |
| F11 | Speed accuracy analysis | implemented | `analytics/web` | Entry-quality typology (clean/revision/slip/calculation) on results |
| F12 | Performance timeline | implemented | `analytics/web` | Benchmark-only trajectory, recent median, personal best |
| F13 | Fatigue analysis | implemented | `analytics` | Operation-adjusted relative time by quarter of the run with CIs, plus paired second-half vs first-half shift across standard runs (docs/FATIGUE.md) |
| F14 | Question replay | implemented | `web/core` | Replay slowest five attempts with original operands outside benchmark |
| F15 | Statistical confidence | implemented | `analytics` | Shrinkage and distribution-free median CIs on heatmap cells, operation summaries and recent scores; Sen trend interval; percentile band visualization; sample-size gates throughout |
| F16 | Automatic bottleneck identification | partial | `analytics` | Operation and tag weaknesses from historical event stream with sample warnings |
| F17 | Intelligent drill generation | implemented | `training` | Skill-cell drills launch from the heatmap cell detail and the due-review queue (Train tab) and run as mode 'drill' with pinned operand ranges, id 'pattern-drill' and an honest explanation; results never upgrade to benchmark (benchmarkEquivalent false, pinned); daily plan surfaces the weakest stable pattern when its data exists; difficulty tiers are F18, cross-operation pattern mixes and efficacy evaluation (F21/F22) are separate features and remain out of scope here |
| F18 | Adaptive difficulty | implemented | `training` | Pattern drills have three difficulty tiers (Narrow = lower half of each band, Full = the exact cell and the default, Stretch = full cell plus exactly one adjacent band on one axis, capped at the benchmark operand space for the four double-top cells); the tier is chosen across runs from the F19 review record's success streak (0 = Narrow, 1-3 or no usable evidence = Full, >= 4 = Stretch), never mid-run, so one run's generated pool and per-run review stay interpretable; tier-1/2 draws map to exactly the drilled cell and a stretch interleaves exactly its two adjacent cells (both occur in seeded draws); every tier stays practice-only (id 'pattern-drill', benchmarkEquivalent false, benchmark ruleset untouched); explicitly out of scope: in-run difficulty adaptation, cross-operation pattern mixes (the generator draws from one rectangle per operation), calibrated mastery modeling and any efficacy claim (F21/F22) |
| F19 | Spaced repetition | implemented | `training` | Pure scheduling primitive is deterministic with explicit now; per-skill review records persist in IndexedDB schema v2 (additive store) with capped localStorage fallback, sanitized/versioned imports and v2 export bundle; every completed pattern drill records one review (interrupted or under-3-solve runs record nothing) whose success rule is at least half the run's in-cell solves at or under the shared AUTOMATICITY_MS 2000 line (nearest-rank median, pinned edge by edge); a due-review queue on the Train tab prompts at-or-overdue records and launches their cells; review outcomes measure speed only (the engine does not persist wrong attempts) and the 1-60 day ladder is a heuristic, not a validated model |
| F20 | Personalized mastery model | partial | `analytics` | Transparent smoothed proxy exists; calibrate probabilistic model on held-out sessions |
| F21 | Score-improvement prioritization | partial | `training` | Priority heuristic exists; compare predicted versus observed training gains |
| F22 | Automatic plateau detection | partial | `analytics` | Conservative plateau signal exists; add intervention and evaluation protocol |
| F23 | Addition techniques | partial | `curriculum` | Instruction examples exist; add interactive step completion and transfer tests |
| F24 | Subtraction techniques | partial | `curriculum` | Rounding and complements examples exist; add timed lesson drills |
| F25 | Multiplication techniques | partial | `curriculum` | Distributive, ×9, ×11 and halve examples; expand complete instruction path |
| F26 | Division techniques | partial | `curriculum` | Inverse and factoring examples; add validated practice variants |
| F27 | Strategy selection training | planned | `curriculum/training` | Compare two mental algorithms on matched unseen examples |
| F28 | Interactive worked examples | partial | `curriculum/web` | Readable steps exist; add interactive prompts with feedback |
| F29 | Optional AI math coach | planned | `services` | Opt-in explanations checked by deterministic arithmetic verification; no answer grading by LLM |
| F30 | Speed intervals | implemented | `training/web` | 30-second sprint preset; add sets and recovery intervals |
| F31 | Cognitive automaticity training | implemented | `training` | Automaticity ('flash') drill on any heatmap cell: engine-enforced per-question latency budget (questionBudgetMs, default the shared AUTOMATICITY_MS 2000 line; slow questions record as missedEvents, never scored, next question gets a fresh window), seeded generator wrapped in varyStimulus so no fact repeats back to back (avoids rote sequence recall; degenerate single-fact ranges cap redraws instead of hanging), stage 'flash' pinned so flash runs never write spaced-repetition reviews, benchmark ruleset byte-identical and imported sessions unaffected |
| F32 | Weakness gauntlet | implemented | `training` | Gauntlet plan (packages/training/src/gauntlet.js) selects at most two skill cells per day that clear the sample gate with shrunken ratio > 1 (weakest first, deterministic, never a sub-gate or fast cell), drills each with the F18 tier ladder on random seeds, probes each family with fresh same-range problems from a day-scoped seed that is never the training seed and a varyStimulus generator, hands off to one standard benchmark; every stage is a practice ruleset (benchmarkEquivalent false, pinned byte-identity of BENCHMARK_RULES) and 'Play again' relaunches the stage; explicit out-of-scope: efficacy claims and in-run adaptation (F21/F22) |
| F33 | Personal-best ghost racing | planned | `web/analytics` | Optional cumulative pace visualization derived from stored benchmark run |
| F34 | Automatic daily training plans | partial | `training/web` | 15-minute routine works; persist completion and optimize allocation |
| F35 | Long-term progression system | planned | `training` | Explicit 30→40→50→60→70+ stages guided by median benchmarks |
| F36 | Adaptive training volume | planned | `training` | Monitor signs of slowdown; recommendations never force continued practice |
| F37 | Progress forecasting | planned | `analytics` | Calibrated prediction intervals from longitudinal runs; abstain if inadequate data |
| F38 | Progress-based recommendations | partial | `training/web` | Weakest operation recommendation works; link to evidence and specific actions |
| F39 | Keystroke analysis | implemented | `core/analytics` | First-input proxy, corrections, wrong prefixes and bounded per-question input traces (captureTrace flag); no UI toggle yet |
| F40 | Hardware calibration | partial | `core/web` | Baseline computation exists; add independent number-copying interface |
| F41 | Response-time distribution modeling | implemented | `analytics` | Adjusted-distribution histogram beside the slow-tail metrics (robust cutoff, slow share, time lost per run, per-operation p50/p90, costliest stalls): fixed log bins [×0.5, 0.75, 1, 1.5, 2, 3, ∞) lower-edge-inclusive, exact counts/shares beside bars, ≥2×-typical tail share cross-checked against the shared robust cutoff, Theil–Sen tail-share movement reusing the consistency trend (≥6 runs), gated below 30 adjusted solves with empty/sparse/engine-1 states (docs/FATIGUE.md) |
| F42 | Arithmetic strategy experiments | partial | `training` | Seeded A/B assignment exists; add balanced items and outcome testing |
| F43 | Performance consistency scoring | implemented | `analytics` | 8-of-10 70+ goal with progress, 8th-best gap, minimum runs-to-goal, rolling median and 10th-90th band chart, Theil-Sen trend; standard benchmarks only (docs/CONSISTENCY.md) |
| F44 | Ranking system | planned | `community` | Sustained verified benchmark ranks separated from practice ranks |
| F45 | Skill-based achievements | planned | `community` | Grant goals based on correct verified events; avoid rewarding idle screen time |
| F46 | Global leaderboards | planned | `services` | Explicit opt-in server verified rankings with abuse and privacy protections |
| F47 | Challenge sharing | planned | `services/web` | Share ruleset+seed via URL; ensure no PII in shared links |
| F48 | Minimalist keyboard-first design | implemented | `web` | Focused answer entry, responsive layout, optional browser PWA install |
| F49 | Fractions and decimals | partial | `quant` | Separate quant generator scaffold; expand exact rational representations |
| F50 | Probability arithmetic | partial | `quant` | EV prototype exists; add verified probability and combinatorics drill bank |
| F51 | Percentages and finance | partial | `quant` | Percentage and basis-point generators exist; add explicit quant UI and feedback |
| F52 | Estimation training | planned | `quant` | Range-based tolerance with verified numerical bounds and justification |
| F53 | Running arithmetic | planned | `quant` | Stateful sequence generator with deterministic intermediate answers |
| F54 | Historical 80-in-8 training | planned | `quant` | Separate format and scoring based on documented historical question style |
| F55 | Market-making simulations | planned | `quant` | Simple expected-value quoting game with separate skill metrics |

See `specs/features.json` for machine-readable records. Convert each partial/planned entry into a tracked GitHub issue as needed. No placeholder UI buttons are presented as working functionality.
