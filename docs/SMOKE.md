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
| M6 | Quant view renders its panels after the `$` fix |
| F43 | a seeded **full 120-second, real-time standard run** stores `benchmark: true` with `zetamac-default-v1` rules, full elapsed time, and the given seed |
| isolation | across every stored session, `benchmark === true` iff it is a complete standard run — practice is never a score |
| F19 | interrupted drill records no spaced-review entry |
| cleanup | delete-local-history empties the stores |

Details on purpose (pinned by unit tests, not duplicated here): generator distribution parity,
review scheduling math, import sanitization.

## Known limitations

- The standard benchmark runs in real time (~2 minutes per pass) — deliberately not virtualized:
  DevTools virtual time (advance/pause) left IndexedDB completions frozen after the run ended,
  which hung every later storage read. Wall-clock execution keeps the whole suite honest.
- The app's own `serviceWorker` occasionally holds a stale cache on very rapid successive runs in
  the same session; each pass uses a throwaway Chrome profile, so cold starts are unaffected.
