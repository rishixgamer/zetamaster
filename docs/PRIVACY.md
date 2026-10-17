# Privacy and Offline Behavior

- No accounts, cookies, analytics SDKs or requests to outside services in this starter.
- IndexedDB first; localStorage fallback. Stored: timing, operands, answers, correction counts, selected seed, timestamp, mode and rules. Do not store keyboard characters unnecessarily.
- Full export JSON includes per-question records and timestamps; session CSV contains session-level summaries. Exports only on explicit click.
- User-triggered import accepts up to 10,000 basic session records; next milestone should apply full schema validation and size caps per event.
- Local clear-history action requires confirmation. Browser storage can also be cleared in browser settings.
- PWA caches public app code and assets, never user session data.
- Browser extensions, shared-device users and compromised profiles may access local data; do not promise absolute privacy.
- Any future AI, sync, or leaderboard backend requires a separate opt-in, clear retention controls, authentication threat review and deletion workflow.
