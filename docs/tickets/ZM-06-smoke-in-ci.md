# ZM-06 · Run the browser smoke suite in CI

**Priority:** P2 · **Labels:** ci, testing · **Blocked by:** ZM-04 (a remote is needed for CI to run at all)

**Feature IDs:** none (test infrastructure; M1 item 5 follow-up)

## Problem

`.github/workflows/ci.yml` runs only `npm run check`. The 19-check smoke suite, which has already caught one shipped bug that broke app startup (`docs/SMOKE.md`), runs only when someone remembers to run it locally. Its default Chrome path is macOS-only (`scripts/smoke.mjs:33`), but it already honors `$CHROME_BIN` and launches with `--headless=new`.

## Acceptance criteria

- [ ] Add a separate `smoke` job (so unit tests stay fast) on `ubuntu-latest`, Node 22, with `CHROME_BIN` set to the runner's preinstalled Chrome (`google-chrome`).
- [ ] The job runs on push and on pull requests and passes all 19 checks. Expect about 3 minutes, since it includes a real 120-second benchmark.
- [ ] On failure, upload `tmp/*.png` screenshots and the smoke log as artifacts.
- [ ] Add a CI section to `docs/SMOKE.md`, including any Linux-specific Chrome flags that turned out to be necessary.

## Benchmark integrity risks

None. The suite already sweeps every saved session to confirm "benchmark iff standard full run". After this ticket, that sweep runs on every PR.
