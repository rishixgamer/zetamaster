# ZM-03 · F47: challenge links are called "tamper-proof" but only detect corruption

**Priority:** P2 — wording · **Labels:** docs, community · **Blocks:** ZM-04

**Feature IDs:** F47

**Current status (specs/features.json):** F47 `implemented`

## Problem

Challenge tokens carry a 32-bit FNV-1a checksum (`packages/community/src/challenges.js`). That catches accidental damage such as a truncated paste. It's not a secret or a signature, though: anyone can change the seed or rules and recompute it. The copy claims more than that:

- `apps/web/src/main.js:1416` — "Share reproducible, tamper-proof challenge links…"
- `packages/community/src/challenges.js:12` — "detect link corruption or tampering"
- `packages/community/src/challenges.js:28` — error text "may be corrupted or tampered"
- `docs/COMMUNITY_THREAT_MODEL.md:45` — "detect link tampering or corruption"

Confirmed safe: challenge runs launch with `mode: 'custom'` (`main.js:1708`), so an edited link can never produce a benchmark run.

## Acceptance criteria

- [ ] Each of the four places above says the checksum catches accidental corruption and does not stop deliberate edits.
- [ ] The threat model records that challenge runs are always practice, which is why editable links are acceptable.
- [ ] Keep the `ChallengeTamperedError` class name for API stability; change only its message.

## Tests required

- [ ] `tests/challenges.test.js` still passes. It asserts the error class, not the message.
- [ ] Add a test that a decoded challenge launches as non-benchmark (`mode: 'custom'`), even when its rules are byte-identical to `BENCHMARK_RULES`.
