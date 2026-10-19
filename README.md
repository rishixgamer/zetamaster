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
- Custom single/multi-operation sessions, operation isolation, 30-second sprints, 300-second endurance, custom duration, deterministic seeds, slowest-question replay, and custom minimum/maximum operand ranges per axis for the addition and multiplication families (subtraction/division derive from those inversely; custom rulesets always stay practice-only and can neither count as benchmarks nor out-live the values that pass validation).
- Speed-interval sets: several short work bouts (each an independent, always-practice "sprint" run) with manually continued recovery pauses and a monotonic rest meter between them; the card quotes your *measured* second-half slowdown as the evidence link while stating plainly that recovery as a countermeasure is an untested hypothesis ([Telemetry](docs/TELEMETRY.md), [Fatigue](docs/FATIGUE.md)).
- Timed question records, first-keystroke timing proxy, corrections, slip/calculation-error typology, a bounded per-question wrong-answer history (values typed or Enter-submitted before the solve), tab-visibility integrity flags ([Telemetry](docs/TELEMETRY.md)), operation tags, medians, P90 latency and slow-question review.
- Difficulty tags extended additively by exact, hand-computed shapes (double column carry, three-digit operands, two-by-two, product ≥ 1000, multi-digit quotients, prime vs composite divisors); stored history keeps the tags of the engine that recorded it ([Feature matrix](docs/FEATURE_MATRIX.md)).
- A sequence history viewer over any saved session: every recorded question in recorded order with its answer, corrections, wrong attempts and the unfinished final problem flagged as unanswered, plus one-click whole-session replay that runs as a clearly labeled, untimed and unscored practice copy — never a new benchmark.
- Optional on-screen numeric keypad feeding the same answer field, and quiet answer sound cues: both settings persist device-locally, default **OFF**, and cannot touch timing telemetry (a cue is played only after a question is already scored; audio failures stay silent).
- Interactive, keyboard-accessible weakness heatmaps per operation, with sample counts, median CIs, a benchmark-only scope, deep links, and one-click 60 s cell drills that are always saved as practice.
- Versioned per-skill taxonomy shared with the heatmaps, per-skill rollups with sample-size gates, practice-scoped pattern drills with honest explanations that auto-tune between runs (a lapsed review narrows the next drill to the easier half of the cell, four consecutive fast ones stretch it into the neighboring band — a streak-based heuristic), and a daily-plan note naming your slowest recorded pattern; strategy effectiveness is not yet evaluated ([Skills](docs/SKILLS.md)).
- Persisted daily training plan (15-minute default): an exact-minute budget split across recall warm-up, targeted practice, technique lesson, mixed sprint and reflection — checkboxes persist per local day (schema-v3 `dailyPlans` store, no score data by design); plateau branches ([Skills](docs/SKILLS.md)) suggest *gauntlet rotation / method work / rest-and-vary* from record evidence (a hypothesis, not a measured treatment), and a coverage meter shows how much of the 420-pattern taxonomy your history has touched.
- Merged recommendations and a transparent score-impact heuristic ("what's worth doing next": due reviews, weakest gated patterns, plateau protocol, estimated payoff with the formula stated per row) — same-data calibration covers only the pace→points arithmetic; the payoff estimates are arithmetic on your history, not predictions ([Skills](docs/SKILLS.md)). A seeded, flag-controlled policy line picks which surface the Train tab emphasizes; no policy-outcome tracking exists yet.
- Spaced pattern reviews: every completed 60 s heatmap/pattern drill records a fast-and-clean per-skill review — success needs at least half the solves inside the 2 s line *and* without a wrong answer typed or Enter-submitted first (interrupted or too-thin runs record nothing) — and a due-review queue on the Train tab prompts and launches what's at or overdue; the 1–60 day interval ladder is a heuristic, and drill efficacy remains unmeasured ([Skills](docs/SKILLS.md)).
- Latency-bound automaticity drills: a "flash 60s" run on any heatmap cell with a 2 s cap per question (slow questions count as *missed*, never scored) and a seeded generator that guarantees no fact repeats back to back; flash runs never feed the spaced-repetition ladder ([Telemetry](docs/TELEMETRY.md), [Gauntlet](docs/GAUNTLET.md)).
- Weakness gauntlet with train/holdout: the Train tab's gauntlet panel picks at most two gated-slowness categories per day, drills each with the tier ladder, then probes each family with fresh same-range problems from an independent day-scoped seed, and hands off to one standard benchmark — all practice runs, always excluded from benchmark metrics ([Gauntlet](docs/GAUNTLET.md)).
- Benchmark consistency dashboard: progress toward 8-of-10 at 70+, the 8th-best gap, rolling median and 10th–90th band chart, robust trend, and median CIs ([Consistency metrics](docs/CONSISTENCY.md)).
- Pace and slow-tail analysis: operation-adjusted solve time by part of the run, second-half slowdown with CIs, slow-question share, time lost per run, costliest stalls, and a log-binned histogram of the adjusted distribution with a ≥×2 tail share and Theil–Sen tail movement ([Pace metrics](docs/FATIGUE.md)).
- Entry-quality panel across standard benchmark runs: per-type rates, operation-adjusted time cost (relative to clean entry and seconds lost per run), a first-key vs typing proxy split, per-operation breakdown with sample gating, and a robust trend of the calculation share ([Entry quality](docs/ENTRY_QUALITY.md)).
- Local saved session history; separate standard and practice runs; rolling benchmark median, personal best and consistent-70 goal check.
- Initial adaptive operation weighting, basic diagnostics, and 12 deterministic arithmetic lesson cards.
- Interactive technique Academy: **all 12 cards** (2 addition, 2 subtraction, 5 multiplication, 3 division) rehearse untimed — guided (compute every step), partial (steps revealed, you finish the composition) and independent (answer straight away) — with fresh seeded transfer problems per technique and a hand-off to a 60-second pattern drill on the same operand pattern (the ×25 double-and-halve card has none: its pair never occurs in the benchmark operand space, stated in the UI, not hidden; all practice runs, never benchmark metrics). The arithmetic is computed once in deterministic code, pinned by tests to each card's example ([Feature matrix](docs/FEATURE_MATRIX.md)).
- A seeded **strategy duel** in the Academy comparing the two curated techniques arm-by-arm on identical problems (round-vs-left-to-right addition; inverse-vs-factor division) with a per-problem first-try tally and a deterministic recommendation — an honest tiny-n comparison, not a significance test — and a **coach verifier**: any pasted explanation's arithmetic claims are recomputed exactly against the card's checked plan, shown only when every claim holds; opt-in, device-local, no grading and no network transport in this build.
- IndexedDB-first session storage with localStorage fallback, downloadable JSON/CSV, JSON import, and opt-in local history deletion.
- Installable PWA with offline cache after an initial successful visit (browser permitting).
- Tests, code-agent instructions, development roadmap and **55 machine-readable acceptance records**.
- **Browser smoke runner** (`npm run smoke`): 18 end-to-end checks against the real app in a real Chrome (launch, custom ranges, keypad persistence, replay, Academy, quant view, a full 120-second standard benchmark stored `benchmark: true`, benchmark isolation sweep, zero page errors) — see [SMOKE](docs/SMOKE.md); no new dependencies.

## What is not finished

- Generator distribution and answer-acceptance rule were audited against the original client on 2026-10-17 ([Parity audit](docs/PARITY_AUDIT.md)). The timer cutoff and PRNG still differ, as documented there. **Individual score equivalence is not certified.**
- Complete difficulty/method taxonomy (skill cells are operand-space only in v1), calibrated learner model, in-run difficulty adaptation and cross-operation pattern drills remain to be built; wrong attempts are now persisted per question (engine 3) and spaced-review outcomes are fast-and-clean, but the drills' transfer to benchmark scores is still unmeasured — automaticity drills and the gauntlet are protocol + probe surfaces ([Gauntlet](docs/GAUNTLET.md)); the daily plan's plateau branches and minute allocation are transparent, deterministic heuristics, not measured policies; their evaluation is part of the pending F20/F21 work.
- AI tutor, multiplayer, verified leaderboards, account sync, full quant interview curriculum and market-making simulation are planned, **not usable yet**.
- Academy rehearsal now covers all 12 cards including division (F26); the duel compares only the two curated pairs (addition, division) because no other card pair rehearses the same problems, the coach surface verifies pasted prose but ships **no AI transport** (no keys, no network — adding one is a future explicit decision), and lesson-level strategy-recognition quizzes plus a per-card skill ladder remain future M3 work. Productivity/effectiveness of any of this practice on benchmark scores is unmeasured, as everywhere in ZetaMaster.

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
