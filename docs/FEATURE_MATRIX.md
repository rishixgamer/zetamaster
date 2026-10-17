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
| F11 | Speed accuracy analysis | partial | `analytics/web` | Entry-quality typology (clean/revision/slip/calculation) on results; add latency-stratified analytics view across sessions |
| F12 | Performance timeline | implemented | `analytics/web` | Benchmark-only trajectory, recent median, personal best |
| F13 | Fatigue analysis | planned | `analytics` | Chart latency across session time and account for operation mix |
| F14 | Question replay | implemented | `web/core` | Replay slowest five attempts with original operands outside benchmark |
| F15 | Statistical confidence | implemented | `analytics` | Shrinkage and distribution-free median CIs on heatmap cells, operation summaries and recent scores; Sen trend interval; percentile band visualization; sample-size gates throughout |
| F16 | Automatic bottleneck identification | partial | `analytics` | Operation and tag weaknesses from historical event stream with sample warnings |
| F17 | Intelligent drill generation | partial | `training` | Weight weaker operations; generate targeted technique or fact drills later |
| F18 | Adaptive difficulty | planned | `training` | Raise/lower difficulty based on rolling mastery while preserving original benchmark |
| F19 | Spaced repetition | partial | `training` | Pure scheduling primitive exists; persist per-skill review and integrate UI |
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
| F31 | Cognitive automaticity training | planned | `training` | Latency-bound fact drills that vary stimulus and avoid rote sequence recall |
| F32 | Weakness gauntlet | planned | `training` | Generate fixed quota of slow categories with independent transfer post-test |
| F33 | Personal-best ghost racing | planned | `web/analytics` | Optional cumulative pace visualization derived from stored benchmark run |
| F34 | Automatic daily training plans | partial | `training/web` | 15-minute routine works; persist completion and optimize allocation |
| F35 | Long-term progression system | planned | `training` | Explicit 30→40→50→60→70+ stages guided by median benchmarks |
| F36 | Adaptive training volume | planned | `training` | Monitor signs of slowdown; recommendations never force continued practice |
| F37 | Progress forecasting | planned | `analytics` | Calibrated prediction intervals from longitudinal runs; abstain if inadequate data |
| F38 | Progress-based recommendations | partial | `training/web` | Weakest operation recommendation works; link to evidence and specific actions |
| F39 | Keystroke analysis | implemented | `core/analytics` | First-input proxy, corrections, wrong prefixes and bounded per-question input traces (captureTrace flag); no UI toggle yet |
| F40 | Hardware calibration | partial | `core/web` | Baseline computation exists; add independent number-copying interface |
| F41 | Response-time distribution modeling | partial | `analytics` | Median and P90 exist; add tail/outlier analysis and adjusted distributions |
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
