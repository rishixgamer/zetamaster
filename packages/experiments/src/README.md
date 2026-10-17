# Experimental laboratory — F39–F43 (PARTIAL)

Inputs: copy-typing baseline (`core/calibration.js`), first-input and entry latencies (`core/session.js`), session percentiles (`analytics/stats.js`), A/B assignment (`training/experiment.js`).

Next interfaces: `CalibrationProtocol`, `StrategyTrial`, `OutcomeAnalyzer`, `LatentSkillModel`, `ConfidenceIntervalEstimator`. Collect data only after consent, randomize comparable stimuli, calculate uncertainty, and never claim that keyboard input latency equals cognitive solving time.
