# Benchmark consistency metrics (F43, F15)

Source: `packages/analytics/src/consistency.js`. Input is **verified standard benchmarks only** (`benchmark === true`, oldest first). Practice, drills, replays, quant runs and imports that fail eligibility never enter these numbers.

## Goal

**Consistent 70+** means at least 8 of the latest 10 standard runs score 70 or more (`GOAL = {target: 70, need: 8, window: 10}`). It is a personal training target, not a hiring threshold, and it matches `benchmarkProgress().mastery70` (a property test checks they agree).

| Metric | Definition | Caveat |
|---|---|---|
| Last 10 at 70+ | count of the latest ≤10 runs scoring ≥70 | goal needs a full window of 10 |
| 8th-best of last 10 | the 8th-highest score in the window: the score that has to reach 70 | needs ≥8 runs |
| Points below 70 | `max(0, 70 − 8th-best)` | |
| Runs to goal | fewest additional runs that could meet the goal if **every** one scored ≥70, with the window sliding | a lower bound, not a forecast; old hits leaving the window can make it larger than `8 − hits` |

## Uncertainty and trend

| Metric | Definition | Caveat |
|---|---|---|
| Recent median | median of the latest ≤10 runs | |
| 95% CI of median | distribution-free order-statistic interval (binomial, p = ½) | needs ≥6 runs; assumes independent runs, which learning violates |
| Rolling band | 10th–90th percentile (linear interpolation) of the trailing 10 runs, from run 3 on | descriptive spread, not a prediction interval |
| Trend | Theil–Sen slope in points per run over the latest ≤20 runs, robust to single outliers | needs ≥6 runs |
| Trend CI | Sen's interval from the Kendall-S normal approximation, ties ignored | serial correlation makes it optimistic; read as rough |
| Operation CI | same median interval on per-operation solve times (Time by operation) | pools all sessions, practice included |

## Chart

`apps/web/src/score-chart.js` renders the latest 40 runs: score dots, rolling median line, 10th–90th band, and a target rule. Its colors passed the dataviz palette validator on the app's dark surface. You can hover it, or focus it and use ←/→/Home/End; a `<details>` table lists every run. On narrow screens the chart scrolls horizontally and opens on the latest runs.
