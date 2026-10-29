# v1.0 tickets

Written 2026-10-28 from a release-readiness review. At that point `npm run check` passed 361/361 and `npm run smoke` passed 19/19. These tickets are kept as the record of what shipped in 1.0.0; ZM-01 to ZM-07 are all done (see [CHANGELOG.md](../../CHANGELOG.md)). Two items from ZM-04 were left until the repo went public: the `master` → `main` rename and the visibility change. Both are now done. Check counts in the tickets are as written then: the smoke suite is at 25 checks and `npm run check` at 386 in 1.0.0.

| # | Ticket | Priority | Needed for 1.0? |
|---|---|---|---|
| ZM-01 | [A reused seed lets the same sequence count as a benchmark again](ZM-01-benchmark-seed-reuse.md) | P0 | Yes |
| ZM-02 | [F46 leaderboard stays on this device but is labeled "Global"](ZM-02-f46-leaderboard-is-local.md) | P1 | Yes |
| ZM-03 | [F47 "tamper-proof" challenge link wording](ZM-03-f47-tamper-proof-wording.md) | P2 | Yes (small) |
| ZM-04 | [Release 1.0.0: version, changelog, branch, remote, tag](ZM-04-release-1.0.0.md) | P1 | Yes, last |
| ZM-05 | [Make the app work on a plain static host](ZM-05-static-hosting.md) | P2 | Only if 1.0 is hosted |
| ZM-06 | [Run the browser smoke suite in CI](ZM-06-smoke-in-ci.md) | P2 | Recommended |
| ZM-07 | [F48 phone-viewport and accessibility checks](ZM-07-mobile-and-a11y-smoke.md) | P2 | Recommended |

Suggested order: ZM-01 → ZM-02 → ZM-03 → ZM-04, then ZM-06 → ZM-07 → ZM-05.
