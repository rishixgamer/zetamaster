# ZM-05 · Make the app work on a plain static host

**Priority:** P2 — only needed if 1.0 should be reachable by URL · **Labels:** infra, pwa · **Related:** ZM-04

**Feature IDs:** F48 (PWA install), no feature change

## Problem

The app currently only works behind `scripts/serve.mjs`, which rewrites two paths:

- `/` → `/apps/web/index.html` and `/sw.js` → `/apps/web/sw.js` (`scripts/serve.mjs`; the smoke server copies these rewrites at `scripts/smoke.mjs:55`).
- `apps/web/index.html` uses root-absolute URLs (`/apps/web/styles.css`, `/apps/web/src/main.js`, …). The manifest has `start_url`/`scope` `/`. The service worker registers at `/sw.js` with scope `/` (`main.js:1777`), and its `FILES` list is root-absolute.

On a static host serving the repo root, `/` returns 404 or a directory listing and `/sw.js` returns 404, so offline mode never installs. Under a subpath, such as a GitHub Pages project site at `/<repo>/`, every absolute URL breaks.

## Constraints

- No build step and no dependencies (ADR 0001).
- A service worker's scope can't be wider than its own directory without a `Service-Worker-Allowed` header, which static hosts usually can't set. The worker therefore has to sit at or above the page that registers it.
- Requests a controlled page makes for `/packages/...` go through its service worker wherever those files live, so caching them is fine.

## Acceptance criteria

- [ ] Serving the repo root with a server that does no rewrites (`python3 -m http.server`) boots the app. History persists across reload, and an offline reload after the first visit works.
- [ ] The same works under a subpath, e.g. serve the parent directory and open `/zetamaster/`.
- [ ] `npm run dev` and `npm run smoke` keep working; drop the smoke server's rewrites so smoke tests the static layout.
- [ ] Optional, after ZM-04: a GitHub Pages workflow that publishes on tag.

## Tests required

- [ ] A unit test that every URL in `index.html`, the manifest and the SW `FILES` list resolves relative to the page (no leading `/`), and every SW entry exists on disk.
- [ ] Smoke runs against a server that does no rewrites.
