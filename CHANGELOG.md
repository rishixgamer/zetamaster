# Changelog

## 1.0.0 — 2026-10-29

First release. An offline-first, dependency-free mental arithmetic trainer for the 120-second default-format benchmark. 54 of the 55 specified features are `implemented` and F46 is `partial` (see [Feature matrix](docs/FEATURE_MATRIX.md)).

### Delivered

- **M0–M6**: the seeded generator and benchmark rules, the live game and session state machine, local history, analytics and the weakness heatmap, adaptive drills and a daily plan, the 12-card technique Academy, the on-device community features, and the separate quant practice academy. Benchmarks stay isolated from practice, replay, quant and modified runs.
- **Benchmark integrity**: a typed or preset seed can no longer be stored as another standard benchmark. Benchmark launches draw a fresh seed, and a repeated seed leaves the score metrics.
- **Honest wording**: the leaderboard is "Board on this device" (saved in this browser, never uploaded), and challenge links are no longer called tamper-proof. The checksum only catches accidental corruption.
- **Static hosting**: `index.html` and `sw.js` sit at the repo root and every URL is relative. The app runs from `python3 -m http.server`, or under a subpath, with working offline reload.
- **Browser smoke suite** (`npm run smoke`, 25 checks): now covers a 375×667 touch pass, a tap-only keypad run, a basic accessibility sweep (named controls, unique ids, a keyboard-reachable heatmap grid), an offline reload and a check that no view shows a raw `null`/`undefined`. It runs in CI as its own job.
- **Interface**: a visual polish pass (depth, hover/focus/disabled states, a view fade-in that respects reduced motion), a two-column Community layout, fixes for sideways scroll on phones, two inputs that had no accessible name, and a "(+null)" in the rank panel.

### Known limitations

- **Parity is not certified.** The generator distribution and answer-acceptance rule were audited against the original client on 2026-10-17, but the timer cutoff and the PRNG still differ ([Parity audit](docs/PARITY_AUDIT.md)). Individual score equivalence is not claimed.
- **Training efficacy is unmeasured.** Drills, the daily plan, spaced review and the policy trial record outcomes with gates. None of it proves that any treatment raises benchmark scores. The trial is a single-device crossover, and carryover between windows is unmodeled.
- **Community features are local only.** Ranks, achievements, challenge links and the score board live in this browser. There is no server, no accounts, no multiplayer and no independent verification. F46 is `partial` for this reason.
- The skill taxonomy covers operand space only. Method tags, cross-operation pattern drills and in-run difficulty adaptation are not built. No AI transport ships (adding one needs a privacy review and consent design).
- GitHub Actions has not run for this repository yet, so the CI jobs, including the smoke job on Linux, have never executed there. `npm run check` and `npm run smoke` were run locally on macOS.
