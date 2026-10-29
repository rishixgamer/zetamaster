# ZM-02 · F46: leaderboard stays on this device but is labeled "Global" and "Verified"

**Priority:** P1 — status honesty · **Labels:** bug, docs, community · **Blocks:** ZM-04

**Feature IDs:** F46 (wording also touches F44–F47 docs)

**Current status (specs/features.json):** F46 `implemented` — "Explicit opt-in server verified rankings with abuse and privacy protections"

## Problem

- `LeaderboardStore` (`packages/services/src/leaderboard.js:93`) reads and writes localStorage only, and the module contains no network code. The only entries anyone sees are their own submissions.
- The UI (`apps/web/src/main.js:1479-1489`) says "GLOBAL LEADERBOARDS · F46", "Verified Leaderboard", "Opt in to Global Leaderboard" and "Submit Latest Benchmark ↗". The draw-for-draw replay check runs in the same browser that produced the run. It confirms the run is self-consistent, but nobody independent verifies it.
- The per-hour rate limit is an in-memory `Map` (`leaderboard.js:96`), so it resets on every reload.
- `specs/features.json:575-579` and `docs/FEATURE_MATRIX.md:52` say `implemented` with server rankings, but `README.md:63` says server-side leaderboards are "not usable yet". The status legend defines `implemented` as "Usable in current web app".
- `docs/COMMUNITY_THREAT_MODEL.md:5` lists global leaderboards and head-to-head duels as provided. `packages/services/src/duels.js` isn't imported by the app; the only duels users can reach are the Academy strategy duels.

## Decision

- **A (recommended for 1.0):** Describe what exists: a personal board stored on this device, with F46 marked `partial`.
- **B:** Build the server: hosting, auth, server-side replay verification, abuse controls. Per AGENTS.md this needs its own ADR plus a privacy review, so it's out of scope for 1.0.

## Acceptance criteria (option A)

- [ ] UI copy reads as a personal board on this device: no "Global", no "Verified" and no ↗. It says plainly that entries never leave the browser.
- [ ] The opt-in toggle is either removed or reworded to describe what it controls. It must not read as consent to upload.
- [ ] F46 → `partial`, with acceptance text listing what exists (local board, client-side replay check) and what's missing (server, accounts, independent verification). Regenerate the matrix with `python3 scripts/generate-feature-specs.py`.
- [ ] Correct the docstrings and error copy in `leaderboard.js` (lines 4, 172, 194).
- [ ] `COMMUNITY_THREAT_MODEL.md`: the anti-cheat replay is client-side and only becomes a trust boundary once a server re-runs it. `duels.js` is a library the UI can't reach yet.
- [ ] README "What works today" gets one honest line for the local community features (F44 ranks, F45 achievements, F47 challenge links, F46 local board). None of them are mentioned there now.

## Data / privacy impact

None new. This ticket brings the wording in line with the existing local-only behavior.

## Tests required

- [ ] Static test: nothing under `packages/services/src` or `packages/community/src` references `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon`. This also guards the privacy default.
- [ ] Smoke: the Community view renders, the board toggle defaults OFF, and the word "Global" doesn't appear.
