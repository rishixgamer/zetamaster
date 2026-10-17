# Coach and progression subsystem — F34–F38 (PARTIAL)

`packages/training/src/planner.js` already creates a daily session prescription. Future `coach` components own milestones 30→40→50→60→70, personal training volume budgets, evidence-backed progress forecasts, plateau responses, and intervention scheduling.

Forecasts must include minimum sample sizes, held-out calibration, and explicit abstention when history is insufficient. A weekly schedule should never shame users for rest days.
