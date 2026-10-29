# ZM-04 · Release 1.0.0: version, changelog, branch, remote, tag

**Priority:** P1 · **Labels:** release · **Blocked by:** ZM-01, ZM-02, ZM-03 (ZM-05–ZM-07 only if they're in 1.0's scope)

**Feature IDs:** none (release mechanics)

## Current state

- `package.json` is `"version": "0.1.0"`, the only version string in the repo.
- There is no CHANGELOG, no git tags and no git remote, so `.github/workflows/ci.yml` has never run.
- Work happens on `master`, while repo tooling and PR conventions expect `main`.
- The README banner says "all 55 features implemented". After ZM-02 that will be untrue (F46 becomes `partial`).

## Decisions needed

- Where the repo lives, and whether it's public or private. The README's license section asks you to check Zetamac branding and trademarks independently before any public distribution.
- Whether 1.0 includes a hosted URL (ZM-05) and CI smoke (ZM-06), or is a local tool you clone and run.

## Acceptance criteria

- [ ] `git branch -m master main`; add the remote; push; CI goes green on GitHub.
- [ ] `package.json` → `1.0.0`.
- [ ] Add `CHANGELOG.md` with a 1.0.0 entry: delivered milestones M0–M6, plus a "Known limitations" section copied from the README's "What is not finished" (timer cutoff and PRNG parity deviations, unmeasured training efficacy, local-only community features).
- [ ] The README status banner matches `specs/features.json` exactly (counts per status).
- [ ] If any shipped file changed since the last cache bump, bump `CACHE` in `apps/web/sw.js` (currently `zetamaster-offline-v20`) so installed copies update.
- [ ] `npm run check` and `npm run smoke` are green on the release commit; record their output in the release notes.
- [ ] Tag the release commit with an annotated tag `v1.0.0`.
