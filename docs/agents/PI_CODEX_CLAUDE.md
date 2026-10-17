# Using Pi, Codex and Claude Code

The repository uses standard files so different agents can take over work without losing the architectural constraints.

## Startup in any agent

1. Set working directory to the extracted `zetamaster/` folder.
2. Ask the agent to read `AGENTS.md`, `docs/MILESTONES.md`, `specs/features.json`, and relevant package source.
3. Ask it to run `npm run check` *before* any change.
4. Request a PR-sized vertical slice with clear files, tests, and acceptance evidence.
5. Have a second model review benchmark contamination, arithmetic correctness, imported data handling and claims of feature completeness.

## Pi Coding Agent

Provide `AGENTS.md` explicitly in the opening task if your Pi setup doesn't automatically inject it. Use your preferred frontier model for planning, cheap/local models for narrow well-tested edits, and a stronger reviewer for score integrity. Avoid running multiple agents editing the same files concurrently.

## Codex

Work from the repo root. Use `AGENTS.md` as repository guidance. Assign bounded tasks such as F09 (heatmap) or F19 (persist review cards), and require passing `npm run check` in the same change.

## Claude Code

The included `CLAUDE.md` points to `AGENTS.md`. Ask for scoped implementation with tests, not a full-platform rewrite. Keep provider configuration outside source control.

## Parallel-agent boundaries

Safe parallel work: independent `packages/quant`, `packages/curriculum` lesson content and `packages/community` designs. High-conflict areas: `packages/core` generator/rules, `apps/web/src/main.js`, shared event schema and benchmark ID. Merge and run regression tests after each agent wave.
