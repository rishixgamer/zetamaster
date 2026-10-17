# Optional services boundary — F29, F46, F47, F54, F55

Zero remote service dependencies in the runnable starter.

Future interfaces: `AIExplanationService`, `SyncService`, `AccountService`, `ChallengeService`, `LeaderboardService`, and `DuelService`. Define a privacy-aware adapter contract and per-service explicit opt-in before implementing any network operations.

AI output is untrusted narrative: verify arithmetic deterministically and never treat a model as the source of scoring truth. Challenge URLs contain only mode/rules/seed. Signed session verification and anti-cheat checks are prerequisites for public rankings.
