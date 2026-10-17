# Future extension contracts: architecture for all 55 features

The project has concrete integration seams rather than decorative empty UI buttons.

| Surface | Function boundary | Main feature IDs | Correctness gate |
|---|---|---|---|
| Standard arithmetic | `RuleSet + seeded QuestionGenerator + Session` | F01–F06 | Source parity, immutable benchmark ID |
| Telemetry & analysis | `SessionRecord -> OperationSummary / Confidence / Heatmap` | F07–F15 | Sample sizes, correct timing semantics |
| Adaptive policy | `History + Budget -> TrainingPrescription` | F16–F22 | No training-policy effect on benchmark distribution |
| Lessons | `QuestionTags -> VerifiedLesson + HoldoutProblem` | F23–F29 | Mathematically verified techniques |
| Training modes | `TrainingModeRegistry -> Generator + Scorer` | F30–F33 | All modes have explicit nonbenchmark namespace |
| Coach | `History -> DailyPlan + GoalStages + Forecast` | F34–F38 | Transparent uncertainties; time bounded |
| Experiments | `TimedTrial -> A/B Effect + Uncertainty` | F39–F43 | Input calibration; no causal overclaims |
| Community | `VerifiedSession -> Rank / Achievement / Challenge / Duel` | F44–F48 | Opt-in account/service with anti-cheat |
| Quant academy | `QuantRuleSet -> ExactAnswer + IndependentScore` | F49–F55 | No benchmark score contamination |

Event schemas are owned by `packages/contracts/src/schema.js`. Keep new policies versioned. Add a migration plan for changed persisted fields.
