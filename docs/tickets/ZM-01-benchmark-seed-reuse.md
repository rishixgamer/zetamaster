# ZM-01 · F01/F43: a reused seed lets the same 120 s sequence count as a benchmark again

**Priority:** P0 — benchmark integrity · **Labels:** bug, benchmark-integrity · **Blocks:** ZM-04

**Feature IDs:** F01, F43 (also affects F35, F44, F46 through shared benchmark history)

**Current status (specs/features.json):** F01 `implemented`, F43 `implemented`

## Problem

A standard benchmark uses whatever is in the SEED field, and that field is never cleared.

- `apps/web/src/main.js:435` — `currentSeed=(preset?.seed ?? $('#seed').value.trim()) || crypto.randomUUID();` runs for every mode, benchmark included. `updateMode` disables only the duration field in benchmark mode (`main.js:405`), so you can still see and edit the seed.
- `packages/core/src/session.js:187` — `benchmark` depends on mode, rules and full duration. Where the seed came from is never considered.
- `main.js:436` copies a preset's seed into the field (the gauntlet's day-scoped probe seed), and no code clears it afterwards. The `#gauntlet-benchmark` handler (`main.js:223-227`) calls `startGame` with no preset, so "Finish with standard benchmark" runs on the probe's seed. So does every later benchmark until the page reloads or you clear the field.
- `scripts/smoke.mjs:541-566` (check F43) currently treats a seeded benchmark stored as `benchmark: true` as correct.

**Effect:** The same seed means the same 120-second problem sequence. Every run on it counts toward the rolling median, personal best, the 8-of-10 goal, progression stage, rank and the local leaderboard. That contradicts AGENTS.md (no modified or easier runs in benchmark scores) and `docs/EVALUATION.md:19` ("Avoid training on these sequences"). The original Zetamac uses `Math.random` and cannot be seeded.

## Repro

I found this by reading the code and haven't reproduced it in a browser yet.

1. Train → Benchmark mode → type `abc` in SEED → play 120 s.
2. Start another benchmark without touching the field. The problem sequence is identical, and both runs are saved as `benchmark: true` with seed `abc`.
3. Variant: run a gauntlet probe, then click "Finish with standard benchmark". The benchmark uses the probe's seed.

## Scope / proposed fix

- [ ] Benchmark launches always draw a fresh `crypto.randomUUID()`. In benchmark mode the SEED field is cleared and disabled, with a one-line reason.
- [ ] Enforce this in core, not only in the UI: new sessions record `seedSource` (`random` | `user` | `preset`), and the `benchmark` flag requires `seedSource === 'random'`. A standard-rules run with a chosen seed is saved as practice.
- [ ] A preset's seed no longer lingers in the field after its run.
- [ ] Existing history: rewrite nothing. Flag benchmark sessions whose seed appears more than once, including in imports via `packages/storage/src/sanitize.js`, and show the count on the Analytics/Data surface. **Decide in this ticket** whether the 2nd and later runs on a repeated seed drop out of benchmark metrics. My recommendation is yes, with the excluded count shown.

## Benchmark integrity risks

This is the risk being fixed. Check that sessions recorded before `seedSource` existed keep their status except for the duplicate-seed rule. Unseeded legacy benchmarks must not change.

## Tests required

- [ ] `tests/session.test.js`: `benchmark` is false for `seedSource` `user` or `preset`, even with byte-identical rules and full duration.
- [ ] Wiring test: a benchmark launch ignores the `#seed` value. The gauntlet hand-off benchmark does not inherit a probe seed.
- [ ] History diagnostic: duplicate-seed benchmarks are flagged deterministically, both in stored history and after import.
- [ ] Smoke F43: the stored benchmark seed is a UUID, not the typed value; typing a seed in benchmark mode has no effect.

## Docs/status update required

`docs/BENCHMARK_PROTOCOL.md` (seed policy), `docs/PARITY_AUDIT.md` (RNG row: seeds are practice-only), `docs/TELEMETRY.md` (new `seedSource` field), F01/F43 acceptance text in `specs/features.json`, then regenerate the matrix.
