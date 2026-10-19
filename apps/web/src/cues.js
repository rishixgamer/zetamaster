/**
 * Answer sound cues (F05, M1 close-out). Cosmetic WebAudio blips, OFF by default, injected into
 * the UI only after the question is already scored — the module shares no clock with the session
 * engine, touches no telemetry, and swallows every playback failure so audio problems can never
 * break a game (a device without audio just stays silent).
 *
 * `playCue` takes an AudioContext the caller owns (created lazily on a user gesture in main.js,
 * satisfying browser autoplay policies) plus the cue name and the consent toggle. It returns true
 * only when something was actually scheduled, which keeps the behavior testable without audio.
 */

export const CUES = Object.freeze({
  correct: Object.freeze({ frequencyHz: 880, durationMs: 70, type: 'sine', gain: 0.05 }),
  finish: Object.freeze({ frequencyHz: 660, durationMs: 160, type: 'triangle', gain: 0.05 }),
});

export function playCue(context, name, enabled = true) {
  if (!enabled) return false;
  const spec = CUES[name];
  if (!spec || !context) return false;
  try {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = spec.type;
    osc.frequency.value = spec.frequencyHz;
    gain.gain.value = spec.gain;
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + spec.durationMs / 1000);
    return true;
  } catch {
    return false; // audio unavailable: silence, never an error loop
  }
}
