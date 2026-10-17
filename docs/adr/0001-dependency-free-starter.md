# ADR 0001: Dependency-free ES module starter

Status: Accepted (initial scaffold).

## Context

A coding-agent-ready, usable starter should run immediately without network access, API keys or an npm registry. The user wants an actual repository, not a speculative package manifest that cannot be tested.

## Decision

Use web-native ES modules and Node built-in serving/testing for the first working version. Preserve package boundaries as migration seams for future TypeScript/React if justified.

## Consequences

Pros: zero install, offline support, auditable behavior, low operational complexity. Cons: no automatic type checking, browser integration testing not yet configured, manual view state logic, less ergonomic UI scaling. Add a follow-up ADR before adopting any new framework, checking preservation of core rules and data schema.
