# Experimental laboratory — F39–F43

Laboratory modules for input calibration and experimental strategy comparisons:
- Copy-typing hardware baseline & keyboard diagnostics (`packages/core/src/calibration.js`, F40)
- Keystroke analysis & input state machine (`packages/core/src/session.js`, F39)
- Response-time distribution modeling (`packages/analytics/src/histogram.js`, F41)
- Seeded balanced A/B strategy trials and outcome testing (`packages/training/src/experiment.js`, F42)
- Performance consistency scoring (`packages/analytics/src/consistency.js`, F43)

Collect data only with explicit consent, randomize comparable stimuli, calculate empirical uncertainty, and never claim that keyboard input latency equals cognitive calculation time.
