import test from 'node:test';
import assert from 'node:assert/strict';
import { StrikeDetector, voteReadings, DEFAULTS } from '../src/onset.js';
import { detectPitch } from '../src/pitch.js';

// ---------------------------------------------------------------------------
// Helpers for loudness-only tests
// ---------------------------------------------------------------------------

// Loudness (RMS) of a set of strikes at time t (ms). Each strike rises over
// 40 ms (the analysis window smooths the attack) and then decays exponentially.
// Strikes add as uncorrelated signals (powers add).
function envelope(t, strikes, floor = 0.002) {
  let power = floor * floor;
  for (const s of strikes) {
    if (t < s.t0) continue;
    const rise = Math.min(1, (t - s.t0) / 40);
    const v = s.peak * rise * Math.exp((-s.decay * (t - s.t0)) / 1000);
    power += v * v;
  }
  return Math.sqrt(power);
}

// Run a detector over a loudness curve and collect events. Readings are a constant
// pitch with high clarity unless `reading` says otherwise.
function run(det, strikes, durationMs, { fps = 60, jitterMs = 0, reading, seed = 1 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const events = [];
  const dt = 1000 / fps;
  for (let t = 0; t <= durationMs; t += dt) {
    const time = t + (jitterMs ? (rnd() - 0.5) * 2 * jitterMs : 0);
    const rms = envelope(time, strikes);
    const r = reading ? reading(time, rms) : { freq: 261.63, clarity: 0.95 };
    for (const e of det.push({ time, rms, ...r })) events.push(e);
  }
  return events;
}

const ofType = (events, type) => events.filter((e) => e.type === type);

// ---------------------------------------------------------------------------
// Onset detection
// ---------------------------------------------------------------------------

test('a single sharp rise fires exactly one onset', () => {
  const ev = run(new StrikeDetector(), [{ t0: 500, peak: 0.3, decay: 1.5 }], 3000);
  assert.equal(ofType(ev, 'onset').length, 1);
  const onsetTime = ofType(ev, 'onset')[0].time;
  assert.ok(onsetTime >= 500 && onsetTime < 560, `onset at ${onsetTime}`);
});

test('a slowly decaying ring fires no further onsets', () => {
  const ev = run(new StrikeDetector(), [{ t0: 200, peak: 0.4, decay: 1.2 }], 6000);
  assert.equal(ofType(ev, 'onset').length, 1);
});

test('a second strike of equal strength on a ringing note is detected', () => {
  // At 600 ms the first ring has decayed to about 0.12.
  const ev = run(
    new StrikeDetector(),
    [{ t0: 300, peak: 0.3, decay: 1.5 }, { t0: 900, peak: 0.3, decay: 1.5 }],
    3500,
  );
  assert.equal(ofType(ev, 'onset').length, 2);
});

test('a quieter second strike on a ringing note is detected', () => {
  const ev = run(
    new StrikeDetector(),
    [{ t0: 300, peak: 0.4, decay: 1.5 }, { t0: 1000, peak: 0.25, decay: 1.5 }],
    3500,
  );
  assert.equal(ofType(ev, 'onset').length, 2);
});

test('two rises within the refractory period fire only one onset', () => {
  const ev = run(
    new StrikeDetector(),
    [{ t0: 400, peak: 0.3, decay: 1.5 }, { t0: 500, peak: 0.3, decay: 1.5 }],
    2500,
  );
  assert.equal(ofType(ev, 'onset').length, 1);
});

test('a strike below the gate is ignored', () => {
  const ev = run(new StrikeDetector(), [{ t0: 400, peak: 0.012, decay: 1.5 }], 2500);
  assert.equal(ofType(ev, 'onset').length, 0);
});

test('steady loud background noise does not trigger', () => {
  // About 0.05 +- 15%, above the gate but with no real rises.
  const det = new StrikeDetector();
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let onsets = 0;
  for (let t = 0; t < 10000; t += 1000 / 60) {
    const rms = 0.05 * (1 + (rnd() - 0.5) * 0.3);
    onsets += det.push({ time: t, rms, freq: null, clarity: 0 }).filter((e) => e.type === 'onset').length;
  }
  assert.equal(onsets, 0);
});

test('quiet background noise under the gate does not trigger', () => {
  const det = new StrikeDetector();
  let s = 11;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let onsets = 0;
  for (let t = 0; t < 10000; t += 1000 / 60) {
    const rms = 0.003 + rnd() * 0.012; // 0.003 .. 0.015
    onsets += det.push({ time: t, rms, freq: null, clarity: 0 }).filter((e) => e.type === 'onset').length;
  }
  assert.equal(onsets, 0);
});

test('works at 30 fps, 60 fps, 120 fps and with timestamp jitter', () => {
  const strikes = [{ t0: 400, peak: 0.3, decay: 1.5 }, { t0: 1500, peak: 0.3, decay: 1.5 }];
  for (const opts of [{ fps: 30 }, { fps: 60 }, { fps: 120 }, { fps: 60, jitterMs: 4 }]) {
    const ev = run(new StrikeDetector(), strikes, 3500, opts);
    assert.equal(ofType(ev, 'onset').length, 2, JSON.stringify(opts));
    assert.equal(ofType(ev, 'strike').length, 2, JSON.stringify(opts));
  }
});

test('reset() clears state', () => {
  const det = new StrikeDetector();
  run(det, [{ t0: 100, peak: 0.3, decay: 1.5 }], 300); // stop mid-capture
  det.reset();
  const ev = run(det, [], 1500);
  assert.equal(ev.length, 0);
});

test('setOptions() takes effect: raising the gate suppresses a soft strike', () => {
  const strikes = [{ t0: 400, peak: 0.05, decay: 1.5 }];
  assert.equal(ofType(run(new StrikeDetector(), strikes, 2000), 'onset').length, 1);
  const det = new StrikeDetector();
  det.setOptions({ gate: 0.1 });
  assert.equal(ofType(run(det, strikes, 2000), 'onset').length, 0);
});

// ---------------------------------------------------------------------------
// Capture window
// ---------------------------------------------------------------------------

test('the result arrives after the capture window, not before', () => {
  const ev = run(new StrikeDetector(), [{ t0: 500, peak: 0.3, decay: 1.5 }], 2500);
  const onset = ofType(ev, 'onset')[0];
  const strike = ofType(ev, 'strike')[0];
  assert.ok(strike, 'expected a strike');
  assert.equal(strike.time, onset.time);
  assert.equal(Math.round(strike.freq * 100) / 100, 261.63);
  // The strike event is emitted on the first frame at or after onset + 120 + 300 ms.
  const emittedAt = (() => {
    const det = new StrikeDetector();
    let at = null;
    for (let t = 0; t <= 2500; t += 1000 / 60) {
      const rms = envelope(t, [{ t0: 500, peak: 0.3, decay: 1.5 }]);
      for (const e of det.push({ time: t, rms, freq: 261.63, clarity: 0.95 })) {
        if (e.type === 'strike' && at === null) at = t;
      }
    }
    return at;
  })();
  assert.ok(emittedAt >= onset.time + 420 && emittedAt < onset.time + 420 + 20, `emitted at ${emittedAt}`);
});

test('attack-transient readings are ignored, window readings are used', () => {
  // Garbage (500 Hz) during the first 120 ms after the strike, the real note after.
  const t0 = 500;
  const ev = run(new StrikeDetector(), [{ t0, peak: 0.3, decay: 1.5 }], 2500, {
    reading: (time) => (time < t0 + 130 ? { freq: 500, clarity: 0.95 } : { freq: 261.63, clarity: 0.95 }),
  });
  const strike = ofType(ev, 'strike')[0];
  assert.ok(strike);
  assert.ok(Math.abs(1200 * Math.log2(strike.freq / 261.63)) < 1, `got ${strike.freq}`);
});

test('low-clarity or missing readings give strike-failed (too-few-readings)', () => {
  const ev1 = run(new StrikeDetector(), [{ t0: 500, peak: 0.3, decay: 1.5 }], 2500, {
    reading: () => ({ freq: 261.63, clarity: 0.3 }),
  });
  assert.equal(ofType(ev1, 'strike').length, 0);
  assert.equal(ofType(ev1, 'strike-failed')[0].reason, 'too-few-readings');

  const ev2 = run(new StrikeDetector(), [{ t0: 500, peak: 0.3, decay: 1.5 }], 2500, {
    reading: () => ({ freq: null, clarity: 0 }),
  });
  assert.equal(ofType(ev2, 'strike-failed')[0].reason, 'too-few-readings');
});

test('a new strike during a capture closes the old capture with its readings so far', () => {
  // Second strike 330 ms after the first: the first capture has about 12 clean
  // readings (from +120 ms to +330 ms) and must still be reported.
  const strikes = [{ t0: 500, peak: 0.3, decay: 1.5 }, { t0: 830, peak: 0.3, decay: 1.5 }];
  const ev = run(new StrikeDetector({ refractoryMs: 250 }), strikes, 3000, {
    reading: (time) => (time < 830 ? { freq: 261.63, clarity: 0.95 } : { freq: 392, clarity: 0.95 }),
  });
  const strikesOut = ofType(ev, 'strike');
  assert.equal(strikesOut.length, 2);
  assert.ok(Math.abs(1200 * Math.log2(strikesOut[0].freq / 261.63)) < 1);
  assert.ok(Math.abs(1200 * Math.log2(strikesOut[1].freq / 392)) < 1);
});

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

const cents = (a, b) => 1200 * Math.log2(a / b);
const rd = (freq) => ({ freq, clarity: 0.9 });

test('vote: 7 readings agree, 3 are an octave off -> the majority wins', () => {
  const readings = [...Array(7).fill(0).map((_, i) => rd(261.63 * (1 + (i - 3) * 0.0004))), rd(523.25), rd(523.25), rd(130.81)];
  const v = voteReadings(readings);
  assert.ok(v.ok);
  assert.equal(v.midi, 60);
  assert.equal(v.readingsUsed, 7);
  assert.equal(v.readingsTotal, 10);
  assert.ok(Math.abs(cents(v.freq, 261.63)) < 2);
});

test('vote: fewer than 5 readings fails', () => {
  const v = voteReadings([rd(440), rd(440), rd(440), rd(440)]);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'too-few-readings');
});

test('vote: an even split between two notes fails as inconsistent', () => {
  const v = voteReadings([rd(261.63), rd(261.63), rd(261.63), rd(261.63), rd(261.63), rd(392), rd(392), rd(392), rd(392), rd(392)]);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'inconsistent');
});

test('vote: scattered readings fail as inconsistent', () => {
  const v = voteReadings([200, 250, 300, 350, 400, 450, 500, 550].map(rd));
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'inconsistent');
});

test('vote: a leaf tuned on the boundary between two notes gives one stable answer', () => {
  // 49.5 cents above A4: readings jitter by +-3 cents across the C/D boundary.
  const base = 440 * Math.pow(2, 49.5 / 1200);
  const readings = [-3, -2, -1, 0, 1, 2, 3, -2, 1, 3].map((c) => rd(base * Math.pow(2, c / 1200)));
  const v = voteReadings(readings);
  assert.ok(v.ok);
  assert.equal(v.readingsUsed, 10);
  assert.ok(Math.abs(cents(v.freq, base)) < 1.5, `got ${cents(v.freq, base)} cents from base`);
  assert.ok(v.midi === 69 || v.midi === 70);
});

test('vote: the a4 option shifts the note numbers', () => {
  const readings = Array(8).fill(rd(432));
  assert.equal(voteReadings(readings, { a4: 432 }).midi, 69);
  assert.equal(voteReadings(readings, { a4: 440 }).midi, 69); // 432 Hz is 31.8 cents flat of A4
  const v = voteReadings(Array(8).fill(rd(415.3)), { a4: 440 });
  assert.equal(v.midi, 68); // G#4
});

test('vote: an exact tie of two readings groups is resolved without throwing', () => {
  const v = voteReadings([rd(300), rd(300), rd(300), rd(300), rd(300), rd(300), rd(300), rd(300)], { minShare: 1 });
  assert.ok(v.ok);
});

// ---------------------------------------------------------------------------
// End to end: synthesised drum audio -> real pitch.js -> StrikeDetector
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Render a sequence of struck notes into one audio buffer.
// notes: [{ freq, atMs, amp }]. Each note: fundamental + two inharmonic overtones,
// 4 ms attack, exponential decay.
function renderDrum(sr, notes, totalMs, { decay = 1.5, noise = 0.002, seed = 3 } = {}) {
  const n = Math.round((sr * totalMs) / 1000);
  const buf = new Float32Array(n);
  const rand = mulberry32(seed);
  for (let i = 0; i < n; i++) buf[i] = (rand() * 2 - 1) * noise;
  for (const note of notes) {
    const start = Math.round((sr * note.atMs) / 1000);
    const phase = rand() * 6.28;
    for (let i = start; i < n; i++) {
      const t = (i - start) / sr;
      const env = Math.min(1, t / 0.004) * Math.exp(-decay * t);
      if (t > 0.01 && env < 1e-4) break;
      const f = note.freq;
      buf[i] +=
        note.amp *
        env *
        (Math.sin(2 * Math.PI * f * t + phase) +
          0.3 * Math.sin(2 * Math.PI * 2 * f * t + 1.1) +
          0.15 * Math.sin(2 * Math.PI * 2.76 * f * t + 2.3));
    }
  }
  return buf;
}

// Feed audio to a detector the way audio.js does: a 4096-sample analyser window,
// RMS over the last 2048 samples, one frame about every 16.7 ms.
function analyse(buf, sr, det) {
  const events = [];
  const hop = Math.round(sr / 60);
  for (let end = 4096; end <= buf.length; end += hop) {
    const win = buf.subarray(end - 4096, end);
    let sum = 0;
    for (let i = 4096 - 2048; i < 4096; i++) sum += win[i] * win[i];
    const rms = Math.sqrt(sum / 2048);
    const r = detectPitch(win, sr);
    const time = (end / sr) * 1000;
    for (const e of det.push({ time, rms, freq: r ? r.freq : null, clarity: r ? r.clarity : 0 })) events.push(e);
  }
  return events;
}

const midiToFreq = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);

function playScale(midis, spacingMs, opts = {}) {
  const { sr = 48000, amp = 0.35, a4 = 440, detune = 0, decay = 1.5 } = opts;
  const notes = midis.map((m, i) => ({
    freq: midiToFreq(m + detune / 100, a4),
    atMs: 800 + i * spacingMs,
    amp,
  }));
  const total = 800 + midis.length * spacingMs + 1500;
  const buf = renderDrum(sr, notes, total, { decay });
  const events = analyse(buf, sr, new StrikeDetector({ a4 }));
  return { events, strikes: ofType(events, 'strike'), failed: ofType(events, 'strike-failed') };
}

// A pentatonic-ish set, deliberately jumping around so neighbours are unrelated.
const SCALE = [60, 67, 62, 69, 64, 72, 65, 71]; // C4 G4 D4 A4 E4 C5 F4 B4

test('end to end: 8 leaves struck 1 s apart are all recognised', () => {
  for (const sr of [48000, 44100]) {
    const { strikes, failed } = playScale(SCALE, 1000, { sr });
    assert.equal(failed.length, 0, `failed: ${JSON.stringify(failed)}`);
    assert.deepEqual(strikes.map((s) => s.midi), SCALE, `sr=${sr}`);
  }
});

test('end to end: quick succession (0.5 s apart) is recognised', () => {
  const { strikes, failed } = playScale(SCALE, 500);
  assert.equal(failed.length, 0, `failed: ${JSON.stringify(failed)}`);
  assert.deepEqual(strikes.map((s) => s.midi), SCALE);
});

test('end to end: low notes (C3 to C4 region) are recognised', () => {
  const low = [48, 55, 50, 57, 52, 60, 53, 59]; // C3 G3 D3 A3 E3 C4 F3 B3
  const { strikes, failed } = playScale(low, 1000);
  assert.equal(failed.length, 0, `failed: ${JSON.stringify(failed)}`);
  assert.deepEqual(strikes.map((s) => s.midi), low);
});

test('end to end: soft strikes are recognised', () => {
  const { strikes, failed } = playScale(SCALE, 1000, { amp: 0.06 });
  assert.equal(failed.length, 0, `failed: ${JSON.stringify(failed)}`);
  assert.deepEqual(strikes.map((s) => s.midi), SCALE);
});

test('end to end: cents are reported accurately (leaves tuned 20 cents sharp)', () => {
  const { strikes } = playScale(SCALE, 1000, { detune: 20 });
  assert.equal(strikes.length, SCALE.length);
  strikes.forEach((s, i) => {
    const expected = midiToFreq(SCALE[i] + 0.2);
    assert.ok(Math.abs(cents(s.freq, expected)) < 3, `note ${i}: ${cents(s.freq, expected).toFixed(2)} cents off`);
    assert.equal(s.midi, SCALE[i]);
  });
});

test('end to end: a reference pitch of 432 Hz is honoured', () => {
  const { strikes } = playScale(SCALE, 1000, { a4: 432 });
  assert.deepEqual(strikes.map((s) => s.midi), SCALE);
});

test('end to end: leaves tuned near the boundary between two notes still give one answer each', () => {
  const { strikes, failed } = playScale(SCALE, 1000, { detune: 48 });
  assert.equal(failed.length, 0, `failed: ${JSON.stringify(failed)}`);
  assert.equal(strikes.length, SCALE.length);
  strikes.forEach((s, i) => {
    const expected = midiToFreq(SCALE[i] + 0.48);
    assert.ok(Math.abs(cents(s.freq, expected)) < 3, `note ${i} off by ${cents(s.freq, expected).toFixed(2)} cents`);
  });
});

test('end to end: the same leaf struck twice gives the same note twice', () => {
  const { strikes } = playScale([64, 64, 64], 900);
  assert.deepEqual(strikes.map((s) => s.midi), [64, 64, 64]);
});

test('end to end: silence and low background noise produce no events', () => {
  const sr = 48000;
  const buf = renderDrum(sr, [], 6000, { noise: 0.01 });
  assert.equal(analyse(buf, sr, new StrikeDetector()).length, 0);
});

test('end to end: ring decaying slowly (0.8 per second) with leaves struck 1 s apart', () => {
  const { strikes, failed } = playScale(SCALE, 1000, { decay: 0.8 });
  assert.equal(failed.length, 0, `failed: ${JSON.stringify(failed)}`);
  assert.deepEqual(strikes.map((s) => s.midi), SCALE);
});

test('end to end: consecutive leaves an octave apart (C4 then C5 while C4 still rings)', () => {
  const octaves = [60, 72, 64, 76, 67, 79, 60, 72];
  const { strikes, failed } = playScale(octaves, 1000);
  assert.equal(failed.length, 0, `failed: ${JSON.stringify(failed)}`);
  assert.deepEqual(strikes.map((s) => s.midi), octaves);
});

test('end to end: a clap or a thump on the table never produces a note', () => {
  const sr = 48000;
  const rand = mulberry32(21);
  const buf = new Float32Array(sr * 8);
  for (let i = 0; i < buf.length; i++) buf[i] = (rand() * 2 - 1) * 0.002;
  // Clap: white-noise burst, 30 ms decay constant.
  const clapAt = Math.round(sr * 1.0);
  for (let i = 0; i < sr * 0.3; i++) buf[clapAt + i] += (rand() * 2 - 1) * 0.5 * Math.exp(-i / (sr * 0.03));
  // Thump: low-passed noise (rumble), 100 ms decay constant.
  const thumpAt = Math.round(sr * 4.0);
  let y = 0;
  for (let i = 0; i < sr * 0.6; i++) {
    y = 0.97 * y + (rand() * 2 - 1) * 0.08;
    buf[thumpAt + i] += y * 2 * Math.exp(-i / (sr * 0.1));
  }
  const events = analyse(buf, sr, new StrikeDetector());
  assert.equal(ofType(events, 'strike').length, 0, JSON.stringify(ofType(events, 'strike')));
});

test('defaults are exported', () => {
  assert.equal(DEFAULTS.minClarity, 0.5);
  assert.equal(DEFAULTS.gate, 0.02);
});
