# Zetamac Default-Format Parity Audit (F01)

**Audit date:** 2026-10-17 · **Method:** read the public client module served to a default game (`/game?key=a7220a92` → `/dist/app.js?v=2`) and the options form at `/`. The original code was read for behavior only; none of it is copied into this repository. Regression evidence: `tests/parity.test.js`.

## Result summary

| Behavior | Original client (as audited) | ZetaMaster | Status |
|---|---|---|---|
| Default options | add, sub, mul, div on; add (2–100)+(2–100); mul (2–12)×(2–100); 120 s | `BENCHMARK_RULES` identical | ✅ parity |
| Operation choice | uniform over enabled operations, one draw per problem | `floor(r·4)` via equal weights | ✅ parity |
| Operand draw | `min + floor(r·(max−min+1))`, inclusive; operation drawn first, then left, then right | same mapping and order | ✅ parity (draw-for-draw test against a reference model) |
| Subtraction | `(a+b) – a`, answer `b` (both from addition ranges) | same | ✅ parity |
| Multiplication | table factor (2–12) always shown on the left, never swapped | same | ✅ parity |
| Division | `(a·b) ÷ a`, divisor is the 2–12 factor, answer `b` | same | ✅ parity |
| Repeats | no duplicate avoidance | none | ✅ parity |
| Problem glyphs | `+`, `–` (en dash), `×`, `÷` | same (changed `−` → `–` in this audit) | ✅ parity |
| Answer acceptance | auto-advance when `field.trim() === String(answer)`; leading zeros do **not** match; non-digits stay in the field until deleted | same rule, field is not sanitized (audited on engine `zm-engine-2`; unchanged in engine `zm-engine-3`) | ✅ parity |
| Enter key | no handler | logged as telemetry only, no game effect | ✅ parity |
| Wrong answers | no penalty, nothing recorded as "wrong" | same — no penalty and no game effect; wrong submissions and wrong values are local, bounded telemetry (engine 3 keeps a per-question value history) | ✅ parity |
| Timer | wall clock (`Date.now`), 1 s `setInterval`; game ends on the first tick where `120 − floor(elapsed/1000) ≤ 0`; answers between 120 000 ms and that tick still count | monotonic clock, strict 120 000 ms cutoff | ≈ see below |
| Countdown display | integer "Seconds left" updated each second | `m:ss`, updated ~60 ms | cosmetic |
| RNG | `Math.random` (unseedable) | seeded `mulberry32`; a benchmark draws a fresh seed, and a chosen seed is practice-only | ≈ see below |

## Known, documented deviations

1. **Timer cutoff.** The original accepts answers until its next 1-second interval tick at or after 120 s (typically a few ms; longer if the browser delays timers). ZetaMaster stops accepting answers at exactly 120 000 ms on a monotonic clock. Effect on score: at most one problem in rare cases, biased *against* ZetaMaster scores. We keep the strict cutoff because it is reproducible.
2. **RNG.** Both produce uniform floats; sequences differ. Statistical properties are tested (chi-square on operation and operand marginals). Seeded replays are a ZetaMaster-only feature, and they are practice: a standard benchmark always draws a fresh seed, so a typed or preset seed cannot enter benchmark scores.
3. **Engine-1 sessions** (before this audit) accepted answers with leading zeros and stripped non-digit keystrokes. Practically no score effect, but sessions now carry `engineVersion` so they can be told apart.

## What this audit does not establish

- That the server always serves this client: the module is versioned (`?v=2`) and may change. Re-run the audit when the query string changes. Freshness re-check 2026-10-18: the live default game (`/game?key=a7220a92`) still serves `/dist/app.js?v=2` with the same default options — no re-audit required.
- Input-device, font, layout or browser rendering parity. Scores still depend on keyboard, latency and display.
- Score equivalence for any individual. The claim is: **the problem distribution and answer-acceptance rule match the audited client**, with the timer deviation above.
