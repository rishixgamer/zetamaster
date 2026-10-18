# Privacy and Offline Behavior

- No accounts, cookies, analytics SDKs or requests to outside services in this starter.
- IndexedDB first; localStorage fallback. Stored: timing, operands, answers, correction counts, selected seed, timestamp, mode and rules. Per-skill spaced-repetition records (F19, [SKILLS.md](./SKILLS.md)) store the skill id, taxonomy version, review counters and review timestamps only — no keystrokes, no identifying information. Do not store keyboard characters unnecessarily.
- Full export JSON is the versioned bundle `{ schema: 'zetamaster-export-v2', exportedAt, sessions, skillReviews }` with per-question records and timestamps plus per-skill review counters; session CSV contains session-level summaries. The legacy bare-array export/import shape remains accepted. Exports only on explicit click.
- User-triggered import accepts up to 10,000 basic session records and up to 10,000 skill-review records; malformed or foreign-taxonomy records are dropped and counted, never partially applied.
- Local clear-history action requires confirmation. Browser storage can also be cleared in browser settings.
- PWA caches public app code and assets, never user session data.
- Browser extensions, shared-device users and compromised profiles may access local data; do not promise absolute privacy.
- Any future AI, sync, or leaderboard backend requires a separate opt-in, clear retention controls, authentication threat review and deletion workflow.
