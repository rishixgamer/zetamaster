# Coach and progression subsystem — F34–F38

`packages/training/src/planner.js` creates daily session prescriptions. The coach and progression modules own:
- Milestone ladder 30→40→50→60→70+ (`packages/training/src/progression.js`, F35)
- Personal adaptive training volume budgets monitoring slowdown (`packages/training/src/volume.js`, F36)
- Evidence-backed progress forecasts with held-out calibration and sample-gated abstention (`packages/analytics/src/forecasting.js`, F37)
- Plateau detection and branch intervention (`packages/training/src/plateau.js`, F22)
- Progress-based merged recommendations (`packages/training/src/recommendations.js`, F38)

Forecasts include minimum sample sizes (>= 8 benchmark runs), held-out cross-validation, and explicit abstention when history is insufficient. Training volume recommendations never force continued practice and respect rest days without shame.
