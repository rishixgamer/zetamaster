# ZetaMaster

**An offline-first, instrumented mental arithmetic trainer.** Target: progress from ~30 to **consistent 70+** on a 120-second default-format Zetamac benchmark through diagnostic practice and explicit arithmetic instruction.

> **Repository status: working foundation + complete 55-feature implementation plan.** The playable browser app is included. Advanced features are *not* all implemented; `docs/FEATURE_MATRIX.md` provides the honest status and minimum acceptance criterion of each idea.

## Launch in 30 seconds

Requirements: **Node.js 20+**. No package installation, npm account, API key, cloud database or build step is required.

```bash
cd zetamaster
npm run dev
```

Open **http://127.0.0.1:5173** in a browser. To run tests:

```bash
npm run check
```

This zero-dependency starter is deliberately simple so Claude Code, Codex, Pi, or another coding agent can start making progress immediately. Later milestones may introduce TypeScript, React, a database server, or AI APIs **behind explicit architectural decisions**.

## What works today

- Browser-playable **120-second, four-operation default-format** arithmetic game with auto-submit on correct answers.
- Custom single/multi-operation sessions, operation isolation, 30-second sprints, 300-second endurance, custom duration, deterministic seeds, slowest-question replay.
- Timed question records, first-keystroke timing proxy, corrections, slip/calculation-error typology, bounded input traces, tab-visibility integrity flags ([Telemetry](docs/TELEMETRY.md)), operation tags, medians, P90 latency and slow-question review.
- Interactive, keyboard-accessible weakness heatmaps per operation, with sample counts, median CIs, a benchmark-only scope, deep links, and one-click 60 s cell drills that are always saved as practice.
- Versioned per-skill taxonomy shared with the heatmaps, per-skill rollups with sample-size gates, practice-scoped pattern-drill rulesets with honest explanations, and a daily-plan note naming your slowest recorded pattern; strategy effectiveness is not yet evaluated ([Skills](docs/SKILLS.md)).
- Spaced pattern reviews: every completed 60 s heatmap/pattern drill records a speed-based per-skill review (interrupted or too-thin runs record nothing), and a due-review queue on the Train tab prompts and launches what's at or overdue; the 1–60 day interval ladder is a heuristic, and drill efficacy remains unmeasured ([Skills](docs/SKILLS.md)).
- Benchmark consistency dashboard: progress toward 8-of-10 at 70+, the 8th-best gap, rolling median and 10th–90th band chart, robust trend, and median CIs ([Consistency metrics](docs/CONSISTENCY.md)).
- Pace and slow-tail analysis: operation-adjusted solve time by part of the run, second-half slowdown with CIs, slow-question share, time lost per run, costliest stalls, and a log-binned histogram of the adjusted distribution with a ≥×2 tail share and Theil–Sen tail movement ([Pace metrics](docs/FATIGUE.md)).
- Entry-quality panel across standard benchmark runs: per-type rates, operation-adjusted time cost (relative to clean entry and seconds lost per run), a first-key vs typing proxy split, per-operation breakdown with sample gating, and a robust trend of the calculation share ([Entry quality](docs/ENTRY_QUALITY.md)).
- Local saved session history; separate standard and practice runs; rolling benchmark median, personal best and consistent-70 goal check.
- Initial adaptive operation weighting, basic diagnostics, personalized 15-minute daily plan, and 12 deterministic arithmetic lesson cards.
- IndexedDB-first session storage with localStorage fallback, downloadable JSON/CSV, JSON import, and opt-in local history deletion.
- Installable PWA with offline cache after an initial successful visit (browser permitting).
- Tests, code-agent instructions, development roadmap and **55 machine-readable acceptance records**.

## What is not finished

- Generator distribution and answer-acceptance rule were audited against the original client on 2026-10-17 ([Parity audit](docs/PARITY_AUDIT.md)). The timer cutoff and PRNG still differ, as documented there. **Individual score equivalence is not certified.**
- Complete difficulty/method taxonomy (skill cells are operand-space only in v1), calibrated learner model, review outcomes that include accuracy (requires persisting wrong attempts), automatic drill difficulty (F18), and automated transfer/efficacy evaluation (F21/F22) remain to be built.
- AI tutor, multiplayer, verified leaderboards, account sync, full quant interview curriculum and market-making simulation are planned, **not usable yet**.
- The present arithmetic Academy teaches techniques but does not yet provide interactive step-through exercises.

For precise status of each feature, use [Feature Matrix](docs/FEATURE_MATRIX.md).

## Repository map

```text
zetamaster/
├── AGENTS.md                       # universal instructions for coding agents
├── CLAUDE.md                       # Claude Code entry point
├── .github/                        # CI, Copilot guidance, PR template
├── apps/web/
│   ├── index.html                   # local-first app
│   ├── styles.css
│   ├── src/main.js                  # browser UI and event handling
│   ├── sw.js                        # cache-first fallback for offline use
│   └── manifest.webmanifest
├── packages/
│   ├── core/src/                   # default rules, RNG, generator, session state
│   ├── analytics/src/              # operations, diagnosis, percentiles, mastery proxy
│   ├── training/src/               # adaptive planner, scheduler, A/B primitive
│   ├── curriculum/src/             # arithmetic instructional content
│   ├── quant/src/                  # isolated optional quant question namespace
│   ├── storage/src/                # local persistence and export/import
│   ├── contracts/src/              # versioned event/feature definitions
│   ├── coach/src/                  # progression/forecast extension boundary
│   ├── experiments/src/            # experimental training lab boundary
│   ├── community/src/              # ranks, challenges, leaderboard contracts
│   └── services/src/               # optional remote and AI service boundaries
├── specs/features.json             # all 55 features / status / criteria
├── docs/                           # architecture, milestones, benchmark protocol, evaluation
├── tests/                          # Node built-in unit tests
└── scripts/                        # local dev server, validation, specs generator
```

## Agent workflow

1. Open the folder in VS Code or your coding-agent environment.
2. Ask the agent to read `AGENTS.md`, `docs/MILESTONES.md`, and `specs/features.json`.
3. Have it run `npm run check` before making changes.
4. Assign one small vertical slice at a time using [coding-agent prompts](docs/agents/CODING_AGENT_PROMPTS.md).
5. Require tests, updated feature status, and verified browser behavior on every milestone.

Example initial prompt:

> Read AGENTS.md and docs/MILESTONES.md, run npm run check, audit the exact Zetamac default arithmetic distribution against the original, and add edge-case/property tests without changing practice scores. Report any parity uncertainty explicitly. Then recommend the next narrow PR.

## Benchmark integrity

Default source is [arithmetic.zetamac.com](https://arithmetic.zetamac.com/). The public configuration specifies the ranges and inverse operation rules. Benchmarks use unmodified 120-second sessions only. All training modes (including seeded custom mode, replay and quant extensions) are excluded from standard leaderboard/median metrics.

**This project is not affiliated with Zetamac or any quantitative trading firm.** A score of 70+ is a personal training target, not a hiring requirement.

## Privacy

Sessions are recorded locally in the browser. The starter includes no third-party analytics or API calls. An export button shares data only when clicked. Avoid storing identifying information in telemetry or challenge URLs. See [Privacy](docs/PRIVACY.md).

## License

MIT. Check the original game's branding, trademarks, and code license independently before commercial distribution. This implementation uses original code and public game-rule descriptions, not copied site source.
