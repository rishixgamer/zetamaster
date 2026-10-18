# Entry quality across runs (F11)

The "Entry quality" panel in Analytics. Source: `packages/analytics/src/entry-quality.js`. Input is **verified standard benchmarks only**, chronological (`scope:'all'` exists in the module for exploratory use, but the panel does not expose a toggle: practice presets and drills have other durations, mixes and no stakes, so they would distort the comparison).

Every solved question gets exactly one entry type from `classifyError` (`errors.js`): calculation (a complete wrong answer was typed first), slip (a wrong digit fixed mid-entry), revision (correct digits deleted), or clean. See [TELEMETRY.md](./TELEMETRY.md) for the raw fields. Engine-1 records lack `wrongPrefixes`, so every correction in them is counted as a slip; the panel discloses how many questions this affects.

## Metrics

| Metric | Definition | Caveat |
|---|---|---|
| Rate | type's solved questions ÷ all analyzed solves in the included runs | count of solved questions; the unsolved question at the buzzer is excluded, as elsewhere |
| vs clean entry | median of (solve time ÷ that operation's **clean-entry median**), per type | ×1.50 means 50% slower than clean entry for the same operation, so a slow operation does not inflate its own errors. Operations with fewer than 5 clean solves have no clean median, and if a whole type has none its ratio falls back to the all-solve median for those operations and is labelled in the footnote |
| Lost / run | median across runs of Σ(responseMs − that operation's clean median) over that type's questions | this is the absolute time cost and the panel's headline number. Only the excess beyond clean entry counts; an event solved faster than clean entry reduces it. Runs without the type contribute 0 |
| To 1st key (proxy) | median `firstInputMs` of the type | a **proxy** for thinking time: people often start typing before they finish computing. Possible only for engine-2 records |
| Typing after | median `entryMs` of the type | typing plus any thinking done after the first keystroke; first + entry = full solve time |
| Calculation trend | Theil–Sen slope of the calculation share per run over the last 20 runs, in percentage points per run, with Sen's CI | needs ≥6 runs; shares are noisy per run, treat the interval as descriptive |
| Time lost / run (total) | same Σ over all non-clean types, median across runs | |
| Rough question cost | total lost per run ÷ overall median solve time | a rough upper bound, like the pace panel's; removing errors entirely is not realistic, and nothing here promises a score gain |
| By operation | per operation × type: count, and the median relative to that operation's clean-entry median when n ≥ 3 | cells under 3 solves show "low n" instead of a ratio |

## Sample-size guidance

Medians need ≥6 observations for a distribution-free 95% CI (`medianCI`), so CIs disappear under 6 runs or for rare types. Per-operation cells suppress ratios below 3 observations. Rates over few runs move a run at a time. None of these numbers are calibrated psychometric measures, and comparing two panels of this kind side by side is descriptive, not evidence of improvement.
