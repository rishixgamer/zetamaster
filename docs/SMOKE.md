# Browser smoke QA

The smoke runner (M1 item 5: an end-to-end browser test runner) drives the real app in a real
Chrome over the DevTools protocol. It exists so "it works in tests" can be separated from "it
works in the browser" — and it has already earned its keep: on its first real pass it caught a
shipped defect the 333 unit tests could not see.

## What it caught (2026-10-19)

`apps/web/src/quant-ui.js` used the `$` DOM helper without defining it. `$` is module-local in
`main.js`, so `renderQuant()` (called by `main.js` init *before* `refresh()`) threw
`ReferenceError: $ is not defined` on every page load — and because that throw happened during
init, **no session history ever loaded on any first visit**: analytics stayed empty, top metrics
read "—", and the whole Train tab stayed data-blind. Fixed by defining the helper in the module
(same pattern as `main.js`); the smoke suite now records zero page errors for a full pass.

## Run it

```bash
npm run smoke
```

Requirements: Chrome installed at `/Applications/Google Chrome.app` (macOS default; override with
`$CHROME_BIN`) and Node >= 22 on the PATH of the machine running it (Node 22+ ships `WebSocket`,
which the CDP client uses; no npm dependencies are added; the script exits cleanly with a version
message on older Node). The runner serves the app itself on a free ephemeral port, so it does not
conflict with `npm run dev`.

## Run it in CI

`.github/workflows/ci.yml` has a separate `smoke` job (so the unit-test job stays fast) that runs on
every push and pull request: `ubuntu-latest`, Node 22, and the runner's preinstalled
`google-chrome` via `CHROME_BIN`. It takes about 3 minutes because it includes the real 120-second
benchmark. On failure it uploads `tmp/*.png` and `tmp/smoke.log` as the `smoke-failure` artifact.

Linux-specific details:

- `SMOKE_NO_SANDBOX=1` makes the runner launch Chrome with `--no-sandbox --disable-dev-shm-usage`.
  Hosted runners restrict unprivileged user namespaces, which Chrome's sandbox needs, and their
  `/dev/shm` is small. The flag is opt-in. Local runs keep the sandbox.
- The throwaway profile lives under `os.tmpdir()`; the runner used to assume a `tmpdir()/opencode`
  folder that exists on the author's Mac but not on a fresh machine.

## What the pass covers

All checks run through the same DOM surfaces a person uses (mode select, setup fields, keypad
buttons, input events) — nothing calls the app's internals directly:

| Surface | Check |
| --- | --- |
| boot | app loads over HTTP; zero JS errors for the whole session |
| F02 | custom mode opens the range panel; half-filled axis errors name the field, never guess |
| F05 | keypad + sound toggles persist to localStorage; survived reload; keypad digits feed the same answer path and score |
| F02/F10 | valid practice-only custom run (addition axis 3–5) records solved questions with tag arrays and engine-3 telemetry |
| reload | entry settings, last-used ranges and saved history survive a fresh document |
| F04 | sequence viewer renders history; replay of the slowest questions launches as labeled practice (`benchmark: false`) |
| F21 | randomized policy trial joins from the Train panel (seeded id stored), the policy line names the trial state, and leaving clears it |
| F26 | Academy rehearsal completes the pinned `68 + 50 = 118 = 115` card example incl. wrong-answer retry; drill hand-off runs as practice; transfer draw shows its seed |
| F27/F29 | strategy duel panel renders; coach verifier consent defaults OFF |
| F46 | Community view renders; the on-device board's save switch defaults off, turning it on enables save, the view does not say Global, and a stored row is still there after reload |
| F47 | A benchmark-shaped challenge link says the checksum catches accidental corruption and does not stop a deliberate edit. Accepting it starts `CUSTOM PRACTICE`, not a benchmark |
| M6 | Quant view renders its panels after the `$` fix |
| a11y | on each of the six views: every `input`/`select` has an accessible name (label, `aria-label`, `aria-labelledby` or `title`), every button has text or a name, no duplicate `id`s, and the heatmap `role="grid"` has exactly one Tab stop and a real ArrowRight key press moves focus one cell |
| F48 | phone pass (375×667, mobile and touch emulation): all six views are opened by a real tap on their nav link, none scrolls sideways (`scrollWidth` and `innerWidth` stay ≤ 375 — mobile emulation widens `innerWidth` to fit overflowing content, so it is compared with the fixed device width), and a screenshot of each is saved to `tmp/smoke-phone-<view>.png` |
| F48 | on the phone, a 3-question custom run is played with taps on the on-screen keypad only; the answer field has focus when the run starts; the run is saved as practice |
| F43 | a **full 120-second, real-time standard run** stores `benchmark: true` with `zetamac-default-v1` rules and full elapsed time. The seed field is disabled; a typed seed is ignored and the stored seed is a fresh UUID (`seedSource: random`) |
| isolation | across every stored session, `benchmark === true` iff it is a complete standard run — practice is never a score |
| F19 | interrupted drill records no spaced-review entry |
| cleanup | delete-local-history empties the stores |

The accessibility and phone checks are basic structural checks. They are **not a WCAG audit**: nothing
here measures colour contrast, screen-reader output, focus order beyond the heatmap grid, or touch-target
size. Adding axe-core would be a new dependency and needs an ADR first (ADR 0001: no dependencies).

Details on purpose (pinned by unit tests, not duplicated here): generator distribution parity,
review scheduling math, import sanitization.

## Known limitations

- The standard benchmark runs in real time (~2 minutes per pass) — deliberately not virtualized:
  DevTools virtual time (advance/pause) left IndexedDB completions frozen after the run ended,
  which hung every later storage read. Wall-clock execution keeps the whole suite honest.
- The app's own `serviceWorker` occasionally holds a stale cache on very rapid successive runs in
  the same session; each pass uses a throwaway Chrome profile, so cold starts are unaffected.
