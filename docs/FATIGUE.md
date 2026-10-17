# Pace through the run and slow tails (F13, F41)

Source: `packages/analytics/src/fatigue.js`. Input is **verified standard benchmarks only**, in chronological order. Practice runs have other durations and operation mixes, so they are excluded.

## Relative time (operation adjustment)

Each solved question's time is divided by the player's median time for that operation, pooled over all standard runs. An operation with fewer than 5 solves is skipped. A relative time of ×1.00 means typical speed for that operation. Without this step, a run that happened to draw more division late would look like fatigue; `tests/fatigue.test.js` checks this case.

Question start time is `shownAtMs` (engine 2), or `completedAtMs − responseMs` for older sessions.

## Pace (F13)

| Metric | Definition | Caveat |
|---|---|---|
| Segment ratio | median relative time of questions **shown** in each quarter of the run (0–30, 30–60, 60–90, 90–120 s), with a distribution-free 95% CI | the question unsolved at the buzzer is excluded, which can make the last quarter look slightly faster (survivorship); the first quarter includes getting started |
| 2nd half vs 1st | per run, the difference of median log relative time (second half − first half), then the median across runs, shown as a % change with a 95% CI | needs ≥3 runs with ≥3 solves per half; paired within runs, so day-to-day differences cancel; runs are not independent, so read the CI as rough |

A positive value means slower later in the run. It describes your pattern and doesn't establish a cause: fatigue, attention drift and strategy changes all look alike here.

## Slow tail (F41)

| Metric | Definition | Caveat |
|---|---|---|
| Slow question | relative time above the larger of ×2 and `exp(median + 3·1.4826·MAD)` of all log relative times | robust to the tail itself |
| Slow share | slow questions ÷ all analyzed solves | |
| Time lost / run | median over runs of Σ(time − operation median) for that run's slow questions, with a median CI | only the excess beyond typical counts |
| ≈ questions | time lost ÷ overall median solve time | a rough upper bound on points at stake; removing stalls entirely is not realistic |
| Tail by operation | median, 90th percentile, their ratio, slow count | per-operation raw times |
| Costliest stalls | top 5 slow questions by excess time, with run number (matches the consistency chart) | |

Still missing for F41: a full histogram of the adjusted distribution.
