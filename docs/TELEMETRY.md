# Telemetry definitions (engine `zm-engine-2`)

All data stays on the device. Times come from a monotonic clock (`performance.now()`), relative to when a question was shown. Definitions live in `packages/core/src/session.js`; the error typology is in `packages/analytics/src/errors.js`.

## Answer acceptance

The field text is fed to the engine on every `input` event. A question is solved when `text.trim() === String(answer)`, matching the audited original (see [PARITY_AUDIT.md](./PARITY_AUDIT.md)). Leading zeros never match. Non-digit characters are not stripped, so the player has to delete them. Enter does nothing.

## Per solved question

| Field | Definition | Caveat |
|---|---|---|
| `responseMs` | question shown → solving input event | includes reading, thinking and typing |
| `firstInputMs` | question shown → first non-empty input | **proxy** for thinking time; people often start typing before they have finished computing |
| `entryMs` | first input → solve | typing plus any thinking done after the first keystroke |
| `corrections` | input events that shortened the field | |
| `wrongPrefixes` | entries into a state that can no longer become the answer (e.g. `8` when the answer is `72`, or `7a`) | |
| `fullWrongAnswers` | times a wrong value at least as long as the answer was typed | counted on growth only |
| `wrongSubmissions` | Enter pressed while the field held a non-empty non-answer | no game effect |
| `pasted` | an input event added more than one character | mobile autocomplete can trigger this too |
| `trace` | up to 48 `[ms, fieldText]` snapshots | field text truncated to 16 characters |
| `shownAtMs`, `completedAtMs` | offsets from session start | used for fatigue/position analysis |

## Error typology (one type per solved question)

1. **calculation**: a complete wrong answer was typed or submitted before the right one.
2. **slip**: a wrong digit appeared mid-entry and was fixed.
3. **revision**: text was deleted with no wrong prefix ever visible.
4. **clean**: typed straight through.

Engine-1 sessions have no `wrongPrefixes`, so any correction in them is reported as a slip.

## Session integrity (`result.integrity`)

- `hiddenCount`, `hiddenMs`: number and total length of page-hidden intervals before the deadline. The clock keeps running, as in the original, so hiding the page can't improve a score. Benchmarks stay valid but the results screen shows the hidden time.
- `pasteEvents`: count of multi-character insertions.

## Benchmark eligibility

`benchmark` is true only if `mode === 'benchmark'`, the rules snapshot equals `BENCHMARK_RULES`, the full duration elapsed, and the run wasn't ended manually. Imported sessions get this recomputed from those same fields by `packages/storage/src/sanitize.js`, and the score must also equal the number of solved events.

## Sample-size guidance

Medians from fewer than 6 observations get no confidence interval. Heatmap cells with fewer than 3 observations are shown as insufficient. None of these numbers are calibrated psychometric measures.
