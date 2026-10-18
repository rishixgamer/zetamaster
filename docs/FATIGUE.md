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

## Adjusted distribution (F41)

`relativeHistogram` in `packages/analytics/src/histogram.js` pools every analyzed adjusted solve from the standard runs into fixed log bins. Counting is deterministic and seed-free — the same sessions always give the same seven counts.

Bin edges (a ratio lands in the bin whose **lower edge it reaches**, so half-open `[lo, hi)` ranges):

| Bin | Range |
|---|---|
| `<×0.5` | 0 ≤ ratio < 0.5 |
| `×0.5–0.75` | 0.5 ≤ ratio < 0.75 |
| `×0.75–1` | 0.75 ≤ ratio < 1 |
| `×1–1.5` | 1 ≤ ratio < 1.5 |
| `×1.5–2` | 1.5 ≤ ratio < 2 |
| `×2–3` | 2 ≤ ratio < 3 (tail starts here) |
| `≥×3` | ratio ≥ 3 |

Each row shows the exact count and the share of all analyzed solves, and the panel always prints the values next to the bars. The tail bins answer: **what fraction of solves take at least twice the typical time for their operation?**

Cross-check with the slow rule (`slowShare`): the robust cutoff is `max(×2, median + 3·1.4826·MAD)` and is therefore **≥ ×2 by construction**. The ≥×2 share can only equal the slow share when the cutoff sits exactly on ×2 and no ratio lies exactly on the edge; otherwise the histogram share is the larger of the two. Two concrete ways they differ, both covered by `tests/histogram.test.js`:

- A solve at **exactly ×2** enters the `×2–3` bin but fails the slow rule's strict `>` (and the cutoff may be at ×2). So a long tail ending exactly at twice typical is visible in the histogram while `slowShare` stays 0.
- When the log MAD is large enough, the robust cutoff can move **past ×3**, in which case "slow questions" is the stricter view and the tiles should be read as the outlier rule, the histogram as the fixed-lens distribution.

Movement across runs: the ≥×2 share per run is fed into the consistency module's Theil–Sen `trend` (95% CI, null below 6 runs), reusing exactly the same slope rule as the other panels. Runs whose solves were all skipped contribute zero, mirroring the entry-quality panel.

Caveats. The section is gated below **30 adjusted solves** (`MIN_HIST_OBS`); below that the counts would look stable while the shares are not. Solves from old engine-1 records use a derived start time and are counted and flagged. The pooled distribution mixes operations after adjustment and whole runs across days, so a shift in it describes the changed mix of solve speeds — it is not, by itself, evidence that removing tail solves would produce score gains, and no points are awarded per solve saved.
