# Ready-to-paste coding agent prompts

## Starting from this repo

> Read AGENTS.md, README.md, docs/MILESTONES.md, and specs/features.json. Run npm run check. Do not change behavior yet. Identify the current milestone, verify the benchmark invariants and list the three highest-value missing vertical slices with tests and acceptance criteria. Prefer independently testable work. Do not claim unsupported parity with the original Zetamac.

## Milestone 1 — fidelity and analytics

> Implement F01 fidelity/property-based tests and F09 interactive arithmetic heatmaps. Keep arithmetic generation deterministic, never mix practice into benchmark analytics, add keyboard-accessible cells and direct-launch drills. Update docs, tests, and feature statuses only after validating working behavior.

## Milestone 2 — learning engine

> Implement F17–F20 as a cohesive adaptive learning slice: persist fact/pattern review state, estimate uncertainty, schedule spaced repetition, and create targeted drills. Use held-out mixed practice to measure transfer. Keep the deterministic standard mode untouched. Add tests and UI.

## Milestone 3 — curriculum

> Implement F23–F28 as interactive lessons: guided demonstrations, partial steps, novel transfer questions, and speed-restricted versions. Answers must be checked by deterministic arithmetic code; all new number patterns need examples and test cases.

## Milestone 4 — experimental performance research

> Implement F39–F43 as an opt-in analytics lab with input-copy calibration, A/B strategies, 90th-percentile latency interventions and consistency tracking. Disclose sample-size limitations, design tests and document the causal inference limits before claiming gains.

## Milestone 5 — quant extension

> Implement F49–F55 in a fully separate quant score namespace. Fractions must use exact rational arithmetic; percentages/EV must have deterministic answer validation; historical formats must be clearly labeled as historical. Do not pollute standard arithmetic score comparisons.
