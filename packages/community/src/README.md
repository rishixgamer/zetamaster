# Community subsystem — F44–F47 (NOT IMPLEMENTED)

Keep community an optional adapter, not a dependency of arithmetic gameplay.

Proposed interfaces:

- `RankPolicy.evaluate(rollingBenchmarkScores)` uses the same immutable benchmark namespace and stated personal goal rule.
- `AchievementPolicy.evaluate(verifiedSessionHistory)` rewards measured mastery rather than engagement streaks.
- `ChallengeCodec.encode({rulesetVersion, seed, duration})` is deterministic, URL safe and excludes user identity.
- `LeaderboardService.submit({signedSessionEvidence, displayName})` requires authentication, anti-bot/abuse limits, opt-in consent and server-side verification.
- `DuelService.match()` is future network-only functionality with separate latency and disconnect rules.

Do not claim browser-local events are cheat-proof. Do not send event-level keystroke data to a server by default.
