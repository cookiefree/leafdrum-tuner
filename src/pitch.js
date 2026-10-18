// Pitch detection for struck, ringing instruments (tongue drums).
//
// Stage 1: McLeod Pitch Method (normalized square difference function, NSDF)
//          finds candidate periods.
// Stage 2: each candidate is checked and refined against a Hann-windowed spectrum.
//          - A real fundamental has a spectral line at its frequency; a wrong
//            sub-octave candidate does not, so octave-down errors are rejected.
//          - If two notes sound at once (a new strike over a ringing old one),
//            the strongest line wins: the new strike is the loudest.
//          - Inharmonic overtones (typical for struck metal) bias the NSDF peak by
//            several to tens of cents; the spectral line is not affected by them,
//            so the final frequency comes from the spectrum.
//
// Pure functions, no browser APIs, so it runs in Node tests.

const hannCache = new Map();
function hannWindow(n) {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return w;
}

// Power of the Hann-windowed DFT of x at frequency f (Hz). Uses a rotation
// recurrence instead of calling sin/cos for every sample.
function powerAt(x, win, sampleRate, f) {
  const w = (2 * Math.PI * f) / sampleRate;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  let c = 1;
  let s = 0;
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * win[i];
    re += v * c;
    im += v * s;
    const nc = c * cw - s * sw;
    s = s * cw + c * sw;
    c = nc;
  }
  return re * re + im * im;
}

// Find the spectral peak near f0: coarse scan, then golden-section search.
// Returns null if there is no real spectral line near f0.
function refineFrequency(x, win, sampleRate, f0, binHz) {
  // Strong inharmonic overtones can pull the NSDF estimate several percent away from
  // the true line, so search a wide neighbourhood (about +-3 semitones). The grid
  // step stays below one bin so the main lobe of the line is never skipped.
  const step = 0.75 * binHz;
  const half = Math.max(0.2 * f0, 1.5 * binHz);
  const nyq = sampleRate / 2 - step;
  const lo = Math.max(20, f0 - half);
  const hi = Math.min(nyq, f0 + half);

  let bestF = lo;
  let bestP = -1;
  for (let f = lo; f <= hi; f += step) {
    const p = powerAt(x, win, sampleRate, f);
    if (p > bestP) {
      bestP = p;
      bestF = f;
    }
  }

  let a = Math.max(20, bestF - step);
  let b = Math.min(nyq, bestF + step);
  const gr = 0.6180339887498949;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let pc = powerAt(x, win, sampleRate, c);
  let pd = powerAt(x, win, sampleRate, d);
  for (let i = 0; i < 14; i++) {
    if (pc > pd) {
      b = d;
      d = c;
      pd = pc;
      c = b - gr * (b - a);
      pc = powerAt(x, win, sampleRate, c);
    } else {
      a = c;
      c = d;
      pc = pd;
      d = a + gr * (b - a);
      pd = powerAt(x, win, sampleRate, d);
    }
  }
  const f = (a + b) / 2;
  const power = powerAt(x, win, sampleRate, f);
  // A real spectral line is a local maximum. If the power is still higher on
  // either side, we converged on the skirt of a neighbouring note: reject.
  if (powerAt(x, win, sampleRate, f - 0.5 * binHz) >= power) return null;
  if (powerAt(x, win, sampleRate, f + 0.5 * binHz) >= power) return null;
  return { freq: f, power };
}

/**
 * Detect the fundamental frequency of a monophonic signal.
 *
 * @param {Float32Array} buffer      time-domain samples (e.g. from AnalyserNode)
 * @param {number} sampleRate        samples per second
 * @param {object} [opts]
 * @param {number} [opts.minFreq=100]          lowest frequency to report (Hz)
 * @param {number} [opts.maxFreq=1500]         highest frequency to report (Hz)
 * @param {number} [opts.windowSize=2048]      samples analysed (taken from the end of buffer)
 * @param {number} [opts.candidateRatio=0.5]   NSDF peaks >= ratio * highest peak are candidates
 * @param {number} [opts.realRatio=0.5]        a lower candidate (freq/2, /3, /4 of the strongest
 *                                             line) replaces it as the fundamental if its
 *                                             spectral amplitude is >= ratio * the strongest's.
 *                                             Lower = trusts weak fundamentals more, but an
 *                                             old note ringing an octave below a new strike
 *                                             is more likely to be mistaken for the fundamental.
 * @param {number} [opts.minRms=0.005]         below this RMS the buffer counts as silence
 * @returns {{freq: number, clarity: number} | null}
 *   clarity is the NSDF value (0..1) at the chosen period: how periodic the signal is.
 */
export function detectPitch(buffer, sampleRate, opts = {}) {
  const {
    minFreq = 100,
    maxFreq = 1500,
    windowSize = 2048,
    candidateRatio = 0.5,
    realRatio = 0.5,
    minRms = 0.005,
  } = opts;
  const MAX_CANDIDATES = 4;

  const W = Math.min(windowSize, buffer.length);
  const x = buffer.subarray(buffer.length - W);

  // Silence gate.
  let sumSq = 0;
  for (let i = 0; i < W; i++) sumSq += x[i] * x[i];
  if (Math.sqrt(sumSq / W) < minRms) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  // +1 so the last candidate lag still has a right-hand neighbour for interpolation.
  const maxLag = Math.min(Math.ceil(sampleRate / minFreq) + 1, Math.floor(W / 2));
  if (maxLag <= minLag + 2) return null;

  // NSDF for lags 0..maxLag: n(t) = 2 * sum(x[j] * x[j+t]) / sum(x[j]^2 + x[j+t]^2)
  // over j = 0 .. W-t-1. Values lie in [-1, 1]; 1 means perfectly periodic at lag t.
  const nsdf = new Float64Array(maxLag + 1);
  for (let t = 0; t <= maxLag; t++) {
    let acf = 0;
    let m = 0;
    const end = W - t;
    for (let j = 0; j < end; j++) {
      const a = x[j];
      const b = x[j + t];
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[t] = m > 0 ? (2 * acf) / m : 0;
  }

  // Key maxima: the highest point of each positive region of the NSDF.
  // Start after the NSDF first drops to zero or below (skip the lobe around lag 0).
  let t = 1;
  while (t < nsdf.length && nsdf[t] > 0) t++;

  const peaks = []; // lag indices of key maxima
  while (t < nsdf.length) {
    while (t < nsdf.length && nsdf[t] <= 0) t++;
    if (t >= nsdf.length) break;
    let best = t;
    while (t < nsdf.length && nsdf[t] > 0) {
      if (nsdf[t] > nsdf[best]) best = t;
      t++;
    }
    // A region may still be open when the lag range ends. That is fine as long as
    // its highest point is interior; a peak on the last lag may not be reached yet.
    if (best >= minLag && best > 0 && best < nsdf.length - 1) peaks.push(best);
  }
  if (peaks.length === 0) return null;

  let highest = 0;
  for (const p of peaks) if (nsdf[p] > highest) highest = nsdf[p];

  // Candidates: strong enough peaks, shortest lag (highest frequency) first.
  const lags = peaks.filter((p) => nsdf[p] >= candidateRatio * highest).slice(0, MAX_CANDIDATES);

  // Stage 2: verify and refine each candidate against the spectrum.
  const win = hannWindow(W);
  const binHz = sampleRate / W;
  const cands = lags.map((lag) => {
    // Parabolic interpolation of the NSDF peak (coarse frequency and clarity).
    const y0 = nsdf[lag - 1];
    const y1 = nsdf[lag];
    const y2 = nsdf[lag + 1];
    const denom = y0 - 2 * y1 + y2;
    let shift = 0;
    let clarity = y1;
    if (denom !== 0) {
      shift = Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / denom));
      clarity = y1 - 0.25 * (y0 - y2) * shift;
    }
    clarity = Math.min(1, clarity);
    const coarse = sampleRate / (lag + shift);
    const ref = refineFrequency(x, win, sampleRate, coarse, binHz);
    if (!ref) return null;
    return { freq: ref.freq, amp: Math.sqrt(ref.power), clarity };
  }).filter(Boolean);
  if (cands.length === 0) return null;

  // The strongest spectral line is the note that was just struck, even when an
  // older note is still ringing underneath it (that one is weaker and decaying).
  let strongest = cands[0];
  for (const c of cands) if (c.amp > strongest.amp) strongest = c;

  // Exception: if the strongest line is only an overtone of a lower line (that
  // line is at freq/2, /3 or /4 and clearly present), the lower line is the
  // real fundamental. Unrelated lower notes are NOT considered.
  let chosen = strongest;
  for (const c of cands) {
    if (c === strongest || c.amp < realRatio * strongest.amp || c.freq >= chosen.freq) continue;
    const ratio = strongest.freq / c.freq;
    const n = Math.round(ratio);
    if (n >= 2 && n <= 4 && Math.abs(1200 * Math.log2(ratio / n)) < 60) chosen = c;
  }
  if (!Number.isFinite(chosen.freq) || chosen.freq < minFreq || chosen.freq > maxFreq) return null;

  return { freq: chosen.freq, clarity: chosen.clarity };
}
