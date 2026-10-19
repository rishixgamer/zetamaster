import test from 'node:test';
import assert from 'node:assert/strict';
import { CUES, playCue } from '../apps/web/src/cues.js';

// Answer sound cues (F05): pure behavior against a stubbed AudioContext. Guarantees pinned here:
// cues are OFF by default, an unknown cue name is a no-op, a missing or throwing context degrades
// to silence, and scheduling uses exactly the spec's frequency, waveform, gain and duration —
// cosmetic playback that can never touch run timing (the module shares no clock with the engine).

function stubContext() {
  const calls = [];
  // AudioParam-shaped objects: the module assigns to the param's `.value` (as real WebAudio
  // requires — reconnecting the param itself is illegal), so the stub records on that setter.
  const param = label => ({ set value(v) { calls.push([label, v]); } });
  const gain = {
    gain: param('gain'),
    connect: target => calls.push(['gain-connect', String(target)]),
    toString: () => 'GAIN', // String(node) is what the connect assertions match on
  };
  const oscillator = {
    set type(v) { calls.push(['type', v]); },
    frequency: param('frequency'),
    connect(target) { calls.push(['osc-connect', String(target)]); },
    start() { calls.push(['start']); },
    stop(t) { calls.push(['stop', t]); },
  };
  return {
    calls,
    currentTime: 1.25,
    destination: 'DEST',
    createOscillator: () => (calls.push(['create-oscillator']), oscillator),
    createGain: () => (calls.push(['create-gain']), gain),
  };
}

test('cue specs are finite, positive and conservative', () => {
  for (const [name, spec] of Object.entries(CUES)) {
    assert.ok(['correct', 'finish'].includes(name));
    assert.ok(spec.frequencyHz > 0 && spec.frequencyHz < 20000);
    assert.ok(spec.durationMs > 0 && spec.durationMs < 1000);
    assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(spec.type));
    assert.ok(spec.gain > 0 && spec.gain <= 0.2, 'gain stays quiet');
  }
});

test('playCue schedules exactly the spec, once, and only when enabled', () => {
  const ctx = stubContext();
  assert.equal(playCue(ctx, 'correct', true), true);
  assert.deepEqual(ctx.calls, [
    ['create-oscillator'], ['create-gain'],
    ['type', 'sine'], ['frequency', 880], ['gain', 0.05],
    ['osc-connect', 'GAIN'], ['gain-connect', 'DEST'],
    ['start'], ['stop', 1.25 + 70 / 1000], // exact float on both sides: currentTime 1.25 + 0.07
  ]);
});

test('disabled cues, unknown names and unusable contexts all degrade to silence', () => {
  const ctx = stubContext();
  assert.equal(playCue(ctx, 'correct', false), false, 'OFF is the default and always silent');
  assert.equal(ctx.calls.length, 0, 'no scheduling at all when disabled');
  assert.equal(playCue(ctx, 'nonexistent', true), false);
  assert.equal(playCue(null, 'correct', true), false);
  const throwing = { createOscillator: () => { throw new Error('no audio device'); } };
  assert.equal(playCue(throwing, 'finish', true), false, 'playback failure never breaks the game');
});
