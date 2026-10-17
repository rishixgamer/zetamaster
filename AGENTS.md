# AGENTS.md — Mandatory coding agent instructions

You are maintaining **ZetaMaster**, an offline-first, adaptive mental arithmetic trainer. The user is aiming to progress from ~30 to **consistent 70+** on default Zetamac. Never prioritize features that increase usage time over features that improve benchmark score.

## Product truth

- **Implemented ≠ validated parity.** The current standard preset implements publicly described original operation ranges and inverse question styles. An independent parity audit remains required before claiming identical probability distributions or score equivalence to the original site.
- Benchmark: 120 seconds; addition each operand 2–100; subtraction generated as inverse addition; multiplication 2–12 × 2–100; division generated as inverse multiplication; all four operations.
- NEVER mix practice, replay, quant, aborted, or modified runs into benchmark scores/leaderboards. Preserve `rules.id`, full rules snapshot, mode, and `benchmark` flags.
- Do not quietly switch to a different arithmetic distribution, lower difficulty, or loosen timing to raise scores.
- Avoid pretending `time to first key` is exact thought time. Label it a proxy.
- Do not add remote tracking, third-party analytics, API keys, or external sync without explicit opt-in and privacy review.
- Never claim 70+ is an official recruitment threshold for any quant firm.

## Architecture constraints

- App is currently **dependency-free ECMAScript modules** (Node >=20 for dev tools); this is deliberate so anyone can run it immediately. Migrating to React+TypeScript is a separate ADR, not a prerequisite to building features.
- `packages/core`: arithmetic rules, seeded generator, session state machine, input calibration.
- `packages/analytics`: stats, diagnosis, progress, heatmap aggregation, mastery proxy.
- `packages/training`: adaptive selection, daily plans, scheduler, experiments.
- `packages/curriculum`: human-verified lesson content, deterministic explanation suggestions.
- `packages/quant`: an independent non-benchmark training namespace.
- `packages/storage`: IndexedDB-first storage, JSON/CSV import/export.
- `apps/web`: presentation and browser-specific wiring; keep business logic in packages.
- `specs/features.json` is the source of truth for **all 55 features**; `docs/FEATURE_MATRIX.md` mirrors it.

## Required workflow for every change

1. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/MILESTONES.md` and relevant F-IDs in `specs/features.json`.
2. Choose a *single vertical slice* (UI + rules + data + tests) that can be reviewed independently. Respect the dependency order in milestones.
3. Document behavior and acceptance criteria, then implement. For modules with numeric reasoning, use deterministic functions and checked exact results.
4. Add/adjust unit tests for generator boundaries, inverse arithmetic, timing, benchmark isolation, and persistence invariants as applicable.
5. Run `npm run check` (Node >=20, no npm install). Add browser smoke tests when browser automation becomes available.
6. Update `specs/features.json` status, regenerate matrix with `python scripts/generate-feature-specs.py` (but first change the generator input if doing so), update relevant docs, and include validation evidence in PR.
7. Do not mark a feature implemented solely because a stub, type, algorithm sketch, or roadmap text exists.

## Coding standards

- Use named functions with small units and explicit inputs; avoid untested global state.
- All random runs accept an explicit seed for reproducibility; separate benchmark and experiment namespaces.
- Use `performance.now()` or another monotonic clock for active-timer calculations, never `Date.now()` alone.
- Sanitize imported data and user-controllable HTML; preserve keyboard and mobile accessibility.
- Use privacy-preserving local history as the default. Exports are user initiated.
- All public metrics need a documented definition and sample-size caveat.
- Ensure functions degrade gracefully when no sessions exist.

## High-leverage next PRs

1. `F01` independent source parity/distribution audit and comprehensive property tests.
2. `F07/F11/F39` explicit wrong-submission/correction semantics and reliable latency model.
3. `F09` accessible heatmaps and skill drill deep linking.
4. `F17/F18/F19` targeted pattern drills and persisted spaced repetition.
5. `F23–F28` interactive guided lessons with transfer practice.
6. `F43` robust consistency scoring and benchmark streak dashboard.

## Definition of done

- UI truly works (not a mock), tests pass, state survives reload, scores remain comparable, privacy defaults remain intact, docs updated, and there is no overclaim of coaching efficacy.
