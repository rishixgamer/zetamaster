# Community, Leaderboard, and Duel Threat Model & Privacy Controls (M5)

## Overview

The ZetaMaster community subsystem provides sustained benchmark ranking (F44), skill-based achievements (F45), global leaderboards (F46), challenge URL sharing (F47), and head-to-head duels.

Because ZetaMaster is offline-first and runs in untrusted user browsers, the community architecture adheres to strict security, privacy, and verification invariants.

---

## 1. Threat Model & Trust Boundaries

### A. Untrusted Client Environment
- **Threat:** A malicious user or browser extension can tamper with JavaScript memory, modify DOM elements, intercept HTTP requests, forged session timestamps, or forge completed scores (e.g., claiming a score of 250 in 120s with arbitrary answer strings).
- **Mitigation:**
  1. **Deterministic PRNG Replay:** All arithmetic problems are generated from a deterministic PRNG seed (`createGenerator(BENCHMARK_RULES, seed)`). The verification engine (`packages/services/src/anti-cheat.js`) re-simulates the exact problem sequence draw-for-draw. Any discrepancy in operands, operations, or expected answers results in immediate rejection (`QUESTION_REPLAY_MISMATCH`).
  2. **Score Integrity Check:** Reported scores must match the exact count of verified correct answers.

### B. Automated Bot Scripting & Synthetic Inputs
- **Threat:** An automated bot script or macro can read problem elements and inject keystrokes programmatically.
- **Mitigation:**
  1. **Physiological Latency Floor:** Human perception, cognition, calculation, and physical key actuation require finite time. Any solve with latency `< 100 ms` flags `SUPERHUMAN_LATENCY_DETECTED`.
  2. **Cadence Variance Analysis:** Automated scripts typically execute with rigid or uniform delays (e.g., `sleep(1200)`). The verification engine computes the standard deviation of solve latency across the session. If the standard deviation is `< 8 ms`, the session flags `BOT_CADENCE_DETECTED`.
  3. **Maximum Solve Rate Cap:** Human physiological throughput is capped at 2.5 solves per second (maximum 300 solves per 120 seconds). Sessions exceeding this rate are rejected.

### C. Benchmark Contamination & Spoofing
- **Threat:** Practice runs, drills with relaxed rules, custom timers, or question budgets could be submitted as standard benchmarks.
- **Mitigation:**
  - Standard benchmarks strictly require `mode === 'benchmark'`, `benchmark === true`, `elapsedMs >= 120000`, and rules byte-identical to `BENCHMARK_RULES`.
  - Practice modes never qualify for verified rankings or benchmark-exclusive achievements.

---

## 2. Privacy Guarantees & PII Protections

### A. Zero Telemetry by Default (Offline-First)
- All game features, local ranks, achievements, and challenge URLs operate **100% offline without network connectivity**.
- **No analytics SDKs, tracking pixels, cookies, or remote pings.**
- Affirmative opt-in consent is required before any leaderboard ranking or duel interaction can occur (`LEADERBOARD_CONSENT_KEY`, `DUEL_CONSENT_KEY`). Consent defaults to `OFF`.

### B. Zero PII in Challenge Sharing (F47)
- Challenge URLs (`ChallengeCodec`) encode **strictly** ruleset parameters and problem seeds:
  `{ v: 1, s: seed, d: duration, op: enabled, a: addition, m: multiplication, b: questionBudgetMs }`.
- Any token or URL containing user names, emails, user IDs, timestamps, device fingerprints, or scores is actively rejected with `InvalidChallengeError`.
- Includes a 32-bit FNV-1a checksum to detect link tampering or corruption (`ChallengeTamperedError`).

### C. Pseudonymous Player Handles
- Leaderboard registrations accept an alias only (3–20 alphanumeric characters, underscores, hyphens).
- Email addresses, URLs, and phone formats are rejected during sanitization (`sanitizeAlias`).

---

## 3. Anti-Abuse & Rate Limiting

- **Rate Limiting:** Each client / player token is limited to at most 5 submissions per hour (`MAX_SUBMISSIONS_PER_HOUR = 5`).
- **Right to Be Forgotten:** Players can wipe all local leaderboard data, forget stored handles, and clear submissions via the UI at any time.

---

## 4. Milestone Verification Gate

- **Offline Gate:** The application remains fully functional offline, produces local rankings and achievements without an account, and never transmits telemetry or personal data by default.
