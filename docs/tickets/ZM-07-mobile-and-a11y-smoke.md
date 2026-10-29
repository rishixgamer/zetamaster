# ZM-07 · F48: automated phone-viewport and accessibility checks

**Priority:** P2 · **Labels:** testing, accessibility, mobile · **Related:** ZM-06

**Feature IDs:** F48 ("Focused answer entry, responsive layout, optional browser PWA install"); F09 keyboard heatmap

**Current status (specs/features.json):** F48 `implemented`

## Problem

`apps/web/styles.css` has breakpoints at 540/640/800/820/960 px, and the answer field already sets `inputmode="numeric"` and an `aria-label`. No automated check covers any of this, though: the smoke suite only runs at a desktop size and never calls `Emulation.setDeviceMetricsOverride`. The responsive-layout and accessibility promises are unverified.

## Acceptance criteria

- [ ] Add a phone-viewport smoke pass (375×667 with touch emulation) that visits all six views (`train`, `analytics`, `academy`, `quant`, `community`, `roadmap`) and asserts no horizontal overflow (`scrollWidth <= innerWidth`), nav reachable, and a screenshot saved to `tmp/`.
- [ ] On the phone viewport, a short custom run can be played with the on-screen keypad alone, and the answer field has focus when the run starts.
- [ ] Add a dependency-free accessibility sweep on each view: every `input`/`select` has an accessible name (label or `aria-label`), every `button` has text or `aria-label`, there are no duplicate `id`s, and every `role="grid"` cell is reachable by keyboard.
- [ ] `docs/SMOKE.md` says these checks are basic and do not amount to a WCAG audit. Adding axe-core would be a new dependency and needs an ADR.

## Tests required

- [ ] The new smoke checks pass locally and, once ZM-06 lands, in CI.
- [ ] Any accessibility violations the sweep finds are fixed in this ticket, or split into their own tickets.
