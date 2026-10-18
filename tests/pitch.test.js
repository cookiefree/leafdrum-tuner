import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../src/pitch.js';

const BUFFER_SIZE = 4096; // same as AnalyserNode fftSize in the app

// Sum of sine partials: partials = [[freqHz, amplitude], ...]
function makeSignal(partials, sampleRate, { n = BUFFER_SIZE, decayPerSecond = 0, phase = 0.3 } = {}) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (const [f, a] of partials) v += a * Math.sin(2 * Math.PI * f * t + phase);
    buf[i] = v * Math.exp(-decayPerSecond * t);
  }
  return buf;
}

// Deterministic PRNG so the noise test is repeatable.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function centsOff(measured, expected) {
  return 1200 * Math.log2(measured / expected);
}

const RATES = [48000, 44100];

for (const sr of RATES) {
  for (const f of [220, 261.63, 440, 880]) {
    test(`pure sine ${f} Hz at ${sr} Hz sample rate`, () => {
      const r = detectPitch(makeSignal([[f, 0.5]], sr), sr);
      assert.ok(r, 'expected a result');
      assert.ok(Math.abs(centsOff(r.freq, f)) < 2, `got ${r.freq}`);
      assert.ok(r.clarity > 0.95, `clarity ${r.clarity}`);
    });
  }
}

test('range edges: 120 Hz and 1400 Hz sines', () => {
  for (const f of [120, 1400]) {
    const r = detectPitch(makeSignal([[f, 0.5]], 48000), 48000);
    assert.ok(r, `no result for ${f}`);
    assert.ok(Math.abs(centsOff(r.freq, f)) < 3, `got ${r.freq} for ${f}`);
  }
});

test('strong 2nd and 3rd harmonics do not cause an octave error', () => {
  for (const sr of RATES) {
    const f0 = 261.63;
    const r = detectPitch(makeSignal([[f0, 0.4], [2 * f0, 0.3], [3 * f0, 0.2]], sr), sr);
    assert.ok(r);
    assert.ok(Math.abs(centsOff(r.freq, f0)) < 3, `got ${r.freq}`);
  }
});

test('tongue-drum-like note: decaying amplitude, inharmonic overtone', () => {
  // Fundamental plus a strong overtone near 2.76x (typical for struck metal), decaying.
  const sr = 48000;
  const f0 = 329.63; // E4
  const sig = makeSignal([[f0, 0.5], [2.76 * f0, 0.25], [5.4 * f0, 0.1]], sr, { decayPerSecond: 2 });
  const r = detectPitch(sig, sr);
  assert.ok(r);
  assert.ok(Math.abs(centsOff(r.freq, f0)) < 3, `got ${r.freq}`);
});

test('weak fundamental with strong 2nd harmonic (documented behaviour)', () => {
  // The fundamental is only 20% of the 2nd harmonic. The NSDF can still lock onto
  // the fundamental period, but this is the hardest case for any pitch detector,
  // so we only require that the answer is the fundamental OR exactly one octave up.
  const sr = 48000;
  const f0 = 220;
  const r = detectPitch(makeSignal([[f0, 0.1], [2 * f0, 0.5]], sr), sr);
  assert.ok(r);
  const okFundamental = Math.abs(centsOff(r.freq, f0)) < 5;
  const okOctaveUp = Math.abs(centsOff(r.freq, 2 * f0)) < 5;
  assert.ok(okFundamental || okOctaveUp, `got ${r.freq}`);
  console.log(`    weak-fundamental case returned ${r.freq.toFixed(2)} Hz (clarity ${r.clarity.toFixed(3)})`);
});

test('silence returns null', () => {
  assert.equal(detectPitch(new Float32Array(BUFFER_SIZE), 48000), null);
});

test('very quiet signal below the gate returns null', () => {
  const sig = makeSignal([[440, 0.001]], 48000);
  assert.equal(detectPitch(sig, 48000), null);
});

test('white noise gives null or low clarity', () => {
  const rand = mulberry32(12345);
  const buf = new Float32Array(BUFFER_SIZE);
  for (let i = 0; i < buf.length; i++) buf[i] = (rand() * 2 - 1) * 0.5;
  const r = detectPitch(buf, 48000);
  assert.ok(r === null || r.clarity < 0.5, `clarity ${r && r.clarity}`);
});

test('sine plus mild noise still detected', () => {
  const rand = mulberry32(777);
  const sig = makeSignal([[392, 0.5]], 48000);
  for (let i = 0; i < sig.length; i++) sig[i] += (rand() * 2 - 1) * 0.02;
  const r = detectPitch(sig, 48000);
  assert.ok(r);
  assert.ok(Math.abs(centsOff(r.freq, 392)) < 3, `got ${r.freq}`);
  assert.ok(r.clarity > 0.9);
});

test('a tone below minFreq is not reported', () => {
  // 90 Hz has a period longer than the lag range, so there is nothing to report.
  assert.equal(detectPitch(makeSignal([[90, 0.5]], 48000), 48000), null);
});

test('result is always inside [minFreq, maxFreq]', () => {
  for (const f of [90, 150, 700, 1600, 2000, 3000]) {
    const r = detectPitch(makeSignal([[f, 0.5]], 48000), 48000);
    if (r) assert.ok(r.freq >= 100 && r.freq <= 1500, `${f} Hz input gave ${r.freq}`);
  }
});

test('custom range is respected', () => {
  const sig = makeSignal([[300, 0.5]], 48000);
  const r = detectPitch(sig, 48000, { minFreq: 250, maxFreq: 400 });
  assert.ok(r);
  assert.ok(Math.abs(centsOff(r.freq, 300)) < 2);
});

test('works with a short buffer (2048 samples)', () => {
  const sig = makeSignal([[440, 0.5]], 48000, { n: 2048 });
  const r = detectPitch(sig, 48000);
  assert.ok(r);
  assert.ok(Math.abs(centsOff(r.freq, 440)) < 2);
});

test('accuracy sweep: every semitone from C3 to C6 within 3 cents', () => {
  const sr = 48000;
  let worst = 0;
  for (let midi = 48; midi <= 84; midi++) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    if (f > 1500) continue;
    const r = detectPitch(makeSignal([[f, 0.4], [2 * f, 0.15]], sr), sr);
    assert.ok(r, `no result for midi ${midi} (${f.toFixed(1)} Hz)`);
    const c = Math.abs(centsOff(r.freq, f));
    worst = Math.max(worst, c);
    assert.ok(c < 3, `midi ${midi}: ${r.freq.toFixed(2)} Hz vs ${f.toFixed(2)} Hz (${c.toFixed(2)} cents)`);
  }
  console.log(`    worst error in sweep: ${worst.toFixed(3)} cents`);
});

test('runs fast enough for a per-frame loop', () => {
  const sr = 48000;
  const sig = makeSignal([[110, 0.5]], sr); // lowest-allowed-ish note = longest lag range
  const runs = 200;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) detectPitch(sig, sr);
  const ms = (performance.now() - t0) / runs;
  console.log(`    ${ms.toFixed(2)} ms per call`);
  assert.ok(ms < 10, `too slow: ${ms} ms per call`);
});

// ---------------------------------------------------------------------------
// Struck-metal behaviour: inharmonic overtones, octave protection, clarity.
// ---------------------------------------------------------------------------

const INHARMONIC_FAMILIES = {
  'octave + 2.76': [2, 2.76],
  'bar-like 2.76, 5.4': [2.76, 5.4],
  'bar 2, 2.76, 5.4': [2, 2.76, 5.4],
  'tongue-ish 2.4, 3.9': [2.4, 3.9],
  'clamped bar 6.27, 17.5': [6.27, 17.5],
  'marimba-like 4, 10': [4, 10],
  'near-harmonic 2.02, 3.05': [2.02, 3.05],
};

function overtoneSignal(sr, f0, ratios, amp, decay) {
  const partials = [[f0, 0.5]];
  ratios.forEach((r, k) => {
    if (r * f0 < sr * 0.45) partials.push([r * f0, (0.5 * amp) / (1 + 0.3 * k)]);
  });
  return makeSignal(partials, sr, { decayPerSecond: decay, phase: 0.9 });
}

for (const [label, ratios] of Object.entries(INHARMONIC_FAMILIES)) {
  test(`inharmonic overtones (${label}): right note, within 3 cents, no octave error`, () => {
    for (const sr of RATES) {
      for (const amp of [0.2, 0.5, 0.7]) {
        for (const decay of [0, 4]) {
          for (let midi = 50; midi <= 84; midi += 2) {
            const f0 = 440 * Math.pow(2, (midi - 69) / 12);
            if (f0 > 1500 || f0 < 105) continue;
            const r = detectPitch(overtoneSignal(sr, f0, ratios, amp, decay), sr);
            const where = `${label} sr=${sr} amp=${amp} decay=${decay} f0=${f0.toFixed(1)}`;
            assert.ok(r, `null for ${where}`);
            const c = Math.abs(centsOff(r.freq, f0));
            assert.ok(c < 3, `${r.freq.toFixed(2)} Hz is ${c.toFixed(1)} cents off for ${where}`);
          }
        }
      }
    }
  });
}

test('never reports a sub-octave of a real note', () => {
  // Strong overtones make the NSDF peak at 2x the period almost as high as at 1x.
  for (const f0 of [220, 261.63, 329.63, 523.25]) {
    const r = detectPitch(overtoneSignal(48000, f0, [2, 2.76], 0.7, 2), 48000);
    assert.ok(r);
    assert.ok(Math.abs(centsOff(r.freq, f0)) < 3, `${f0} Hz read as ${r.freq}`);
  }
});

test('clarity: clean and drum-like tones score high, noise scores low', () => {
  const clean = detectPitch(makeSignal([[330, 0.5]], 48000), 48000);
  assert.ok(clean.clarity > 0.98, `clean ${clean.clarity}`);

  const drum = detectPitch(overtoneSignal(48000, 330, [2, 2.76, 5.4], 0.35, 3), 48000);
  assert.ok(drum.clarity > 0.75, `drum-like ${drum.clarity}`);

  // Brownian noise (low-frequency rumble) is the most pitch-like noise.
  const rand = mulberry32(5);
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const b = new Float32Array(BUFFER_SIZE);
    let y = 0;
    for (let i = 0; i < b.length; i++) {
      y = 0.98 * y + (rand() * 2 - 1) * 0.05;
      b[i] = y;
    }
    const r = detectPitch(b, 48000);
    if (r) worst = Math.max(worst, r.clarity);
  }
  assert.ok(worst < 0.7, `rumble reached clarity ${worst}`);
});

test('two unrelated tones at once: no crash, result stays in range (documented limitation)', () => {
  // Clarity cannot flag this case (the mix can still look periodic), so the
  // strike-voting stage has to deal with double hits. Here we only require sane output.
  const r = detectPitch(makeSignal([[261.63, 0.3], [392, 0.3]], 48000), 48000);
  if (r) assert.ok(r.freq >= 100 && r.freq <= 1500);
});

test('input buffer is not modified', () => {
  const sig = makeSignal([[440, 0.5]], 48000);
  const copy = Float32Array.from(sig);
  detectPitch(sig, 48000);
  assert.deepEqual(sig, copy);
});

test('a new strike over an old note still ringing: the new (stronger) note wins', () => {
  const sr = 48000;
  const note = (f, a, ph) => [[f, a], [2 * f, 0.3 * a], [2.76 * f, 0.15 * a]].map(([ff, aa], k) => [ff, aa, ph + k]);
  const mix = (parts) => {
    const b = new Float32Array(BUFFER_SIZE);
    for (let i = 0; i < b.length; i++) {
      let v = 0;
      for (const [f, a, p] of parts) v += a * Math.sin((2 * Math.PI * f * i) / sr + p);
      b[i] = v;
    }
    return b;
  };
  const cases = [
    [392, 261.63, 0.4], // fifth below, old ring 40% as strong
    [293.66, 392, 0.4], // old ring higher than the new note
    [440, 261.63, 0.4],
    [329.63, 261.63, 0.4],
    [523.25, 261.63, 0.3], // old ring exactly an octave below the new note
    [440, 220, 0.3],
  ];
  for (const [newF, oldF, ratio] of cases) {
    const r = detectPitch(mix([...note(newF, 0.3, 0.5), ...note(oldF, 0.3 * ratio, 1.7)]), sr);
    assert.ok(r, `null for new ${newF} over old ${oldF}`);
    assert.ok(Math.abs(centsOff(r.freq, newF)) < 3, `new ${newF} over old ${oldF} read as ${r.freq.toFixed(1)}`);
  }
});

test('a fundamental at 60% of the first overtone is still reported as the fundamental', () => {
  const f0 = 261.63;
  const r = detectPitch(makeSignal([[f0, 0.3], [2 * f0, 0.5]], 48000), 48000);
  assert.ok(r);
  assert.ok(Math.abs(centsOff(r.freq, f0)) < 3, `got ${r.freq}`);
});
