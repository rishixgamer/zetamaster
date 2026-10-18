import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PROGRESSION_STAGES, evaluateProgression } from '../packages/training/src/progression.js';
import { buildGhostTrajectory, compareGhostPace, selectPersonalBestBenchmark } from '../packages/analytics/src/ghost.js';
import { generateCopyTrials, evaluateCopyTrial, computeHardwareDiagnostics } from '../packages/core/src/calibration.js';
import { forecastProgress } from '../packages/analytics/src/forecasting.js';
import { forecastChartLayout, forecastChartSvg } from '../apps/web/src/score-chart.js';

const root = resolve(new URL('..', import.meta.url).pathname);

test('index.html contains all M3/M4 UI panel roots and modal elements', () => {
  const html = readFileSync(resolve(root, 'apps/web/index.html'), 'utf8');

  // F35: Skill Progression Ladder
  assert.ok(html.includes('id="ladder-panel"'), 'ladder-panel element in Train tab');
  assert.ok(html.includes('<span>LADDER TIER</span>'), 'LADDER TIER metric in top metrics');

  // F33: Ghost Racing pace display
  assert.ok(html.includes('id="ghost-pace"'), 'ghost-pace container in live game panel');
  assert.ok(html.includes('id="ghost-badge"'), 'ghost-badge element');
  assert.ok(html.includes('id="ghost-stats"'), 'ghost-stats element');
  assert.ok(html.includes('id="ghost-delta"'), 'ghost-delta element');

  // F40: Hardware Calibration modal
  assert.ok(html.includes('id="calibration-modal"'), 'calibration-modal element');
  assert.ok(html.includes('id="open-calibration"'), 'open-calibration button in setup');
  assert.ok(html.includes('id="calib-close"'), 'calib-close button');
  assert.ok(html.includes('id="calib-body"'), 'calib-body container');
});

test('main.js wires F33, F35, F37, F40 modules into the application lifecycle', () => {
  const main = readFileSync(resolve(root, 'apps/web/src/main.js'), 'utf8');

  // Imports verified
  assert.ok(main.includes('packages/training/src/progression.js'));
  assert.ok(main.includes('packages/analytics/src/ghost.js'));
  assert.ok(main.includes('packages/core/src/calibration.js'));
  assert.ok(main.includes('packages/analytics/src/forecasting.js'));

  // Panel rendering calls
  assert.ok(main.includes('renderLadderPanel('));
  assert.ok(main.includes('renderProgression();'));
  assert.ok(main.includes('renderForecast();'));
  assert.ok(main.includes('renderGhostPace('));
  assert.ok(main.includes('openCalibrationModal'));
});

test('forecast chart layout and SVG render calibrated projection intervals accurately', () => {
  const sessions = [30, 32, 35, 38, 41, 44, 46, 48, 51, 54].map((score, i) => ({
    mode: 'benchmark',
    benchmark: true,
    score,
    startedAt: `2026-10-18T${String(10 + i).padStart(2, '0')}:00:00Z`,
    events: [],
  }));

  const forecast = forecastProgress(sessions, { horizon: 10, confidence: 0.80 });
  assert.equal(forecast.abstain, false);

  const series = sessions.map((s, i) => ({ run: i + 1, score: s.score, at: s.startedAt }));
  const layout = forecastChartLayout(series, forecast, 70);
  assert.equal(layout.shown.length, 10);
  assert.equal(layout.horizon, 10);
  assert.ok(layout.horizonX > layout.xs[9]);

  const svg = forecastChartSvg(series, forecast, 70);
  assert.ok(svg.includes('forecast-chart'));
  assert.ok(svg.includes('polygon')); // fan
  assert.ok(svg.includes('line')); // projection line
  assert.ok(svg.includes('70 target'));
});

test('ghost pace evaluation computes delta and projections across live practice ticks', () => {
  const pbSession = {
    id: 'pb-1',
    mode: 'benchmark',
    benchmark: true,
    score: 40,
    elapsedMs: 120000,
    startedAt: '2026-10-18T10:00:00Z',
    events: Array.from({ length: 40 }, (_, i) => ({ responseMs: 3000, correct: true })),
  };

  const trajectory = buildGhostTrajectory(pbSession);
  assert.ok(trajectory);

  // At 30s into a 120s practice session:
  // Ghost score at 30s is 10 solves
  // If player has 12 solves: +2 ahead, projected final is (12/30)*120 = 48
  const livePace = compareGhostPace(12, 30000, trajectory);
  assert.equal(livePace.currentScore, 12);
  assert.equal(livePace.ghostScore, 10);
  assert.equal(livePace.delta, 2);
  assert.equal(livePace.status, 'ahead');
  assert.equal(livePace.projectedFinal, 48);
});

test('hardware calibration trial pipeline deterministically evaluates and computes diagnostics', () => {
  const trials = generateCopyTrials('test-calib-seed', 10);
  assert.equal(trials.length, 10);

  const evaluated = trials.map(t => evaluateCopyTrial(t, t.expected, 180 + t.digits * 25));
  const diagnostics = computeHardwareDiagnostics(evaluated);

  assert.ok(diagnostics);
  assert.equal(diagnostics.sampleSize, 10);
  assert.equal(diagnostics.accuracy, 1.0);
  assert.ok(diagnostics.medianMs >= 180);
  assert.ok(diagnostics.msPerDigit > 0);
  assert.ok(diagnostics.limitation.length > 0);
});
